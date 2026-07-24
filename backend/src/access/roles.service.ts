import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { AccessService } from './access.service';

@Injectable()
export class RolesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: AccessService,
  ) {}

  permissions() {
    return this.pool
      .query(`SELECT key, resource, description FROM permissions ORDER BY resource, key`)
      .then((r) => r.rows);
  }

  async roles() {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.key, r.name, r.description, r.is_system, r.approval_slot,
              COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    );
    return rows;
  }

  async create(dto: { key: string; name: string; description?: string; permission_keys?: string[]; approval_slot?: string }) {
    const { rows } = await this.pool.query(
      `INSERT INTO roles (key, name, description, is_system, approval_slot)
       VALUES ($1,$2,$3,false,$4) RETURNING id`,
      [dto.key, dto.name, dto.description ?? null, dto.approval_slot || null],
    );
    if (dto.permission_keys?.length) await this.setPermissions(rows[0].id, dto.permission_keys);
    this.access.invalidate();
    return this.role(rows[0].id);
  }

  async setPermissions(roleId: string, keys: string[]) {
    const role = await this.pool.query(`SELECT is_system FROM roles WHERE id=$1`, [roleId]);
    if (!role.rows[0]) throw new NotFoundException('Role not found');
    await this.pool.query(`DELETE FROM role_permissions WHERE role_id=$1`, [roleId]);
    if (keys.length) {
      const values = keys.map((_, i) => `($1,$${i + 2})`).join(',');
      await this.pool.query(
        `INSERT INTO role_permissions (role_id, permission_key) VALUES ${values} ON CONFLICT DO NOTHING`,
        [roleId, ...keys],
      );
    }
    this.access.invalidate();
    return this.role(roleId);
  }

  async role(id: string) {
    return (await this.roles()).find((r: any) => r.id === id);
  }

  async remove(id: string) {
    const r = await this.pool.query(`SELECT is_system FROM roles WHERE id=$1`, [id]);
    if (!r.rows[0]) throw new NotFoundException('Role not found');
    if (r.rows[0].is_system) throw new BadRequestException('System roles cannot be deleted');
    await this.pool.query(`DELETE FROM roles WHERE id=$1`, [id]);
    this.access.invalidate();
    return { deleted: id };
  }
}
