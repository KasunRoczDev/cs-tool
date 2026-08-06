import { BillingReportService } from './billing-report.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const settings = { getAll: jest.fn().mockResolvedValue({ billing_currency: 'USD' }) } as any;
  const svc = new BillingReportService(pool, settings);
  return { svc, query, settings };
}

describe('BillingReportService.group', () => {
  it('groups resources by project, sums subtotals, and skips unbilled resources from the subtotal', () => {
    const { svc } = makeService();
    const rows = [
      { service_id: 's1', name: 'be', service_type: 'ECS', provider: 'AWS', region: 'sg', product_id: 'p1', product_name: 'MediApp', amount: 64, notes: null },
      { service_id: 's2', name: 'app', service_type: 'ECS', provider: 'AWS', region: 'sg', product_id: 'p1', product_name: 'MediApp', amount: 48, notes: null },
      { service_id: 's3', name: 'unbilled', service_type: 'ECS', provider: null, region: null, product_id: 'p1', product_name: 'MediApp', amount: null, notes: null },
      { service_id: 's4', name: 'db', service_type: 'RDS', provider: 'DigitalOcean', region: null, product_id: 'p2', product_name: 'GCEC', amount: 32, notes: null },
    ];
    const result = svc.group(rows);
    expect(result.projects).toHaveLength(2);
    const mediapp = result.projects.find((p) => p.product_id === 'p1')!;
    expect(mediapp.resources).toHaveLength(3);
    expect(mediapp.subtotal).toBe(112); // 64 + 48, unbilled excluded
    const gcec = result.projects.find((p) => p.product_id === 'p2')!;
    expect(gcec.subtotal).toBe(32);
    expect(result.grand_total).toBe(144);
  });

  it('returns an empty report when there are no matching services', () => {
    const { svc } = makeService();
    const result = svc.group([]);
    expect(result.projects).toEqual([]);
    expect(result.grand_total).toBe(0);
  });
});

describe('BillingReportService.report', () => {
  it('normalizes the month and applies filters as query params', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    const result = await svc.report('2026-08-15', { product_id: 'p1' });
    expect(result.month).toBe('2026-08-01');
    expect(result.currency).toBe('USD');
    expect(query.mock.calls[0][1]).toEqual(['2026-08-01', 'p1']);
  });
});
