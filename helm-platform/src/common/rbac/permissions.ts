/** Namespaced permission keys (blueprint C.8). Stored as data; this is the seed catalog. */
export const Permissions = {
  RepositoryRead: 'repository.read',
  RepositoryManage: 'repository.manage',
  BranchCreate: 'branch.create',
  BranchDelete: 'branch.delete',
  WorkItemCreate: 'workitem.create',
  WorkItemVerify: 'workitem.verify',
  MergeApprove: 'merge.approve',
  MergeExecute: 'merge.execute',
  HotfixCreate: 'hotfix.create',
  ReleaseCreate: 'release.create',
  ReleaseEdit: 'release.edit',
  DeployApproveCanary: 'deploy.approve.canary',
  DeployApproveBeta: 'deploy.approve.beta',
  DeployApproveProduction: 'deploy.approve.production',
  DeployApproveEnterprise: 'deploy.approve.enterprise',
  DeployRollback: 'deploy.rollback',
  UserManage: 'user.manage',
  AuditRead: 'audit.read',
} as const;

export type PermissionKey = (typeof Permissions)[keyof typeof Permissions];

export const channelApprovePermission = (channel: string): string => `deploy.approve.${channel}`;
