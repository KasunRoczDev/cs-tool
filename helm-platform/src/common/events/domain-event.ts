export interface ActorRef { id?: string; email?: string; }
export interface TraceRef { requestId?: string; ip?: string; userAgent?: string; }

/** Canonical event envelope (blueprint C.4.1). Versioned for additive evolution. */
export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  type: string;            // e.g. 'release.promoted'
  version: number;         // envelope version
  occurredAt: string;      // ISO-8601 UTC
  actor: ActorRef;
  subject: { type: string; id: string };
  data: T;
  trace?: TraceRef;
}

/** Well-known event types (blueprint C.4.2 + G additions). */
export const EventTypes = {
  RepositoryRegistered: 'repository.registered',
  RepositorySyncDrift: 'repository.sync_drift_detected',
  BranchCreated: 'branch.created',
  BranchDeleted: 'branch.deleted',
  PrOpened: 'pr.opened',
  PrMerged: 'pr.merged',
  PrClosed: 'pr.closed',
  MergeConflictDetected: 'merge.conflict_detected',
  MergeApproved: 'merge.approved',
  WorkItemStatusChanged: 'workitem.status_changed',
  HotfixCreated: 'hotfix.created',
  ReleaseCreated: 'release.created',
  ReleaseUpdated: 'release.updated',
  ReleasePromoted: 'release.promoted',
  ReleaseNotesGenerated: 'release.notes_generated',
  DeploymentStarted: 'deployment.started',
  DeploymentSucceeded: 'deployment.succeeded',
  DeploymentFailed: 'deployment.failed',
  DeploymentRolledBack: 'deployment.rolled_back',
  DeploymentAutoRollback: 'deployment.auto_rollback_triggered',
} as const;
