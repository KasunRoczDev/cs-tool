import { BillingDashboardService } from './billing-dashboard.service';

function makeService(settingsOverrides: Record<string, string> = {}) {
  const query = jest.fn();
  const pool = { query } as any;
  const settings = { getAll: jest.fn().mockResolvedValue({ billing_currency: 'USD', ...settingsOverrides }) } as any;
  const svc = new BillingDashboardService(pool, settings);
  return { svc, query, settings };
}

function mockRows(query, rowsList) {
  for (const rows of rowsList) query.mockResolvedValueOnce({ rows });
}

describe('BillingDashboardService.summary', () => {
  it('aggregates period total, trend, and all breakdowns for an explicit month scope', async () => {
    const { svc, query } = makeService({ billing_currency: 'LKR' });
    mockRows(query, [
      [{ total: 1234.5 }],
      [{ month: '2026-08-01', total: 1234.5 }],
      [{ month: '2026-08-01', product_id: 'p1', product_name: 'OMS', total: 1234.5 }],
      [{ product_id: 'p1', product_name: 'OMS', total: 800 }],
      [{ service_type: 'RDS', total: 400 }],
      [{ provider: 'AWS', total: 300 }],
      [{ service_id: 's1', name: 'db', product_name: 'OMS', service_type: 'RDS', amount: 400 }],
    ]);

    const result = await svc.summary(6, 'month', '2026-08-15');
    expect(result.currency).toBe('LKR');
    expect(result.period).toBe('month');
    expect(result.month).toBe('2026-08-01');
    expect(result.period_total).toBe(1234.5);
    expect(result.trend).toEqual([{ month: '2026-08-01', total: 1234.5 }]);
    expect(result.project_trend).toEqual([{ month: '2026-08-01', product_id: 'p1', product_name: 'OMS', total: 1234.5 }]);
    expect(result.by_project).toEqual([{ product_id: 'p1', product_name: 'OMS', total: 800 }]);
    expect(result.by_service_type).toEqual([{ service_type: 'RDS', total: 400 }]);
    expect(result.by_provider).toEqual([{ provider: 'AWS', total: 300 }]);
    expect(result.top_services).toEqual([{ service_id: 's1', name: 'db', product_name: 'OMS', service_type: 'RDS', amount: 400 }]);
    // period-scoped queries (total, by_project, by_service_type, by_provider, top_services) all used the normalized month as $1
    expect(query.mock.calls[0][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[3][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[4][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[5][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[6][1]).toEqual(['2026-08-01']);
  });

  it('defaults to the current month when no month is given', async () => {
    const { svc, query } = makeService();
    mockRows(query, [[{ total: 0 }], [], [], [], [], [], []]);
    const result = await svc.summary(6, 'month');
    expect(result.period_total).toBe(0);
    expect(result.month).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('scopes the period queries to the whole year when period is "year"', async () => {
    const { svc, query } = makeService();
    mockRows(query, [[{ total: 500 }], [], [], [], [], [], []]);
    const result = await svc.summary(6, 'year', '2026-03-01');
    expect(result.period).toBe('year');
    expect(result.month).toBe('2026-03-01');
    expect(result.period_total).toBe(500);
    expect(query.mock.calls[0][0]).toContain("date_trunc('year'");
    expect(query.mock.calls[0][1]).toEqual(['2026-03-01']);
  });

  it('ignores the month filter entirely for "all" scope', async () => {
    const { svc, query } = makeService();
    mockRows(query, [[{ total: 999 }], [], [], [], [], [], []]);
    const result = await svc.summary(6, 'all');
    expect(result.period).toBe('all');
    expect(result.month).toBeNull();
    expect(result.period_total).toBe(999);
    expect(query.mock.calls[0][1]).toEqual([]);
  });

  it('appends a product filter to every period-scoped and trend query when productId is given', async () => {
    const { svc, query } = makeService();
    mockRows(query, [[{ total: 42 }], [], [], [], [], [], []]);
    await svc.summary(6, 'month', '2026-08-01', 'p1');
    // periodTotal: $1 = month, $2 = productId
    expect(query.mock.calls[0][1]).toEqual(['2026-08-01', 'p1']);
    expect(query.mock.calls[0][0]).toContain('s.product_id = $2');
    // trend: $1 = months, $2 = productId
    expect(query.mock.calls[1][1]).toEqual([6, 'p1']);
    expect(query.mock.calls[1][0]).toContain('s.product_id = $2');
  });
});
