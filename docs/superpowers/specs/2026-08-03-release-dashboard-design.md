# Release Dashboard — Design Spec

Status: approved
Date: 2026-08-03
Roadmap ref: [`RELEASE_MANAGEMENT_ROADMAP.md`](../../RELEASE_MANAGEMENT_ROADMAP.md) §23 Dashboard

## Problem

The platform's `/` overview is general server monitoring. There is no
release-specific landing page: no widget for active releases, pending
approvals, upcoming releases, current production version, or pipeline
health. Anyone wanting that picture today has to visit Release Board,
Deployments, and Release Metrics separately and mentally combine them.

## Goals

- One page that answers "what's going on with releases right now" at a
  glance, without a new data model — everything is read-aggregated from
  tables that already exist (`releases`, `deployments`, `deployment_history`,
  `release_approvals`, `deploy_jobs`, `channels`, `products`).
- Consistent with the existing Release Management pages: same auth guard,
  same product-filter convention, same page shell.

## Non-goals

- Live/WebSocket updates (manual refresh only — matches Release Metrics /
  Audit Log, not the Deployments board).
- Per-user personalization (e.g. "waiting on you" framing) — approvals are
  shown platform-wide, not scoped to the signed-in user. Personal
  dashboards are explicitly out of scope here (tracked separately under
  §30 UX Enhancements, not part of this pass).
- Failed-deployments / recent-rollbacks widget — deliberately excluded
  from this pass (already visible on the Deployments board); can be added
  later if it proves to be missed.
- New database tables or migrations. This is pure aggregation.

## Placement & scope

New page `/release-dashboard`, added to the Release Management sidebar
group in `Shell.jsx` (after Release Metrics, before Release Calendar — or
wherever fits visually; exact ordering decided during implementation).

Shows all products by default, with an optional `product_id` filter
dropdown — the same convention as Release Board, Release Metrics, and
Audit Log.

Manual refresh: fetched on mount, plus an explicit "Refresh" button. No
new WebSocket channel.

## Backend

New module under `backend/src/release/`: `dashboard.controller.ts` +
`dashboard.service.ts`, following the existing `CalendarService` pattern
(pure aggregation queries against the pool, no new tables).

### `GET /release-dashboard?product_id=<optional>`

Guarded by `JwtAuthGuard` + `PermissionGuard`, reusing whatever read
permission already gates the Release Board page (confirmed during
implementation — no new permission key is introduced).

Response shape:

```jsonc
{
  "active_releases": [
    { "id": "...", "version": "1.4.0", "name": "...", "status": "qa",
      "product_id": "...", "product_name": "...", "planned_date": "..." }
  ],
  "pending_approvals": [
    { "release_id": "...", "version": "1.4.0", "product_name": "...",
      "role": "qa", "awaiting_email": "..." }
  ],
  "upcoming_releases": [
    { "id": "...", "version": "1.5.0", "name": "...",
      "planned_date": "...", "product_name": "..." }
  ],
  "production_versions": [
    { "product_id": "...", "product_name": "...", "version": "1.3.2",
      "deployed_at": "..." }
  ],
  "pipeline_health": {
    "window_days": 7, "succeeded": 42, "failed": 3, "rate": 0.933
  },
  "mini_calendar": [
    { "date": "2026-08-05", "type": "release", "label": "1.5.0 planned" }
  ]
}
```

Widget definitions:

- **active_releases** — `releases.status NOT IN ('draft', 'released',
  'archived')`, optionally filtered by `product_id` via the repo→product
  join used elsewhere in the release module.
- **pending_approvals** — every approval row with `decision = 'pending'`
  across all releases (not scoped to the signed-in user), reusing the same
  source query shape as `ApprovalsService`.
- **upcoming_releases** — `releases.planned_date BETWEEN now() AND now() +
  14 days`, top 5 ordered by `planned_date`.
- **production_versions** — per product, the latest `deployments` row with
  `status = 'succeeded'` on the channel where `key = 'production'`.
- **pipeline_health** — `deploy_jobs` succeeded vs. failed count over a
  trailing 7-day window; `rate = succeeded / (succeeded + failed)`, `null`
  if no jobs in the window (not `0`, to distinguish "no data" from "all
  failed").
- **mini_calendar** — internally reuses `CalendarService.calendar()` for a
  14-day forward window (releases + deployments + freeze windows), trimmed
  to the 5 soonest combined items.

All six sub-queries run concurrently via `Promise.all`, matching the
pattern in `DeploymentsService.metrics()`.

## Frontend

`dashboard/app/(app)/release-dashboard/page.jsx`:

- Product-filter dropdown at the top (same component/pattern as Release
  Board).
- A responsive grid of widget cards:
  - Active Releases (list, links to `/releases/:id`)
  - Pending Approvals (list, links to `/releases/:id`)
  - Upcoming Releases (list, links to `/releases/:id`)
  - Current Production Version (small table, one row per product)
  - Pipeline Health (stat: success rate + succeeded/failed counts,
    7-day window)
  - Mini Calendar (compact strip of the next 5 dated items, links to full
    `/release-calendar`)
- Each widget has an explicit empty state ("No active releases", "No
  pending approvals", etc.) rather than rendering a blank card.
- "Refresh" button re-fetches `GET /release-dashboard`.

## Testing

`dashboard.service.spec.ts`: one test per widget query, mocking
`pool.query` per call in sequence — matching the style already used in
`calendar.service.spec.ts` / `deployments.service.spec.ts`.

## Documentation

- Add "Release Dashboard" row to the page table in
  `docs/RELEASE_MANAGEMENT_GUIDE.md`, plus a short section describing each
  widget.
- Update `docs/RELEASE_MANAGEMENT_ROADMAP.md` §23 from ❌ to ✅ once shipped,
  matching the existing style of prior "done" entries.
