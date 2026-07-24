import { Module } from '@nestjs/common';
import { HotfixService } from './hotfix.service';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';
import { GitProviderModule } from '../git-provider/git-provider.module';

@Module({
  imports: [GitProviderModule],
  providers: [HotfixService, PrismaService, OutboxService],
  exports: [HotfixService],
})
export class WorkItemModule {}
