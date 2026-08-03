import { DeploymentsService } from './deployments.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const git = {} as any;
  const rt = { emitReleaseEvent: jest.fn() } as any;
  const notifications = { notifyEvent: jest.fn().mockResolvedValue(undefined) } as any;
  const approvals = { isFullyApproved: jest.fn() } as any;
  const calendar = { activeFreeze: jest.fn().mockResolvedValue(null) } as any;
  const environment = { resolveForDeploy: jest.fn().mockResolvedValue([]) } as any;
  const svc = new DeploymentsService(pool, git, rt, notifications, approvals, calendar, environment);
  return { svc, query, approvals, calendar, environment };
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

describe('DeploymentsService.deploy — scheduling & freeze windows', () => {
  it('rejects scheduling a deployment in the past', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'canary', requires_approval: false }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    await expect(
      svc.deploy('r1', { channel: 'canary', scheduled_at: '2000-01-01T00:00:00Z' }, 'u1', 'admin'),
    ).rejects.toThrow('scheduled_at must be in the future');
  });

  it('rejects a non-admin deploy that falls inside an active freeze window', async () => {
    const { svc, query, approvals, calendar } = makeService();
    approvals.isFullyApproved.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    calendar.activeFreeze.mockResolvedValueOnce({
      name: 'Holiday freeze', starts_at: '2026-12-20', ends_at: '2027-01-02', reason: 'code freeze',
    });

    await expect(
      svc.deploy('r1', { channel: 'production' }, 'u1', 'operator'),
    ).rejects.toThrow('Holiday freeze');
  });

  it('lets an admin override an active freeze window', async () => {
    const { svc, query, calendar } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    calendar.activeFreeze.mockResolvedValueOnce({ name: 'Freeze', starts_at: '2026-01-01', ends_at: '2026-01-02' });
    query.mockResolvedValueOnce({ rows: [] }); // previousVersion
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'pending' }] }); // INSERT deployment
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    const result = await svc.deploy('r1', { channel: 'production' }, 'u1', 'admin');
    expect(result.id).toBe('d1');
  });

  it('creates a scheduled deployment without executing it immediately, even on a no-approval channel', async () => {
    const { svc, query } = makeService();
    const future = new Date(Date.now() + 3600_000).toISOString();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'canary', requires_approval: false }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    query.mockResolvedValueOnce({ rows: [] }); // previousVersion
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'scheduled', scheduled_at: future }] }); // INSERT
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    const result = await svc.deploy('r1', { channel: 'canary', scheduled_at: future }, 'u1', 'admin');
    expect(result.status).toBe('scheduled');
    const insertCall = query.mock.calls[5];
    expect(insertCall[0]).toContain('INSERT INTO deployments');
    expect(insertCall[1]).toContain('scheduled');
  });
});

describe('DeploymentsService.deploy — channel locking', () => {
  it('rejects a non-admin deploy to a locked channel', async () => {
    const { svc, query, approvals } = makeService();
    approvals.isFullyApproved.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true, locked: true, locked_reason: 'Holiday freeze' }] }); // channel
    await expect(
      svc.deploy('r1', { channel: 'production' }, 'u1', 'operator'),
    ).rejects.toThrow('Holiday freeze');
  });

  it('lets an admin deploy to a locked channel', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true, locked: true, locked_reason: 'x' }] });
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    query.mockResolvedValueOnce({ rows: [] }); // previousVersion
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // INSERT
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    const result = await svc.deploy('r1', { channel: 'production' }, 'u1', 'admin');
    expect(result.id).toBe('d1');
  });
});

describe('DeploymentsService.deploy — strategy waves', () => {
  it('splits servers into wave-tagged jobs for a rolling strategy (batch_size=2)', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    query.mockResolvedValueOnce({ rows: [] }); // previousVersion
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', current_wave: 1, total_waves: 2, strategy: 'rolling' }] }); // INSERT deployment
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory
    query.mockResolvedValueOnce({ rows: [{ repository_id: 'repo1', commit_sha: 'abc', branch_name: 'main', slug: 'app' }] }); // createJobs: repos
    for (let i = 0; i < 3; i++) {
      query.mockResolvedValueOnce({ rows: [{ tags: {} }] }); // server tags lookup
      query.mockResolvedValueOnce({ rows: [] }); // INSERT deploy_jobs
    }

    const result = await svc.deploy(
      'r1',
      { channel: 'production', server_ids: ['s1', 's2', 's3'], strategy: 'rolling', strategy_config: { batch_size: 2 } },
      'u1', 'admin',
    );
    expect(result.id).toBe('d1');

    const deploymentInsert = query.mock.calls[5];
    expect(deploymentInsert[1]).toContain(2); // total_waves = 2 (batches of 2: [s1,s2],[s3])

    const jobInserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO deploy_jobs'));
    expect(jobInserts).toHaveLength(3);
    expect(jobInserts[0][1].at(-2)).toBe(1); // s1 -> wave 1
    expect(jobInserts[1][1].at(-2)).toBe(1); // s2 -> wave 1
    expect(jobInserts[2][1].at(-2)).toBe(2); // s3 -> wave 2
  });

  it('rejects an unknown strategy', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true }] });
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    await expect(
      svc.deploy('r1', { channel: 'production', strategy: 'blue_green' }, 'u1', 'admin'),
    ).rejects.toThrow('Unknown strategy');
  });
});

describe('DeploymentsService.deploy — env var injection', () => {
  it('resolves and attaches env vars per pinned repo (channel + that repo\'s product) to each deploy job', async () => {
    const { svc, query, environment } = makeService();
    environment.resolveForDeploy.mockResolvedValueOnce(['API_KEY=abc123']);
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'production', version: '1.0.0' }] }); // release
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1', key: 'production', requires_approval: true }] }); // channel
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds
    query.mockResolvedValueOnce({ rows: [] }); // previousVersion
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // INSERT deployment
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory
    query.mockResolvedValueOnce({ rows: [{ repository_id: 'repo1', commit_sha: 'abc', branch_name: 'main', slug: 'app', product_id: 'p1' }] }); // createJobs: repos
    query.mockResolvedValueOnce({ rows: [{ tags: {} }] }); // server tags
    query.mockResolvedValueOnce({ rows: [] }); // INSERT deploy_jobs

    await svc.deploy('r1', { channel: 'production', server_ids: ['s1'] }, 'u1', 'admin');

    expect(environment.resolveForDeploy).toHaveBeenCalledWith('ch1', 'p1');
    const jobInsert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO deploy_jobs'));
    expect(JSON.parse(jobInsert[1].at(-1))).toEqual(['API_KEY=abc123']);
  });
});

describe('DeploymentsService.settleDeployment (wave-aware)', () => {
  it('is a no-op if the deployment is already terminal', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'succeeded' }] });
    await (svc as any).settleDeployment('d1');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the current wave still has open jobs', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 1, total_waves: 2, channel_id: 'ch1' }] });
    query.mockResolvedValueOnce({ rows: [{ total: 2, open: 1, failed: 0 }] });
    await (svc as any).settleDeployment('d1');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails the whole deployment and cancels not-yet-started later-wave jobs when a wave fails', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 1, total_waves: 3, strategy: 'rolling', channel_id: 'ch1', current_version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ total: 2, open: 0, failed: 1 }] });
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] });
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE status='failed'
    query.mockResolvedValueOnce({ rows: [] }); // cancel later-wave jobs
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    await (svc as any).settleDeployment('d1');

    expect(query.mock.calls.some(([sql]) => sql.includes("status = 'failed'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('wave > $2'))).toBe(true);
  });

  it('pauses a canary deployment in awaiting_promotion once its wave succeeds (not the last wave)', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 1, total_waves: 2, strategy: 'canary', channel_id: 'ch1', current_version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ total: 1, open: 0, failed: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] });
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE status='awaiting_promotion'
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    await (svc as any).settleDeployment('d1');

    expect(query.mock.calls.some(([sql]) => sql.includes("status = 'awaiting_promotion'"))).toBe(true);
  });

  it('auto-advances a rolling deployment to the next wave once the current wave succeeds', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 1, total_waves: 2, strategy: 'rolling', channel_id: 'ch1', current_version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ total: 2, open: 0, failed: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] });
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE current_wave = current_wave + 1
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    await (svc as any).settleDeployment('d1');

    expect(query.mock.calls.some(([sql]) => sql.includes('current_wave = current_wave + 1'))).toBe(true);
  });

  it('settles a deployment as succeeded once its last (or only) wave finishes', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 2, total_waves: 2, strategy: 'rolling', channel_id: 'ch1', current_version: '1.0.0' }] });
    query.mockResolvedValueOnce({ rows: [{ total: 1, open: 0, failed: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] });
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE status='succeeded'
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory

    await (svc as any).settleDeployment('d1');

    expect(query.mock.calls.some(([sql]) => sql.includes("status = 'succeeded'"))).toBe(true);
  });
});

describe('DeploymentsService.promoteWave', () => {
  it('rejects promoting a deployment that is not awaiting promotion', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress' }] });
    await expect(svc.promoteWave('d1', 'u1')).rejects.toThrow('Only deployments awaiting promotion');
  });

  it('advances to the next wave and sets status back to in_progress', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'awaiting_promotion', current_wave: 1, total_waves: 2, channel_id: 'ch1' }] }); // getRaw
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] }); // channel lookup
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'in_progress', current_wave: 2 }] }); // final getRaw

    const result = await svc.promoteWave('d1', 'u1');
    expect(result.current_wave).toBe(2);
  });
});

describe('DeploymentsService.retry — wave scoping', () => {
  it('only retries jobs in the current (failed) wave, preserving their wave number', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'failed', channel_id: 'ch1', current_wave: 2, total_waves: 3 }] }); // getRaw
    query.mockResolvedValueOnce({ rows: [] }); // assertChannelFree
    query.mockResolvedValueOnce({
      rows: [{
        server_id: 's1', repository_id: 'repo1', repo_slug: 'app', env_key: 'production',
        env_path: 'oms-production', branch: 'main', commit_sha: 'abc', custom_commands: [], wave: 2,
      }],
    }); // failed jobs in wave 2
    query.mockResolvedValueOnce({ rows: [] }); // INSERT re-run job
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE deployments in_progress
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory
    query.mockResolvedValueOnce({ rows: [{ key: 'production' }] }); // channel lookup
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] }); // final getRaw

    await svc.retry('d1', 'u1');

    const selectCall = query.mock.calls[2];
    expect(selectCall[0]).toContain('wave = $2');
    expect(selectCall[1]).toEqual(['d1', 2]);
    const insertCall = query.mock.calls[3];
    expect(insertCall[1].at(-2)).toBe(2); // wave preserved on re-insert
  });
});

describe('DeploymentsService.sweepScheduledDeployments', () => {
  it('executes due scheduled deployments and defers ones still inside a freeze window', async () => {
    const { svc, query, calendar } = makeService();
    query.mockResolvedValueOnce({
      rows: [
        { id: 'd1', channel_id: 'ch1', release_id: 'r1' },
        { id: 'd2', channel_id: 'ch1', release_id: 'r2' },
      ],
    }); // due scheduled deployments
    const execute = jest.spyOn(svc as any, 'execute').mockResolvedValue(undefined);

    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds for d1
    calendar.activeFreeze.mockResolvedValueOnce(null); // d1 not frozen
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE status='approved' for d1
    query.mockResolvedValueOnce({ rows: [] }); // recordHistory for d1

    query.mockResolvedValueOnce({ rows: [] }); // releaseProductIds for d2
    calendar.activeFreeze.mockResolvedValueOnce({ name: 'Freeze' }); // d2 still frozen -> skip

    await svc.sweepScheduledDeployments();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('d1');
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

describe('DeploymentsService.metrics', () => {
  it('computes DORA metrics from deployment/history data', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1' }] }); // channel lookup
    query.mockResolvedValueOnce({ rows: [{ day: '2026-07-01', n: 2 }, { day: '2026-07-02', n: 1 }] }); // freq series
    query.mockResolvedValueOnce({ rows: [{ median_seconds: '3600' }] }); // lead time (1h)
    query.mockResolvedValueOnce({ rows: [{ failed: 1, total: 4 }] }); // change failure rate
    query.mockResolvedValueOnce({ rows: [{ mttr_seconds: '1800', recovered_count: 1, incident_count: 1 }] }); // MTTR (30m)
    query.mockResolvedValueOnce({ rows: [{ mean_seconds: '900' }] }); // mean deployment duration (15m)
    query.mockResolvedValueOnce({ rows: [{ rolled_back: 1, total: 4 }] }); // rollback frequency

    const result = await svc.metrics('production', 30);

    expect(result.deployment_frequency.count).toBe(3);
    expect(result.deployment_frequency.per_week).toBeCloseTo(0.7, 1);
    expect(result.deployment_frequency.tier).toBe('Medium');
    expect(result.lead_time_for_changes.median_seconds).toBe(3600);
    expect(result.lead_time_for_changes.tier).toBe('Elite');
    expect(result.change_failure_rate.percent).toBe(25);
    expect(result.change_failure_rate.tier).toBe('High');
    expect(result.mttr.mean_seconds).toBe(1800);
    expect(result.mttr.tier).toBe('Elite');
    expect(result.mean_deployment_duration.mean_seconds).toBe(900);
    expect(result.rollback_frequency.percent).toBe(25);
  });

  it('throws NotFoundException for an unknown channel', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.metrics('bogus', 30)).rejects.toThrow('Channel not found');
  });

  it('returns N/A tiers and null percentages when there is no data', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1' }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ median_seconds: null }] });
    query.mockResolvedValueOnce({ rows: [{ failed: 0, total: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ mttr_seconds: null, recovered_count: 0, incident_count: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ mean_seconds: null }] });
    query.mockResolvedValueOnce({ rows: [{ rolled_back: 0, total: 0 }] });

    const result = await svc.metrics('production', 30);
    expect(result.deployment_frequency.count).toBe(0);
    expect(result.lead_time_for_changes.tier).toBe('N/A');
    expect(result.change_failure_rate.percent).toBeNull();
    expect(result.change_failure_rate.tier).toBe('N/A');
    expect(result.mttr.tier).toBe('N/A');
    expect(result.mean_deployment_duration.mean_seconds).toBeNull();
    expect(result.rollback_frequency.percent).toBeNull();
  });
});

describe('DeploymentsService.createRecurringDeployment', () => {
  it('rejects an unknown interval_type', async () => {
    const { svc } = makeService();
    await expect(
      svc.createRecurringDeployment({ release_id: 'r1', channel: 'production', interval_type: 'hourly', time_of_day: '02:00' }, 'u1'),
    ).rejects.toThrow('Unknown interval_type');
  });

  it('requires day_of_week for a weekly recurrence', async () => {
    const { svc } = makeService();
    await expect(
      svc.createRecurringDeployment({ release_id: 'r1', channel: 'production', interval_type: 'weekly', time_of_day: '02:00' }, 'u1'),
    ).rejects.toThrow('day_of_week');
  });

  it('rejects a malformed time_of_day', async () => {
    const { svc } = makeService();
    await expect(
      svc.createRecurringDeployment({ release_id: 'r1', channel: 'production', time_of_day: '2am' } as any, 'u1'),
    ).rejects.toThrow('time_of_day');
  });

  it('rejects an unknown channel', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      svc.createRecurringDeployment({ release_id: 'r1', channel: 'bogus', time_of_day: '02:00' }, 'u1'),
    ).rejects.toThrow('Channel not found');
  });

  it('creates a daily recurring deployment rule', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'ch1' }] }); // channel lookup
    query.mockResolvedValueOnce({ rows: [{ id: 'rd1', interval_type: 'daily' }] }); // INSERT
    const result = await svc.createRecurringDeployment({ release_id: 'r1', channel: 'production', time_of_day: '02:00' }, 'u1');
    expect(result.id).toBe('rd1');
  });
});

describe('DeploymentsService.setRecurringDeploymentEnabled / deleteRecurringDeployment', () => {
  it('throws NotFoundException toggling an unknown rule', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.setRecurringDeploymentEnabled('bogus', false)).rejects.toThrow('not found');
  });

  it('throws NotFoundException deleting an unknown rule', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(svc.deleteRecurringDeployment('bogus')).rejects.toThrow('not found');
  });
});

describe('DeploymentsService — isRecurringDeploymentDue', () => {
  it('is due only at the exact matching UTC hour/minute (daily)', () => {
    const { svc } = makeService();
    const rule = { interval_type: 'daily', time_of_day: '02:00', day_of_week: null };
    const dueAt = new Date(Date.UTC(2026, 0, 1, 2, 0));
    const notDueAt = new Date(Date.UTC(2026, 0, 1, 2, 1));
    expect((svc as any).isRecurringDeploymentDue(rule, dueAt)).toBe(true);
    expect((svc as any).isRecurringDeploymentDue(rule, notDueAt)).toBe(false);
  });

  it('also checks day_of_week when weekly', () => {
    const { svc } = makeService();
    const rule = { interval_type: 'weekly', time_of_day: '02:00', day_of_week: 1 }; // Monday
    const monday = new Date(Date.UTC(2026, 0, 5, 2, 0)); // 2026-01-05 is a Monday
    const tuesday = new Date(Date.UTC(2026, 0, 6, 2, 0));
    expect((svc as any).isRecurringDeploymentDue(rule, monday)).toBe(true);
    expect((svc as any).isRecurringDeploymentDue(rule, tuesday)).toBe(false);
  });
});

describe('DeploymentsService.sweepRecurringDeployments', () => {
  const DUE_AT = new Date(Date.UTC(2026, 0, 1, 2, 0));
  const DUE_RULE = {
    id: 'rd1', release_id: 'r1', channel_id: 'ch1', channel_key: 'production', server_ids: [],
    interval_type: 'daily', day_of_week: null, time_of_day: '02:00', strategy: 'all_at_once',
    strategy_config: {}, enabled: true, last_run_at: null,
  };

  it('fires deploy() for a due rule and records last_run_at', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [DUE_RULE] });
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE last_run_at
    const deploySpy = jest.spyOn(svc, 'deploy').mockResolvedValue({ id: 'd1' } as any);

    await svc.sweepRecurringDeployments(DUE_AT);

    expect(deploySpy).toHaveBeenCalledWith(
      'r1', expect.objectContaining({ channel: 'production' }), undefined, undefined,
    );
  });

  it('skips (and logs, not throws) a rule blocked by deploy() — e.g. a freeze window or revoked approval', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [DUE_RULE] });
    query.mockResolvedValueOnce({ rows: [] });
    jest.spyOn(svc, 'deploy').mockRejectedValue(new Error('Channel is locked'));

    await expect(svc.sweepRecurringDeployments(DUE_AT)).resolves.toBeUndefined();
  });

  it('does not re-fire a rule already run within the last minute', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ ...DUE_RULE, last_run_at: DUE_AT.toISOString() }] });
    const deploySpy = jest.spyOn(svc, 'deploy').mockResolvedValue({ id: 'd1' } as any);

    await svc.sweepRecurringDeployments(new Date(DUE_AT.getTime() + 30_000)); // 30s later, same rule
    expect(deploySpy).not.toHaveBeenCalled();
  });

  it('does nothing when no rule is due at this minute', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [DUE_RULE] });
    const deploySpy = jest.spyOn(svc, 'deploy').mockResolvedValue({ id: 'd1' } as any);

    await svc.sweepRecurringDeployments(new Date(Date.UTC(2026, 0, 1, 3, 0))); // wrong hour
    expect(deploySpy).not.toHaveBeenCalled();
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
