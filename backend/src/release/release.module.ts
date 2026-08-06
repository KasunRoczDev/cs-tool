import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GitService } from './git.service';
import { RepositoriesService } from './repositories.service';
import { RepositoriesController } from './repositories.controller';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';
import { DeploymentsService } from './deployments.service';
import { DeploymentsController } from './deployments.controller';
import { DeployAgentController } from './deploy-agent.controller';
import { WebhooksController } from './webhooks.controller';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { AccessModule } from '../access/access.module';
import { StatusService } from './status/status.service';
import { StatusController } from './status/status.controller';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { EnvironmentService } from './environment.service';
import { EnvironmentController } from './environment.controller';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AgentReleasesService } from './agent-releases.service';
import { AgentReleasesController } from './agent-releases.controller';
import { AgentUpdatesController } from './agent-updates.controller';
import { AppsService } from './apps.service';
import { AppsController } from './apps.controller';
import { ServerAppsService } from './server-apps.service';
import { ServerAppsController } from './server-apps.controller';

/**
 * Release Management — repositories, versions, releases (draft builder, repo
 * pinning, item bundling, promotion, release-notes generation) and a deployment
 * channel pipeline (canary -> beta -> production -> enterprise) with first-class
 * rollback. Ported from the Release & DevOps Platform blueprint.
 */
@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    NotificationsModule,
    AccessModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [
    GitService,
    RepositoriesService,
    ReleasesService,
    DeploymentsService,
    ApprovalsService,
    StatusService,
    CalendarService,
    EnvironmentService,
    AuditService,
    DashboardService,
    AgentReleasesService,
    AppsService,
    ServerAppsService,
  ],
  controllers: [
    RepositoriesController,
    ReleasesController,
    DeploymentsController,
    DeployAgentController,
    WebhooksController,
    ApprovalsController,
    StatusController,
    CalendarController,
    EnvironmentController,
    AuditController,
    DashboardController,
    AgentReleasesController,
    AgentUpdatesController,
    AppsController,
    ServerAppsController,
  ],
  exports: [RepositoriesService, ReleasesService, DeploymentsService, GitService, ApprovalsService],
})
export class ReleaseModule {}
