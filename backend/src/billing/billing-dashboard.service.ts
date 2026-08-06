import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { SettingsService } from '../settings/settings.service';
import { firstOfMonth } from './billing-records.service';

export type PeriodScope = 'month' | 'year' | 'all';

export interface BillingSummary {
  currency: string;
  period: PeriodScope;
  month: string | null;
  period_total: number;
  trend: { month: string; total: number }[];
  project_trend: { month: string; product_id: string; product_name: string; total: number }[];
  by_project: { product_id: string; product_name: string; total: number }[];
  by_service_type: { service_type: string; total: number }[];
  by_provider: { provider: string; total: number }[];
  top_services: { service_id: string; name: string; product_name: string; service_type: string; amount: number }[];
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

@Injectable()
export class BillingDashboardService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly settings: SettingsService,
  ) {}

  async summary(months: number, scope: PeriodScope = 'month', monthParam?: string, productId?: string): Promise<BillingSummary> {
    const anchorMonth = monthParam ? firstOfMonth(monthParam) : currentMonth();

    const periodClause =
      scope === 'all'
        ? 'TRUE'
        : scope === 'year'
          ? `br.billing_month >= date_trunc('year', $1::date) AND br.billing_month < date_trunc('year', $1::date) + interval '1 year'`
          : `br.billing_month = $1::date`;
    const periodParams: any[] = scope === 'all' ? [] : [anchorMonth];
    const productClause = productId ? ` AND s.product_id = $${periodParams.length + 1}` : '';
    const scopedParams = productId ? [...periodParams, productId] : periodParams;

    const trendProductClause = productId ? ' AND s.product_id = $2' : '';
    const trendParams = productId ? [months, productId] : [months];

    const [
      settingsMap, periodTotalRes, trendRes, projectTrendRes,
      byProjectRes, byTypeRes, byProviderRes, topServicesRes,
    ] = await Promise.all([
      this.settings.getAll(),
      this.pool.query(
        `SELECT COALESCE(sum(br.amount), 0)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
          WHERE ${periodClause}${productClause}`,
        scopedParams,
      ),
      this.pool.query(
        `SELECT to_char(br.billing_month, 'YYYY-MM-01') AS month, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
          WHERE br.billing_month >= date_trunc('month', now()) - ($1 || ' months')::interval${trendProductClause}
          GROUP BY br.billing_month
          ORDER BY br.billing_month`,
        trendParams,
      ),
      this.pool.query(
        `SELECT to_char(br.billing_month, 'YYYY-MM-01') AS month, p.id AS product_id, p.name AS product_name, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN products p ON p.id = s.product_id
          WHERE br.billing_month >= date_trunc('month', now()) - ($1 || ' months')::interval${trendProductClause}
          GROUP BY br.billing_month, p.id, p.name
          ORDER BY br.billing_month, p.name`,
        trendParams,
      ),
      this.pool.query(
        `SELECT p.id AS product_id, p.name AS product_name, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN products p ON p.id = s.product_id
          WHERE ${periodClause}${productClause}
          GROUP BY p.id, p.name
          ORDER BY total DESC`,
        scopedParams,
      ),
      this.pool.query(
        `SELECT st.name AS service_type, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN service_types st ON st.id = s.service_type_id
          WHERE ${periodClause}${productClause}
          GROUP BY st.name
          ORDER BY total DESC`,
        scopedParams,
      ),
      this.pool.query(
        `SELECT COALESCE(s.provider, 'Unknown') AS provider, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
          WHERE ${periodClause}${productClause}
          GROUP BY COALESCE(s.provider, 'Unknown')
          ORDER BY total DESC`,
        scopedParams,
      ),
      this.pool.query(
        `SELECT s.id AS service_id, s.name, p.name AS product_name, st.name AS service_type, sum(br.amount)::float AS amount
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN products p ON p.id = s.product_id
           JOIN service_types st ON st.id = s.service_type_id
          WHERE ${periodClause}${productClause}
          GROUP BY s.id, s.name, p.name, st.name
          ORDER BY amount DESC
          LIMIT 10`,
        scopedParams,
      ),
    ]);

    return {
      currency: settingsMap.billing_currency || 'USD',
      period: scope,
      month: scope === 'all' ? null : anchorMonth,
      period_total: periodTotalRes.rows[0]?.total ?? 0,
      trend: trendRes.rows,
      project_trend: projectTrendRes.rows,
      by_project: byProjectRes.rows,
      by_service_type: byTypeRes.rows,
      by_provider: byProviderRes.rows,
      top_services: topServicesRes.rows,
    };
  }
}
