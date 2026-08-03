import { ApprovalsService } from './approvals.service';

function makePool(queryImpls: any[]) {
  const query = jest.fn();
  for (const impl of queryImpls) query.mockResolvedValueOnce(impl);
  return { query } as any;
}

const notifications = {
  notifyEvent: jest.fn().mockResolvedValue(undefined),
  sendThreadedEmail: jest.fn().mockResolvedValue(undefined),
} as any;

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

describe('ApprovalsService.submit', () => {
  const RELEASE_ROW = { rows: [{ id: 'r1', version: '1.0.0' }] };
  const REQUIRED_ONE = { rows: [{ id: 'u-qa', email: 'qa@x.com', approval_role: 'qa', product_id: 'p1', product_name: 'OMS' }] };

  it("records a direct approver's decision, a history row, and clears reminders", async () => {
    const pool = makePool([
      { rows: [{ id: 'u-qa', email: 'qa@x.com', approval_role: 'qa', product_id: 'p1' }] }, // me
      REQUIRED_ONE,
      { rows: [{ id: 'appr1' }] }, // INSERT release_approvals
      { rows: [] }, // INSERT release_approval_history
      { rows: [] }, // DELETE approval_reminders
      RELEASE_ROW,
      REQUIRED_ONE,
      {
        rows: [{
          id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null,
          expires_at: null, decided_on_behalf_of: null, approver_email: 'qa@x.com', decided_on_behalf_of_email: null, attachments: [],
        }],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.submit('r1', 'u-qa', { decision: 'approved' });
    expect(status.approved_count).toBe(1);

    const historyInsert = pool.query.mock.calls[3];
    expect(historyInsert[0]).toContain('INSERT INTO release_approval_history');
    expect(historyInsert[1]).toEqual(['r1', 'u-qa', 'qa', 'approved', null, 'u-qa', null]);
  });

  it('rejects a user who is neither a required approver nor an active delegate', async () => {
    const pool = makePool([
      { rows: [{ id: 'stranger', email: 's@x.com', approval_role: null, product_id: null }] },
      REQUIRED_ONE,
      { rows: [] }, // delegation lookup — none found
    ]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(svc.submit('r1', 'stranger', { decision: 'approved' })).rejects.toThrow('not a required approver');
  });

  it('lets an active delegate submit on behalf of a required approver', async () => {
    const pool = makePool([
      { rows: [{ id: 'delegate1', email: 'delegate@x.com', approval_role: null, product_id: null }] },
      REQUIRED_ONE,
      { rows: [{ from_user: 'u-qa' }] }, // delegation found
      { rows: [{ id: 'appr1' }] },
      { rows: [] },
      { rows: [] },
      RELEASE_ROW,
      REQUIRED_ONE,
      {
        rows: [{
          id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null,
          expires_at: null, decided_on_behalf_of: 'delegate1', approver_email: 'qa@x.com',
          decided_on_behalf_of_email: 'delegate@x.com', attachments: [],
        }],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    const status = await svc.submit('r1', 'delegate1', { decision: 'approved' });
    expect(status.approvers[0].decided_by).toBe('delegate@x.com');

    const insertApprovals = pool.query.mock.calls[3];
    expect(insertApprovals[1][1]).toBe('u-qa'); // recorded under the delegator's slot, not the delegate's id
  });
});

describe('ApprovalsService.createDelegation', () => {
  const future = () => new Date(Date.now() + 86_400_000).toISOString();

  it('rejects when the actor is neither the delegator nor an admin', async () => {
    const pool = makePool([]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(
      svc.createDelegation('u-qa', 'u-ba', future(), undefined, 'someone-else', 'operator'),
    ).rejects.toThrow('Only the approver themself or an admin');
  });

  it('rejects delegating to yourself', async () => {
    const pool = makePool([]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(svc.createDelegation('u-qa', 'u-qa', future(), undefined, 'u-qa')).rejects.toThrow('Cannot delegate to yourself');
  });

  it('rejects a non-future ends_at', async () => {
    const pool = makePool([]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(
      svc.createDelegation('u-qa', 'u-ba', '2000-01-01T00:00:00Z', undefined, 'u-qa'),
    ).rejects.toThrow('must be a valid date in the future');
  });

  it('creates a delegation when the actor is the delegator', async () => {
    const pool = makePool([{ rows: [{ id: 'd1', from_user: 'u-qa', to_user: 'u-ba' }] }]);
    const svc = new ApprovalsService(pool, notifications);
    const result = await svc.createDelegation('u-qa', 'u-ba', future(), 'on leave', 'u-qa');
    expect(result.id).toBe('d1');
  });
});

describe('ApprovalsService.revokeDelegation', () => {
  it('throws NotFoundException for an unknown delegation', async () => {
    const pool = makePool([{ rows: [] }]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(svc.revokeDelegation('bogus', 'u1')).rejects.toThrow('not found');
  });

  it('rejects revocation by someone who is not the delegator or an admin', async () => {
    const pool = makePool([{ rows: [{ from_user: 'u-qa' }] }]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(svc.revokeDelegation('d1', 'someone-else', 'operator')).rejects.toThrow('Only the delegator or an admin');
  });

  it('lets the delegator revoke their own delegation', async () => {
    const pool = makePool([{ rows: [{ from_user: 'u-qa' }] }, { rows: [] }]);
    const svc = new ApprovalsService(pool, notifications);
    await expect(svc.revokeDelegation('d1', 'u-qa')).resolves.toEqual({ revoked: true });
  });
});

describe('ApprovalsService.reRequestApproval', () => {
  it("resets the approver's decision, logs history, and emails them", async () => {
    const pool = makePool([
      { rows: [{ email: 'qa@x.com', approval_role: 'qa' }] }, // approver lookup
      { rows: [{ version: '1.0.0' }] }, // release lookup
      { rows: [] }, // DELETE release_approvals
      { rows: [] }, // INSERT history
      { rows: [] }, // DELETE reminders
      { rows: [{ id: 'r1', version: '1.0.0' }] }, // status(): release
      { rows: [] }, // status(): requiredApprovers
      { rows: [] }, // status(): decisions
    ]);
    const svc = new ApprovalsService(pool, notifications);
    await svc.reRequestApproval('r1', 'u-qa', 'admin1');
    expect(notifications.sendThreadedEmail).toHaveBeenCalledWith(
      ['qa@x.com'], expect.stringContaining('re-approval requested'), expect.any(String), expect.any(String),
    );
  });
});

describe('ApprovalsService.history', () => {
  it('returns the release approval history rows', async () => {
    const pool = makePool([{ rows: [{ id: 'h1' }, { id: 'h2' }] }]);
    const svc = new ApprovalsService(pool, notifications);
    expect(await svc.history('r1')).toHaveLength(2);
  });
});

describe('ApprovalsService.sweepExpiredApprovals', () => {
  it('expires stale approved decisions and logs history for each', async () => {
    const pool = makePool([
      {
        rows: [
          { release_id: 'r1', approver_id: 'u-qa', approval_role: 'qa' },
          { release_id: 'r2', approver_id: 'u-ba', approval_role: 'ba' },
        ],
      },
      { rows: [] },
      { rows: [] },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    await svc.sweepExpiredApprovals();
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});

describe('ApprovalsService.sweepApprovalReminders', () => {
  it('emails a still-pending approver who has not been reminded recently', async () => {
    const pool = makePool([
      { rows: [{ id: 'r1', version: '1.0.0' }] }, // openReleases
      { rows: [{ id: 'r1', version: '1.0.0' }] }, // status(): release
      { rows: [{ id: 'u-qa', email: 'qa@x.com', approval_role: 'qa', product_id: 'p1', product_name: 'OMS' }] }, // status(): requiredApprovers
      { rows: [] }, // status(): decisions (none -> pending)
      { rows: [] }, // reminder lookup — none yet
      { rows: [] }, // upsert reminder
    ]);
    const svc = new ApprovalsService(pool, notifications);
    await svc.sweepApprovalReminders();
    expect(notifications.sendThreadedEmail).toHaveBeenCalledWith(
      ['qa@x.com'], expect.stringContaining('Reminder'), expect.any(String), expect.any(String),
    );
  });

  it('skips a release that is already fully approved', async () => {
    const pool = makePool([
      { rows: [{ id: 'r1', version: '1.0.0' }] },
      { rows: [{ id: 'r1', version: '1.0.0' }] },
      { rows: [{ id: 'u-qa', email: 'qa@x.com', approval_role: 'qa', product_id: 'p1', product_name: 'OMS' }] },
      {
        rows: [{
          id: 'a1', approver_id: 'u-qa', approval_role: 'qa', decision: 'approved', remark: null, updated_at: null,
          expires_at: null, decided_on_behalf_of: null, approver_email: 'qa@x.com', decided_on_behalf_of_email: null, attachments: [],
        }],
      },
    ]);
    const svc = new ApprovalsService(pool, notifications);
    await svc.sweepApprovalReminders();
    expect(pool.query).toHaveBeenCalledTimes(4); // never reaches the reminder-lookup query
  });
});
