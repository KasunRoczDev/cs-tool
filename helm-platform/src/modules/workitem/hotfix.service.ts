import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';
import { EventTypes } from '../../common/events/domain-event';
import { ProviderRegistry } from '../git-provider/provider-registry';

/**
 * Hotfix automation (blueprint C.9.1 / J.4): create hotfix/* from the production tag,
 * then prepare merge-backs into main AND every active release/* branch — the highest
 * manual-error source today.
 */
@Injectable()
export class HotfixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly providers: ProviderRegistry,
  ) {}

  async createHotfix(ctx: any, dto: { repositoryId: string; baseChannel: string; title: string; developerId: string }) {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: dto.repositoryId } });
    const provider = this.providers.for(repo.provider);
    const repoRef = { provider: repo.provider, fullName: repo.providerFullName };

    // Resolve the production tag for the channel and branch from it.
    const prodVersion = await this.prisma.serviceVersion.findFirst({
      where: { repositoryId: repo.id, channel: dto.baseChannel }, orderBy: { createdAt: 'desc' },
    });
    const hotfixBranch = `hotfix/${prodVersion?.version ?? 'x.y.z'}-fix`;

    return this.prisma.$transaction(async (tx) => {
      if (prodVersion?.commitSha) {
        await provider.createBranch(repoRef, hotfixBranch, prodVersion.commitSha).catch(() => undefined);
      }
      const workItem = await tx.workItem.create({
        data: { type: 'hotfix', title: dto.title, repositoryId: repo.id, branchName: hotfixBranch,
          developerId: dto.developerId, status: 'open', priority: 'critical' },
      });
      // Compute merge-back targets: main + every active release/* branch.
      const targets = ['main', ...(await tx.branch.findMany({
        where: { repositoryId: repo.id, type: 'release' }, select: { name: true },
      })).map((b) => b.name)];

      await this.outbox.write(tx, {
        type: EventTypes.HotfixCreated, actor: ctx.actor, subject: { type: 'work_item', id: workItem.id },
        data: { repository: repo.name, hotfixBranch, mergeBackTargets: targets }, trace: ctx.trace,
      });
      return { workItem, hotfixBranch, mergeBackTargets: targets };
    });
  }
}
