# Release Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only Release Dashboard page (`/release-dashboard`) that aggregates active releases, pending approvals, upcoming releases, per-product production versions, deploy-job pipeline health, and a mini calendar strip — all from existing tables, no new migrations.

**Architecture:** One new backend module slice (`DashboardService` + `DashboardController`) under `backend/src/release/`, following the existing `CalendarService`/`CalendarController` pattern: pure SQL aggregation against the shared `pg` pool, no new tables. `DashboardService` reuses `ApprovalsService.status()` (for correct pending-approval semantics across custom per-product workflows) and `CalendarService.calendar()` (for the mini calendar) rather than re-deriving that logic in raw SQL. One new frontend page mirrors the `release-metrics` page's structure (stat/list cards, product filter dropdown like `audit-log`'s release filter).

**Tech Stack:** NestJS (`@nestjs/common`, `pg` `Pool`), Jest for backend unit tests, Next.js App Router (`'use client'` page), existing `dashboard/lib/api.js` REST client.

## Global Constraints

- No new database tables or migrations — every widget reads from `releases`, `release_repositories`, `repositories`, `products`, `release_statuses`, `deployments`, `channels`, `deploy_jobs`, and reuses `CalendarService`/`ApprovalsService`.
- `releases.status_id` is nullable (set only after a release's first status transition — see `backend/src/release/status/status.service.ts:107-119` and `database/release_workflow_config_migration.sql`). A release with `status_id IS NULL` is treated as category `'draft'` — this is exact for the default workflow and the common case; a custom per-product workflow whose *never-transitioned* initial status has a non-`'draft'` category is a known, documented edge case this dashboard does not special-case (it will simply not show such a release as "active" until its first transition sets `status_id`).
- The mini-calendar widget is **not** product-filtered (`CalendarService.calendar()` has no product-scoping parameter) — it always shows all products. This is a documented limitation, not a bug.
- No new permission key. `GET /release-dashboard` is guarded by `JwtAuthGuard` + `PermissionGuard` only (no `@RequirePermission`), exactly like `GET /release-board` (`backend/src/release/status/status.controller.ts:53-54`) — open to any authenticated user.
- `active_releases` query is capped at 20 rows (bounds the per-release `ApprovalsService.status()` fan-out used for the pending-approvals widget).
- `upcoming_releases` and `mini_calendar` each cap at 5 items, over a 14-day forward window, per the approved design spec.
- `pipeline_health` uses a trailing 7-day window over `deploy_jobs`; `rate` is `null` (not `0`) when there were zero jobs in the window.

---

### Task 1: `DashboardService` — active releases, upcoming releases, production versions, pipeline health

**Files:**
- Create: `backend/src/release/dashboard.service.ts`
- Test: `backend/src/release/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `PG_POOL` token from `backend/src/database/database.module.ts` (same as every other release-module service); `Pool` type from `pg`.
- Produces (consumed by Task 2 and Task 3):
  - `class DashboardService`
  - `activeReleases(productId?: string): Promise<Array<{id: string, version: string, name: string|null, planned_date: string|null, category: string, status_name: string, product_id: string|null, product_name: string|null}>>`
  - `upcomingReleases(productId?: string): Promise<Array<{id: string, version: string, name: string|null, planned_date: string, product_id: string|null, product_name: string|null}>>`
  - `productionVersions(productId?: string): Promise<Array<{product_id: string, product_name: string|null, version: string|null, deployed_at: string|null}>>`
  - `pipelineHealth(productId?: string): Promise<{window_days: 7, succeeded: number, failed: number, rate: number|null}>`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/release/dashboard.service.spec.ts`:

```typescript
import { DashboardService } from './dashboard.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const approvals = { status: jest.fn() } as any;
  const calendar = { calendar: jest.fn() } as any;
  const svc = new DashboardService(pool, approvals, calendar);
  return { svc, query, approvals, calendar };
}

describe('DashboardService.activeReleases', () => {
  it('queries with a null product filter when none is given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.4.0', category: 'stage' }] });
    const rows = await svc.activeReleases();
    expect(rows).toEqual([{ id: 'r1', version: '1.4.0', category: 'stage' }]);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([null]);
  });

  it('passes the product filter through when given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.activeReleases('p1');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['p1']);
  });
});

describe('DashboardService.upcomingReleases', () => {
  it('returns rows from the pool', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r2', version: '1.5.0' }] });
    const rows = await svc.upcomingReleases();
    expect(rows).toEqual([{ id: 'r2', version: '1.5.0' }]);
  });
});

describe('DashboardService.productionVersions', () => {
  it('returns one row per product', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30T00:00:00Z' }],
    });
    const rows = await svc.productionVersions();
    expect(rows).toEqual([
      { product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30T00:00:00Z' },
    ]);
  });
});

describe('DashboardService.pipelineHealth', () => {
  it('computes a success rate from succeeded/failed counts', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ succeeded: 9, failed: 1 }] });
    const health = await svc.pipelineHealth();
    expect(health).toEqual({ window_days: 7, succeeded: 9, failed: 1, rate: 0.9 });
  });

  it('returns a null rate when there were no jobs in the window', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ succeeded: 0, failed: 0 }] });
    const health = await svc.pipelineHealth();
    expect(health).toEqual({ window_days: 7, succeeded: 0, failed: 0, rate: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest dashboard.service.spec.ts`
Expected: FAIL — `Cannot find module './dashboard.service'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/release/dashboard.service.ts`:

```typescript
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
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest dashboard.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/dashboard.service.ts backend/src/release/dashboard.service.spec.ts
git commit -m "feat(release): add DashboardService aggregation queries"
```

---

### Task 2: `DashboardService.overview()` — pending approvals + mini calendar

**Files:**
- Modify: `backend/src/release/dashboard.service.ts`
- Modify: `backend/src/release/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `activeReleases`, `upcomingReleases`, `productionVersions`, `pipelineHealth` from Task 1 (same class, already present); `ApprovalsService.status(releaseId: string)` (`backend/src/release/approvals.service.ts:42`, returns `{approvers: Array<{email: string, role: string, product_name: string|null, decision: string}>, ...}`); `CalendarService.calendar(from: string, to: string)` (`backend/src/release/calendar.service.ts:75`, returns `{releases, deployments, freeze_windows}`).
- Produces (consumed by Task 3):
  - `overview(productId?: string): Promise<{active_releases, pending_approvals, upcoming_releases, production_versions, pipeline_health, mini_calendar}>`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/release/dashboard.service.spec.ts`:

```typescript
describe('DashboardService.overview', () => {
  it('combines every widget, deriving pending approvals from active releases and a 5-item mini calendar', async () => {
    const { svc, query, approvals, calendar } = makeService();

    // Query order inside overview(): activeReleases, upcomingReleases, productionVersions, pipelineHealth.
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.4.0', product_id: 'p1', product_name: 'Core' }] }); // activeReleases
    query.mockResolvedValueOnce({ rows: [{ id: 'r2', version: '1.5.0', planned_date: '2026-08-10' }] }); // upcomingReleases
    query.mockResolvedValueOnce({ rows: [{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30' }] }); // productionVersions
    query.mockResolvedValueOnce({ rows: [{ succeeded: 5, failed: 0 }] }); // pipelineHealth

    approvals.status.mockResolvedValueOnce({
      approvers: [
        { email: 'qa@x.com', role: 'qa', product_name: 'Core', decision: 'pending' },
        { email: 'lead@x.com', role: 'dev_lead', product_name: 'Core', decision: 'approved' },
      ],
    });

    calendar.calendar.mockResolvedValueOnce({
      releases: [{ version: '1.5.0', planned_date: '2026-08-10' }],
      deployments: [{ release_version: '1.4.0', channel_name: 'Production', scheduled_at: '2026-08-05', finished_at: null, created_at: '2026-08-01' }],
      freeze_windows: [{ name: 'Holiday freeze', starts_at: '2026-08-15' }],
    });

    const result = await svc.overview('p1');

    expect(result.active_releases).toEqual([{ id: 'r1', version: '1.4.0', product_id: 'p1', product_name: 'Core' }]);
    expect(result.pending_approvals).toEqual([
      { release_id: 'r1', version: '1.4.0', product_name: 'Core', role: 'qa', awaiting_email: 'qa@x.com' },
    ]);
    expect(result.upcoming_releases).toEqual([{ id: 'r2', version: '1.5.0', planned_date: '2026-08-10' }]);
    expect(result.production_versions).toEqual([{ product_id: 'p1', product_name: 'Core', version: '1.3.2', deployed_at: '2026-07-30' }]);
    expect(result.pipeline_health).toEqual({ window_days: 7, succeeded: 5, failed: 0, rate: 1 });
    expect(result.mini_calendar).toEqual([
      { date: '2026-08-05', type: 'deployment', label: '1.4.0 → Production' },
      { date: '2026-08-10', type: 'release', label: '1.5.0 planned' },
      { date: '2026-08-15', type: 'freeze', label: 'Holiday freeze' },
    ]);
    expect(approvals.status).toHaveBeenCalledWith('r1');
    expect(approvals.status).toHaveBeenCalledTimes(1);
  });

  it('caps the mini calendar at 5 items, soonest first', async () => {
    const { svc, query, approvals, calendar } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ succeeded: 0, failed: 0 }] });
    calendar.calendar.mockResolvedValueOnce({
      releases: [1, 2, 3, 4, 5, 6].map((n) => ({ version: `1.${n}.0`, planned_date: `2026-08-0${n}` })),
      deployments: [],
      freeze_windows: [],
    });

    const result = await svc.overview();
    expect(result.mini_calendar).toHaveLength(5);
    expect(result.mini_calendar[0].date).toBe('2026-08-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest dashboard.service.spec.ts -t overview`
Expected: FAIL with `svc.overview is not a function`

- [ ] **Step 3: Implement `overview()`**

Add to `backend/src/release/dashboard.service.ts` (inside the `DashboardService` class, after `pipelineHealth`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest dashboard.service.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/dashboard.service.ts backend/src/release/dashboard.service.spec.ts
git commit -m "feat(release): combine dashboard widgets into DashboardService.overview()"
```

---

### Task 3: `DashboardController` + module registration

**Files:**
- Create: `backend/src/release/dashboard.controller.ts`
- Modify: `backend/src/release/release.module.ts`

**Interfaces:**
- Consumes: `DashboardService.overview(productId?: string)` from Task 2.
- Produces: `GET /release-dashboard?product_id=<optional>` HTTP endpoint.

- [ ] **Step 1: Write the controller**

Create `backend/src/release/dashboard.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('release-dashboard')
  overview(@Query('product_id') productId?: string) {
    return this.dashboard.overview(productId || undefined);
  }
}
```

- [ ] **Step 2: Register in the module**

In `backend/src/release/release.module.ts`, add the import lines after the `AuditController`/`AuditService` imports (around line 25):

```typescript
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
```

Add `DashboardService` to the `providers` array (after `AuditService`) and `DashboardController` to the `controllers` array (after `AuditController`):

```typescript
  providers: [
    GitService,
    RepositoriesService,
    ReleasesService,
    DeploymentsService,
    ApprovalsService,
    StatusService,
    CalendarService,
    EnvironmentService,
    AuditService,
    DashboardService,
    AgentReleasesService,
  ],
  controllers: [
    RepositoriesController,
    ReleasesController,
    DeploymentsController,
    DeployAgentController,
    WebhooksController,
    ApprovalsController,
    StatusController,
    CalendarController,
    EnvironmentController,
    AuditController,
    DashboardController,
    AgentReleasesController,
    AgentUpdatesController,
  ],
```

- [ ] **Step 3: Verify the backend builds**

Run: `cd backend && npm run build`
Expected: exits 0, no TypeScript errors (confirms `DashboardService`/`DashboardController` wire up correctly and all existing services still compile).

- [ ] **Step 4: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: PASS, including the 8 `dashboard.service.spec.ts` tests plus every pre-existing suite (no regressions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/dashboard.controller.ts backend/src/release/release.module.ts
git commit -m "feat(release): expose GET /release-dashboard"
```

---

### Task 4: Frontend — Release Dashboard page

**Files:**
- Modify: `dashboard/lib/api.js`
- Create: `dashboard/app/(app)/release-dashboard/page.jsx`
- Modify: `dashboard/components/Shell.jsx`

**Interfaces:**
- Consumes: `GET /release-dashboard?product_id=<optional>` from Task 3, response shape from `DashboardService.overview()` (Task 2); existing `api.products()` (`dashboard/lib/api.js:93`).
- Produces: `/release-dashboard` page, reachable from the Release Management sidebar group.

- [ ] **Step 1: Add the API client method**

In `dashboard/lib/api.js`, add this line immediately after `releaseBoard: () => req('/release-board'),` (line 291):

```javascript
  releaseDashboard: (productId) => req('/release-dashboard' + qs({ product_id: productId })),
```

- [ ] **Step 2: Add the sidebar entry**

In `dashboard/components/Shell.jsx`, add this as the first item in the `Release Management` section's `items` array (immediately before `{ href: '/repositories', label: '📚 Repositories' }` at line 74):

```javascript
        { href: '/release-dashboard', label: '🏠 Release Dashboard' },
```

- [ ] **Step 3: Write the page**

Create `dashboard/app/(app)/release-dashboard/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

function Card({ title, children, empty }) {
  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      {empty ? <p className="empty">{empty}</p> : children}
    </div>
  );
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

const CALENDAR_ICON = { release: '🚀', deployment: '🛳️', freeze: '🧊' };

export default function ReleaseDashboardPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  const load = () => api.releaseDashboard(productId || undefined).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-head">
        <h2>🏠 Release Dashboard</h2>
        <button onClick={load}>↻ Refresh</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— all products —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!data ? (
        <p className="empty">Loading…</p>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Card title="Active Releases" empty={data.active_releases.length === 0 ? 'No active releases.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.active_releases.map((r) => (
                <li key={r.id}>
                  <Link href={`/releases/${r.id}`}>{r.version}</Link>
                  {' — '}{r.status_name}{r.product_name ? ` (${r.product_name})` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Pending Approvals" empty={data.pending_approvals.length === 0 ? 'No pending approvals.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.pending_approvals.map((a, i) => (
                <li key={`${a.release_id}-${a.role}-${i}`}>
                  <Link href={`/releases/${a.release_id}`}>{a.version}</Link>
                  {' — '}{a.role} ({a.awaiting_email}){a.product_name ? ` · ${a.product_name}` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Upcoming Releases (14d)" empty={data.upcoming_releases.length === 0 ? 'Nothing planned in the next 14 days.' : null}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.upcoming_releases.map((r) => (
                <li key={r.id}>
                  <Link href={`/releases/${r.id}`}>{r.version}</Link>
                  {' — '}{fmtDate(r.planned_date)}{r.product_name ? ` (${r.product_name})` : ''}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Current Production Version" empty={data.production_versions.length === 0 ? 'No production deployments yet.' : null}>
            <table className="grid">
              <thead><tr><th>Product</th><th>Version</th><th>Deployed</th></tr></thead>
              <tbody>
                {data.production_versions.map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.product_name || '—'}</td>
                    <td>{p.version || '—'}</td>
                    <td>{fmtDate(p.deployed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Pipeline Health (7d)">
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {data.pipeline_health.rate != null ? `${Math.round(data.pipeline_health.rate * 100)}%` : '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {data.pipeline_health.succeeded} succeeded / {data.pipeline_health.failed} failed
            </div>
          </Card>

          <Card title="Next 14 Days" empty={data.mini_calendar.length === 0 ? 'Nothing scheduled.' : null}>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {data.mini_calendar.map((i, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  {CALENDAR_ICON[i.type] || '•'} {fmtDate(i.date)} — {i.label}
                </li>
              ))}
            </ul>
            <Link href="/release-calendar" style={{ fontSize: 12 }}>View full calendar →</Link>
          </Card>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd dashboard && npm run build`
Expected: exits 0, no build errors (confirms the new page and `Shell.jsx`/`api.js` edits are syntactically and type-safe under Next.js's build).

- [ ] **Step 5: Manually verify in the browser**

Run: `cd dashboard && npm run dev`
Then open `http://localhost:5173/release-dashboard` (log in first if prompted), confirm:
- The "🏠 Release Dashboard" link appears at the top of the Release Management sidebar section.
- The page loads without a console error and shows the six cards.
- Selecting a product in the dropdown re-fetches and narrows the widgets that support product-scoping (all except "Next 14 Days").
- Clicking "↻ Refresh" re-fetches.
- Links from list items navigate to the corresponding release detail page.

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/api.js "dashboard/app/(app)/release-dashboard/page.jsx" dashboard/components/Shell.jsx
git commit -m "feat(release): add Release Dashboard page"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/RELEASE_MANAGEMENT_GUIDE.md`
- Modify: `docs/RELEASE_MANAGEMENT_ROADMAP.md`

**Interfaces:**
- Consumes: nothing (docs-only).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the page to the guide's page table**

In `docs/RELEASE_MANAGEMENT_GUIDE.md`, add a row to the table (after the header row, before `| 📚 Repositories |`, around line 15):

```markdown
| 🏠 Release Dashboard | `/release-dashboard` | At-a-glance overview: active releases, pending approvals, upcoming releases, production versions, pipeline health |
```

Then add a new section after the `## Overview` section's closing `---` (before `## 📚 Repositories`, around line 31), matching the format of the other page sections:

```markdown
## 🏠 Release Dashboard

A single-page overview, filterable by product:

- **Active Releases** — releases whose current status is mid-workflow (not
  draft, not archived/terminal).
- **Pending Approvals** — every still-undecided sign-off across active
  releases, platform-wide (not scoped to the signed-in user).
- **Upcoming Releases** — releases with a `planned_date` in the next 14 days.
- **Current Production Version** — the latest succeeded deployment per
  product on the `production` channel.
- **Pipeline Health** — deploy-job succeeded/failed rate over the trailing
  7 days.
- **Next 14 Days** — a 5-item strip combining planned releases, scheduled/
  recent deployments, and freeze windows (not product-filtered — links to
  the full [Release Calendar](#-release-calendar) for the complete view).

Manual refresh (a **↻ Refresh** button), same as Release Metrics — no
WebSocket wiring.

---
```

- [ ] **Step 2: Mark §23 done in the roadmap**

In `docs/RELEASE_MANAGEMENT_ROADMAP.md`, replace the `## 23. Dashboard` section (lines 317-321) with:

```markdown
## 23. Dashboard
- ✅ **Done** — the **Release Dashboard** page (`/release-dashboard`,
  `GET /release-dashboard`) shows active releases, pending approvals,
  upcoming releases (14-day window), current production version per
  product, deploy-job pipeline health (7-day window), and a mini calendar
  strip. Manual refresh, same as Release Metrics. The mini-calendar widget
  is not product-filtered (`CalendarService.calendar()` has no
  product-scoping parameter today).
```

Also update the "Priority Recommendations" section's closing note (around line 417-424) — replace the sentence beginning "Notably *not* re-prioritized up: **Artifact Management**" with:

```markdown
**All ten priority items from this list are now done, plus the Release
Dashboard (§23).** Notably *not* re-prioritized up: **Artifact Management**
(Docker/Helm/package registries) — not assessed above because it wasn't in
the per-category list; worth a follow-up pass if it matters to you. Beyond
that, the remaining ❌/⚠️ items throughout this document are the ones
deliberately left for a future pass, each with a stated reason (needs
infrastructure this platform doesn't have, needs a product decision only
you can make, or is genuinely low value for its complexity) rather than
silently dropped.
```

- [ ] **Step 3: Commit**

```bash
git add docs/RELEASE_MANAGEMENT_GUIDE.md docs/RELEASE_MANAGEMENT_ROADMAP.md
git commit -m "docs(release): document the Release Dashboard, mark roadmap §23 done"
```
