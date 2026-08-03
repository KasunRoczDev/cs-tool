import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { GitService } from './git.service';
import { decryptSecret } from '../common/crypto.util';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { StatusService } from './status/status.service';

@Injectable()
export class ReleasesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly git: GitService,
    private readonly rt: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly status: StatusService,
  ) {}

  list() {
    return this.pool
      .query(
        `SELECT r.id, r.version, r.name, r.status, r.planned_date, r.created_at, r.updated_at,
                r.archived_at, u.email AS created_by_email,
                (SELECT count(*)::int FROM release_repositories rr WHERE rr.release_id = r.id) AS repo_count,
                (SELECT count(*)::int FROM release_items ri WHERE ri.release_id = r.id) AS item_count
           FROM releases r
           LEFT JOIN users u ON u.id = r.created_by
          ORDER BY r.created_at DESC`,
      )
      .then((res) => res.rows);
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT r.*, u.email AS created_by_email
         FROM releases r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Release not found');
    const release = rows[0];
    const [repos, items] = await Promise.all([
      this.pool.query(
        `SELECT rr.*, rp.name AS repository_name, rp.slug AS repository_slug,
                rp.product_id AS product_id, p.name AS product_name
           FROM release_repositories rr
           JOIN repositories rp ON rp.id = rr.repository_id
           LEFT JOIN products p ON p.id = rp.product_id
          WHERE rr.release_id = $1
          ORDER BY rp.name`,
        [id],
      ),
      this.pool.query(
        `SELECT * FROM release_items WHERE release_id = $1
          ORDER BY item_type, item_key`,
        [id],
      ),
    ]);
    return { ...release, repositories: repos.rows, items: items.rows };
  }

  async create(input: { version: string; name?: string; planned_date?: string }, userId?: string) {
    if (input.planned_date && Number.isNaN(Date.parse(input.planned_date))) {
      throw new BadRequestException('planned_date must be a valid date');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO releases (version, name, planned_date, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.version, input.name ?? null, input.planned_date ?? null, userId ?? null],
    );
    this.rt.emitReleaseEvent('release.created', rows[0]);
    return rows[0];
  }

  async update(id: string, patch: { name?: string; planned_date?: string }) {
    const cols: Record<string, unknown> = { name: patch.name };
    if (patch.planned_date !== undefined) {
      if (patch.planned_date === '') {
        cols.planned_date = null; // '' clears it
      } else if (Number.isNaN(Date.parse(patch.planned_date))) {
        throw new BadRequestException('planned_date must be a valid date');
      } else {
        cols.planned_date = patch.planned_date;
      }
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) {
      if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
    }
    if (sets.length === 0) return this.get(id);
    sets.push('updated_at = now()');
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE releases SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Release not found');
    return rows[0];
  }

  /** Pin a repository + commit SHA into the release. */
  async addRepository(
    releaseId: string,
    input: {
      repository_id: string;
      commit_sha?: string;
      ref?: string;
      repo_version?: string;
      branch_name?: string;
    },
  ) {
    const rel = await this.get(releaseId);
    if (rel.status !== 'draft') {
      throw new BadRequestException('Can only pin repos while release is a draft');
    }
    const repo = await this.pool.query(
      `SELECT slug, provider, remote_url, default_branch, github_token_enc
         FROM repositories WHERE id = $1`,
      [input.repository_id],
    );
    if (!repo.rows[0]) throw new NotFoundException('Repository not found');
    const repoRow = repo.rows[0];
    const repoToken = repoRow.github_token_enc
      ? decryptSecret(repoRow.github_token_enc)
      : undefined;
    const sha =
      input.commit_sha ??
      (await this.git.resolveSha(repoRow, input.ref ?? 'main', repoToken));
    const { rows } = await this.pool.query(
      `INSERT INTO release_repositories
         (release_id, repository_id, commit_sha, repo_version, branch_name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (release_id, repository_id)
       DO UPDATE SET commit_sha = EXCLUDED.commit_sha,
                     repo_version = EXCLUDED.repo_version,
                     branch_name = EXCLUDED.branch_name
       RETURNING *`,
      [
        releaseId,
        input.repository_id,
        sha,
        input.repo_version ?? null,
        input.branch_name ?? null,
      ],
    );
    return rows[0];
  }

  async removeRepository(releaseId: string, repoLinkId: string) {
    await this.pool.query(
      `DELETE FROM release_repositories WHERE id = $1 AND release_id = $2`,
      [repoLinkId, releaseId],
    );
    return { deleted: true };
  }

  /** Bundle a feature/bug/hotfix changelog item into the release. */
  async addItem(
    releaseId: string,
    input: {
      item_type: 'feature' | 'bug' | 'hotfix';
      item_key: string;
      title: string;
      author?: string;
    },
  ) {
    await this.get(releaseId);
    const { rows } = await this.pool.query(
      `INSERT INTO release_items (release_id, item_type, item_key, title, author)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (release_id, item_type, item_key)
       DO UPDATE SET title = EXCLUDED.title, author = EXCLUDED.author
       RETURNING *`,
      [releaseId, input.item_type, input.item_key, input.title, input.author ?? null],
    );
    if (input.item_type === 'hotfix') {
      const rel = await this.pool
        .query('SELECT version FROM releases WHERE id = $1', [releaseId])
        .then((r) => r.rows[0]);
      this.notifications
        .notifyEvent('hotfix.created', {
          title: `Hotfix ${input.item_key} added to ${rel?.version ?? 'release'}`,
          lines: [`*${input.title}*`, input.author ? `by ${input.author}` : ''].filter(Boolean),
          severity: 'warning',
        })
        .catch(() => undefined);
    }
    return rows[0];
  }

  async removeItem(releaseId: string, itemId: string) {
    await this.pool.query(
      `DELETE FROM release_items WHERE id = $1 AND release_id = $2`,
      [itemId, releaseId],
    );
    return { deleted: true };
  }

  /**
   * Promote a release one step forward through its resolved workflow (the
   * default is draft->canary->beta->production->enterprise, but per-product
   * custom workflows are respected — see StatusService.nextStatusKey).
   *
   * Delegates the actual transition (permission/approval gate, status_id +
   * legacy status sync, history row, realtime/notify) to StatusService so
   * there's a single implementation of "move a release's status" — this is
   * just the legacy convenience entry point, kept gated the way it always
   * was (coarse admin/operator role + approvals, no fine-grained permission
   * check) so existing operator accounts aren't cut off. The dedicated
   * Status panel / POST .../transition enforces the fine-grained
   * status.transition.* permission instead.
   */
  async promote(id: string, userId: string, actorRole?: string) {
    const rel = await this.get(id);
    if (rel.status === 'archived') {
      throw new BadRequestException('Archived releases cannot be promoted');
    }
    if (rel.status === 'draft' && rel.repositories.length === 0) {
      throw new BadRequestException(
        'Cannot promote a draft with no pinned repositories',
      );
    }
    const next = await this.status.nextStatusKey(id);
    if (!next) {
      throw new BadRequestException(
        `Release at "${rel.status}" cannot be promoted further`,
      );
    }
    return this.status.transition(id, userId, actorRole, next, undefined, {
      skipPermissionCheck: true,
    });
  }

  async archive(id: string, userId: string, actorRole?: string) {
    return this.status.transition(id, userId, actorRole, 'archived', undefined, {
      skipPermissionCheck: true,
    });
  }

  /**
   * Auto-generate markdown release notes from (a) manually bundled items and
   * (b) live GitHub data per pinned repo — merged Pull Requests, commits, and
   * Feature/Bug IDs extracted from PR titles + commit messages. Repos without a
   * token (or non-GitHub) are skipped gracefully so generation never fails.
   */
  async generateNotes(id: string) {
    const rel = await this.get(id);
    const groups: Record<string, string> = {
      feature: '### ✨ Features',
      bug: '### 🐛 Bug Fixes',
      hotfix: '### 🚑 Hotfixes',
    };
    const lines: string[] = [
      `# ${rel.name ? rel.name + ' — ' : ''}Release ${rel.version}`,
      '',
      `_Status: ${rel.status} · generated ${new Date().toISOString().slice(0, 10)}_`,
      '',
    ];

    // (a) Manually bundled items.
    for (const type of ['feature', 'bug', 'hotfix'] as const) {
      const items = rel.items.filter((i: any) => i.item_type === type);
      if (items.length === 0) continue;
      lines.push(groups[type]);
      for (const it of items) {
        lines.push(
          `- **${it.item_key}** ${it.title}${it.author ? ` (@${it.author})` : ''}`,
        );
      }
      lines.push('');
    }

    // (b) Live aggregation from each pinned repo (best-effort).
    const allPRs: string[] = [];
    const allCommits: string[] = [];
    const featureIds = new Set<string>();
    const bugIds = new Set<string>();
    for (const r of rel.repositories) {
      try {
        const repo = await this.pool
          .query(
            `SELECT slug, provider, remote_url, default_branch, github_token_enc
               FROM repositories WHERE id = $1`,
            [r.repository_id],
          )
          .then((q) => q.rows[0]);
        if (!repo || (repo.provider ?? 'github') !== 'github' || !repo.github_token_enc) continue;
        const token = decryptSecret(repo.github_token_enc);
        const branch = r.branch_name || repo.default_branch || 'main';

        const prs = await this.git.listMergedPullRequests(repo, token, undefined, 30);
        for (const pr of prs) {
          allPRs.push(`- \`${r.repository_name}\` #${pr.number} ${pr.title} (@${pr.author})`);
          const ids = this.git.extractWorkIds(pr.title);
          ids.features.forEach((f) => featureIds.add(f));
          ids.bugs.forEach((b) => bugIds.add(b));
        }

        const commits = await this.git.listCommits(repo, token, r.commit_sha || branch, 30);
        for (const c of commits) {
          allCommits.push(`- \`${c.sha.slice(0, 8)}\` ${c.message} — ${c.author}`);
          const ids = this.git.extractWorkIds(c.message);
          ids.features.forEach((f) => featureIds.add(f));
          ids.bugs.forEach((b) => bugIds.add(b));
        }
      } catch {
        /* skip repos we can't read; notes generation stays resilient */
      }
    }

    if (featureIds.size > 0 || bugIds.size > 0) {
      lines.push('### 🔖 Tracked Work Items');
      if (featureIds.size > 0) lines.push(`- **Features:** ${[...featureIds].join(', ')}`);
      if (bugIds.size > 0) lines.push(`- **Bugs:** ${[...bugIds].join(', ')}`);
      lines.push('');
    }
    if (allPRs.length > 0) {
      lines.push('### 🔀 Merged Pull Requests');
      lines.push(...allPRs.slice(0, 100), '');
    }
    if (allCommits.length > 0) {
      lines.push('### 📝 Commits');
      lines.push(...allCommits.slice(0, 100), '');
    }

    if (rel.repositories.length > 0) {
      lines.push('### 📦 Pinned Artifacts');
      for (const r of rel.repositories) {
        lines.push(
          `- \`${r.repository_name}\` @ ${String(r.commit_sha).slice(0, 8)}` +
            (r.repo_version ? ` (v${r.repo_version})` : ''),
        );
      }
      lines.push('');
    }
    if (
      rel.items.length === 0 &&
      rel.repositories.length === 0 &&
      allPRs.length === 0 &&
      allCommits.length === 0
    ) {
      lines.push('_No items or repositories bundled yet._');
    }
    const notes = lines.join('\n');
    const { rows } = await this.pool.query(
      `UPDATE releases SET release_notes = $2, updated_at = now()
        WHERE id = $1 RETURNING release_notes`,
      [id, notes],
    );
    return { release_notes: rows[0].release_notes };
  }

  async getNotes(id: string) {
    const { rows } = await this.pool.query(
      `SELECT release_notes FROM releases WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Release not found');
    return { release_notes: rows[0].release_notes };
  }

  /**
   * CI/quality-gate status per pinned repo, read live from GitHub Check Runs
   * for that repo's pinned commit — not something the platform runs itself.
   * Repos without a GitHub token (or non-GitHub) report 'unavailable' rather
   * than failing the whole release's status.
   */
  async testStatus(id: string) {
    const rel = await this.get(id);
    const repositories = await Promise.all(
      rel.repositories.map(async (r: any) => {
        const repo = await this.pool
          .query(
            `SELECT slug, provider, remote_url, default_branch, github_token_enc
               FROM repositories WHERE id = $1`,
            [r.repository_id],
          )
          .then((q) => q.rows[0]);
        if (!repo || (repo.provider ?? 'github') !== 'github' || !repo.github_token_enc) {
          return {
            repository_name: r.repository_name, commit_sha: r.commit_sha,
            checks: [], overall: 'unavailable', reason: 'No GitHub token configured for this repository',
          };
        }
        try {
          const token = decryptSecret(repo.github_token_enc);
          const checks = await this.git.getCheckRuns(repo, token, r.commit_sha);
          const overall =
            checks.length === 0 ? 'no_checks'
              : checks.some((c) => c.status !== 'completed') ? 'pending'
                : checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required') ? 'failed'
                  : 'passed';
          return { repository_name: r.repository_name, commit_sha: r.commit_sha, checks, overall };
        } catch {
          return {
            repository_name: r.repository_name, commit_sha: r.commit_sha,
            checks: [], overall: 'unavailable', reason: 'GitHub API error',
          };
        }
      }),
    );
    return { release_id: id, repositories };
  }
}
