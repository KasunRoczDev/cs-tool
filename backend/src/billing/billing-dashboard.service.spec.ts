import { BillingDashboardService } from './billing-dashboard.service';

function makeService(settingsOverrides: Record<string, string> = {}) {
  const query = jest.fn();
  const pool = { query } as any;
  const settings = { getAll: jest.fn().mockResolvedValue({ billing_currency: 'USD', ...settingsOverrides }) } as any;
  const svc = new BillingDashboardService(pool, settings);
  return { svc, query, settings };
}

describe('BillingDashboardService.summary', () => {
  it('aggregates current month total, trend, and breakdowns using the configured currency', async () => {
    const { svc, query } = makeService({ billing_currency: 'LKR' });
    query
      .mockResolvedValueOnce({ rows: [{ total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ month: '2026-08-01', total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ product_id: 'p1', product_name: 'OMS', total: 800 }] })
      .mockResolvedValueOnce({ rows: [{ service_type: 'RDS', total: 400 }] });

    const result = await svc.summary(6);
    expect(result.currency).toBe('LKR');
    expect(result.current_month_total).toBe(1234.5);
    expect(result.trend).toEqual([{ month: '2026-08-01', total: 1234.5 }]);
    expect(result.by_project).toEqual([{ product_id: 'p1', product_name: 'OMS', total: 800 }]);
    expect(result.by_service_type).toEqual([{ service_type: 'RDS', total: 400 }]);
  });

  it('defaults current_month_total to 0 when there are no billing records yet', async () => {
    const { svc, query } = makeService();
    query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await svc.summary(6);
    expect(result.current_month_total).toBe(0);
  });
});
