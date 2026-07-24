import {
  RepoRef, Cursor, Page, Branch, Commit, Tag, Comparison, ConflictReport, PullRequest,
  ReviewStatus, ChangedFile, CheckSummary, CheckRun, RateLimitInfo, ScopedToken,
  ProtectionRule, MergeStrategy, MergeResult, CreatePrInput,
} from './types';
import { DomainEvent } from '../../common/events/domain-event';

/** Provider-agnostic Git port (blueprint I.1). GitHub first; GitLab/Bitbucket are new adapters. */
export abstract class GitProvider {
  abstract readonly key: 'github' | 'gitlab' | 'bitbucket';

  // Auth / installation lifecycle
  abstract getInstallationToken(repo: RepoRef): Promise<ScopedToken>;
  abstract revokeToken(token: ScopedToken): Promise<void>;
  abstract listInstallationRepos(installationId: string): Promise<{ fullName: string }[]>;

  // Repository / branches
  abstract listBranches(repo: RepoRef, page?: Cursor): Promise<Page<Branch>>;
  abstract getBranch(repo: RepoRef, name: string): Promise<Branch | null>;
  abstract createBranch(repo: RepoRef, name: string, fromSha: string): Promise<Branch>;
  abstract deleteBranch(repo: RepoRef, name: string): Promise<void>;
  abstract compareBranches(repo: RepoRef, base: string, head: string): Promise<Comparison>;
  abstract detectConflicts(repo: RepoRef, src: string, dst: string): Promise<ConflictReport>;

  // Commits / tags / releases
  abstract listCommits(repo: RepoRef, opts: { branch?: string; since?: string }, page?: Cursor): Promise<Page<Commit>>;
  abstract getCommit(repo: RepoRef, sha: string): Promise<Commit>;
  abstract createTag(repo: RepoRef, name: string, sha: string): Promise<Tag>;
  abstract listTags(repo: RepoRef, page?: Cursor): Promise<Page<Tag>>;
  abstract createRelease(repo: RepoRef, tag: string, notes: string): Promise<{ id: string; url: string }>;

  // Pull/merge requests
  abstract listPullRequests(repo: RepoRef, state: string, page?: Cursor): Promise<Page<PullRequest>>;
  abstract getPullRequest(repo: RepoRef, number: number): Promise<PullRequest>;
  abstract createPullRequest(repo: RepoRef, input: CreatePrInput): Promise<PullRequest>;
  abstract mergePullRequest(repo: RepoRef, number: number, strategy: MergeStrategy): Promise<MergeResult>;
  abstract closePullRequest(repo: RepoRef, number: number): Promise<void>;
  abstract getReviewStatus(repo: RepoRef, number: number): Promise<ReviewStatus>;
  abstract listPrFiles(repo: RepoRef, number: number): Promise<ChangedFile[]>;

  // Checks / statuses
  abstract getCombinedStatus(repo: RepoRef, sha: string): Promise<CheckSummary>;
  abstract listCheckRuns(repo: RepoRef, sha: string): Promise<CheckRun[]>;

  // Branch protection
  abstract getBranchProtection(repo: RepoRef, pattern: string): Promise<ProtectionRule | null>;
  abstract setBranchProtection(repo: RepoRef, pattern: string, rule: ProtectionRule): Promise<void>;

  // Webhooks
  abstract ensureWebhook(repo: RepoRef, callbackUrl: string, secret: string): Promise<void>;
  abstract verifyWebhook(headers: Record<string, string>, rawBody: Buffer): boolean;
  abstract normalizeWebhook(headers: Record<string, string>, body: unknown): DomainEvent[];

  // Rate limit awareness
  abstract getRateLimit(repo: RepoRef): Promise<RateLimitInfo>;
}
