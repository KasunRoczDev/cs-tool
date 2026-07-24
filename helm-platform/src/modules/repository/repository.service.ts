import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';
import { EventTypes } from '../../common/events/domain-event';
import { ProviderRegistry } from '../git-provider/provider-registry';
import { Errors } from '../../common/errors/app-error';

@Injectable()
export class RepositoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly providers: ProviderRegistry,
  ) {}

  list(filter: { provider?: string; active?: boolean; q?: string }) {
    return this.prisma.repository.findMany({
      where: {
        deletedAt: null,
        provider: filter.provider,
        isActive: filter.active,
        name: filter.q ? { contains: filter.q, mode: 'insensitive' } : undefined,
      },
      orderBy: { name: 'asc' },
    });
  }

  async register(ctx: any, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      const repo = await tx.repository.create({
        data: {
          name: dto.name, slug: dto.slug, provider: dto.provider ?? 'github',
          providerFullName: dto.providerFullName, defaultBranch: dto.defaultBranch ?? 'main',
          techStack: dto.techStack ?? [], dockerImageName: dto.dockerImageName,
          containerRegistry: dto.containerRegistry, metadata: dto.metadata ?? {},
        },
      });
      await this.outbox.write(tx, {
        type: EventTypes.RepositoryRegistered, actor: ctx.actor,
        subject: { type: 'repository', id: repo.id }, data: { name: repo.name },
        trace: ctx.trace,
      });
      return repo;
    });
  }

  /** Bulk onboarding (blueprint G.7): list installation repos, register selected. */
  async bulkImport(ctx: any, dto: { provider: string; installationId: string; repoFullNames: string[] }) {
    const provider = this.providers.for(dto.provider);
    const available = await provider.listInstallationRepos(dto.installationId);
    const selected = available.filter((r) => dto.repoFullNames.includes(r.fullName));
    const created = [];
    for (const r of selected) {
      created.push(await this.register(ctx, {
        name: r.fullName.split('/').pop(), slug: r.fullName.replace('/', '-'),
        provider: dto.provider, providerFullName: r.fullName,
      }));
    }
    return { imported: created.length };
  }

  async get(id: string) {
    const repo = await this.prisma.repository.findFirst({ where: { id, deletedAt: null } });
    if (!repo) throw Errors.notFound('Repository not found');
    return repo;
  }
}
