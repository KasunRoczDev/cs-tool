import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

/**
 * Resolves the product scope(s) a request acts on, from its route params/body.
 * Used by PermissionGuard to check permissions against the right product.
 * Returns [] when scope is global / not product-bound (guard then checks global).
 */
@Injectable()
export class ProductScopeResolver {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async resolve(req: any): Promise<string[]> {
    const p = req.params || {};
    const b = req.body || {};

    if (b.product_id) return [b.product_id];
    if (p.productId) return [p.productId];

    // Route heuristics by resource in the path.
    const path: string = req.route?.path || req.url || '';

    if (/\/products\//.test(path) && p.id) return [p.id];
    if (/\/repositories\//.test(path) && p.id) return this.one(`SELECT product_id FROM repositories WHERE id=$1`, p.id);
    if (/\/servers\//.test(path) && p.id) return this.one(`SELECT product_id FROM servers WHERE id=$1`, p.id);
    if (/\/releases\//.test(path) && p.id) return this.releaseProducts(p.id);
    if (/\/deployments\//.test(path) && p.id) {
      const rel = await this.one(`SELECT release_id FROM deployments WHERE id=$1`, p.id);
      return rel[0] ? this.releaseProducts(rel[0]) : [];
    }
    return [];
  }

  private async one(sql: string, id: string): Promise<string[]> {
    const { rows } = await this.pool.query(sql, [id]);
    return rows[0]?.product_id ? [rows[0].product_id] : rows[0]?.release_id ? [rows[0].release_id] : [];
  }

  /** A release's products = distinct products of its pinned repos. */
  async releaseProducts(releaseId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT rp.product_id
         FROM release_repositories rr JOIN repositories rp ON rp.id = rr.repository_id
        WHERE rr.release_id = $1 AND rp.product_id IS NOT NULL`,
      [releaseId],
    );
    return rows.map((r) => r.product_id);
  }
}
