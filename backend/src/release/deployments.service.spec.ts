import { DeploymentsService } from './deployments.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const git = {} as any;
  const rt = { emitReleaseEvent: jest.fn() } as any;
  const notifications = { notifyEvent: jest.fn() } as any;
  const approvals = { isFullyApproved: jest.fn() } as any;
  const svc = new DeploymentsService(pool, git, rt, notifications, approvals);
  return { svc, query, approvals };
}

describe('DeploymentsService.deploy', () => {
  it('rejects deploying an archived release', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'archived', version: '1.0.0' }] });
    await expect(
      svc.deploy('r1', { channel: 'canary' }, 'u1', 'operator'),
    ).rejects.toThrow('Cannot deploy an archived release');
  });

  it('rejects when the release is not fully approved and the actor is not admin', async () => {
    const { svc, query, approvals } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] });
    approvals.isFullyApproved.mockResolvedValueOnce(false);
    await expect(
      svc.deploy('r1', { channel: 'canary' }, 'u1', 'operator'),
    ).rejects.toThrow('not fully approved');
  });

  it('rejects when the target channel already has an active deployment (concurrency guard)', async () => {
    const { svc, query } = makeService();
    // admin skips the approval-gate query entirely
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'canary' }] }); // channel
    query.mockResolvedValueOnce({ rows: [{ id: 'd-existing', status: 'in_progress' }] }); // assertChannelFree
    await expect(
      svc.deploy('r1', { channel: 'canary' }, 'u1', 'admin'),
    ).rejects.toThrow('already has an active deployment');
  });
});

describe('DeploymentsService.rollback', () => {
  it('rejects when no rollback target was recorded for this deployment', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', rollback_target: null }] }); // getRaw
    await expect(svc.rollback('d1', 'u1')).rejects.toThrow('No rollback target recorded');
  });

  it('rejects when the rollback target release no longer exists', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', rollback_target: '1.2.3' }] }); // getRaw
    query.mockResolvedValueOnce({ rows: [] }); // target release lookup, not found
    await expect(svc.rollback('d1', 'u1')).rejects.toThrow('Rollback target release 1.2.3 not found');
  });
});

describe('DeploymentsService.sweepStaleJobs', () => {
  it('settles each distinct affected deployment exactly once, deduping repeated ids', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ deployment_id: 'd1' }, { deployment_id: 'd1' }, { deployment_id: 'd2' }],
    });
    const settle = jest.spyOn(svc as any, 'settleDeployment').mockResolvedValue(undefined);

    await svc.sweepStaleJobs();

    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledWith('d1');
    expect(settle).toHaveBeenCalledWith('d2');
  });
});
