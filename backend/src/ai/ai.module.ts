import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { ReleaseModule } from '../release/release.module';
import { AiService } from './ai.service';
import { LlmService } from './llm.service';
import { AiController } from './ai.controller';

/**
 * AI Assistant — release intelligence. Heuristic scoring over the platform's own
 * data (deployments, jobs, PRs, commits, alerts) with optional LLM enrichment.
 * Reuses GitService + ReleasesService exported by ReleaseModule.
 */
@Module({
  imports: [
    DatabaseModule,
    ReleaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [AiService, LlmService],
  controllers: [AiController],
})
export class AiModule {}
