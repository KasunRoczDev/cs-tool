import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

/**
 * Product-wise access control. Resolves a user's effective permissions for a
 * given product (union of their global + that-product memberships), with a short
 * in-memory cache. `can()` is the single authz decision used by PermissionGuard.
 */
@Injectable()
export class AccessService {
  private cache = new Map<string, { perms: Set<string>; exp: number }>();
  private readonly TTL_MS = 60_000;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private key(userId: string, productId?: string) {
    return `${userId}:${productId ?? 'null'}`;
  }

  /** Effective permission keys for (user, product). Global memberships always apply. */
  async effective(userId: string, productId?: string): Promise<Set<string>> {
    const k = this.key(userId, productId);
    const hit = this.cache.get(k);
    if (hit && hit.exp > Date.now()) return hit.perms;
    const { rows } = await this.pool.query(
      `SELECT DISTINCT rp.permission_key
         FROM memberships m
         JOIN role_permissions rp ON rp.role_id = m.role_id
        WHERE m.user_id = $1
          AND (m.scope_type = 'global' OR m.product_id = $2)`,
      [userId, productId ?? null],
    );
    const perms = new Set<string>(rows.map((r) => r.permission_key));
    this.cache.set(k, { perms, exp: Date.now() + this.TTL_MS });
    return perms;
  }

  /** Is the user a global platform admin (superuser)? */
  async isSuperuser(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = $1 AND m.scope_type = 'global' AND r.key = 'platform_admin' LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  async can(userId: string, permission: string, productId?: string): Promise<boolean> {
    if (await this.isSuperuser(userId)) return true;
    return (await this.effective(userId, productId)).has(permission);
  }

  /** All effective permissions across ALL products the user belongs to (for /me/permissions with no product). */
  async allEffective(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT rp.permission_key
         FROM memberships m JOIN role_permissions rp ON rp.role_id = m.role_id
        WHERE m.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.permission_key);
  }

  invalidate() {
    this.cache.clear();
  }
}
