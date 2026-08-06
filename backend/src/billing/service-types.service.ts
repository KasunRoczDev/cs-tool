import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ServiceType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  created_at: string;
}

@Injectable()
export class ServiceTypesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(): Promise<ServiceType[]> {
    return this.pool
      .query('SELECT id, key, name, description, created_at FROM service_types ORDER BY name')
      .then((r) => r.rows);
  }

  async create(key: string, name: string, description?: string): Promise<ServiceType> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO service_types (key, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, key, name, description, created_at`,
        [key, name, description ?? null],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Service type key already exists');
      throw e;
    }
  }

  async update(
    id: string,
    patch: { key?: string; name?: string; description?: string },
  ): Promise<ServiceType> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.key !== undefined) { params.push(patch.key); sets.push(`key = $${params.length}`); }
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.description !== undefined) { params.push(patch.description); sets.push(`description = $${params.length}`); }
    if (sets.length === 0) {
      const { rows } = await this.pool.query(
        'SELECT id, key, name, description, created_at FROM service_types WHERE id = $1', [id]);
      if (!rows[0]) throw new NotFoundException('Service type not found');
      return rows[0];
    }
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE service_types SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, key, name, description, created_at`,
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
