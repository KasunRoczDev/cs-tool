import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { RepositoryController } from './repository.controller';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';
import { GitProviderModule } from '../git-provider/git-provider.module';

@Module({
  imports: [GitProviderModule],
  controllers: [RepositoryController],
  providers: [RepositoryService, PrismaService, OutboxService],
  exports: [RepositoryService],
})
export class RepositoryModule {}
