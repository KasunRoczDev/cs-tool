import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { GitProvider } from '../git-provider.port';
import { DomainEvent, EventTypes } from '../../../common/events/domain-event';
import {
  RepoRef, Cursor, Page, Branch, Commit, Tag, Comparison, ConflictReport, PullRequest,
  ReviewStatus, ChangedFile, CheckSummary, CheckRun, RateLimitInfo, ScopedToken,
  ProtectionRule, MergeStrategy, MergeResult, CreatePrInput,
} from '../types';

/**
 * GitHub adapter (MVP). Stub: method bodies show the Octokit call sites + the
 * cross-cutting concerns (App installation tokens, backoff, ETag, normalization).
 * Wire @octokit/rest in getClient() to make live.
 */
@Injectable()
export class GitHubAdapter extends GitProvider {
  readonly key = 'github' as const;
  private readonly log = new Logger(GitHubAdapter.name);

  // private async getClient(repo: RepoRef) { return new Octokit({ auth: (await this.getInstallationToken(repo)).token }); }
  private notImplemented(m: string): never { throw new Error(`GitHubAdapter.${m} not implemented (scaffold)`); }

  async getInstallationToken(_repo: RepoRef): Promise<ScopedToken> {
    // App JWT -> POST /app/installations/{id}/access_tokens ; cache per-installation until expiry.
    return { token: 'ghs_stub', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }
  async revokeToken(_t: ScopedToken): Promise<void> { /* DELETE /installation/token */ }
  async listInstallationRepos(_id: string): Promise<{ fullName: string }[]> { return []; }

  async listBranches(_r: RepoRef, _p?: Cursor): Promise<Page<Branch>> { return { items: [] }; }
  async getBranch(_r: RepoRef, _n: string): Promise<Branch | null> { return null; }
  async createBranch(_r: RepoRef, _n: string, _sha: string): Promise<Branch> { this.notImplemented('createBranch'); }
  async deleteBranch(_r: RepoRef, _n: string): Promise<void> { this.notImplemented('deleteBranch'); }
  async compareBranches(_r: RepoRef, _b: string, _h: string): Promise<Comparison> { return { aheadBy: 0, behindBy: 0, files: [] }; }
  async detectConflicts(_r: RepoRef, _s: string, _d: string): Promise<ConflictReport> { return { hasConflicts: false, files: [] }; }

  async listCommits(_r: RepoRef, _o: { branch?: string; since?: string }, _p?: Cursor): Promise<Page<Commit>> { return { items: [] }; }
  async getCommit(_r: RepoRef, _sha: string): Promise<Commit> { this.notImplemented('getCommit'); }
  async createTag(_r: RepoRef, _n: string, _sha: string): Promise<Tag> { this.notImplemented('createTag'); }
  async listTags(_r: RepoRef, _p?: Cursor): Promise<Page<Tag>> { return { items: [] }; }
  async createRelease(_r: RepoRef, _t: string, _notes: string): Promise<{ id: string; url: string }> { this.notImplemented('createRelease'); }

  async listPullRequests(_r: RepoRef, _s: string, _p?: Cursor): Promise<Page<PullRequest>> { return { items: [] }; }
  async getPullRequest(_r: RepoRef, _n: number): Promise<PullRequest> { this.notImplemented('getPullRequest'); }
  async createPullRequest(_r: RepoRef, _i: CreatePrInput): Promise<PullRequest> { this.notImplemented('createPullRequest'); }
  async mergePullRequest(_r: RepoRef, _n: number, _s: MergeStrategy): Promise<MergeResult> { return { merged: true }; }
  async closePullRequest(_r: RepoRef, _n: number): Promise<void> { /* PATCH state=closed */ }
  async getReviewStatus(_r: RepoRef, _n: number): Promise<ReviewStatus> { return { state: 'review_required', approvals: 0, changesRequested: 0 }; }
  async listPrFiles(_r: RepoRef, _n: number): Promise<ChangedFile[]> { return []; }

  async getCombinedStatus(_r: RepoRef, _sha: string): Promise<CheckSummary> { return { state: 'success', total: 0, passed: 0 }; }
  async listCheckRuns(_r: RepoRef, _sha: string): Promise<CheckRun[]> { return []; }

  async getBranchProtection(_r: RepoRef, _p: string): Promise<ProtectionRule | null> { return null; }
  async setBranchProtection(_r: RepoRef, _p: string, _rule: ProtectionRule): Promise<void> { /* PUT branches/{b}/protection */ }

  async ensureWebhook(_r: RepoRef, _url: string, _secret: string): Promise<void> { /* POST /repos/{}/hooks */ }

  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean {
    const sig = headers['x-hub-signature-256'];
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
    if (!sig || !secret) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  }

  /** Map GitHub webhook payloads to the canonical event catalog (blueprint I.3). */
  normalizeWebhook(headers: Record<string, string>, body: any): DomainEvent[] {
    const event = headers['x-github-event'];
    const base = (type: string, subjectId: string, data: Record<string, unknown>): DomainEvent => ({
      eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(),
      actor: { email: body?.sender?.login }, subject: { type: 'pull_request', id: subjectId }, data,
    });
    if (event === 'pull_request') {
      const pr = body.pull_request;
      if (body.action === 'opened') return [base(EventTypes.PrOpened, String(pr.number), { repo: body.repository?.full_name })];
      if (body.action === 'closed' && pr.merged) return [base(EventTypes.PrMerged, String(pr.number), { repo: body.repository?.full_name })];
      if (body.action === 'closed') return [base(EventTypes.PrClosed, String(pr.number), { repo: body.repository?.full_name })];
    }
    return [];
  }

  async getRateLimit(_r: RepoRef): Promise<RateLimitInfo> { return { remaining: 5000, limit: 5000, resetAt: new Date().toISOString() }; }
}
