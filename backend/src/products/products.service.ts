import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Injectable()
export class ProductsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** List products with a live count of assigned servers. */
  list() {
    return this.pool
      .query(
        `SELECT p.id, p.name, p.description, p.created_at,
                count(s.id)::int AS server_count
           FROM products p
           LEFT JOIN servers s ON s.product_id = p.id
          GROUP BY p.id
          ORDER BY p.name`,
      )
      .then((r) => r.rows);
  }

  async create(name: string, description?: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO products (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, created_at`,
      [name, description ?? null],
    );
    return rows[0];
  }

  async update(id: string, patch: { name?: string; description?: string }) {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.description !== undefined) { params.push(patch.description); sets.push(`description = $${params.length}`); }
    if (sets.length === 0) {
      const { rows } = await this.pool.query(
        `SELECT id, name, description, created_at FROM products WHERE id = $1`, [id]);
      if (!rows[0]) throw new NotFoundException('Product not found');
      return rows[0];
    }
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, description, created_at`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    return rows[0];
  }

  /** Delete a product. Servers keep existing (product_id set to NULL by FK). */
  async remove(id: string) {
    const { rowCount } = await this.pool.query('DELETE FROM products WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('Product not found');
    return { deleted: id };
  }
}
