import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface DueService {
  service_id: string;
  name: string;
  service_type: string;
  region: string | null;
  billing_mode: 'pay_per_use' | 'monthly' | 'annual';
  existing_record: { id: string; amount: string; notes: string | null } | null;
}

export interface MonthlyForm {
  product: { id: string; name: string };
  month: string;
  services: DueService[];
}

export interface BillingRecordRow {
  id: string;
  service_id: string;
  service_name: string;
  service_type: string;
  product_id: string;
  product_name: string;
  region: string | null;
  billing_mode: string;
  billing_month: string;
  amount: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function firstOfMonth(month: string): string {
  const d = new Date(month);
  if (isNaN(d.getTime())) throw new BadRequestException('month must be a valid date');
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

@Injectable()
export class BillingRecordsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async monthlyForm(productId: string, month: string): Promise<MonthlyForm> {
    const billingMonth = firstOfMonth(month);

    const { rows: productRows } = await this.pool.query(
      'SELECT id, name FROM products WHERE id = $1', [productId]);
    if (!productRows[0]) throw new NotFoundException('Product not found');

    const { rows } = await this.pool.query(
      `SELECT s.id AS service_id, s.name, st.name AS service_type, s.region, s.billing_mode,
              br.id AS record_id, br.amount, br.notes,
              (SELECT max(billing_month) FROM billing_records WHERE service_id = s.id) AS last_billed
         FROM services s
         JOIN service_types st ON st.id = s.service_type_id
         LEFT JOIN billing_records br ON br.service_id = s.id AND br.billing_month = $2::date
        WHERE s.product_id = $1 AND s.status = 'active'
        ORDER BY s.name`,
      [productId, billingMonth],
    );

    const services: DueService[] = rows
      .filter((r: any) => {
        if (r.billing_mode !== 'annual') return true;
        if (!r.last_billed) return true; // never billed — due now
        const last = new Date(r.last_billed);
        const due = new Date(billingMonth);
        const monthsApart =
          (due.getUTCFullYear() - last.getUTCFullYear()) * 12 +
          (due.getUTCMonth() - last.getUTCMonth());
        return monthsApart >= 12;
      })
      .map((r: any) => ({
        service_id: r.service_id,
        name: r.name,
        service_type: r.service_type,
        region: r.region,
        billing_mode: r.billing_mode,
        existing_record: r.record_id ? { id: r.record_id, amount: r.amount, notes: r.notes } : null,
      }));

    return { product: productRows[0], month: billingMonth, services };
  }

  async bulkUpsert(
    productId: string,
    month: string,
    entries: { service_id: string; amount: number; notes?: string }[],
    userId: string,
  ): Promise<{ upserted: number }> {
    const billingMonth = firstOfMonth(month);
    let upserted = 0;
    for (const entry of entries) {
      if (entry.amount === null || entry.amount === undefined) continue;
      await this.pool.query(
        `INSERT INTO billing_records (service_id, billing_month, amount, notes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (service_id, billing_month)
         DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now()`,
        [entry.service_id, billingMonth, entry.amount, entry.notes ?? null, userId],
      );
      upserted++;
    }
    return { upserted };
  }

  async list(filters: {
    product_id?: string; service_id?: string; service_type_id?: string; from?: string; to?: string;
  }): Promise<BillingRecordRow[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.product_id) { params.push(filters.product_id); where.push(`s.product_id = $${params.length}`); }
    if (filters.service_id) { params.push(filters.service_id); where.push(`br.service_id = $${params.length}`); }
    if (filters.service_type_id) { params.push(filters.service_type_id); where.push(`s.service_type_id = $${params.length}`); }
    if (filters.from) { params.push(firstOfMonth(filters.from)); where.push(`br.billing_month >= $${params.length}`); }
    if (filters.to) { params.push(firstOfMonth(filters.to)); where.push(`br.billing_month <= $${params.length}`); }
    const sql = `
      SELECT br.id, br.service_id, s.name AS service_name, st.name AS service_type,
             s.product_id, p.name AS product_name, s.region, s.billing_mode,
             br.billing_month, br.amount, br.notes, br.created_at, br.updated_at
        FROM billing_records br
        JOIN services s ON s.id = br.service_id
        JOIN service_types st ON st.id = s.service_type_id
        JOIN products p ON p.id = s.product_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY br.billing_month DESC, p.name, s.name`;
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  private async getById(id: string): Promise<BillingRecordRow> {
    const { rows } = await this.pool.query(
      `SELECT br.id, br.service_id, s.name AS service_name, st.name AS service_type,
              s.product_id, p.name AS product_name, s.region, s.billing_mode,
              br.billing_month, br.amount, br.notes, br.created_at, br.updated_at
         FROM billing_records br
         JOIN services s ON s.id = br.service_id
         JOIN service_types st ON st.id = s.service_type_id
         JOIN products p ON p.id = s.product_id
        WHERE br.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Billing record not found');
    return rows[0];
  }

  async update(id: string, patch: { amount?: number; notes?: string }): Promise<BillingRecordRow> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.amount !== undefined) { params.push(patch.amount); sets.push(`amount = $${params.length}`); }
    if (patch.notes !== undefined) { params.push(patch.notes); sets.push(`notes = $${params.length}`); }
    if (sets.length === 0) return this.getById(id);
    sets.push('updated_at = now()');
    params.push(id);
    const { rowCount } = await this.pool.query(
      `UPDATE billing_records SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (!rowCount) throw new NotFoundException('Billing record not found');
    return this.getById(id);
  }

  async remove(id: string): Promise<{ deleted: string }> {
    const { rowCount } = await this.pool.query('DELETE FROM billing_records WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('Billing record not found');
    return { deleted: id };
  }

  toCsv(rows: BillingRecordRow[]): string {
    const cols = ['billing_month', 'product_name', 'service_name', 'service_type', 'region', 'billing_mode', 'amount', 'notes'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // pg returns DATE columns as Date objects; String(Date) gives a verbose
    // local-format string, not the plain YYYY-MM-DD the JSON API already
    // implicitly returns via JSON.stringify's Date -> ISO serialization.
    const fmtMonth = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
    const lines = [cols.join(',')];
    for (const r of rows) {
      const row = { ...r, billing_month: fmtMonth(r.billing_month) };
      lines.push(cols.map((c) => esc((row as any)[c])).join(','));
    }
    return lines.join('\n');
  }
}
