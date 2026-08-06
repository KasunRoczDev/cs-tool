import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { SettingsService } from '../settings/settings.service';

export interface BillingSummary {
  currency: string;
  current_month_total: number;
  trend: { month: string; total: number }[];
  by_project: { product_id: string; product_name: string; total: number }[];
  by_service_type: { service_type: string; total: number }[];
}

@Injectable()
export class BillingDashboardService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly settings: SettingsService,
  ) {}

  async summary(months: number): Promise<BillingSummary> {
    const [settingsMap, currentMonthRes, trendRes, byProjectRes, byTypeRes] = await Promise.all([
      this.settings.getAll(),
      this.pool.query(
        `SELECT COALESCE(sum(amount), 0)::float AS total
           FROM billing_records
          WHERE billing_month = date_trunc('month', now())::date`,
      ),
      this.pool.query(
        `SELECT to_char(billing_month, 'YYYY-MM-01') AS month, sum(amount)::float AS total
           FROM billing_records
          WHERE billing_month >= date_trunc('month', now()) - ($1 || ' months')::interval
          GROUP BY billing_month
          ORDER BY billing_month`,
        [months],
      ),
      this.pool.query(
        `SELECT p.id AS product_id, p.name AS product_name, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN products p ON p.id = s.product_id
          WHERE br.billing_month = date_trunc('month', now())::date
          GROUP BY p.id, p.name
          ORDER BY total DESC`,
      ),
      this.pool.query(
        `SELECT st.name AS service_type, sum(br.amount)::float AS total
           FROM billing_records br
           JOIN services s ON s.id = br.service_id
           JOIN service_types st ON st.id = s.service_type_id
          WHERE br.billing_month = date_trunc('month', now())::date
          GROUP BY st.name
          ORDER BY total DESC`,
      ),
    ]);

    return {
      currency: settingsMap.billing_currency || 'USD',
      current_month_total: currentMonthRes.rows[0]?.total ?? 0,
      trend: trendRes.rows,
      by_project: byProjectRes.rows,
      by_service_type: byTypeRes.rows,
    };
  }
}
