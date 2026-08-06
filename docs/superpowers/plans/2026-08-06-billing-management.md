# Billing Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a billing management module — per-Enterprise-Project cloud service inventory, a monthly bill-entry workflow, billing history/export, and a cost dashboard with server-utilization insights.

**Architecture:** New `backend/src/billing/` NestJS module (raw `pg` queries via the existing `PG_POOL`, no ORM) exposing `service-types`, `services`, `billing-records`, and `billing-dashboard` endpoints, backed by a new `database/billing_migration.sql`. New `dashboard/app/(app)/billing/*` pages (plain React, Next.js 14 app router) consume it through `dashboard/lib/api.js`.

**Tech Stack:** NestJS 10, `pg`, `class-validator`/`class-transformer`, PostgreSQL/TimescaleDB, Next.js 14 (app router), `recharts`, Jest/ts-jest.

## Global Constraints

- Raw `pg.Pool` queries via `PG_POOL` (from `backend/src/database/database.module.ts`), no ORM — matches every existing module (`products`, `release`, etc.).
- DTOs use `class-validator` decorators; the app has a global `ValidationPipe({ whitelist: true, transform: true })` (`backend/src/main.ts:38`) — unknown fields are stripped automatically, no manual whitelisting needed.
- Foreign-key-shaped body fields (`product_id`, `service_type_id`, `server_id`, `service_id`) are validated with `@IsUUID()`, matching the precedent in `backend/src/notifications/dto.ts:74-95`.
- Write endpoints are guarded with `@Roles('admin', 'operator')` from `backend/src/common/jwt-auth.guard.ts`; reads only need `@UseGuards(JwtAuthGuard)`. This matches `products.controller.ts` — no new RBAC plumbing.
- Money is `NUMERIC(12,2)`. Currency is a single global value at `platform_settings.billing_currency` (table already exists, from `settings_migration.sql`) — no per-record currency, no exchange rates.
- **Test only real logic, not CRUD.** This codebase has zero spec files for plain CRUD services (`products`, `topology`) and reserves `*.service.spec.ts` for services with actual branching (date math, state machines, aggregation, CSV formatting) — see `calendar.service.spec.ts`, `audit.service.ts`. Follow that: `service-types` and `services` (Tasks 2–3) get no spec file, just manual `curl` verification; `billing-records`, `billing-dashboard`, `billing-insights` (Tasks 4–6) get full TDD.
- Migrations are idempotent SQL (`IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for enums), wired into `backend/scripts/migrate.js` via a `<NAME>_MIGRATION_PATH` env var with a `path.resolve(__dirname, ...)` fallback. Both `docker-compose.yml` and `docker-compose.dev.yml` bind-mount the whole `./database` folder, so a new file needs **no compose-file edit** — only the `migrate.js` wiring.
- **This repo's path contains `&`** (`Cybersecurity & Server Metrics Monitoring Platform`), which breaks `npx.cmd` when invoked directly from a Windows shell in this repo. Always run backend tests via `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest <pattern>` (confirmed working — the dev stack must be up, e.g. via `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`).
- Frontend has no test framework (`dashboard/package.json` has no `test` script, no `*.test.*`/`*.spec.*` files anywhere under `dashboard/`) — frontend tasks are verified manually in the browser, not with automated tests.
- Frontend reuses existing global CSS classes verbatim — do not redefine them: `page-head`, `inline-form`, `grid` (table), `error`, `modal-backdrop` / `modal` / `modal-actions` (see `dashboard/components/RegisterServer.jsx`), `card`, `empty`, `hint`.
- `dashboard/lib/api.js`'s `req()` helper already attaches `Authorization: Bearer <jwt>` and handles 401 redirect — every new method must go through it (or, for file downloads, mirror the existing `exportAuditLogCsv`/`downloadApprovalAttachment` blob-download pattern, since a plain `<a href>` can't carry the auth header).

---

## Task 1: Database migration

**Files:**
- Create: `database/billing_migration.sql`
- Modify: `backend/scripts/migrate.js` (add wiring block before the admin-seed block at the end)

**Interfaces:**
- Produces: tables `service_types`, `services`, `billing_records`; enums `billing_mode` (`pay_per_use`/`monthly`/`annual`), `service_status` (`active`/`retired`); seeded rows in `service_types` (ecs/rds/obs/storage/redis) and `platform_settings` (`billing_currency` = `USD`). Every later task's SQL depends on these exact table/column names.

- [ ] **Step 1: Write the migration file**

```sql
-- =====================================================================
-- Billing Management — service inventory + monthly billing records.
-- Apply after schema.sql, products_migration.sql, settings_migration.sql.
--   psql -U monitor -d monitoring -f database/billing_migration.sql
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE billing_mode AS ENUM ('pay_per_use', 'monthly', 'annual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE service_status AS ENUM ('active', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS service_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  name            TEXT NOT NULL,
  region          TEXT,
  specs           JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_mode    billing_mode NOT NULL DEFAULT 'monthly',
  server_id       UUID REFERENCES servers(id) ON DELETE SET NULL,
  tags            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          service_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_services_product ON services (product_id);
CREATE INDEX IF NOT EXISTS idx_services_type    ON services (service_type_id);
CREATE INDEX IF NOT EXISTS idx_services_server  ON services (server_id);

CREATE TABLE IF NOT EXISTS billing_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  billing_month DATE NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, billing_month)
);
CREATE INDEX IF NOT EXISTS idx_billing_records_month ON billing_records (billing_month DESC);

INSERT INTO service_types (key, name) VALUES
  ('ecs', 'ECS'), ('rds', 'RDS'), ('obs', 'OBS'),
  ('storage', 'Storage'), ('redis', 'Redis')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES ('billing_currency', 'USD')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Wire it into `backend/scripts/migrate.js`**

Insert this block right before the `const email = process.env.ADMIN_EMAIL ...` line at the end of the file (i.e. after the existing `agent-update-status migration` block), so it runs after `products` and `platform_settings` already exist:

```js
  // Apply billing-management migration (idempotent — IF NOT EXISTS / guarded
  // enums). Must run after products_migration.sql (products) and
  // settings_migration.sql (platform_settings).
  const billingPath =
    process.env.BILLING_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/billing_migration.sql');
  if (fs.existsSync(billingPath)) {
    console.log('Applying billing-management migration...');
    await client.query(fs.readFileSync(billingPath, 'utf8'));
  }
```

- [ ] **Step 3: Apply it against the running dev database and verify**

Run (from the repo root, with the dev stack up via `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend node scripts/migrate.js
```

Expected: log lines ending in `Applying billing-management migration...` then `Admin ready: ...` / `Done.`, no errors.

Then verify the tables exist:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec db psql -U monitor -d monitoring -c "\d services" -c "SELECT key,name FROM service_types ORDER BY key;" -c "SELECT value FROM platform_settings WHERE key='billing_currency';"
```

Expected: `services` table description printed, 5 service types listed (ecs, obs, rds, redis, storage), and `billing_currency` = `USD`.

- [ ] **Step 4: Commit**

```bash
git add database/billing_migration.sql backend/scripts/migrate.js
git commit -m "feat(billing): add service inventory + billing records migration"
```

---

## Task 2: Backend — service types catalog

**Files:**
- Create: `backend/src/billing/service-types.service.ts`
- Create: `backend/src/billing/service-types.controller.ts`
- Create: `backend/src/billing/billing.module.ts`
- Modify: `backend/src/app.module.ts` (register `BillingModule`)

**Interfaces:**
- Consumes: `PG_POOL` from `backend/src/database/database.module.ts`; `JwtAuthGuard`/`Roles` from `backend/src/common/jwt-auth.guard.ts`; tables from Task 1.
- Produces: `ServiceTypesService` (exported from `BillingModule`) with `list()`, `create(key, name, description?)`, `update(id, patch)`, `remove(id)` — Task 3 does not depend on this, but Tasks 4–6 assume `service_types(id, key, name, description, created_at)` rows exist for joins.

- [ ] **Step 1: Implement the service**

`backend/src/billing/service-types.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ServiceType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  created_at: string;
}

@Injectable()
export class ServiceTypesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(): Promise<ServiceType[]> {
    return this.pool
      .query('SELECT id, key, name, description, created_at FROM service_types ORDER BY name')
      .then((r) => r.rows);
  }

  async create(key: string, name: string, description?: string): Promise<ServiceType> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO service_types (key, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, key, name, description, created_at`,
        [key, name, description ?? null],
      );
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Service type key already exists');
      throw e;
    }
  }

  async update(
    id: string,
    patch: { key?: string; name?: string; description?: string },
  ): Promise<ServiceType> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.key !== undefined) { params.push(patch.key); sets.push(`key = $${params.length}`); }
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.description !== undefined) { params.push(patch.description); sets.push(`description = $${params.length}`); }
    if (sets.length === 0) {
      const { rows } = await this.pool.query(
        'SELECT id, key, name, description, created_at FROM service_types WHERE id = $1', [id]);
      if (!rows[0]) throw new NotFoundException('Service type not found');
      return rows[0];
    }
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE service_types SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, key, name, description, created_at`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Service type not found');
    return rows[0];
  }

  async remove(id: string): Promise<{ deleted: string }> {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS c FROM services WHERE service_type_id = $1', [id]);
    if (rows[0].c > 0) {
      throw new ConflictException(`Cannot delete: ${rows[0].c} service(s) use this type`);
    }
    const { rowCount } = await this.pool.query('DELETE FROM service_types WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('Service type not found');
    return { deleted: id };
  }
}
```

- [ ] **Step 2: Implement the controller**

`backend/src/billing/service-types.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServiceTypesService } from './service-types.service';

class CreateServiceTypeDto {
  @IsString() key!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateServiceTypeDto {
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('billing/service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypes: ServiceTypesService) {}

  @Get()
  list() {
    return this.serviceTypes.list();
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateServiceTypeDto) {
    return this.serviceTypes.create(dto.key, dto.name, dto.description);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceTypeDto) {
    return this.serviceTypes.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceTypes.remove(id);
  }
}
```

- [ ] **Step 3: Create the module and register it**

`backend/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [ServiceTypesService],
  controllers: [ServiceTypesController],
  exports: [ServiceTypesService],
})
export class BillingModule {}
```

In `backend/src/app.module.ts`, add the import and register it in the `imports` array (after `AccessModule`):

```ts
import { AccessModule } from './access/access.module';
import { BillingModule } from './billing/billing.module';
```

```ts
    AiModule,
    AccessModule,
    BillingModule,
```

- [ ] **Step 4: Verify manually against the running dev stack**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest --listTests
```

Expected: command succeeds (confirms ts-node picked up the new files with no compile errors — no billing test files exist yet, that's fine).

Log in and hit the new endpoints (replace `admin@example.com`/`admin123` if changed):

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token||JSON.parse(d).token))")
curl -s http://localhost:4000/api/v1/billing/service-types -H "Authorization: Bearer $TOKEN"
```

Expected: JSON array of 5 seeded service types (ecs, obs, rds, redis, storage).

```bash
curl -s -X POST http://localhost:4000/api/v1/billing/service-types -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"key":"cdn","name":"CDN"}'
```

Expected: `{"id":"...","key":"cdn","name":"CDN","description":null,"created_at":"..."}`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/billing/service-types.service.ts backend/src/billing/service-types.controller.ts backend/src/billing/billing.module.ts backend/src/app.module.ts
git commit -m "feat(billing): add service types catalog CRUD"
```

---

## Task 3: Backend — service inventory

**Files:**
- Create: `backend/src/billing/services.service.ts`
- Create: `backend/src/billing/services.controller.ts`
- Modify: `backend/src/billing/billing.module.ts` (add `ServicesService`/`ServicesController`)

**Interfaces:**
- Consumes: `PG_POOL`; `products`, `service_types`, `servers`, `services` tables.
- Produces: `ServicesService.list(filters)`, `.get(id)`, `.create(input, userId)`, `.update(id, patch)`, `.setStatus(id, status)`, returning `ServiceRow { id, product_id, product_name, service_type_id, service_type_name, name, region, specs, billing_mode, server_id, server_name, tags, status, created_at }`. Task 4's `monthly-form`/`export.csv` queries join against `services`/`service_types`/`products` directly (not through this service), but the frontend (Task 9) calls this controller's routes by exact path (`/billing/services`, `/billing/services/:id/retire`, `/billing/services/:id/reactivate`).

- [ ] **Step 1: Implement the service**

`backend/src/billing/services.service.ts`:

```ts
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
```

- [ ] **Step 2: Implement the controller**

`backend/src/billing/services.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServicesService, BillingMode } from './services.service';

class CreateServiceDto {
  @IsUUID() product_id!: string;
  @IsUUID() service_type_id!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsArray() specs?: { key: string; value: string }[];
  @IsOptional() @IsIn(['pay_per_use', 'monthly', 'annual']) billing_mode?: BillingMode;
  @IsOptional() @IsUUID() server_id?: string;
  @IsOptional() @IsObject() tags?: Record<string, string>;
}
class UpdateServiceDto {
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() service_type_id?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsArray() specs?: { key: string; value: string }[];
  @IsOptional() @IsIn(['pay_per_use', 'monthly', 'annual']) billing_mode?: BillingMode;
  @IsOptional() @IsUUID() server_id?: string;
  @IsOptional() @IsObject() tags?: Record<string, string>;
}

@UseGuards(JwtAuthGuard)
@Controller('billing/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(
    @Query('product_id') productId?: string,
    @Query('service_type_id') typeId?: string,
    @Query('status') status?: string,
  ) {
    return this.services.list({ product_id: productId, service_type_id: typeId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateServiceDto, @Req() req: any) {
    return this.services.create(dto, req.user.sub);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(id, dto);
  }

  @Roles('admin', 'operator')
  @Post(':id/retire')
  retire(@Param('id') id: string) {
    return this.services.setStatus(id, 'retired');
  }

  @Roles('admin', 'operator')
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.services.setStatus(id, 'active');
  }
}
```

- [ ] **Step 3: Register in the module**

Modify `backend/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [ServiceTypesService, ServicesService],
  controllers: [ServiceTypesController, ServicesController],
  exports: [ServiceTypesService, ServicesService],
})
export class BillingModule {}
```

- [ ] **Step 4: Verify manually**

```bash
PRODUCT_ID=$(curl -s http://localhost:4000/api/v1/products -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
TYPE_ID=$(curl -s http://localhost:4000/api/v1/billing/service-types -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
SERVICE_ID=$(curl -s -X POST http://localhost:4000/api/v1/billing/services -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PRODUCT_ID\",\"service_type_id\":\"$TYPE_ID\",\"name\":\"prod-redis-01\",\"region\":\"ap-southeast-1\",\"billing_mode\":\"monthly\",\"specs\":[{\"key\":\"vCPU\",\"value\":\"4\"}],\"tags\":{\"env\":\"live\"}}" \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
echo "SERVICE_ID=$SERVICE_ID"
```

Expected: the create call returns `201`-shaped JSON with `product_name`, `service_type_name` populated, `specs: [{"key":"vCPU","value":"4"}]`, `status: "active"`; `$SERVICE_ID` prints a UUID (keep this shell session open — Task 4's verification reuses `$TOKEN`, `$PRODUCT_ID`, and `$SERVICE_ID` from here).

```bash
curl -s "http://localhost:4000/api/v1/billing/services?status=active" -H "Authorization: Bearer $TOKEN"
```

Expected: array containing the created service.

- [ ] **Step 5: Commit**

```bash
git add backend/src/billing/services.service.ts backend/src/billing/services.controller.ts backend/src/billing/billing.module.ts
git commit -m "feat(billing): add service inventory CRUD"
```

---

## Task 4: Backend — billing records (monthly form, bulk upsert, history, CSV export)

**Files:**
- Create: `backend/src/billing/billing-records.service.ts`
- Create: `backend/src/billing/billing-records.service.spec.ts`
- Create: `backend/src/billing/billing-records.controller.ts`
- Modify: `backend/src/billing/billing.module.ts`

**Interfaces:**
- Consumes: `PG_POOL`; `services`/`service_types`/`products`/`billing_records` tables (Task 1); the `ServiceRow`-shaped join is independent of `ServicesService` (its own query).
- Produces: `BillingRecordsService.monthlyForm(productId, month)`, `.bulkUpsert(productId, month, entries, userId)`, `.list(filters)`, `.update(id, patch)`, `.remove(id)`, `.toCsv(rows)`. Task 5/6 do not depend on this service directly (separate queries), but the frontend (Tasks 10–11) calls this controller's exact routes: `GET /billing/monthly-form`, `POST /billing/records/bulk`, `GET /billing/records`, `PATCH /billing/records/:id`, `DELETE /billing/records/:id`, `GET /billing/records/export.csv`.

- [ ] **Step 1: Write the failing spec**

`backend/src/billing/billing-records.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { BillingRecordsService } from './billing-records.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new BillingRecordsService(pool);
  return { svc, query };
}

describe('BillingRecordsService.monthlyForm', () => {
  it('throws NotFoundException when the product does not exist', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.monthlyForm('missing', '2026-08-01')).rejects.toThrow(NotFoundException);
  });

  it('includes monthly/pay_per_use services unconditionally, and only-due annual services', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'OMS' }] });
    query.mockResolvedValueOnce({
      rows: [
        { service_id: 's1', name: 'redis-01', service_type: 'Redis', region: 'ap-1', billing_mode: 'monthly',
          record_id: null, amount: null, notes: null, last_billed: null },
        { service_id: 's2', name: 'obs-archive', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: '2026-03-01' }, // 5 months ago — not due
        { service_id: 's3', name: 'obs-backup', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: '2025-06-01' }, // 14 months ago — due
        { service_id: 's4', name: 'obs-new', service_type: 'OBS', region: 'ap-1', billing_mode: 'annual',
          record_id: null, amount: null, notes: null, last_billed: null }, // never billed — due
      ],
    });

    const result = await svc.monthlyForm('p1', '2026-08-01');
    expect(result.services.map((s) => s.service_id)).toEqual(['s1', 's3', 's4']);
    expect(result.month).toBe('2026-08-01');
  });

  it('pre-fills existing_record when a billing_records row already exists for the month', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'OMS' }] });
    query.mockResolvedValueOnce({
      rows: [{ service_id: 's1', name: 'redis-01', service_type: 'Redis', region: 'ap-1', billing_mode: 'monthly',
        record_id: 'br1', amount: '42.00', notes: 'note', last_billed: '2026-08-01' }],
    });
    const result = await svc.monthlyForm('p1', '2026-08-15');
    expect(result.services[0].existing_record).toEqual({ id: 'br1', amount: '42.00', notes: 'note' });
  });
});

describe('BillingRecordsService.bulkUpsert', () => {
  it('upserts every entry with a non-null amount and skips null amounts', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValue({ rows: [] });
    const result = await svc.bulkUpsert('p1', '2026-08-01', [
      { service_id: 's1', amount: 10 },
      { service_id: 's2', amount: null as any },
      { service_id: 's3', amount: 20, notes: 'x' },
    ], 'u1');
    expect(result.upserted).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('BillingRecordsService.toCsv', () => {
  it('quotes fields containing commas and escapes embedded quotes', () => {
    const { svc } = makeService();
    const csv = svc.toCsv([
      { id: '1', service_id: 's1', service_name: 'redis, prod', service_type: 'Redis',
        product_id: 'p1', product_name: 'OMS', region: 'ap-1', billing_mode: 'monthly',
        billing_month: '2026-08-01', amount: '42.00', notes: 'has "quotes"',
        created_at: '', updated_at: '' } as any,
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"redis, prod"');
    expect(lines[1]).toContain('"has ""quotes"""');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-records.service.spec.ts
```

Expected: FAIL — `Cannot find module './billing-records.service'`.

- [ ] **Step 3: Implement the service**

`backend/src/billing/billing-records.service.ts`:

```ts
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

function firstOfMonth(month: string): string {
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
    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map((c) => esc((r as any)[c])).join(','));
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-records.service.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Implement the controller**

`backend/src/billing/billing-records.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { BillingRecordsService } from './billing-records.service';

class BulkEntryDto {
  @IsUUID() service_id!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() notes?: string;
}
class BulkUpsertDto {
  @IsUUID() product_id!: string;
  @IsString() month!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkEntryDto) entries!: BulkEntryDto[];
}
class UpdateBillingRecordDto {
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() notes?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingRecordsController {
  constructor(private readonly records: BillingRecordsService) {}

  @Get('monthly-form')
  monthlyForm(@Query('product_id') productId: string, @Query('month') month: string) {
    return this.records.monthlyForm(productId, month);
  }

  @Roles('admin', 'operator')
  @Post('records/bulk')
  bulkUpsert(@Body() dto: BulkUpsertDto, @Req() req: any) {
    return this.records.bulkUpsert(dto.product_id, dto.month, dto.entries, req.user.sub);
  }

  @Get('records')
  list(
    @Query('product_id') productId?: string,
    @Query('service_id') serviceId?: string,
    @Query('service_type_id') typeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.records.list({ product_id: productId, service_id: serviceId, service_type_id: typeId, from, to });
  }

  @Get('records/export.csv')
  async exportCsv(
    @Query('product_id') productId: string | undefined,
    @Query('service_id') serviceId: string | undefined,
    @Query('service_type_id') typeId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.records.list({ product_id: productId, service_id: serviceId, service_type_id: typeId, from, to });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="billing-history.csv"');
    res.send(this.records.toCsv(rows));
  }

  @Roles('admin', 'operator')
  @Patch('records/:id')
  update(@Param('id') id: string, @Body() dto: UpdateBillingRecordDto) {
    return this.records.update(id, dto);
  }

  @Roles('admin', 'operator')
  @Delete('records/:id')
  remove(@Param('id') id: string) {
    return this.records.remove(id);
  }
}
```

- [ ] **Step 6: Register in the module**

Modify `backend/src/billing/billing.module.ts` — add `BillingRecordsService`/`BillingRecordsController`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BillingRecordsService } from './billing-records.service';
import { BillingRecordsController } from './billing-records.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [ServiceTypesService, ServicesService, BillingRecordsService],
  controllers: [ServiceTypesController, ServicesController, BillingRecordsController],
  exports: [ServiceTypesService, ServicesService, BillingRecordsService],
})
export class BillingModule {}
```

- [ ] **Step 7: Verify manually**

Using the `$TOKEN`, `$PRODUCT_ID` from Task 3, and a `$SERVICE_ID` from the service created there:

```bash
curl -s "http://localhost:4000/api/v1/billing/monthly-form?product_id=$PRODUCT_ID&month=2026-08-01" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"product":{"id":"...","name":"..."},"month":"2026-08-01","services":[{"service_id":"...","name":"prod-redis-01",...,"existing_record":null}]}`.

```bash
curl -s -X POST http://localhost:4000/api/v1/billing/records/bulk -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PRODUCT_ID\",\"month\":\"2026-08-01\",\"entries\":[{\"service_id\":\"$SERVICE_ID\",\"amount\":42.5,\"notes\":\"test\"}]}"
curl -s "http://localhost:4000/api/v1/billing/records?product_id=$PRODUCT_ID" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:4000/api/v1/billing/records/export.csv?product_id=$PRODUCT_ID" -H "Authorization: Bearer $TOKEN"
```

Expected: bulk call returns `{"upserted":1}`; list shows the new record with `amount: "42.50"`; CSV export returns a `text/csv` body with a header row and one data row.

- [ ] **Step 8: Commit**

```bash
git add backend/src/billing/billing-records.service.ts backend/src/billing/billing-records.service.spec.ts backend/src/billing/billing-records.controller.ts backend/src/billing/billing.module.ts
git commit -m "feat(billing): add monthly billing form, bulk upsert, history, CSV export"
```

---

## Task 5: Backend — billing dashboard summary

**Files:**
- Create: `backend/src/billing/billing-dashboard.service.ts`
- Create: `backend/src/billing/billing-dashboard.service.spec.ts`
- Modify: `backend/src/billing/billing.module.ts`

**Interfaces:**
- Consumes: `PG_POOL`; `SettingsService.getAll()` from `backend/src/settings/settings.service.ts` (already returns `platform_settings` as a flat map, including `billing_currency`); `billing_records`/`services`/`products`/`service_types` tables.
- Produces: `BillingDashboardService.summary(months)` → `BillingSummary { currency, current_month_total, trend, by_project, by_service_type }`. Task 6's controller (`BillingDashboardController`) is created there and depends on this service's exact method name/shape.

- [ ] **Step 1: Write the failing spec**

`backend/src/billing/billing-dashboard.service.spec.ts`:

```ts
import { BillingDashboardService } from './billing-dashboard.service';

function makeService(settingsOverrides: Record<string, string> = {}) {
  const query = jest.fn();
  const pool = { query } as any;
  const settings = { getAll: jest.fn().mockResolvedValue({ billing_currency: 'USD', ...settingsOverrides }) } as any;
  const svc = new BillingDashboardService(pool, settings);
  return { svc, query, settings };
}

describe('BillingDashboardService.summary', () => {
  it('aggregates current month total, trend, and breakdowns using the configured currency', async () => {
    const { svc, query } = makeService({ billing_currency: 'LKR' });
    query
      .mockResolvedValueOnce({ rows: [{ total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ month: '2026-08-01', total: 1234.5 }] })
      .mockResolvedValueOnce({ rows: [{ product_id: 'p1', product_name: 'OMS', total: 800 }] })
      .mockResolvedValueOnce({ rows: [{ service_type: 'RDS', total: 400 }] });

    const result = await svc.summary(6);
    expect(result.currency).toBe('LKR');
    expect(result.current_month_total).toBe(1234.5);
    expect(result.trend).toEqual([{ month: '2026-08-01', total: 1234.5 }]);
    expect(result.by_project).toEqual([{ product_id: 'p1', product_name: 'OMS', total: 800 }]);
    expect(result.by_service_type).toEqual([{ service_type: 'RDS', total: 400 }]);
  });

  it('defaults current_month_total to 0 when there are no billing records yet', async () => {
    const { svc, query } = makeService();
    query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await svc.summary(6);
    expect(result.current_month_total).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-dashboard.service.spec.ts
```

Expected: FAIL — `Cannot find module './billing-dashboard.service'`.

- [ ] **Step 3: Implement the service**

`backend/src/billing/billing-dashboard.service.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-dashboard.service.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Register in the module** (controller comes in Task 6, but register the service now)

Modify `backend/src/billing/billing.module.ts` — import `SettingsModule` and add `BillingDashboardService`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BillingRecordsService } from './billing-records.service';
import { BillingRecordsController } from './billing-records.controller';
import { BillingDashboardService } from './billing-dashboard.service';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    SettingsModule,
  ],
  providers: [ServiceTypesService, ServicesService, BillingRecordsService, BillingDashboardService],
  controllers: [ServiceTypesController, ServicesController, BillingRecordsController],
  exports: [ServiceTypesService, ServicesService, BillingRecordsService, BillingDashboardService],
})
export class BillingModule {}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/billing/billing-dashboard.service.ts backend/src/billing/billing-dashboard.service.spec.ts backend/src/billing/billing.module.ts
git commit -m "feat(billing): add dashboard summary aggregation"
```

---

## Task 6: Backend — cost insights + dashboard controller

**Files:**
- Create: `backend/src/billing/billing-insights.service.ts`
- Create: `backend/src/billing/billing-insights.service.spec.ts`
- Create: `backend/src/billing/billing-dashboard.controller.ts`
- Modify: `backend/src/billing/billing.module.ts`

**Interfaces:**
- Consumes: `PG_POOL`; `services`/`servers`/`billing_records`/`metrics_1h` (from `database/schema.sql`, columns `server_id, bucket, cpu_usage, memory_usage`) tables; `BillingDashboardService.summary` (Task 5).
- Produces: `BillingInsightsService.getInsights()` → `InsightFlag[] { service_id, service_name, server_id, server_name, flag, avg_cpu, avg_ram, amount, reason }`; `GET /billing/dashboard/summary?months=`, `GET /billing/dashboard/insights` routes the frontend (Task 12) calls by these exact paths.

- [ ] **Step 1: Write the failing spec**

`backend/src/billing/billing-insights.service.spec.ts`:

```ts
import { BillingInsightsService } from './billing-insights.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new BillingInsightsService(pool);
  return { svc, query };
}

describe('BillingInsightsService.getInsights', () => {
  it('flags a service as a downsizing candidate when avg CPU/RAM are both low', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's1', service_name: 'redis-01', server_id: 'sv1', server_name: 'web-01',
        server_status: 'online', last_seen: new Date().toISOString(),
        amount: 42, avg_cpu: 8, avg_ram: 12,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe('downsizing_candidate');
  });

  it('flags a service as possibly unused when its server is offline', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's2', service_name: 'ecs-02', server_id: 'sv2', server_name: 'app-02',
        server_status: 'offline', last_seen: new Date().toISOString(),
        amount: 15, avg_cpu: 50, avg_ram: 60,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toBe('possibly_unused');
  });

  it('does not flag a healthily-utilized, online, billed service', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's3', service_name: 'rds-01', server_id: 'sv3', server_name: 'db-01',
        server_status: 'online', last_seen: new Date().toISOString(),
        amount: 100, avg_cpu: 55, avg_ram: 60,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(0);
  });

  it('skips services with a zero or negative billed amount', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{
        service_id: 's4', service_name: 'obs-01', server_id: 'sv4', server_name: 'store-01',
        server_status: 'offline', last_seen: null,
        amount: 0, avg_cpu: null, avg_ram: null,
      }],
    });
    const flags = await svc.getInsights();
    expect(flags).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-insights.service.spec.ts
```

Expected: FAIL — `Cannot find module './billing-insights.service'`.

- [ ] **Step 3: Implement the service**

`backend/src/billing/billing-insights.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const CPU_THRESHOLD = 15;   // percent
const RAM_THRESHOLD = 20;   // percent
const WINDOW_DAYS = 30;

export interface InsightFlag {
  service_id: string;
  service_name: string;
  server_id: string;
  server_name: string;
  flag: 'downsizing_candidate' | 'possibly_unused';
  avg_cpu: number | null;
  avg_ram: number | null;
  amount: number;
  reason: string;
}

@Injectable()
export class BillingInsightsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getInsights(): Promise<InsightFlag[]> {
    const { rows } = await this.pool.query(
      `SELECT s.id AS service_id, s.name AS service_name,
              sv.id AS server_id, sv.name AS server_name, sv.status AS server_status, sv.last_seen,
              br.amount::float AS amount,
              (SELECT avg(cpu_usage)    FROM metrics_1h WHERE server_id = sv.id AND bucket >= now() - ($1 || ' days')::interval) AS avg_cpu,
              (SELECT avg(memory_usage) FROM metrics_1h WHERE server_id = sv.id AND bucket >= now() - ($1 || ' days')::interval) AS avg_ram
         FROM services s
         JOIN servers sv ON sv.id = s.server_id
         JOIN billing_records br ON br.service_id = s.id
                                 AND br.billing_month = date_trunc('month', now() - interval '1 month')::date
        WHERE s.status = 'active'`,
      [WINDOW_DAYS],
    );

    const flags: InsightFlag[] = [];
    for (const r of rows) {
      if (!(r.amount > 0)) continue;
      const offline =
        r.server_status === 'offline' ||
        (r.last_seen && new Date(r.last_seen).getTime() < Date.now() - WINDOW_DAYS * 86_400_000);
      if (offline) {
        flags.push({
          service_id: r.service_id, service_name: r.service_name,
          server_id: r.server_id, server_name: r.server_name,
          flag: 'possibly_unused', avg_cpu: r.avg_cpu, avg_ram: r.avg_ram, amount: r.amount,
          reason: `Server "${r.server_name}" is offline or hasn't reported in ${WINDOW_DAYS}+ days but is still billed.`,
        });
        continue;
      }
      if (r.avg_cpu != null && r.avg_ram != null && r.avg_cpu < CPU_THRESHOLD && r.avg_ram < RAM_THRESHOLD) {
        flags.push({
          service_id: r.service_id, service_name: r.service_name,
          server_id: r.server_id, server_name: r.server_name,
          flag: 'downsizing_candidate', avg_cpu: r.avg_cpu, avg_ram: r.avg_ram, amount: r.amount,
          reason: `Avg CPU ${r.avg_cpu.toFixed(1)}% / RAM ${r.avg_ram.toFixed(1)}% over ${WINDOW_DAYS} days — consider downsizing.`,
        });
      }
    }
    return flags;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing-insights.service.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Implement the dashboard controller**

`backend/src/billing/billing-dashboard.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BillingDashboardService } from './billing-dashboard.service';
import { BillingInsightsService } from './billing-insights.service';

@UseGuards(JwtAuthGuard)
@Controller('billing/dashboard')
export class BillingDashboardController {
  constructor(
    private readonly dashboard: BillingDashboardService,
    private readonly insights: BillingInsightsService,
  ) {}

  @Get('summary')
  summary(@Query('months') months?: string) {
    return this.dashboard.summary(months ? parseInt(months, 10) : 6);
  }

  @Get('insights')
  getInsights() {
    return this.insights.getInsights();
  }
}
```

- [ ] **Step 6: Register in the module (final version)**

Modify `backend/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ServiceTypesService } from './service-types.service';
import { ServiceTypesController } from './service-types.controller';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { BillingRecordsService } from './billing-records.service';
import { BillingRecordsController } from './billing-records.controller';
import { BillingDashboardService } from './billing-dashboard.service';
import { BillingInsightsService } from './billing-insights.service';
import { BillingDashboardController } from './billing-dashboard.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    SettingsModule,
  ],
  providers: [
    ServiceTypesService, ServicesService, BillingRecordsService,
    BillingDashboardService, BillingInsightsService,
  ],
  controllers: [
    ServiceTypesController, ServicesController, BillingRecordsController, BillingDashboardController,
  ],
  exports: [ServiceTypesService, ServicesService, BillingRecordsService],
})
export class BillingModule {}
```

- [ ] **Step 7: Run the full billing test suite and verify manually**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest billing
```

Expected: PASS, all billing spec files (11 tests total across Tasks 4–6).

```bash
curl -s "http://localhost:4000/api/v1/billing/dashboard/summary?months=6" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:4000/api/v1/billing/dashboard/insights" -H "Authorization: Bearer $TOKEN"
```

Expected: summary returns `{"currency":"USD","current_month_total":0,"trend":[...],"by_project":[...],"by_service_type":[...]}` (0 since the test record from Task 4 was billed for `2026-08-01`, not necessarily "this month" when you run this — that's expected); insights returns `[]` (no linked-server services billed last month yet).

- [ ] **Step 8: Commit**

```bash
git add backend/src/billing/billing-insights.service.ts backend/src/billing/billing-insights.service.spec.ts backend/src/billing/billing-dashboard.controller.ts backend/src/billing/billing.module.ts
git commit -m "feat(billing): add cost insights and wire up the dashboard controller"
```

---

## Task 7: Frontend — API client methods

**Files:**
- Modify: `dashboard/lib/api.js` (append a new `// ── Billing ──` section at the end of the `api` object, before the closing `};`)

**Interfaces:**
- Consumes: exact backend routes from Tasks 2–6.
- Produces: `api.serviceTypes()`, `.createServiceType()`, `.updateServiceType()`, `.deleteServiceType()`, `.billingServices()`, `.billingService()`, `.createBillingService()`, `.updateBillingService()`, `.retireBillingService()`, `.reactivateBillingService()`, `.monthlyBillingForm()`, `.bulkBillingRecords()`, `.billingRecords()`, `.updateBillingRecord()`, `.deleteBillingRecord()`, `.exportBillingRecordsCsv()`, `.billingDashboardSummary()`, `.billingInsights()` — every method name Tasks 8–13 call by exact name.

- [ ] **Step 1: Add the methods**

Insert before the final `};` in `dashboard/lib/api.js` (after the `downloadApprovalAttachment` method, matching its blob-download pattern for the CSV export):

```js
  // ── Billing ──────────────────────────────────────────────────────────
  serviceTypes: () => req('/billing/service-types'),
  createServiceType: (body) => req('/billing/service-types', { method: 'POST', body: JSON.stringify(body) }),
  updateServiceType: (id, body) => req(`/billing/service-types/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteServiceType: (id) => req(`/billing/service-types/${id}`, { method: 'DELETE' }),
  billingServices: (filters) => req('/billing/services' + qs(filters)),
  billingService: (id) => req(`/billing/services/${id}`),
  createBillingService: (body) => req('/billing/services', { method: 'POST', body: JSON.stringify(body) }),
  updateBillingService: (id, body) => req(`/billing/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  retireBillingService: (id) => req(`/billing/services/${id}/retire`, { method: 'POST' }),
  reactivateBillingService: (id) => req(`/billing/services/${id}/reactivate`, { method: 'POST' }),
  monthlyBillingForm: (productId, month) => req(`/billing/monthly-form${qs({ product_id: productId, month })}`),
  bulkBillingRecords: (body) => req('/billing/records/bulk', { method: 'POST', body: JSON.stringify(body) }),
  billingRecords: (filters) => req('/billing/records' + qs(filters)),
  updateBillingRecord: (id, body) => req(`/billing/records/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBillingRecord: (id) => req(`/billing/records/${id}`, { method: 'DELETE' }),
  exportBillingRecordsCsv: async (filters) => {
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/billing/records/export.csv${qs(filters)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'billing-history.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
  billingDashboardSummary: (months) => req('/billing/dashboard/summary' + qs({ months })),
  billingInsights: () => req('/billing/dashboard/insights'),
```

- [ ] **Step 2: Verify it compiles**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec dashboard node -e "require('/app/lib/api.js')" 2>&1 | head -5
```

Expected: either no output/module-not-found-under-node (it's an ESM/Next module, not runnable standalone) is fine — the real check is the dashboard's own dev server compiling without error:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs dashboard --tail 30
```

Expected: no new compile errors after the file save (Next's dev server hot-reloads and would log a syntax error if the edit broke the file).

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.js
git commit -m "feat(billing): add billing API client methods"
```

---

## Task 8: Frontend — Service Types admin page + nav entry

**Files:**
- Create: `dashboard/app/(app)/billing/service-types/page.jsx`
- Modify: `dashboard/components/Shell.jsx` (insert a new "Billing" nav group)

**Interfaces:**
- Consumes: `api.serviceTypes/createServiceType/updateServiceType/deleteServiceType` (Task 7).
- Produces: `/billing/service-types` route; the "Billing" nav group other frontend tasks' pages (9–12) live under.

- [ ] **Step 1: Add the "Billing" nav group**

In `dashboard/components/Shell.jsx`, insert this object into the `navGroups` array right after the `Monitoring` group closes (after the line `},` that follows the `/analysis` item) and before the `Release Management` group starts:

```jsx
    {
      section: 'Billing',
      items: [
        { href: '/billing/dashboard',     label: '💰 Billing Dashboard' },
        { href: '/billing/services',      label: '🧾 Services' },
        { href: '/billing/service-types', label: '🏷️ Service Types' },
        { href: '/billing/monthly-entry', label: '📅 Monthly Entry' },
        { href: '/billing/history',       label: '📜 Billing History' },
      ],
    },
```

- [ ] **Step 2: Create the Service Types page**

`dashboard/app/(app)/billing/service-types/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ServiceTypesPage() {
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [editing, setEditing] = useState(null);

  const load = () => api.serviceTypes().then(setTypes).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.createServiceType(form);
      setForm({ key: '', name: '', description: '' });
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    setErr('');
    try {
      await api.updateServiceType(editing.id, { key: editing.key, name: editing.name, description: editing.description });
      setEditing(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  const remove = async (t) => {
    if (!confirm(`Delete service type "${t.name}"?`)) return;
    setErr('');
    try { await api.deleteServiceType(t.id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🏷️ Service Types</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={create}>
        <input placeholder="key (e.g. ecs)" required
          value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        <input placeholder="name (e.g. ECS)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="description (optional)" style={{ minWidth: 220 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button type="submit">Add service type</button>
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Key</th><th>Name</th><th>Description</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} />
                ) : <code>{t.key}</code>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                ) : <b>{t.name}</b>}
              </td>
              <td>
                {editing?.id === t.id ? (
                  <input value={editing.description || ''} style={{ minWidth: 220 }}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                ) : (t.description || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </td>
              <td>{new Date(t.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                {editing?.id === t.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing({ id: t.id, key: t.key, name: t.name, description: t.description })}>Edit</button>
                    <button onClick={() => remove(t)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify manually in the browser**

Open `http://localhost:5173/billing/service-types`, confirm:
- The "Billing" nav group appears in the sidebar with 5 links.
- The 5 seeded service types (ECS, RDS, OBS, Storage, Redis) list.
- Adding a new type (key `test`, name `Test`) appears in the table without a page reload.
- Editing and deleting work.

- [ ] **Step 4: Commit**

```bash
git add "dashboard/app/(app)/billing/service-types/page.jsx" dashboard/components/Shell.jsx
git commit -m "feat(billing): add service types admin page and Billing nav group"
```

---

## Task 9: Frontend — Service inventory page

**Files:**
- Create: `dashboard/app/(app)/billing/services/page.jsx`

**Interfaces:**
- Consumes: `api.billingServices/createBillingService/updateBillingService/retireBillingService/reactivateBillingService` (Task 7), `api.products()` (existing), `api.serviceTypes()` (Task 7), `api.servers()` (existing — each server row already has a `product_id` field, confirmed in `backend/src/servers`'s `list` query joining `product_id`).
- Produces: `/billing/services` route.

- [ ] **Step 1: Create the page**

`dashboard/app/(app)/billing/services/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const BILLING_MODES = ['pay_per_use', 'monthly', 'annual'];

function KeyValueRows({ rows, onChange, keyPlaceholder = 'key', valuePlaceholder = 'value' }) {
  const update = (i, field, value) => {
    const next = rows.slice();
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: '', value: '' }]);

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input placeholder={keyPlaceholder} value={row.key}
            onChange={(e) => update(i, 'key', e.target.value)} />
          <input placeholder={valuePlaceholder} value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)} />
          <button type="button" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ Add</button>
    </div>
  );
}

const EMPTY_FORM = {
  product_id: '', service_type_id: '', name: '', region: '',
  billing_mode: 'monthly', server_id: '', specs: [], tags: [],
};

function toTagsObject(rows) {
  const obj = {};
  for (const r of rows) if (r.key) obj[r.key] = r.value;
  return obj;
}
function tagsObjectToRows(obj = {}) {
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [servers, setServers] = useState([]);
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', status: 'active' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.billingServices(filters).then(setServices).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [filters.product_id, filters.service_type_id, filters.status]);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.serviceTypes().then(setTypes).catch(() => {});
    api.servers().then(setServers).catch(() => {});
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const body = {
      product_id: form.product_id,
      service_type_id: form.service_type_id,
      name: form.name,
      region: form.region || undefined,
      billing_mode: form.billing_mode,
      server_id: form.server_id || undefined,
      specs: form.specs.filter((r) => r.key),
      tags: toTagsObject(form.tags),
    };
    try {
      if (editingId) await api.updateBillingService(editingId, body);
      else await api.createBillingService(body);
      resetForm();
      load();
    } catch (e) { setErr(e.message); }
  };

  const edit = (s) => {
    setEditingId(s.id);
    setForm({
      product_id: s.product_id, service_type_id: s.service_type_id, name: s.name,
      region: s.region || '', billing_mode: s.billing_mode, server_id: s.server_id || '',
      specs: s.specs || [], tags: tagsObjectToRows(s.tags),
    });
  };

  const retire = async (s) => {
    if (!confirm(`Retire "${s.name}"? It will stop appearing in monthly billing entry.`)) return;
    try { await api.retireBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };
  const reactivate = async (s) => {
    try { await api.reactivateBillingService(s.id); load(); } catch (e) { setErr(e.message); }
  };

  const productServers = servers.filter((sv) => !form.product_id || sv.product_id === form.product_id);

  return (
    <div>
      <div className="page-head"><h2>🧾 Services</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
          <option value="">All</option>
        </select>
      </div>

      <form onSubmit={submit} style={{ marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h3>{editingId ? 'Edit service' : 'Add service'}</h3>
        <label>Enterprise Project
          <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value, server_id: '' })}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Service Type
          <select required value={form.service_type_id} onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}>
            <option value="">— select —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Region<input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></label>
        <label>Billing mode
          <select value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })}>
            {BILLING_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Linked server (optional)
          <select value={form.server_id} onChange={(e) => setForm({ ...form, server_id: e.target.value })}>
            <option value="">— none —</option>
            {productServers.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
          </select>
        </label>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Specs</div>
          <KeyValueRows rows={form.specs} onChange={(specs) => setForm({ ...form, specs })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tags</div>
          <KeyValueRows rows={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit">{editingId ? 'Save' : 'Add service'}</button>
          {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
        </div>
      </form>

      <table className="grid">
        <thead>
          <tr><th>Project</th><th>Type</th><th>Name</th><th>Region</th><th>Billing mode</th><th>Server</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} style={{ opacity: s.status === 'retired' ? 0.5 : 1 }}>
              <td>{s.product_name}</td>
              <td>{s.service_type_name}</td>
              <td><b>{s.name}</b></td>
              <td>{s.region || '—'}</td>
              <td>{s.billing_mode}</td>
              <td>{s.server_name || '—'}</td>
              <td>{s.status}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => edit(s)}>Edit</button>
                {s.status === 'active'
                  ? <button onClick={() => retire(s)}>Retire</button>
                  : <button onClick={() => reactivate(s)}>Reactivate</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually in the browser**

Open `http://localhost:5173/billing/services`:
- Create a service under an Enterprise Project with a service type, region, one spec row (`vCPU`/`4`), one tag row (`env`/`live`), no linked server. Confirm it appears in the table.
- Edit it: link it to a server (only servers belonging to the selected project should be selectable), save, confirm `server_name` shows in the table.
- Retire it, confirm it dims and the action flips to "Reactivate"; switch the status filter to "All" to see retired rows.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/(app)/billing/services/page.jsx"
git commit -m "feat(billing): add service inventory page"
```

---

## Task 10: Frontend — Monthly billing entry workflow

**Files:**
- Create: `dashboard/components/MonthlyBillingModal.jsx`
- Create: `dashboard/app/(app)/billing/monthly-entry/page.jsx`

**Interfaces:**
- Consumes: `api.monthlyBillingForm(productId, month)` and `api.bulkBillingRecords(body)` (Task 7); reuses the `.modal-backdrop`/`.modal`/`.modal-actions` CSS from `dashboard/components/RegisterServer.jsx`.
- Produces: `/billing/monthly-entry` route; `MonthlyBillingModal` component (used only here).

- [ ] **Step 1: Create the modal component**

`dashboard/components/MonthlyBillingModal.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function MonthlyBillingModal({ productId, month, onClose, onSaved }) {
  const [form, setForm] = useState(null); // { product, month, services }
  const [entries, setEntries] = useState({}); // service_id -> { amount, notes }
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.monthlyBillingForm(productId, month).then((f) => {
      setForm(f);
      const initial = {};
      for (const s of f.services) {
        initial[s.service_id] = {
          amount: s.existing_record ? String(s.existing_record.amount) : '',
          notes: s.existing_record?.notes || '',
        };
      }
      setEntries(initial);
    }).catch((e) => setErr(e.message));
  }, [productId, month]);

  const setEntry = (serviceId, field, value) =>
    setEntries((e) => ({ ...e, [serviceId]: { ...e[serviceId], [field]: value } }));

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    const body = {
      product_id: productId,
      month,
      entries: Object.entries(entries)
        .filter(([, v]) => v.amount !== '')
        .map(([service_id, v]) => ({ service_id, amount: Number(v.amount), notes: v.notes || undefined })),
    };
    try {
      await api.bulkBillingRecords(body);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <form onSubmit={save}>
          <h3>{form ? `${form.product.name} — ${form.month.slice(0, 7)}` : 'Loading…'}</h3>
          {err && <div className="error">{err}</div>}
          {!form ? (
            <p>Loading services…</p>
          ) : form.services.length === 0 ? (
            <p>No active services due for billing this month.</p>
          ) : (
            <table className="grid">
              <thead><tr><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {form.services.map((s) => (
                  <tr key={s.service_id}>
                    <td>{s.name}</td>
                    <td>{s.service_type}</td>
                    <td>
                      <input type="number" step="0.01" min="0" style={{ width: 100 }}
                        value={entries[s.service_id]?.amount ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'amount', e.target.value)} />
                    </td>
                    <td>
                      <input value={entries[s.service_id]?.notes ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'notes', e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!form || saving || form.services.length === 0}>
              {saving ? 'Saving…' : 'Save all'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

`dashboard/app/(app)/billing/monthly-entry/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import MonthlyBillingModal from '@/components/MonthlyBillingModal';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function MonthlyEntryPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  const load = () => {
    if (!productId) { setErr('Select an Enterprise Project first'); return; }
    setErr('');
    setOpen(true);
  };

  return (
    <div>
      <div className="page-head"><h2>📅 Monthly Billing Entry</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— select Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="month" value={month.slice(0, 7)}
          onChange={(e) => setMonth(`${e.target.value}-01`)} />
        <button onClick={load}>Load services</button>
      </div>

      {open && (
        <MonthlyBillingModal
          productId={productId}
          month={month}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify manually in the browser**

Open `http://localhost:5173/billing/monthly-entry`:
- Select the Enterprise Project used in Task 9, keep the default (current) month, click "Load services" — the modal opens listing the active service(s) created earlier.
- Enter an amount, click "Save all" — modal closes without error.
- Reopen the same project/month — the amount you entered should now pre-fill the input (confirms `existing_record` round-trips).

- [ ] **Step 4: Commit**

```bash
git add dashboard/components/MonthlyBillingModal.jsx "dashboard/app/(app)/billing/monthly-entry/page.jsx"
git commit -m "feat(billing): add monthly billing entry workflow"
```

---

## Task 11: Frontend — Billing history page

**Files:**
- Create: `dashboard/app/(app)/billing/history/page.jsx`

**Interfaces:**
- Consumes: `api.billingRecords`, `api.deleteBillingRecord`, `api.exportBillingRecordsCsv` (Task 7), `api.products()`, `api.serviceTypes()` (Task 7).
- Produces: `/billing/history` route.

- [ ] **Step 1: Create the page**

`dashboard/app/(app)/billing/history/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function BillingHistoryPage() {
  const [records, setRecords] = useState([]);
  const [products, setProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ product_id: '', service_type_id: '', from: '', to: '' });
  const [err, setErr] = useState('');

  const load = () => api.billingRecords(filters).then(setRecords).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [filters.product_id, filters.service_type_id, filters.from, filters.to]);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.serviceTypes().then(setTypes).catch(() => {});
  }, []);

  const remove = async (r) => {
    if (!confirm(`Delete billing record for "${r.service_name}" (${r.billing_month.slice(0, 7)})?`)) return;
    try { await api.deleteBillingRecord(r.id); load(); } catch (e) { setErr(e.message); }
  };

  const exportCsv = async () => {
    try { await api.exportBillingRecordsCsv(filters); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>📜 Billing History</h2>
        <button onClick={exportCsv}>Export CSV</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form" style={{ marginBottom: 16 }}>
        <select value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
          <option value="">— all projects —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.service_type_id} onChange={(e) => setFilters({ ...filters, service_type_id: e.target.value })}>
          <option value="">— all types —</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="month" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="month" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>

      <table className="grid">
        <thead>
          <tr><th>Month</th><th>Project</th><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.billing_month.slice(0, 7)}</td>
              <td>{r.product_name}</td>
              <td>{r.service_name}</td>
              <td>{r.service_type}</td>
              <td>{r.amount}</td>
              <td>{r.notes || '—'}</td>
              <td><button onClick={() => remove(r)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually in the browser**

Open `http://localhost:5173/billing/history`:
- Confirm the record saved in Task 10 appears with the right month/project/service/amount.
- Filter by project and by the `from`/`to` month pickers, confirm the list narrows correctly.
- Click "Export CSV" — a `billing-history.csv` file downloads; open it and confirm the header row and data row match what's on screen.
- Delete the test record, confirm it disappears from the table.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/(app)/billing/history/page.jsx"
git commit -m "feat(billing): add billing history page with CSV export"
```

---

## Task 12: Frontend — Billing dashboard page

**Files:**
- Create: `dashboard/app/(app)/billing/dashboard/page.jsx`

**Interfaces:**
- Consumes: `api.billingDashboardSummary(months)`, `api.billingInsights()` (Task 7); `recharts` (`ResponsiveContainer`, `LineChart`, `Line`, `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid` — same imports as `dashboard/app/(app)/release-metrics/page.jsx`).
- Produces: `/billing/dashboard` route.

- [ ] **Step 1: Create the page**

`dashboard/app/(app)/billing/dashboard/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';

function StatTile({ title, value }) {
  return (
    <div className="card" style={{ flex: '1 1 220px' }}>
      <h4 style={{ margin: 0 }}>{title}</h4>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{value}</div>
    </div>
  );
}

const FLAG_LABEL = {
  downsizing_candidate: 'Downsizing candidate',
  possibly_unused: 'Possibly unused',
};

export default function BillingDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.billingDashboardSummary(6).then(setSummary).catch((e) => setErr(e.message));
    api.billingInsights().then(setInsights).catch(() => {});
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!summary) return <p>Loading…</p>;

  const fmt = (n) => `${summary.currency} ${Number(n).toFixed(2)}`;

  return (
    <div>
      <div className="page-head"><h2>💰 Billing Dashboard</h2></div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile title="Current month total" value={fmt(summary.current_month_total)} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h4>Spend trend</h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={summary.trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9aa4b2' }} tickFormatter={(m) => m.slice(0, 7)} />
            <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
            <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} labelStyle={{ color: '#cbd5e1' }} />
            <Line type="monotone" dataKey="total" stroke="#4f9dff" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {summary.trend.length === 0 && <p className="empty">No billing records yet.</p>}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <h4>By Enterprise Project</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.by_project} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
              <XAxis dataKey="product_name" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
              <Bar dataKey="total" fill="#4f9dff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {summary.by_project.length === 0 && <p className="empty">No billing records this month.</p>}
        </div>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <h4>By Service Type</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.by_service_type} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
              <XAxis dataKey="service_type" tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9aa4b2' }} />
              <Tooltip contentStyle={{ background: '#161a22', border: '1px solid #2a2f3a' }} />
              <Bar dataKey="total" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {summary.by_service_type.length === 0 && <p className="empty">No billing records this month.</p>}
        </div>
      </div>

      <div className="card">
        <h4>Cost Insights</h4>
        {insights.length === 0 ? (
          <p className="empty">No cost flags — nothing looks obviously oversized or unused.</p>
        ) : (
          <table className="grid">
            <thead><tr><th>Service</th><th>Server</th><th>Flag</th><th>Avg CPU</th><th>Avg RAM</th><th>Amount</th><th>Reason</th></tr></thead>
            <tbody>
              {insights.map((f) => (
                <tr key={f.service_id}>
                  <td>{f.service_name}</td>
                  <td>{f.server_name}</td>
                  <td>{FLAG_LABEL[f.flag] || f.flag}</td>
                  <td>{f.avg_cpu != null ? `${f.avg_cpu.toFixed(1)}%` : '—'}</td>
                  <td>{f.avg_ram != null ? `${f.avg_ram.toFixed(1)}%` : '—'}</td>
                  <td>{fmt(f.amount)}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually in the browser**

Open `http://localhost:5173/billing/dashboard`:
- The "Current month total" stat tile renders (0.00 is fine if nothing's billed this calendar month).
- The trend chart renders with the empty-state message if there's no data yet, or a line if you've saved a record for the current month via Task 10.
- The two breakdown bar charts render (or show their empty state).
- The Cost Insights table shows its empty state (no linked/billed services from last month yet) — this is expected at this point in verification.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/(app)/billing/dashboard/page.jsx"
git commit -m "feat(billing): add billing dashboard with trend, breakdowns, and cost insights"
```

---

## Task 13: Frontend — global currency setting

**Files:**
- Modify: `dashboard/app/(app)/settings/page.jsx`

**Interfaces:**
- Consumes: `api.getSettings()`/`api.saveSettings()` (existing, already returns/accepts `billing_currency` since it's a flat `platform_settings` map — no backend change needed); `Section`/`Field` from `dashboard/components/SettingsUI.jsx`; `getRole` from `dashboard/lib/api.js` (already imported at the top of this file).

- [ ] **Step 1: Add the `BillingCurrencySection` component**

In `dashboard/app/(app)/settings/page.jsx`, add this function after `SmtpSection` (before `export default function SettingsPage()`):

```jsx
// ── Billing Section ───────────────────────────────────────────────────────
function BillingCurrencySection() {
  const isAdmin = getRole() === 'admin';
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.getSettings().then((s) => setCurrency(s.billing_currency || 'USD'))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings({ billing_currency: currency });
      setToast('Saved');
      setTimeout(() => setToast(''), 3000);
    } catch (e) { setToast(e.message); }
    setSaving(false);
  };

  if (loading) return null;

  return (
    <Section title="Billing" description="Global currency used across the Billing dashboard and reports.">
      <Field label="Currency" hint="e.g. USD, LKR — applies to every billing amount platform-wide.">
        <input value={currency} disabled={!isAdmin} style={{ width: 100 }}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        {isAdmin && <button onClick={save} disabled={saving} style={{ marginLeft: 8 }}>{saving ? 'Saving…' : 'Save'}</button>}
        {toast && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>{toast}</span>}
      </Field>
    </Section>
  );
}
```

- [ ] **Step 2: Render it on the page**

Modify the `SettingsPage` component's return block:

```jsx
      <ThemeSection />
      <SmtpSection />
      <BillingCurrencySection />
```

- [ ] **Step 3: Verify manually in the browser**

Open `http://localhost:5173/settings` as admin:
- A new "Billing" section shows with a "Currency" field pre-filled `USD`.
- Change it to `LKR`, click "Save", confirm the "Saved" toast appears.
- Reload the page — the field still shows `LKR` (persisted).
- Reopen `http://localhost:5173/billing/dashboard` — the "Current month total" stat tile now shows the `LKR` prefix instead of `USD`.
- Set it back to `USD` for consistency with the rest of this plan's manual-verification steps.

- [ ] **Step 4: Commit**

```bash
git add "dashboard/app/(app)/settings/page.jsx"
git commit -m "feat(billing): add global currency setting to Settings page"
```

---

## Task 14: Documentation

**Files:**
- Modify: `README.md` (add a "Billing Management" section)

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Add the section**

In `README.md`, insert a new section after `## Alerting` and before `## Security notes`:

```markdown
## Billing Management

Tracks cloud service cost per Enterprise Project (the existing `products`
table doubles as "Enterprise Project"):

1. **Service Types** (`/billing/service-types`) — an admin-managed catalog
   (ECS, RDS, OBS, Storage, Redis, …).
2. **Services** (`/billing/services`) — the inventory: one row per cloud
   service instance, with project, type, region, structured specs, billing
   mode (`pay_per_use` / `monthly` / `annual`), optional tags, and an
   optional link to a monitored server.
3. **Monthly Entry** (`/billing/monthly-entry`) — pick a project + month,
   fill in the billed amount for every service due that month in one pass.
4. **Billing History** (`/billing/history`) — filterable record history +
   CSV export.
5. **Billing Dashboard** (`/billing/dashboard`) — current month total,
   spend trend, breakdowns by project/service type, and rule-based cost
   insights (flags services whose linked server is idle or offline but
   still billed).

Global currency is set once, in Settings → Billing.

Backend routes: `GET/POST /api/v1/billing/service-types`,
`GET/POST/PATCH /api/v1/billing/services` (+ `/:id/retire`,
`/:id/reactivate`), `GET /api/v1/billing/monthly-form`,
`POST /api/v1/billing/records/bulk`, `GET/PATCH/DELETE
/api/v1/billing/records[/:id]`, `GET /api/v1/billing/records/export.csv`,
`GET /api/v1/billing/dashboard/summary`,
`GET /api/v1/billing/dashboard/insights`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(billing): document the Billing Management module"
```
