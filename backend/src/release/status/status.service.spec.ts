import { BadRequestException } from '@nestjs/common';
import { StatusService } from './status.service';

function makePool(queryImpls: any[]) {
  const query = jest.fn();
  for (const impl of queryImpls) query.mockResolvedValueOnce(impl);
  return { query } as any;
}

const notifications = { notifyEvent: jest.fn().mockResolvedValue(undefined) } as any;
const rt = { emitReleaseEvent: jest.fn() } as any;
const access = { can: jest.fn() } as any;
const approvals = { isFullyApproved: jest.fn() } as any;

describe('StatusService.createStatus', () => {
  it('inserts the status and auto-provisions its status.transition.<key> permission', async () => {
    const pool = makePool([
      { rows: [{ id: 'wf1' }] }, // workflow lookup
      { rows: [{ id: 's1', key: 'qa_review', name: 'QA Review', workflow_id: 'wf1' }] }, // INSERT status
      { rows: [] }, // INSERT permission catalog row
    ]);
    const svc = new StatusService(pool, access, approvals, rt, notifications);
    const row = await svc.createStatus('wf1', { key: 'qa_review', name: 'QA Review', rank: 1 });
    expect(row.key).toBe('qa_review');

    const permCall = pool.query.mock.calls.find(([sql]: any[]) => /INSERT INTO permissions/.test(sql));
    expect(permCall).toBeDefined();
    expect(permCall[1]).toEqual(['status.transition.qa_review', 'Transition release to QA Review']);
  });

  it('rejects a key with characters outside [a-z0-9_]', async () => {
    const pool = makePool([]);
    const svc = new StatusService(pool, access, approvals, rt, notifications);
    await expect(svc.createStatus('wf1', { key: 'QA Review!', name: 'QA Review', rank: 1 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('StatusService.deleteStatus', () => {
  it('refuses to delete a status that releases currently reference', async () => {
    const pool = makePool([{ rows: [{ n: 2 }] }]);
    const svc = new StatusService(pool, access, approvals, rt, notifications);
    await expect(svc.deleteStatus('wf1', 's1')).rejects.toBeInstanceOf(BadRequestException);
    expect(pool.query).toHaveBeenCalledTimes(1); // never reaches the DELETE
  });

  it('deletes a status that no release references', async () => {
    const pool = makePool([
      { rows: [{ n: 0 }] },
      { rowCount: 1 },
    ]);
    const svc = new StatusService(pool, access, approvals, rt, notifications);
    await expect(svc.deleteStatus('wf1', 's1')).resolves.toEqual({ deleted: true });
  });
});

describe('StatusService.transition — releases.status is no longer enum-cast', () => {
  it('transitions into a custom status key outside the legacy release_channel enum', async () => {
    const WF = { id: 'wf1', name: 'Custom' };
    const DRAFT = { id: 's-draft', key: 'draft', name: 'Draft' };
    const QA = { id: 's-qa', key: 'qa_review', name: 'QA Review' };
    const TRANSITION = {
      id: 't1', from_status_id: 's-draft', to_status_id: 's-qa', kind: 'forward',
      require_approval: true, required_checks: [], required_permission: 'status.transition.qa_review',
    };

    // Content-matched rather than call-order-matched: several distinct calls in
    // transition()/statusView() share identical SQL shapes, disambiguated by params.
    const query = jest.fn((sql: string, params: any[] = []) => {
      if (/FROM release_repositories/.test(sql)) return Promise.resolve({ rows: [] }); // no product scope
      if (/FROM release_workflows WHERE is_default/.test(sql)) return Promise.resolve({ rows: [WF] });
      if (/SELECT status_id, status FROM releases/.test(sql)) return Promise.resolve({ rows: [{ status_id: null, status: 'draft' }] });
      if (/FROM release_statuses WHERE workflow_id=\$1 AND key=\$2/.test(sql)) {
        return Promise.resolve({ rows: [params[1] === 'qa_review' ? QA : DRAFT] });
      }
      if (/to_status_id=\$2 AND \(from_status_id=\$3/.test(sql)) return Promise.resolve({ rows: [TRANSITION] });
      if (/FROM release_statuses WHERE workflow_id=\$1 ORDER BY rank/.test(sql)) return Promise.resolve({ rows: [DRAFT, QA] });
      if (/SELECT version FROM releases/.test(sql)) return Promise.resolve({ rows: [{ version: '1.0.0' }] });
      if (/INSERT INTO release_status_history/.test(sql)) return Promise.resolve({ rows: [] });
      if (/JOIN release_statuses ts ON ts\.id = t\.to_status_id/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const pool = { query } as any;

    const svc = new StatusService(pool, access, approvals, rt, notifications);
    await expect(svc.transition('r1', 'u1', 'admin', 'qa_review')).resolves.toBeDefined();

    const updateCall = query.mock.calls.find(([sql]: any[]) => /UPDATE releases SET status_id/.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).not.toContain('::release_channel');
    expect(updateCall![1]).toEqual(['r1', 's-qa', 'qa_review']);
  });
});
