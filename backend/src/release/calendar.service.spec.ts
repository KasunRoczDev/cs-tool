import { CalendarService } from './calendar.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new CalendarService(pool);
  return { svc, query };
}

describe('CalendarService.createFreezeWindow', () => {
  it('rejects ends_at at or before starts_at', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.createFreezeWindow({ name: 'Freeze', starts_at: '2026-12-20', ends_at: '2026-12-19' }),
    ).rejects.toThrow('ends_at must be after starts_at');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unparseable dates', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.createFreezeWindow({ name: 'Freeze', starts_at: 'nope', ends_at: '2026-12-19' }),
    ).rejects.toThrow('starts_at/ends_at must be valid dates');
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts a valid window and normalizes empty scope fields to null', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'fw1', name: 'Freeze' }] });
    await svc.createFreezeWindow({
      name: 'Freeze', starts_at: '2026-12-20', ends_at: '2026-12-27', channel_id: '', product_id: '',
    });
    const [, params] = query.mock.calls[0];
    expect(params[3]).toBeNull(); // channel_id
    expect(params[4]).toBeNull(); // product_id
  });
});

describe('CalendarService.calendar', () => {
  it('rejects a missing or invalid date range', async () => {
    const { svc, query } = makeService();
    await expect(svc.calendar('', '2026-08-31')).rejects.toThrow('from/to must be valid dates');
    await expect(svc.calendar('bogus', '2026-08-31')).rejects.toThrow('from/to must be valid dates');
    expect(query).not.toHaveBeenCalled();
  });

  it('aggregates releases, deployments, and freeze windows for a valid range', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', planned_date: '2026-08-15' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'd1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'fw1' }] });

    const result = await svc.calendar('2026-08-01', '2026-08-31');
    expect(result.releases).toEqual([{ id: 'r1', planned_date: '2026-08-15' }]);
    expect(result.deployments).toEqual([{ id: 'd1' }]);
    expect(result.freeze_windows).toEqual([{ id: 'fw1' }]);
  });
});
