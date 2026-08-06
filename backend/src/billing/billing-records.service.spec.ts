import { NotFoundException } from '@nestjs/common';
import { BillingRecordsService } from './billing-records.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new BillingRecordsService(pool);
  return { svc, query };
}

describe('BillingRecordsService.monthlyForm', () => {
  it('throws NotFoundException when the product does not exist', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.monthlyForm('missing', '2026-08-01')).rejects.toThrow(NotFoundException);
  });

  it('includes monthly/pay_per_use services unconditionally, and only-due annual services', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'OMS' }] });
    query.mockResolvedValueOnce({
      rows: [
        { service_id: 's1', name: 'redis-01', service_type: 'Redis', region: 'ap-1', billing_mode: 'monthly',
          record_id: null, amount: null, notes: null, last_billed: null },
        { service_id: 's2', name: 'obs-archive', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: '2026-03-01' }, // 5 months ago — not due
        { service_id: 's3', name: 'obs-backup', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: '2025-06-01' }, // 14 months ago — due
        { service_id: 's4', name: 'obs-new', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: null }, // never billed — due
      ],
    });

    const result = await svc.monthlyForm('p1', '2026-08-01');
    expect(result.services.map((s) => s.service_id)).toEqual(['s1', 's3', 's4']);
    expect(result.month).toBe('2026-08-01');
  });

  it('pre-fills existing_record when a billing_records row already exists for the month', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'OMS' }] });
    query.mockResolvedValueOnce({
      rows: [{ service_id: 's1', name: 'redis-01', service_type: 'Redis', region: 'ap-1', billing_mode: 'monthly',
        record_id: 'br1', amount: '42.00', notes: 'note', last_billed: '2026-08-01' }],
    });
    const result = await svc.monthlyForm('p1', '2026-08-15');
    expect(result.services[0].existing_record).toEqual({ id: 'br1', amount: '42.00', notes: 'note' });
  });
});

describe('BillingRecordsService.bulkUpsert', () => {
  it('upserts every entry with a non-null amount and skips null amounts', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValue({ rows: [] });
    const result = await svc.bulkUpsert('p1', '2026-08-01', [
      { service_id: 's1', amount: 10 },
      { service_id: 's2', amount: null as any },
      { service_id: 's3', amount: 20, notes: 'x' },
    ], 'u1');
    expect(result.upserted).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('BillingRecordsService.toCsv', () => {
  it('quotes fields containing commas and escapes embedded quotes', () => {
    const { svc } = makeService();
    const csv = svc.toCsv([
      { id: '1', service_id: 's1', service_name: 'redis, prod', service_type: 'Redis',
        product_id: 'p1', product_name: 'OMS', region: 'ap-1', billing_mode: 'monthly',
        billing_month: '2026-08-01', amount: '42.00', notes: 'has "quotes"',
        created_at: '', updated_at: '' } as any,
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"redis, prod"');
    expect(lines[1]).toContain('"has ""quotes"""');
  });
});
