import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ServiceType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  spec_fields: string[];
  created_at: string;
}

const COLUMNS = 'id, key, name, description, spec_fields, created_at';

@Injectable()
export class ServiceTypesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(): Promise<ServiceType[]> {
    return this.pool
      .query(`SELECT ${COLUMNS} FROM service_types ORDER BY name`)
      .then((r) => r.rows);
  }

  async create(key: string, name: string, description?: string, specFields?: string[]): Promise<ServiceType> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO service_types (key, name, description, spec_fields)
         VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [key, name, description ?? null, JSON.stringify(specFields ?? [])],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Service type key already exists');
      throw e;
    }
  }

  async update(
    id: string,
    patch: { key?: string; name?: string; description?: string; spec_fields?: string[] },
  ): Promise<ServiceType> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.key !== undefined) { params.push(patch.key); sets.push(`key = $${params.length}`); }
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.description !== undefined) { params.push(patch.description); sets.push(`description = $${params.length}`); }
    if (patch.spec_fields !== undefined) { params.push(JSON.stringify(patch.spec_fields)); sets.push(`spec_fields = $${params.length}`); }
    if (sets.length === 0) {
      const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM service_types WHERE id = $1`, [id]);
      if (!rows[0]) throw new NotFoundException('Service type not found');
      return rows[0];
    }
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE service_types SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING ${COLUMNS}`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Service type not found');
    return rows[0];
  }

  async remove(id: string): Promise<{ deleted: string }> {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS c FROM services WHERE service_type_id = $1', [id]);
    if (rows[0].c > 0) {
      throw new ConflictException(`Cannot delete: ${rows[0].c} service(s) use this type`);
    }
    const { rowCount } = await this.pool.query('DELETE FROM service_types WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('Service type not found');
    return { deleted: id };
  }
}
