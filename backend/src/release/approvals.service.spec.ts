import { ApprovalsService } from './approvals.service';

function makePool(queryImpls: any[]) {
  const query = jest.fn();
  for (const impl of queryImpls) query.mockResolvedValueOnce(impl);
  return { query } as any;
}

const notifications = { notifyEvent: jest.fn(), sendThreadedEmail: jest.fn() } as any;

describe('ApprovalsService.status / isFullyApproved', () => {
  const RELEASE_ROW = { rows: [{ id: 'r1', version: '1.0.0' }] };
  const REQUIRED_TWO = {
    rows: [
      { id: 'u-qa', email: 'qa@x.com', approval_role: 'qa', product_id: 'p1', product_name: 'OMS' },
      { id: 'u-ba', email: 'ba@x.com', approval_role: 'ba', product_id: 'p1', product_name: 'OMS' },
    ],
  };
  const REQUIRED_NONE = { rows: [] };

  it('is fully approved once every required approver has approved', async () => {
    const pool = makePool([
      RELEASE_ROW,
      REQUIRED_TWO,
      {
        rows: [
          { id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null, approver_email: 'qa@x.com', attachments: [] },
          { id: 'a2', approver_id: 'u-ba', approval_role: 'ba', decision: 'approved', remark: null, updated_at: null, approver_email: 'ba@x.com', attachments: [] },
        ],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.status('r1');
    expect(status.fully_approved).toBe(true);
    expect(status.approved_count).toBe(2);
    expect(status.pending).toEqual([]);
  });

  it('is not fully approved while a required approver is still pending', async () => {
    const pool = makePool([
      RELEASE_ROW,
      REQUIRED_TWO,
      {
        rows: [
          { id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null, approver_email: 'qa@x.com', attachments: [] },
        ],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.status('r1');
    expect(status.fully_approved).toBe(false);
    expect(status.pending).toEqual(['ba@x.com']);
  });

  it('sets rejected=true and fully_approved=false when any approver rejects', async () => {
    const pool = makePool([
      RELEASE_ROW,
      REQUIRED_TWO,
      {
        rows: [
          { id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null, approver_email: 'qa@x.com', attachments: [] },
          { id: 'a2', approver_id: 'u-ba', approval_role: 'ba', decision: 'rejected', remark: 'no', updated_at: null, approver_email: 'ba@x.com', attachments: [] },
        ],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.status('r1');
    expect(status.rejected).toBe(true);
    expect(status.fully_approved).toBe(false);
  });

  it('treats the gate as open (fully_approved=true) when no approvers are configured', async () => {
    const pool = makePool([RELEASE_ROW, REQUIRED_NONE, { rows: [] }]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.status('r1');
    expect(status.required_count).toBe(0);
    expect(status.fully_approved).toBe(true);
  });

  it('isFullyApproved delegates to status().fully_approved', async () => {
    const pool = makePool([RELEASE_ROW, REQUIRED_NONE, { rows: [] }]);
    const svc = new ApprovalsService(pool, notifications);
    expect(await svc.isFullyApproved('r1')).toBe(true);
  });
});
