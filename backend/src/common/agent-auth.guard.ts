import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { hashApiKey } from './hash.util';

/**
 * Authenticates an agent request via the `X-Api-Key` header.
 * On success attaches `req.server = { id, name }`.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') {
      throw new UnauthorizedException('Missing X-Api-Key header');
    }
    const { rows } = await this.pool.query(
      'SELECT id, name FROM servers WHERE api_key_hash = $1 LIMIT 1',
      [hashApiKey(key)],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid API key');
    }
    req.server = rows[0];
    return true;
  }
}
