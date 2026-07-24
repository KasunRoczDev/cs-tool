import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** Approval-policy + freeze-window checks (blueprint G.2, G.9). */
@Injectable()
export class GovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** True if a freeze blocks this channel right now (unless actor overrides). */
  async isFrozen(channel: string, actorRoles: string[]): Promise<boolean> {
    const now = new Date();
    const active = await this.prisma.freezeWindow.findFirst({
      where: { startsAt: { lte: now }, endsAt: { gte: now }, channels: { has: channel } },
    });
    if (!active) return false;
    const canOverride = active.overrideRoles.some((r) => actorRoles.includes(r));
    return !canOverride;
  }

  /** True if approval requirements for the gate are satisfied. */
  async approvalsSatisfied(subjectId: string, gate: string): Promise<boolean> {
    const req = await this.prisma.approvalRequest.findFirst({
      where: { subjectId, gate, state: 'pending' },
      include: { decisions: true },
    });
    if (!req) return true; // no policy => no extra gate beyond RBAC
    const policy = req.policyId ? await this.prisma.approvalPolicy.findUnique({ where: { id: req.policyId } }) : null;
    const approvals = req.decisions.filter((d) => d.decision === 'approved').length;
    const rejected = req.decisions.some((d) => d.decision === 'rejected');
    return !rejected && approvals >= (policy?.minApprovals ?? req.requiredApprovals);
  }
}
