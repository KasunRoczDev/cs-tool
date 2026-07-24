import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { AccessService } from './access.service';

@Injectable()
export class MembershipsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: AccessService,
  ) {}

  /** Members of a product (+ global grants that apply everywhere). */
  async forProduct(productId: string) {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.user_id, u.email, m.role_id, r.key AS role_key, r.name AS role_name,
              m.scope_type, m.product_id
         FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
        WHERE m.product_id = $1 OR m.scope_type = 'global'
        ORDER BY m.scope_type DESC, u.email`,
      [productId],
    );
    return rows;
  }

  async forUser(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.role_id, r.key AS role_key, r.name AS role_name,
              m.scope_type, m.product_id, p.name AS product_name
         FROM memberships m JOIN roles r ON r.id = m.role_id
         LEFT JOIN products p ON p.id = m.product_id
        WHERE m.user_id = $1 ORDER BY m.scope_type DESC, p.name`,
      [userId],
    );
    return rows;
  }

  async grant(dto: { user_id: string; role_id: string; scope_type?: string; product_id?: string }, actorId?: string) {
    const scope = dto.scope_type === 'global' ? 'global' : 'product';
    const { rows } = await this.pool.query(
      `INSERT INTO memberships (user_id, role_id, scope_type, product_id, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, role_id, scope_type, product_id) DO NOTHING
       RETURNING id`,
      [dto.user_id, dto.role_id, scope, scope === 'global' ? null : dto.product_id ?? null, actorId ?? null],
    );
    this.access.invalidate();
    return rows[0] ?? { ok: true, note: 'already granted' };
  }

  async revoke(id: string) {
    await this.pool.query(`DELETE FROM memberships WHERE id=$1`, [id]);
    this.access.invalidate();
    return { deleted: id };
  }
}
