import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { GitService } from '../release/git.service';
import { ReleasesService } from '../release/releases.service';
import { decryptSecret } from '../common/crypto.util';
import { LlmService } from './llm.service';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const level = (score: number) => (score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low');

// Path patterns that signal a likely breaking change.
const BREAKING = [
  { re: /(^|\/)(migrations?|database)\/.*\.(sql|php)$/i, kind: 'db_migration', why: 'Database migration' },
  { re: /(_migration|migrate).*\.(sql|php|ts|js)$/i, kind: 'db_migration', why: 'Database migration' },
  { re: /(composer\.json|composer\.lock|package\.json|package-lock\.json|yarn\.lock)$/i, kind: 'dependency', why: 'Dependency change' },
  { re: /(routes?|api)\/.*\.(php|ts|js)$/i, kind: 'api', why: 'Route/API surface change' },
  { re: /\.(proto|graphql|openapi\.ya?ml|swagger\.ya?ml)$/i, kind: 'contract', why: 'API contract change' },
  { re: /(controller|resolver)s?\/.*\.(php|ts|js)$/i, kind: 'api', why: 'Controller/resolver change' },
  { re: /(config|\.env\.example|dockerfile|docker-compose)/i, kind: 'config', why: 'Config/infra change' },
];

@Injectable()
export class AiService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly git: GitService,
    private readonly releases: ReleasesService,
    private readonly llm: LlmService,
  ) {}

  status() {
    return { llm: this.llm.status() };
  }

  private async repoWithToken(id: string) {
    const { rows } = await this.pool.query(
      `SELECT id, name, slug, provider, remote_url, default_branch, github_token_enc
         FROM repositories WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Repository not found');
    const token = rows[0].github_token_enc ? decryptSecret(rows[0].github_token_enc) : undefined;
    return { repo: rows[0], token };
  }

  /** Historical change-failure rate for a channel (DORA-style). */
  private async channelFailureRate(channelKey: string) {
    const { rows } = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE d.status = 'succeeded')::int AS ok,
         count(*) FILTER (WHERE d.status = 'failed')::int    AS failed
       FROM deployments d JOIN channels c ON c.id = d.channel_id
      WHERE c.key = $1`,
      [channelKey],
    );
    const ok = rows[0].ok || 0;
    const failed = rows[0].failed || 0;
    const total = ok + failed;
    return { rate: total ? failed / total : 0, ok, failed, total };
  }

  // ── 1 & 7) Estimate release risk ───────────────────────────────────────────
  async releaseRisk(releaseId: string, channel = 'production') {
    const rel = await this.releases.get(releaseId); // throws 404 if missing
    const features = rel.items.filter((i: any) => i.item_type === 'feature').length;
    const bugs = rel.items.filter((i: any) => i.item_type === 'bug').length;
    const hotfixes = rel.items.filter((i: any) => i.item_type === 'hotfix').length;
    const repoCount = rel.repositories.length;
    const cfr = await this.channelFailureRate(channel);

    const factors: { label: string; points: number; detail?: string }[] = [];
    const add = (label: string, points: number, detail?: string) => {
      if (points) factors.push({ label, points, detail });
    };
    add('Cross-repo blast radius', Math.min(repoCount * 8, 32), `${repoCount} repositories`);
    add('Hotfixes included', hotfixes * 14, hotfixes ? `${hotfixes} hotfix(es) — rushed by nature` : undefined);
    add('Change volume', Math.min((features + bugs) * 3, 20), `${features} features, ${bugs} bug fixes`);
    add('Channel failure history', Math.round(cfr.rate * 30),
      `${(cfr.rate * 100).toFixed(0)}% of past ${channel} deploys failed (${cfr.failed}/${cfr.total})`);
    add('Unverified work items',
      Math.min(rel.items.filter((i: any) => !['verified', 'released'].includes(i.status)).length * 4, 18),
      undefined);

    const score = clamp(factors.reduce((s, f) => s + f.points, 0));
    const lv = level(score);
    let recommendation =
      lv === 'high'
        ? 'Stage on Canary first, require a second approver, and prepare the rollback plan before promoting.'
        : lv === 'medium'
          ? 'Promote during business hours with the on-call engineer available; watch health checks closely.'
          : 'Low risk — safe to promote with standard approval.';

    const narrative = await this.llm.complete(
      'You are a release engineering risk advisor. Be concise and concrete (max 4 sentences).',
      `Release ${rel.version} targeting ${channel}. Factors: ${JSON.stringify(factors)}. ` +
        `Computed risk score ${score}/100 (${lv}). Give a brief risk assessment and the single most important precaution.`,
    );

    return { release_version: rel.version, channel, score, level: lv, factors, recommendation, narrative };
  }

  // ── 2) Predict deployment failure ──────────────────────────────────────────
  async predictDeployment(releaseId: string, channel = 'production') {
    const risk = await this.releaseRisk(releaseId, channel);
    const cfr = await this.channelFailureRate(channel);
    // Blend historical base rate with this release's risk score.
    const probability = clamp((cfr.rate * 100 * 0.5) + (risk.score * 0.5), 0, 95);
    const confidence = cfr.total >= 10 ? 'high' : cfr.total >= 3 ? 'medium' : 'low';
    return {
      release_version: risk.release_version,
      channel,
      failure_probability: probability,
      level: level(probability),
      confidence,
      basis: `Historical ${channel} failure rate ${(cfr.rate * 100).toFixed(0)}% over ${cfr.total} deploys, blended with release risk ${risk.score}/100.`,
      top_factors: risk.factors.slice().sort((a, b) => b.points - a.points).slice(0, 3),
    };
  }

  // ── 3) Detect risky pull requests ──────────────────────────────────────────
  async riskyPullRequests(repoId: string, limit = 15) {
    const { repo, token } = await this.repoWithToken(repoId);
    if (!token) throw new NotFoundException('Repository has no GitHub token; add one to analyze PRs');
    const open = await this.git.listOpenPullRequests(repo, token, limit);
    const out: Array<{
      number: number; title: string; author: string; url: string;
      churn: number; files: number; age_days: number;
      score: number; level: string; reasons: string[];
    }> = [];
    for (const pr of open) {
      const stats = await this.git.getPullRequestStats(repo, token, pr.number).catch(() => null);
      if (!stats) continue;
      const ageDays = (Date.now() - new Date(pr.created_at).getTime()) / 86400000;
      const churn = stats.additions + stats.deletions;
      const reasons: string[] = [];
      let score = 0;
      if (churn > 800) { score += 35; reasons.push(`large diff (${churn} lines)`); }
      else if (churn > 300) { score += 20; reasons.push(`sizable diff (${churn} lines)`); }
      if (stats.changed_files > 25) { score += 20; reasons.push(`${stats.changed_files} files touched`); }
      else if (stats.changed_files > 10) { score += 10; reasons.push(`${stats.changed_files} files`); }
      if (ageDays > 14) { score += 18; reasons.push(`stale (${Math.round(ageDays)}d old)`); }
      if (stats.mergeable_state === 'dirty') { score += 20; reasons.push('merge conflicts'); }
      if (stats.commits > 20) { score += 8; reasons.push(`${stats.commits} commits`); }
      out.push({
        number: pr.number, title: pr.title, author: pr.author, url: pr.url,
        churn, files: stats.changed_files, age_days: Math.round(ageDays),
        score: clamp(score), level: level(clamp(score)), reasons,
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ── 4) Recommend reviewers ─────────────────────────────────────────────────
  async recommendReviewers(repoId: string, prNumber: number) {
    const { repo, token } = await this.repoWithToken(repoId);
    if (!token) throw new NotFoundException('Repository has no GitHub token');
    const files = await this.git.listPullRequestFiles(repo, token, prNumber);
    const pr = await this.git.listOpenPullRequests(repo, token, 100).then((l) => l.find((p) => p.number === prNumber));
    const authors = await this.git.topAuthorsForPaths(repo, token, files.map((f) => f.filename), pr?.author);
    return {
      pr_number: prNumber,
      files_changed: files.length,
      reviewers: authors.map((a) => ({
        login: a.login,
        reason: `Recently authored ${a.touches} change(s) to the touched files`,
      })),
      note: authors.length === 0 ? 'No clear file-ownership history found for these paths.' : undefined,
    };
  }

  // ── 5) Detect breaking changes ─────────────────────────────────────────────
  async breakingChanges(repoId: string, prNumber: number) {
    const { repo, token } = await this.repoWithToken(repoId);
    if (!token) throw new NotFoundException('Repository has no GitHub token');
    const files = await this.git.listPullRequestFiles(repo, token, prNumber);
    const flags: { file: string; kind: string; why: string }[] = [];
    for (const f of files) {
      for (const rule of BREAKING) {
        if (rule.re.test(f.filename)) { flags.push({ file: f.filename, kind: rule.kind, why: rule.why }); break; }
      }
      if (f.status === 'removed') flags.push({ file: f.filename, kind: 'removal', why: 'File removed (possible API removal)' });
    }
    const kinds = [...new Set(flags.map((f) => f.kind))];
    const lv = flags.some((f) => ['db_migration', 'contract', 'removal'].includes(f.kind))
      ? 'high' : flags.length ? 'medium' : 'low';

    const narrative = flags.length
      ? await this.llm.complete(
          'You are a senior reviewer detecting breaking changes. Max 3 sentences, concrete.',
          `PR #${prNumber} touches: ${JSON.stringify(flags.slice(0, 20))}. Summarize the breaking-change risk and what to verify before merge.`,
        )
      : null;

    return { pr_number: prNumber, level: lv, categories: kinds, flags, narrative };
  }

  // ── 6) Suggest rollback plan ───────────────────────────────────────────────
  async rollbackPlan(releaseId: string, channel = 'production') {
    const rel = await this.releases.get(releaseId);
    const prev = await this.pool.query(
      `SELECT r.id, r.version FROM deployments d
         JOIN releases r ON r.id = d.release_id
         JOIN channels c ON c.id = d.channel_id
        WHERE c.key = $1 AND d.status = 'succeeded' AND r.id <> $2
        ORDER BY d.finished_at DESC NULLS LAST LIMIT 1`,
      [channel, releaseId],
    );
    const target = prev.rows[0];
    const hasMigrations = rel.items.some((i: any) => i.item_type === 'hotfix') || rel.repositories.length > 0;
    const steps = [
      target
        ? `Re-promote release ${target.version} to ${channel} (rollback target) — pinned artifacts move back with no rebuild.`
        : `No prior succeeded ${channel} deploy found — roll back by re-pinning each repo to its previous tag manually.`,
      'If DB migrations shipped, run the corresponding down-migrations BEFORE switching traffic (verify each is reversible).',
      'Restart application services (php-fpm / queue workers) and clear caches.',
      'Run the post-deploy health check; confirm error rate and latency return to baseline.',
      'Notify stakeholders via the release channel and open an incident if customer impact occurred.',
    ];
    const narrative = await this.llm.complete(
      'You are an SRE writing a rollback runbook. Keep it to ordered, actionable steps.',
      `Rolling back release ${rel.version} on ${channel}. Rollback target: ${target?.version ?? 'none recorded'}. ` +
        `Repos: ${rel.repositories.map((r: any) => `${r.repository_name}@${String(r.commit_sha).slice(0, 8)}`).join(', ')}. ` +
        `Produce a concise rollback plan.`,
    );
    return { release_version: rel.version, channel, rollback_target: target?.version ?? null, steps, narrative };
  }

  // ── 8) Analyze production incidents ────────────────────────────────────────
  async analyzeIncidents(hours = 72) {
    const { rows: alerts } = await this.pool.query(
      `SELECT a.id, a.type, a.severity, a.message, a.status, a.created_at, s.name AS server_name
         FROM alerts a LEFT JOIN servers s ON s.id = a.server_id
        WHERE a.created_at > now() - ($1 || ' hours')::interval
        ORDER BY a.created_at DESC`,
      [hours],
    );
    const { rows: deploys } = await this.pool.query(
      `SELECT r.version, c.key AS channel, d.status, d.finished_at
         FROM deployments d JOIN releases r ON r.id = d.release_id JOIN channels c ON c.id = d.channel_id
        WHERE d.finished_at > now() - ($1 || ' hours')::interval
        ORDER BY d.finished_at DESC`,
      [hours],
    );
    // Correlate: an alert within 6h AFTER a deploy is a candidate regression.
    const suspected = alerts
      .map((a) => {
        const link = deploys.find(
          (d) => d.finished_at &&
            new Date(a.created_at) >= new Date(d.finished_at) &&
            new Date(a.created_at).getTime() - new Date(d.finished_at).getTime() < 6 * 3600 * 1000,
        );
        return link ? { alert: a, deploy: link } : null;
      })
      .filter(Boolean);

    const byType = alerts.reduce((m: Record<string, number>, a) => {
      m[a.type] = (m[a.type] || 0) + 1; return m;
    }, {});
    const critical = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length;

    const narrative = alerts.length
      ? await this.llm.complete(
          'You are an incident analyst. Summarize patterns and likely release linkage in <=4 sentences.',
          `Window: last ${hours}h. ${alerts.length} alerts (by type ${JSON.stringify(byType)}), ${critical} high/critical. ` +
            `Recent deploys: ${JSON.stringify(deploys.slice(0, 8))}. Suspected release-linked: ${JSON.stringify(suspected.slice(0, 8))}.`,
        )
      : null;

    return {
      window_hours: hours,
      total_alerts: alerts.length,
      high_critical: critical,
      by_type: byType,
      recent_deploys: deploys.slice(0, 10),
      suspected_release_linked: suspected.slice(0, 10),
      narrative,
    };
  }

  // ── 9) AI-enhanced release notes ───────────────────────────────────────────
  async enhanceReleaseNotes(releaseId: string) {
    const generated = await this.releases.generateNotes(releaseId); // raw, data-driven
    const polished = await this.llm.complete(
      'You are a technical writer. Rewrite these raw release notes into a clear, customer-facing changelog. ' +
        'Group by Features / Fixes / Maintenance, keep IDs, do not invent items.',
      generated.release_notes || 'No content.',
      900,
    );
    return {
      raw: generated.release_notes,
      polished, // null when no LLM key — UI falls back to raw
      llm_used: !!polished,
    };
  }
}
