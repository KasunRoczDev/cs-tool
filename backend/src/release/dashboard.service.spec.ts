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
