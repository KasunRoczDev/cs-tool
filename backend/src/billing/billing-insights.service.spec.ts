import { BillingInsightsService } from './billing-insights.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new BillingInsightsService(pool);
  return { svc, query };
}

describe('BillingInsightsService.getInsights', () => {
  it('flags a service as a downsizing candidate when avg CPU/RAM are both low', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's1', service_name: 'redis-01', server_id: 'sv1', server_name: 'web-01',
        server_status: 'online', last_seen: new Date().toISOString(),
        amount: 42, avg_cpu: 8, avg_ram: 12,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe('downsizing_candidate');
  });

  it('flags a service as possibly unused when its server is offline', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's2', service_name: 'ecs-02', server_id: 'sv2', server_name: 'app-02',
        server_status: 'offline', last_seen: new Date().toISOString(),
        amount: 15, avg_cpu: 50, avg_ram: 60,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe('possibly_unused');
  });

  it('does not flag a healthily-utilized, online, billed service', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's3', service_name: 'rds-01', server_id: 'sv3', server_name: 'db-01',
        server_status: 'online', last_seen: new Date().toISOString(),
        amount: 100, avg_cpu: 55, avg_ram: 60,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(0);
  });

  it('skips services with a zero or negative billed amount', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's4', service_name: 'obs-01', server_id: 'sv4', server_name: 'store-01',
        server_status: 'offline', last_seen: null,
        amount: 0, avg_cpu: null, avg_ram: null,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(0);
  });
});
