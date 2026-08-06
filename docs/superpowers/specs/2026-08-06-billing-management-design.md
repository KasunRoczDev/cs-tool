# Billing Management — Design Spec

Status: approved
Date: 2026-08-06

## Problem

The platform tracks servers, security events, and releases per Enterprise
Project (`products`), but has no way to record what cloud services each
project runs, what they cost, or how spend trends over time. Billing is
currently tracked outside the platform (spreadsheets), with no link between
a project's monitored infrastructure and its cost.

## Goals

- A per-project inventory of cloud services (ECS/RDS/OBS/Storage/Redis/...),
  each with type, specs, region, billing mode, and optional tags.
- A monthly workflow: pick an Enterprise Project + month, get a form
  listing every service due that month, fill in billed amounts in one pass.
- Billing history, filterable and exportable.
- A billing dashboard: monthly total + trend, breakdown by project, by
  service type, and cost-insight flags that cross-reference a service's
  linked server's actual utilization (CPU/RAM/uptime) against its cost.
- Reuses existing concepts: `products` *is* Enterprise Project (no new
  project entity), `servers` for the optional service↔server link,
  `platform_settings` for the global currency, the existing
  `@Roles('admin','operator')` guard pattern.

## Non-goals

- Multi-currency / exchange rates — one global currency
  (`platform_settings.billing_currency`, default `USD`).
- Historical backfill tooling — tracking starts going forward; past months
  can still be entered manually through the same monthly-entry UI if ever
  needed, just no bulk-import feature.
- Structured per-service-type spec schemas — `specs` is a generic key/value
  list on every service regardless of type.
- Approval workflow on billing entries (unlike Releases) — admin/operator
  writes take effect immediately.
- ML-based cost forecasting — insights are fixed, explainable threshold
  rules, not a model.
- Hard delete of services — retiring a service sets `status='retired'` so
  billing history stays intact; it just drops out of future monthly-entry
  forms.

## Data model

New `database/billing_migration.sql`, applied after `products_migration.sql`
and `schema.sql` (needs `products` and `servers`). Idempotent, following the
existing migration style (`IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN
duplicate_object`).

```sql
CREATE TYPE billing_mode   AS ENUM ('pay_per_use', 'monthly', 'annual');
CREATE TYPE service_status AS ENUM ('active', 'retired');

CREATE TABLE service_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,        -- 'ecs', 'rds', 'obs', 'storage', 'redis', ...
  name        TEXT NOT NULL,               -- display name
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  name           TEXT NOT NULL,             -- e.g. "prod-redis-01"
  region         TEXT,
  specs          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ "key": "vCPU", "value": "4" }, ...]
  billing_mode   billing_mode NOT NULL DEFAULT 'monthly',
  server_id      UUID REFERENCES servers(id) ON DELETE SET NULL,
  tags           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- same shape as servers.tags
  status         service_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_services_product ON services (product_id);
CREATE INDEX idx_services_type    ON services (service_type_id);
CREATE INDEX idx_services_server  ON services (server_id);

CREATE TABLE billing_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL,              -- normalized to first-of-month
  amount        NUMERIC(12,2) NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, billing_month)
);
CREATE INDEX idx_billing_records_month ON billing_records (billing_month DESC);

-- Seed starter service types.
INSERT INTO service_types (key, name) VALUES
  ('ecs', 'ECS'), ('rds', 'RDS'), ('obs', 'OBS'),
  ('storage', 'Storage'), ('redis', 'Redis')
ON CONFLICT (key) DO NOTHING;

-- Seed global currency default (reuses existing key/value settings table).
INSERT INTO platform_settings (key, value) VALUES ('billing_currency', 'USD')
ON CONFLICT (key) DO NOTHING;
```

`billing_month` is always stored as the first day of the month
(`date_trunc('month', ...)`), enforced at the service layer, so the
`UNIQUE (service_id, billing_month)` constraint gives one row per
service per calendar month regardless of what day it's entered on. For
`annual` services this constraint is unchanged — they simply get one row
per year, on whatever month they're due.

## Backend

New `backend/src/billing/` module (raw `pg` queries via `PG_POOL`, same
style as `products/`), registered in `app.module.ts`.

### `service-types` (`ServiceTypesController`)

- `GET /billing/service-types` — list.
- `POST /billing/service-types` (admin, operator) — `{ key, name, description? }`.
- `PATCH /billing/service-types/:id` (admin, operator).
- `DELETE /billing/service-types/:id` (admin) — blocked (409) if any
  `services` row references it.

### `services` (`ServicesController`)

- `GET /billing/services?product_id=&service_type_id=&status=` — list,
  joined with product name, service type name, server name (if linked).
- `GET /billing/services/:id`.
- `POST /billing/services` (admin, operator) — `{ product_id,
  service_type_id, name, region?, specs?, billing_mode, server_id?, tags? }`.
- `PATCH /billing/services/:id` (admin, operator) — same fields, partial.
- `POST /billing/services/:id/retire` (admin, operator) — sets
  `status='retired'`. No hard delete endpoint.

### `billing-records` (`BillingRecordsController`)

- `GET /billing/monthly-form?product_id=&month=YYYY-MM-01` — the data
  behind the "fill in this project's bills" popup. Returns every `active`
  service for the project where `billing_mode IN ('pay_per_use','monthly')`,
  plus `active` `annual` services whose most recent billing record (if any)
  has `billing_month` exactly 12 months before the requested month (or no
  record at all — first-time entry). Each row includes its existing
  `billing_records` entry for that month if present, so the form pre-fills
  on re-open/edit.

  Response:
  ```jsonc
  {
    "product": { "id": "...", "name": "OMS" },
    "month": "2026-08-01",
    "services": [
      { "service_id": "...", "name": "prod-redis-01", "service_type": "Redis",
        "region": "ap-southeast-1", "billing_mode": "monthly",
        "existing_record": { "id": "...", "amount": "42.00", "notes": "" } // or null
      }
    ]
  }
  ```

- `POST /billing/records/bulk` (admin, operator) — body:
  `{ product_id, month, entries: [{ service_id, amount, notes? }] }`.
  Upserts each into `billing_records` on `(service_id, billing_month)`
  conflict. Entries with `amount == null` are skipped (leaving that
  service unbilled for the month rather than writing a zero row).
- `GET /billing/records?product_id=&service_id=&service_type_id=&from=&to=`
  — filterable history, newest first, joined with service/product/type names.
- `PATCH /billing/records/:id` (admin, operator) — edit `amount`/`notes`.
- `DELETE /billing/records/:id` (admin, operator).
- `GET /billing/records/export.csv?<same filters as history>` — streams
  `text/csv` with columns: month, project, service, type, region,
  billing_mode, amount, notes.

### `dashboard` (`BillingDashboardController`)

- `GET /billing/dashboard/summary?months=6` —
  ```jsonc
  {
    "currency": "USD",
    "current_month_total": 1234.56,
    "trend": [ { "month": "2026-03-01", "total": 1050.00 }, ... ],
    "by_project": [ { "product_id": "...", "product_name": "OMS", "total": 800.00 } ],
    "by_service_type": [ { "service_type": "RDS", "total": 400.00 } ]
  }
  ```
  All aggregates scoped to the most recent completed month for the
  "current" figures and the trailing `months` for the trend line; every
  sub-query runs concurrently via `Promise.all` (matching
  `DeploymentsService.metrics()`).

- `GET /billing/dashboard/insights` — rule-based cost flags. For every
  `active` service with a `server_id` and a billing record in the most
  recent completed month:
  - pulls 30-day avg `cpu_usage`/`memory_usage` for the linked server from
    `metrics_1h`, and the server's `status`/`last_seen`.
  - flags `"downsizing_candidate"` when avg CPU < 15% **and** avg RAM < 20%
    over the window and `amount > 0`.
  - flags `"possibly_unused"` when `server.status = 'offline'` or
    `last_seen < now() - interval '30 days'` and the service still has a
    non-zero billing record this month.
  - Response: `[{ service_id, service_name, server_id, server_name, flag,
    avg_cpu, avg_ram, amount, reason }]`. Thresholds (15% CPU, 20% RAM,
    30-day window) are constants in `insights.service.ts`, not
    user-configurable in this pass.

## Frontend

New "Billing" sidebar section in `Shell.jsx` (own top-level group, after
"Monitoring"), all pages under `dashboard/app/(app)/billing/`:

- `/billing/services` — table (filter by project/type/status) + create/edit
  form: project dropdown (`products`), type dropdown (`service_types`),
  name, region (text), specs editor (add/remove key-value rows), billing
  mode select, optional server dropdown (servers filtered to the selected
  project), tags editor (same key-value pattern as specs). Retired
  services shown greyed-out with a "Reactivate" affordance instead of
  disappearing.
- `/billing/service-types` — small CRUD page, same shape as `/products`.
- `/billing/monthly-entry` — project dropdown + month picker (default:
  current month) → "Load services" fetches `GET /billing/monthly-form` and
  opens a modal listing each due service with an amount input
  (pre-filled from `existing_record`) and an optional notes input → "Save
  all" calls `POST /billing/records/bulk`.
- `/billing/history` — filterable table (project/service/type/date range)
  + "Export CSV" button. Since the API is Bearer-token authed, a plain
  `<a href>` can't carry the header — the button does a `fetch()` with the
  `Authorization` header (same as every other `lib/api.js` call), reads the
  response as a blob, and triggers the download via a temporary object URL
  (`URL.createObjectURL` + synthetic `<a click>`), not a direct link to the
  endpoint.
- `/billing/dashboard` — currency-labeled stat tile (current month total),
  `recharts` line chart for the trend, bar charts for by-project and
  by-service-type breakdowns, and a "Cost Insights" list rendering the
  flags from `/billing/dashboard/insights` (service name, server name,
  avg CPU/RAM, amount, plain-language reason).

`lib/api.js` gains the corresponding methods (`serviceTypes()`,
`createService()`, `monthlyForm()`, `bulkBillingRecords()`,
`billingDashboard()`, `billingInsights()`, etc.), following the existing
naming convention in that file.

## Testing

`*.service.spec.ts` per service, matching the `release/` module's style
(mocked `pool.query` per call):

- `services.service.spec.ts` — create/retire/list filtering.
- `billing-records.service.spec.ts` — bulk upsert (insert vs. update on
  conflict), the annual-service due-this-month logic in
  `monthly-form`, and CSV export column shape.
- `dashboard.service.spec.ts` — summary aggregation per widget.
- `insights.service.spec.ts` — both flag rules, including the "no server
  linked → not evaluated" and "no billing record this month → not
  evaluated" edge cases.

Manual verification in the browser: create a service type, create a
service under an Enterprise Project with specs/tags/linked server, run the
monthly-entry flow for two consecutive months, confirm history/export and
the dashboard trend/breakdown/insights render correctly.

## Documentation

- Add a "Billing Management" section to `README.md` (or a dedicated
  `docs/BILLING_GUIDE.md` if the README section grows too large),
  describing the service inventory → monthly entry → dashboard flow.
