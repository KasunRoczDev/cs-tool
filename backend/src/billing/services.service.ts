import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export type BillingMode = 'pay_per_use' | 'monthly' | 'annual';
export type ServiceStatus = 'active' | 'retired';

export interface ServiceRow {
  id: string;
  product_id: string;
  product_name: string;
  service_type_id: string;
  service_type_name: string;
  name: string;
  region: string | null;
  specs: { key: string; value: string }[];
  billing_mode: BillingMode;
  server_id: string | null;
  server_name: string | null;
  tags: Record<string, string>;
  status: ServiceStatus;
  created_at: string;
}

export interface ServiceInput {
  product_id: string;
  service_type_id: string;
  name: string;
  region?: string;
  specs?: { key: string; value: string }[];
  billing_mode?: BillingMode;
  server_id?: string;
  tags?: Record<string, string>;
}

const LIST_SELECT = `
  SELECT s.id, s.product_id, p.name AS product_name,
         s.service_type_id, st.name AS service_type_name,
         s.name, s.region, s.specs, s.billing_mode,
         s.server_id, sv.name AS server_name,
         s.tags, s.status, s.created_at
    FROM services s
    JOIN products p ON p.id = s.product_id
    JOIN service_types st ON st.id = s.service_type_id
    LEFT JOIN servers sv ON sv.id = s.server_id`;

@Injectable()
export class ServicesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(filters: {
    product_id?: string; service_type_id?: string; status?: string;
  }): Promise<ServiceRow[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.product_id) { params.push(filters.product_id); where.push(`s.product_id = $${params.length}`); }
    if (filters.service_type_id) { params.push(filters.service_type_id); where.push(`s.service_type_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); where.push(`s.status = $${params.length}`); }
    const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name, s.name`;
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  async get(id: string): Promise<ServiceRow> {
    const { rows } = await this.pool.query(`${LIST_SELECT} WHERE s.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Service not found');
    return rows[0];
  }

  async create(input: ServiceInput, userId: string): Promise<ServiceRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO services (product_id, service_type_id, name, region, specs, billing_mode, server_id, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.product_id,
        input.service_type_id,
        input.name,
        input.region ?? null,
        JSON.stringify(input.specs ?? []),
        input.billing_mode ?? 'monthly',
        input.server_id ?? null,
        JSON.stringify(input.tags ?? {}),
        userId,
      ],
    );
    return this.get(rows[0].id);
  }

  async update(id: string, patch: Partial<ServiceInput>): Promise<ServiceRow> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.product_id !== undefined) push('product_id', patch.product_id);
    if (patch.service_type_id !== undefined) push('service_type_id', patch.service_type_id);
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.region !== undefined) push('region', patch.region);
    if (patch.specs !== undefined) push('specs', JSON.stringify(patch.specs));
    if (patch.billing_mode !== undefined) push('billing_mode', patch.billing_mode);
    if (patch.server_id !== undefined) push('server_id', patch.server_id);
    if (patch.tags !== undefined) push('tags', JSON.stringify(patch.tags));
    if (sets.length === 0) return this.get(id);
    params.push(id);
    const { rowCount } = await this.pool.query(
      `UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    if (!rowCount) throw new NotFoundException('Service not found');
    return this.get(id);
  }

  async setStatus(id: string, status: ServiceStatus): Promise<ServiceRow> {
    const { rowCount } = await this.pool.query(
      'UPDATE services SET status = $1 WHERE id = $2', [status, id]);
    if (!rowCount) throw new NotFoundException('Service not found');
    return this.get(id);
  }
}
