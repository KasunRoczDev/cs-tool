import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { ApprovalsService } from './approvals.service';
import { CalendarService } from './calendar.service';

// Every release's product, resolved the same way as StatusService.releaseProducts():
// through its pinned repositories. A release can technically pin repos from more
// than one product; this dashboard takes the first (LIMIT 1) for a single-value
// display, same simplification StatusService already makes for workflow resolution.
const PRODUCT_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT rp.product_id, p.name AS product_name
      FROM release_repositories rr
      JOIN repositories rp ON rp.id = rr.repository_id
      LEFT JOIN products p ON p.id = rp.product_id
     WHERE rr.release_id = r.id AND rp.product_id IS NOT NULL
     LIMIT 1
  ) prod ON true
`;

/**
 * Release Dashboard: read-only aggregation over releases/deployments/approvals/
 * deploy_jobs for the overview page. No new tables — see the design spec at
 * docs/superpowers/specs/2026-08-03-release-dashboard-design.md.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly approvals: ApprovalsService,
    private readonly calendar: CalendarService,
  ) {}

  /** Releases whose current status category is 'stage' (in flight, not draft/terminal). */
  async activeReleases(productId?: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.version, r.name, r.planned_date,
              COALESCE(s.category, 'draft') AS category,
              COALESCE(s.name, initcap(r.status)) AS status_name,
              prod.product_id, prod.product_name
         FROM releases r
         LEFT JOIN release_statuses s ON s.id = r.status_id
         ${PRODUCT_LATERAL}
        WHERE COALESCE(s.category, 'draft') = 'stage'
          AND ($1::uuid IS NULL OR prod.product_id = $1)
        ORDER BY r.updated_at DESC
        LIMIT 20`,
      [productId ?? null],
    );
    return rows;
  }

  /** Releases with a planned_date in the next 14 days. */
  async upcomingReleases(productId?: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.version, r.name, r.planned_date, prod.product_id, prod.product_name
         FROM releases r
         ${PRODUCT_LATERAL}
        WHERE r.planned_date BETWEEN now() AND now() + interval '14 days'
          AND ($1::uuid IS NULL OR prod.product_id = $1)
        ORDER BY r.planned_date ASC
        LIMIT 5`,
      [productId ?? null],
    );
    return rows;
  }

  /** Latest succeeded deployment on the 'production' channel, one row per product. */
  async productionVersions(productId?: string) {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (prod.product_id)
              prod.product_id, prod.product_name,
              d.current_version AS version, d.finished_at AS deployed_at
         FROM deployments d
         JOIN channels c ON c.id = d.channel_id AND c.key = 'production'
         JOIN LATERAL (
           SELECT rp.product_id, p.name AS product_name
             FROM release_repositories rr
             JOIN repositories rp ON rp.id = rr.repository_id
             LEFT JOIN products p ON p.id = rp.product_id
            WHERE rr.release_id = d.release_id AND rp.product_id IS NOT NULL
            LIMIT 1
         ) prod ON true
        WHERE d.status = 'succeeded'
          AND ($1::uuid IS NULL OR prod.product_id = $1)
        ORDER BY prod.product_id, d.finished_at DESC NULLS LAST`,
      [productId ?? null],
    );
    return rows;
  }

  /** Deploy-job succeeded/failed rate over a trailing 7-day window. */
  async pipelineHealth(productId?: string) {
    const { rows } = await this.pool.query(
      `SELECT count(*) FILTER (WHERE dj.status = 'succeeded')::int AS succeeded,
              count(*) FILTER (WHERE dj.status = 'failed')::int AS failed
         FROM deploy_jobs dj
         LEFT JOIN repositories rp ON rp.id = dj.repository_id
        WHERE dj.created_at >= now() - interval '7 days'
          AND ($1::uuid IS NULL OR rp.product_id = $1)`,
      [productId ?? null],
    );
    const { succeeded, failed } = rows[0];
    const total = succeeded + failed;
    return { window_days: 7 as const, succeeded, failed, rate: total > 0 ? succeeded / total : null };
  }

  /** Full dashboard payload: every widget, aggregated for one request. */
  async overview(productId?: string) {
    const [activeReleases, upcomingReleases, productionVersions, pipelineHealth] = await Promise.all([
      this.activeReleases(productId),
      this.upcomingReleases(productId),
      this.productionVersions(productId),
      this.pipelineHealth(productId),
    ]);

    const pendingByRelease = await Promise.all(activeReleases.map((r) => this.approvals.status(r.id)));
    const pendingApprovals = pendingByRelease.flatMap((status, i) =>
      status.approvers
        .filter((a: any) => a.decision === 'pending')
        .map((a: any) => ({
          release_id: activeReleases[i].id,
          version: activeReleases[i].version,
          product_name: a.product_name,
          role: a.role,
          awaiting_email: a.email,
        })),
    );

    const from = new Date();
    const to = new Date(from.getTime() + 14 * 86_400_000);
    const cal = await this.calendar.calendar(from.toISOString(), to.toISOString());
    const miniCalendar = [
      ...cal.releases.map((r: any) => ({ date: r.planned_date, type: 'release', label: `${r.version} planned` })),
      ...cal.deployments.map((d: any) => ({
        date: d.scheduled_at || d.finished_at || d.created_at,
        type: 'deployment',
        label: `${d.release_version} → ${d.channel_name}`,
      })),
      ...cal.freeze_windows.map((f: any) => ({ date: f.starts_at, type: 'freeze', label: f.name })),
    ]
      .filter((i) => i.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5);

    return {
      active_releases: activeReleases,
      pending_approvals: pendingApprovals,
      upcoming_releases: upcomingReleases,
      production_versions: productionVersions,
      pipeline_health: pipelineHealth,
      mini_calendar: miniCalendar,
    };
  }
}
