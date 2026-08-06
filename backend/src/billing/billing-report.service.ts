import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { SettingsService } from '../settings/settings.service';
import { firstOfMonth } from './billing-records.service';

export interface ReportRow {
  service_id: string;
  name: string;
  service_type: string;
  provider: string | null;
  region: string | null;
  product_id: string;
  product_name: string;
  amount: number | null;
  notes: string | null;
}

export interface ReportResource {
  service_id: string;
  name: string;
  service_type: string;
  provider: string | null;
  region: string | null;
  amount: number | null;
  notes: string | null;
}

export interface ReportProject {
  product_id: string;
  product_name: string;
  resources: ReportResource[];
  subtotal: number;
}

export interface BillingReport {
  month: string;
  currency: string;
  projects: ReportProject[];
  grand_total: number;
}

export interface ReportFilters {
  product_id?: string;
  service_type_id?: string;
  provider?: string;
}

@Injectable()
export class BillingReportService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly settings: SettingsService,
  ) {}

  /** Groups flat service+billing rows by project, computing per-project and grand totals. Unbilled resources (amount === null) are listed but excluded from the sums. */
  group(rows: ReportRow[]): { projects: ReportProject[]; grand_total: number } {
    const byProduct = new Map<string, ReportProject>();
    for (const r of rows) {
      if (!byProduct.has(r.product_id)) {
        byProduct.set(r.product_id, { product_id: r.product_id, product_name: r.product_name, resources: [], subtotal: 0 });
      }
      const project = byProduct.get(r.product_id)!;
      project.resources.push({
        service_id: r.service_id,
        name: r.name,
        service_type: r.service_type,
        provider: r.provider,
        region: r.region,
        amount: r.amount,
        notes: r.notes,
      });
      if (r.amount != null) project.subtotal += r.amount;
    }
    const projects = [...byProduct.values()];
    const grand_total = projects.reduce((sum, p) => sum + p.subtotal, 0);
    return { projects, grand_total };
  }

  async report(month: string, filters: ReportFilters): Promise<BillingReport> {
    const billingMonth = firstOfMonth(month);
    const where: string[] = [`s.status = 'active'`];
    const params: any[] = [billingMonth];
    if (filters.product_id) { params.push(filters.product_id); where.push(`s.product_id = $${params.length}`); }
    if (filters.service_type_id) { params.push(filters.service_type_id); where.push(`s.service_type_id = $${params.length}`); }
    if (filters.provider) { params.push(filters.provider); where.push(`s.provider = $${params.length}`); }

    const [settingsMap, { rows }] = await Promise.all([
      this.settings.getAll(),
      this.pool.query(
        `SELECT s.id AS service_id, s.name, st.name AS service_type, s.provider, s.region,
                s.product_id, p.name AS product_name,
                br.amount::float AS amount, br.notes
           FROM services s
           JOIN products p ON p.id = s.product_id
           JOIN service_types st ON st.id = s.service_type_id
           LEFT JOIN billing_records br ON br.service_id = s.id AND br.billing_month = $1::date
          WHERE ${where.join(' AND ')}
          ORDER BY p.name, s.name`,
        params,
      ),
    ]);

    const { projects, grand_total } = this.group(rows);
    return {
      month: billingMonth,
      currency: settingsMap.billing_currency || 'USD',
      projects,
      grand_total,
    };
  }
}
