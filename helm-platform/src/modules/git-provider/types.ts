export interface RepoRef { provider: string; fullName: string; }
export interface Cursor { cursor?: string; limit?: number; }
export interface Page<T> { items: T[]; nextCursor?: string; }
export interface Branch { name: string; sha: string; protected?: boolean; }
export interface Commit { sha: string; message: string; author: string; date: string; }
export interface Tag { name: string; sha: string; }
export interface Comparison { aheadBy: number; behindBy: number; files: string[]; }
export interface ConflictReport { hasConflicts: boolean; files: string[]; }
export interface PullRequest {
  number: number; title: string; state: string; sourceBranch: string; targetBranch: string;
  author: string; merged: boolean; mergeable?: boolean; reviewState?: string;
}
export interface ReviewStatus { state: string; approvals: number; changesRequested: number; }
export interface ChangedFile { path: string; additions: number; deletions: number; }
export interface CheckSummary { state: 'success' | 'pending' | 'failure'; total: number; passed: number; }
export interface CheckRun { name: string; status: string; conclusion?: string; }
export interface RateLimitInfo { remaining: number; limit: number; resetAt: string; }
export interface ScopedToken { token: string; expiresAt: string; }
export interface ProtectionRule { requireReviews: number; requireStatusChecks: string[]; }
export type MergeStrategy = 'merge' | 'squash' | 'rebase';
export interface MergeResult { merged: boolean; sha?: string; }
export interface CreatePrInput { source: string; target: string; title: string; body?: string; }
