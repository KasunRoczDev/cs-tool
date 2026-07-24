import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Liveness / readiness / status (blueprint G.8). */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz') health() { return { status: 'ok' }; }

  @Get('readyz')
  async ready() {
    try { await this.prisma.$queryRaw`SELECT 1`; return { status: 'ready', db: 'up' }; }
    catch { return { status: 'degraded', db: 'down' }; }
  }

  @Get('api/v1/status')
  async status() {
    return {
      service: 'helm-api',
      db: await this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      time: new Date().toISOString(),
    };
  }
}
