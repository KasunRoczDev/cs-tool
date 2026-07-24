import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';
import { EventTypes } from '../../common/events/domain-event';
import { Errors } from '../../common/errors/app-error';
import { GovernanceService } from './governance.service';
import { CompatibilityService } from './compatibility.service';

const CHANNEL_ORDER = ['draft', 'canary', 'beta', 'production', 'enterprise'];

export interface PreflightResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: unknown }[];
}

@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly governance: GovernanceService,
    private readonly compat: CompatibilityService,
  ) {}

  async create(ctx: any, dto: { version: string; name?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.release.create({
        data: { version: dto.version, name: dto.name, createdBy: ctx.actor?.id },
      });
      await this.outbox.write(tx, {
        type: EventTypes.ReleaseCreated, actor: ctx.actor,
        subject: { type: 'release', id: release.id }, data: { version: release.version }, trace: ctx.trace,
      });
      return release;
    });
  }

  addRepository(ctx: any, releaseId: string, dto: any) {
    return this.prisma.releaseRepository.create({
      data: {
        releaseId, repositoryId: dto.repositoryId, version: dto.version,
        commitSha: dto.commitSha, branchName: dto.branchName, gitTag: dto.gitTag,
      },
    });
  }

  /** Runs every gate check and reports pass/fail per check (blueprint H: /preflight). */
  async runPreflight(releaseId: string, toChannel: string, actorRoles: string[]): Promise<PreflightResult> {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId }, include: { workItems: true, repositories: true },
    });
    if (!release) throw Errors.notFound('Release not found');

    const compat = await this.compat.checkRelease(releaseId);
    const frozen = await this.governance.isFrozen(toChannel, actorRoles);
    const approvals = await this.governance.approvalsSatisfied(releaseId, `promote:${toChannel}`);
    const blockingItems = release.workItems.filter(
      (w) => !['merged', 'verified', 'released'].includes(w.status),
    );
    const hasRepos = release.repositories.length > 0;

    const checks = [
      { name: 'has_repositories', ok: hasRepos },
      { name: 'compatibility', ok: compat.ok, detail: compat.violations },
      { name: 'work_items_ready', ok: blockingItems.length === 0,
        detail: blockingItems.map((w) => w.refCode) },
      { name: 'no_active_freeze', ok: !frozen },
      { name: 'approvals_satisfied', ok: approvals },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  }

  /**
   * Promote a release to the next channel. The keystone operation (blueprint C.9.2 / J.1):
   * preflight -> governance -> transition -> channel history -> deployment -> events,
   * all in one transaction enlisting the outbox.
   */
  async promote(ctx: any, releaseId: string, toChannel: string, actorRoles: string[]) {
    if (!CHANNEL_ORDER.includes(toChannel)) throw Errors.releaseNotPromotable({ reason: 'unknown channel' });

    const preflight = await this.runPreflight(releaseId, toChannel, actorRoles);
    if (!preflight.ok) {
      const freeze = preflight.checks.find((c) => c.name === 'no_active_freeze');
      if (freeze && !freeze.ok) throw Errors.freezeActive();
      const appr = preflight.checks.find((c) => c.name === 'approvals_satisfied');
      if (appr && !appr.ok) throw Errors.approvalRequired();
      throw Errors.releaseNotPromotable(preflight.checks.filter((c) => !c.ok));
    }

    return this.prisma.$transaction(async (tx) => {
      const release = await tx.release.findUnique({ where: { id: releaseId } });
      if (!release) throw Errors.notFound('Release not found');

      await tx.release.update({ where: { id: releaseId }, data: { status: toChannel, channel: toChannel } });
      await tx.releaseChannelHistory.create({
        data: { releaseId, channel: toChannel, action: 'promoted', fromStatus: release.status, approvedBy: ctx.actor?.id },
      });
      const deployment = await tx.deployment.create({
        data: { releaseId, channel: toChannel, status: 'pending', triggeredBy: ctx.actor?.id, approvedBy: ctx.actor?.id },
      });
      await this.outbox.write(tx, {
        type: EventTypes.ReleasePromoted, actor: ctx.actor, subject: { type: 'release', id: releaseId },
        data: { from: release.status, to: toChannel, releaseVersion: release.version, deploymentId: deployment.id },
        trace: ctx.trace,
      });
      await this.outbox.write(tx, {
        type: EventTypes.DeploymentStarted, actor: ctx.actor, subject: { type: 'deployment', id: deployment.id },
        data: { channel: toChannel, releaseId }, trace: ctx.trace,
      });
      return { release: { ...release, status: toChannel }, deployment };
    });
  }

  async rollback(ctx: any, releaseId: string, toReleaseId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.release.findUnique({ where: { id: toReleaseId } });
      const deployment = await tx.deployment.create({
        data: { releaseId, channel: 'production', status: 'rolled_back', rollbackTarget: target?.version, triggeredBy: ctx.actor?.id },
      });
      await this.outbox.write(tx, {
        type: EventTypes.DeploymentRolledBack, actor: ctx.actor, subject: { type: 'deployment', id: deployment.id },
        data: { releaseId, toReleaseId, reason }, trace: ctx.trace,
      });
      return deployment;
    });
  }

  async get(id: string) {
    const release = await this.prisma.release.findFirst({
      where: { id, deletedAt: null },
      include: { repositories: true, workItems: true, deployments: true, channelHistory: true },
    });
    if (!release) throw Errors.notFound('Release not found');
    return release;
  }
}
