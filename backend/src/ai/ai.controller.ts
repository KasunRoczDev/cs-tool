import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AiService } from './ai.service';

/** AI Assistant — release intelligence over the platform's own data (+ optional LLM). */
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  @Get('releases/:id/risk')
  risk(@Param('id') id: string, @Query('channel') channel?: string) {
    return this.ai.releaseRisk(id, channel || 'production');
  }

  @Get('releases/:id/predict')
  predict(@Param('id') id: string, @Query('channel') channel?: string) {
    return this.ai.predictDeployment(id, channel || 'production');
  }

  @Get('releases/:id/rollback-plan')
  rollback(@Param('id') id: string, @Query('channel') channel?: string) {
    return this.ai.rollbackPlan(id, channel || 'production');
  }

  @Get('releases/:id/notes')
  notes(@Param('id') id: string) {
    return this.ai.enhanceReleaseNotes(id);
  }

  @Get('repositories/:id/risky-prs')
  riskyPrs(@Param('id') id: string) {
    return this.ai.riskyPullRequests(id);
  }

  @Get('repositories/:id/prs/:number/reviewers')
  reviewers(@Param('id') id: string, @Param('number') number: string) {
    return this.ai.recommendReviewers(id, parseInt(number, 10));
  }

  @Get('repositories/:id/prs/:number/breaking-changes')
  breaking(@Param('id') id: string, @Param('number') number: string) {
    return this.ai.breakingChanges(id, parseInt(number, 10));
  }

  @Get('incidents')
  incidents(@Query('hours') hours?: string) {
    return this.ai.analyzeIncidents(hours ? parseInt(hours, 10) : 72);
  }
}
