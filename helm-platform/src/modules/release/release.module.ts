import { Module } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { ReleaseController } from './release.controller';
import { GovernanceService } from './governance.service';
import { CompatibilityService } from './compatibility.service';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../../common/events/outbox.service';

@Module({
  controllers: [ReleaseController],
  providers: [ReleaseService, GovernanceService, CompatibilityService, PrismaService, OutboxService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
