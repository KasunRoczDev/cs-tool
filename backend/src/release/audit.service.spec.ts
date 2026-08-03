import { AuditService } from './audit.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new AuditService(pool);
  return { svc, query };
}

describe('AuditService.list', () => {
  it('passes filters through as positional params, defaulting and capping limit', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'h1' }] });
    const rows = await svc.list({ release_id: 'r1' });
    expect(rows).toEqual([{ id: 'h1' }]);
    const params = query.mock.calls[0][1];
    expect(params).toEqual(['r1', null, null, null, null, 200]); // default limit 200
  });

  it('caps an oversized limit at 5000', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.list({ limit: 999999 });
    const params = query.mock.calls[0][1];
    expect(params[5]).toBe(5000);
  });
});

describe('AuditService.toCsv', () => {
  it('produces a header row plus one row per entry, quoting fields with commas/quotes', async () => {
    const { svc } = makeService();
    const csv = svc.toCsv([
      { at: '2026-01-01', type: 'approval', subject: '1.0.0', summary: 'qa: approved', actor_email: 'a@x.com', note: 'has, a comma and "quotes"', release_id: 'r1', deployment_id: null },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('at,type,subject,summary,actor_email,note,release_id,deployment_id');
    expect(lines[1]).toContain('"has, a comma and ""quotes"""');
  });

  it('returns just the header row for an empty result set', () => {
    const { svc } = makeService();
    const csv = svc.toCsv([]);
    expect(csv.split('\n')).toHaveLength(1);
  });
});
