import { DashboardService } from './dashboard.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const approvals = { status: jest.fn() } as any;
  const calendar = { calendar: jest.fn() } as any;
  const svc = new DashboardService(pool, approvals, calendar);
  return { svc, query, approvals, calendar };
}

describe('DashboardService.activeReleases', () => {
  it('queries with a null product filter when none is given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.4.0', category: 'stage' }] });
    const rows = await svc.activeReleases();
    expect(rows).toEqual([{ id: 'r1', version: '1.4.0', category: 'stage' }]);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([null]);
  });

  it('passes the product filter through when given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.activeReleases('p1');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['p1']);
  });
});

describe('DashboardService.upcomingReleases', () => {
  it('returns rows from the pool', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r2', version: '1.5.0' }] });
    const rows = await svc.upcomingReleases();
    expect(rows).toEqual([{ id: 'r2', version: '1.5.0' }]);
  });
});

describe('DashboardService.productionVersions', () => {
  it('returns one row per product', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30T00:00:00Z' }],
    });
    const rows = await svc.productionVersions();
    expect(rows).toEqual([
      { product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30T00:00:00Z' },
    ]);
  });
});

describe('DashboardService.pipelineHealth', () => {
  it('computes a success rate from succeeded/failed counts', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ succeeded: 9, failed: 1 }] });
    const health = await svc.pipelineHealth();
    expect(health).toEqual({ window_days: 7, succeeded: 9, failed: 1, rate: 0.9 });
  });

  it('returns a null rate when there were no jobs in the window', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ succeeded: 0, failed: 0 }] });
    const health = await svc.pipelineHealth();
    expect(health).toEqual({ window_days: 7, succeeded: 0, failed: 0, rate: null });
  });
});

describe('DashboardService.overview', () => {
  it('combines every widget, deriving pending approvals from active releases and a 5-item mini calendar', async () => {
    const { svc, query, approvals, calendar } = makeService();

    // Query order inside overview(): activeReleases, upcomingReleases, productionVersions, pipelineHealth.
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.4.0', product_id: 'p1', product_name: 'Core' }] }); // activeReleases
    query.mockResolvedValueOnce({ rows: [{ id: 'r2', version: '1.5.0', planned_date: '2026-08-10' }] }); // upcomingReleases
    query.mockResolvedValueOnce({ rows: [{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30' }] }); // productionVersions
    query.mockResolvedValueOnce({ rows: [{ succeeded: 5, failed: 0 }] }); // pipelineHealth

    approvals.status.mockResolvedValueOnce({
      approvers: [
        { email: 'qa@x.com', role: 'qa', product_name: 'Core', decision: 'pending' },
        { email: 'lead@x.com', role: 'dev_lead', product_name: 'Core', decision: 'approved' },
      ],
    });

    calendar.calendar.mockResolvedValueOnce({
      releases: [{ version: '1.5.0', planned_date: '2026-08-10' }],
      deployments: [{ release_version: '1.4.0', channel_name: 'Production', scheduled_at: '2026-08-05', finished_at: null, created_at: '2026-08-01' }],
      freeze_windows: [{ name: 'Holiday freeze', starts_at: '2026-08-15' }],
    });

    const result = await svc.overview('p1');

    expect(result.active_releases).toEqual([{ id: 'r1', version: '1.4.0', product_id: 'p1', product_name: 'Core' }]);
    expect(result.pending_approvals).toEqual([
      { release_id: 'r1', version: '1.4.0', product_name: 'Core', role: 'qa', awaiting_email: 'qa@x.com' },
    ]);
    expect(result.upcoming_releases).toEqual([{ id: 'r2', version: '1.5.0', planned_date: '2026-08-10' }]);
    expect(result.production_versions).toEqual([{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30' }]);
    expect(result.pipeline_health).toEqual({ window_days: 7, succeeded: 5, failed: 0, rate: 1 });
    expect(result.mini_calendar).toEqual([
      { date: '2026-08-05', type: 'deployment', label: '1.4.0 → Production' },
      { date: '2026-08-10', type: 'release', label: '1.5.0 planned' },
      { date: '2026-08-15', type: 'freeze', label: 'Holiday freeze' },
    ]);
    expect(approvals.status).toHaveBeenCalledWith('r1');
    expect(approvals.status).toHaveBeenCalledTimes(1);
  });

  it('caps the mini calendar at 5 items, soonest first', async () => {
    const { svc, query, approvals, calendar } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ succeeded: 0, failed: 0 }] });
    calendar.calendar.mockResolvedValueOnce({
      releases: [1, 2, 3, 4, 5, 6].map((n) => ({ version: `1.${n}.0`, planned_date: `2026-08-0${n}` })),
      deployments: [],
      freeze_windows: [],
    });

    const result = await svc.overview();
    expect(result.mini_calendar).toHaveLength(5);
    expect(result.mini_calendar[0].date).toBe('2026-08-01');
  });
});
