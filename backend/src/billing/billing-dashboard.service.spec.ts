import { BillingDashboardService } from './billing-dashboard.service';

function makeService(settingsOverrides: Record<string, string> = {}) {
  const query = jest.fn();
  const pool = { query } as any;
  const settings = { getAll: jest.fn().mockResolvedValue({ billing_currency: 'USD', ...settingsOverrides }) } as any;
  const svc = new BillingDashboardService(pool, settings);
  return { svc, query, settings };
}

describe('BillingDashboardService.summary', () => {
  it('aggregates period total, trend, and breakdowns for an explicit month scope', async () => {
    const { svc, query } = makeService({ billing_currency: 'LKR' });
    query
      .mockResolvedValueOnce({ rows: [{ total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ month: '2026-08-01', total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ product_id: 'p1', product_name: 'OMS', total: 800 }] })
      .mockResolvedValueOnce({ rows: [{ service_type: 'RDS', total: 400 }] });

    const result = await svc.summary(6, 'month', '2026-08-15');
    expect(result.currency).toBe('LKR');
    expect(result.period).toBe('month');
    expect(result.month).toBe('2026-08-01');
    expect(result.period_total).toBe(1234.5);
    expect(result.trend).toEqual([{ month: '2026-08-01', total: 1234.5 }]);
    expect(result.by_project).toEqual([{ product_id: 'p1', product_name: 'OMS', total: 800 }]);
    expect(result.by_service_type).toEqual([{ service_type: 'RDS', total: 400 }]);
    // period-scoped queries (total, by_project, by_service_type) all used the normalized month as $1
    expect(query.mock.calls[0][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[2][1]).toEqual(['2026-08-01']);
    expect(query.mock.calls[3][1]).toEqual(['2026-08-01']);
  });

  it('defaults to the current month when no month is given', async () => {
    const { svc, query } = makeService();
    query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await svc.summary(6, 'month');
    expect(result.period_total).toBe(0);
    expect(result.month).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('scopes the period queries to the whole year when period is "year"', async () => {
    const { svc, query } = makeService();
    query
      .mockResolvedValueOnce({ rows: [{ total: 500 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await svc.summary(6, 'year', '2026-03-01');
    expect(result.period).toBe('year');
    expect(result.month).toBe('2026-03-01');
    expect(result.period_total).toBe(500);
    expect(query.mock.calls[0][0]).toContain("date_trunc('year'");
    expect(query.mock.calls[0][1]).toEqual(['2026-03-01']);
  });

  it('ignores the month filter entirely for "all" scope', async () => {
    const { svc, query } = makeService();
    query
      .mockResolvedValueOnce({ rows: [{ total: 999 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await svc.summary(6, 'all');
    expect(result.period).toBe('all');
    expect(result.month).toBeNull();
    expect(result.period_total).toBe(999);
    expect(query.mock.calls[0][1]).toEqual([]);
  });
});
