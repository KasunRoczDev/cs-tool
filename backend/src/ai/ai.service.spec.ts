import { AiService } from './ai.service';

const HIGH_RISK_RELEASE = {
  version: '1.0.0',
  items: [
    { item_type: 'hotfix', status: 'open' },
    { item_type: 'hotfix', status: 'open' },
    { item_type: 'hotfix', status: 'open' },
  ],
  repositories: [{}, {}, {}, {}, {}],
};
const LOW_RISK_RELEASE = { version: '2.0.0', items: [], repositories: [{}] };

function makeService(releaseFixture: any) {
  const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ok: 0, failed: 0 }] }) } as any;
  const git = {} as any;
  const releases = { get: jest.fn().mockResolvedValue(releaseFixture) } as any;
  const llm = { complete: jest.fn().mockResolvedValue('narrative') } as any;
  const notifications = { notifyEvent: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AiService(pool, git, releases, llm, notifications);
  return { svc, notifications };
}

describe('AiService.releaseRisk — high-risk notification', () => {
  it('computes a high risk level and fires release.ai_high_risk once', async () => {
    const { svc, notifications } = makeService(HIGH_RISK_RELEASE);
    const risk = await svc.releaseRisk('r1', 'production');
    expect(risk.level).toBe('high');
    expect(notifications.notifyEvent).toHaveBeenCalledTimes(1);
    expect(notifications.notifyEvent).toHaveBeenCalledWith(
      'release.ai_high_risk',
      expect.objectContaining({ severity: 'critical' }),
    );
  });

  it('does not re-notify on a second view within the cooldown window', async () => {
    const { svc, notifications } = makeService(HIGH_RISK_RELEASE);
    await svc.releaseRisk('r1', 'production');
    await svc.releaseRisk('r1', 'production');
    expect(notifications.notifyEvent).toHaveBeenCalledTimes(1);
  });

  it('does not notify for a low-risk release', async () => {
    const { svc, notifications } = makeService(LOW_RISK_RELEASE);
    const risk = await svc.releaseRisk('r2', 'production');
    expect(risk.level).toBe('low');
    expect(notifications.notifyEvent).not.toHaveBeenCalled();
  });
});
