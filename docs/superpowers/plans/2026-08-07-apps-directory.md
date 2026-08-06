# Apps Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Server → App → Env Vars/Config directory: which apps run on which monitored servers, each app's per-server nginx/php-fpm/php.ini config, and app-scoped (optionally channel-scoped) environment variables/secrets.

**Architecture:** New `apps`, `server_apps`, and `app_env_vars` tables, all living in the existing `backend/src/release/` module (reuses `repositories`, `channels`, and the `common/crypto.util` secret-encryption pattern already there). Frontend adds an `/apps` list page, an `/apps/[id]` detail page, and a "Hosted Apps" section on the existing server detail page, sharing one new config-editor component between the two.

**Tech Stack:** NestJS 10, raw `pg` queries via `PG_POOL`, `class-validator`, PostgreSQL, Next.js 14 app router, plain React (no test framework on the frontend).

## Global Constraints

- Raw `pg.Pool` queries via `PG_POOL` (global, from `DatabaseModule`) — no ORM, matches every existing module.
- Foreign-key-shaped body fields use `@IsUUID()` (matches `notifications/dto.ts`, the billing module's `services.controller.ts`).
- Plain CRUD (apps, server_apps linking) is guarded with `@Roles('admin', 'operator')` from `backend/src/common/jwt-auth.guard.ts` — matches `repositories.controller.ts`. Env var/secret writes use the stricter `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission('settings.manage')` — matches `environment.controller.ts` exactly, since this is the same class of sensitive data.
- Secrets are encrypted via `encryptSecret`/`decryptSecret` from `backend/src/common/crypto.util.ts` (AES-256-GCM, key derived from `TOKEN_ENC_KEY`). Never return `value_plain` or a decrypted value for a secret row from any list endpoint — only `has_value: boolean`.
- **Test only real logic, not CRUD** (established codebase convention — see `products`/`topology` with zero spec files vs. `environment.service.spec.ts` covering `EnvironmentService`'s masking/encryption/dedup in detail). `apps.service.ts` and `server-apps.service.ts` get no spec file, just manual `curl` verification; `app-env-vars.service.ts` gets a full TDD pass mirroring `environment.service.spec.ts`.
- Migrations are idempotent SQL (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), wired into `backend/scripts/migrate.js` via a `<NAME>_MIGRATION_PATH` env var with a `path.resolve(__dirname, ...)` fallback — no `docker-compose.yml` edit needed (the whole `./database` folder is already bind-mounted).
- **This repo's path contains `&`**, which breaks `npx.cmd` invoked directly from a Windows shell here. Run backend tests via `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest <pattern>` with the dev stack up (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`).
- Frontend has no test framework — verify manually in the browser (or via `curl` against the API first, then a browser pass).
- Frontend reuses existing global CSS classes verbatim: `page-head`, `inline-form`, `grid` (table), `error`, `hint`, `empty`, `card`. Do not redefine them.
- `dashboard/lib/api.js`'s `req()` helper already attaches `Authorization: Bearer <jwt>` and handles 401 redirect — every new method must go through it.

---

## Task 1: Database migration

**Files:**
- Create: `database/apps_migration.sql`
- Modify: `backend/scripts/migrate.js` (add wiring block before the admin-seed block at the end)

**Interfaces:**
- Produces: tables `apps`, `server_apps`, `app_env_vars`. Every later task's SQL depends on these exact table/column names.

- [ ] **Step 1: Write the migration file**

```sql
-- =====================================================================
-- Apps directory: which apps run on which monitored server, per-server
-- nginx/php-fpm/php.ini config, and app-scoped (optionally channel-
-- scoped) environment variables/secrets.
-- Apply after release_migration.sql (repositories, products, channels)
-- and environment_secrets_migration.sql (crypto pattern precedent).
--   psql -U monitor -d monitoring -f database/apps_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS apps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_product ON apps (product_id);
CREATE INDEX IF NOT EXISTS idx_apps_repository ON apps (repository_id);

CREATE TABLE IF NOT EXISTS server_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  app_id          UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  nginx_config    TEXT,
  php_fpm_config  TEXT,
  php_ini_config  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, app_id)
);
CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps (server_id);
CREATE INDEX IF NOT EXISTS idx_server_apps_app ON server_apps (app_id);

CREATE TABLE IF NOT EXISTS app_env_vars (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  channel_id  UUID REFERENCES channels(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value_enc   TEXT,
  value_plain TEXT,
  is_secret   BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, channel_id, key)
);
CREATE INDEX IF NOT EXISTS idx_app_env_vars_app ON app_env_vars (app_id);
```

- [ ] **Step 2: Wire it into `backend/scripts/migrate.js`**

Insert this block right before the `const email = process.env.ADMIN_EMAIL ...` line at the end of the file:

```js
  // Apply apps-directory migration (idempotent — IF NOT EXISTS). Must run
  // after release_migration.sql (repositories, products, channels) and
  // schema.sql (servers, users).
  const appsPath =
    process.env.APPS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/apps_migration.sql');
  if (fs.existsSync(appsPath)) {
    console.log('Applying apps-directory migration...');
    await client.query(fs.readFileSync(appsPath, 'utf8'));
  }
```

- [ ] **Step 3: Apply it against the running dev database and verify**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend node scripts/migrate.js
```

Expected: log lines ending in `Applying apps-directory migration...` then `Admin ready: ...` / `Done.`, no errors.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec db psql -U monitor -d monitoring -c "\d apps" -c "\d server_apps" -c "\d app_env_vars"
```

Expected: all three table descriptions printed with the columns above.

- [ ] **Step 4: Commit**

```bash
git add database/apps_migration.sql backend/scripts/migrate.js
git commit -m "feat(apps): add apps directory migration (apps, server_apps, app_env_vars)"
```

---

## Task 2: Backend — apps CRUD + reverse server lookup

**Files:**
- Create: `backend/src/release/apps.service.ts`
- Create: `backend/src/release/apps.controller.ts`
- Modify: `backend/src/release/release.module.ts` (register both)

**Interfaces:**
- Consumes: `PG_POOL`; tables from Task 1; `products`, `repositories`, `servers`, `server_apps` tables.
- Produces: `AppsService.list()`, `.get(id)`, `.create(input, userId)`, `.update(id, patch)`, `.remove(id)`, `.listServers(appId)`, returning `AppRow { id, name, description, product_id, product_name, repository_id, repository_name, created_at }` and `AppServerRow { id, server_app_id, name, hostname, status, nginx_config, php_fpm_config, php_ini_config }`. Routes: `GET/POST /apps`, `GET/PATCH/DELETE /apps/:id`, `GET /apps/:id/servers` — Tasks 8–9's frontend calls these by exact path.

- [ ] **Step 1: Implement the service**

`backend/src/release/apps.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface AppRow {
  id: string;
  name: string;
  description: string | null;
  product_id: string | null;
  product_name: string | null;
  repository_id: string | null;
  repository_name: string | null;
  created_at: string;
}

export interface AppServerRow {
  id: string;
  server_app_id: string;
  name: string;
  hostname: string | null;
  status: string;
  nginx_config: string | null;
  php_fpm_config: string | null;
  php_ini_config: string | null;
}

export interface AppInput {
  name: string;
  description?: string;
  product_id?: string;
  repository_id?: string;
}

const LIST_SELECT = `
  SELECT a.id, a.name, a.description, a.product_id, p.name AS product_name,
         a.repository_id, r.name AS repository_name, a.created_at
    FROM apps a
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN repositories r ON r.id = a.repository_id`;

@Injectable()
export class AppsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<AppRow[]> {
    const { rows } = await this.pool.query(`${LIST_SELECT} ORDER BY a.name`);
    return rows;
  }

  async get(id: string): Promise<AppRow> {
    const { rows } = await this.pool.query(`${LIST_SELECT} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('App not found');
    return rows[0];
  }

  async create(input: AppInput, userId: string): Promise<AppRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO apps (name, description, product_id, repository_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.name, input.description ?? null, input.product_id ?? null, input.repository_id ?? null, userId],
    );
    return this.get(rows[0].id);
  }

  async update(id: string, patch: Partial<AppInput>): Promise<AppRow> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.product_id !== undefined) push('product_id', patch.product_id);
    if (patch.repository_id !== undefined) push('repository_id', patch.repository_id);
    if (sets.length === 0) return this.get(id);
    params.push(id);
    const { rowCount } = await this.pool.query(
      `UPDATE apps SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (!rowCount) throw new NotFoundException('App not found');
    return this.get(id);
  }

  async remove(id: string): Promise<{ deleted: string }> {
    const { rowCount } = await this.pool.query('DELETE FROM apps WHERE id = $1', [id]);
    if (!rowCount) throw new NotFoundException('App not found');
    return { deleted: id };
  }

  /** Servers hosting this app, with their per-server config (reverse of ServerAppsService.list). */
  async listServers(appId: string): Promise<AppServerRow[]> {
    const { rows } = await this.pool.query(
      `SELECT sv.id, sa.id AS server_app_id, sv.name, sv.hostname, sv.status,
              sa.nginx_config, sa.php_fpm_config, sa.php_ini_config
         FROM server_apps sa
         JOIN servers sv ON sv.id = sa.server_id
        WHERE sa.app_id = $1
        ORDER BY sv.name`,
      [appId],
    );
    return rows;
  }
}
```

- [ ] **Step 2: Implement the controller**

`backend/src/release/apps.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { AppsService } from './apps.service';

class CreateAppDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() repository_id?: string;
}
class UpdateAppDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() repository_id?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  list() {
    return this.apps.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.apps.get(id);
  }

  @Get(':id/servers')
  listServers(@Param('id') id: string) {
    return this.apps.listServers(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateAppDto, @Req() req: any) {
    return this.apps.create(dto, req.user.sub);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.apps.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apps.remove(id);
  }
}
```

- [ ] **Step 3: Register in `release.module.ts`**

Add to `backend/src/release/release.module.ts`: import `AppsService` from `./apps.service` and `AppsController` from `./apps.controller`; add `AppsService` to `providers`, `AppsController` to `controllers`.

- [ ] **Step 4: Verify manually against the running dev stack**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs backend --tail 10
```

Expected: `Mapped {/api/v1/apps, GET}`, `{/api/v1/apps/:id/servers, GET}`, etc. — no compile errors.

```bash
TOKEN=$(cat /tmp/token.txt)   # reuse the session token from earlier in this conversation, or re-login
curl -s -X POST http://localhost:4000/api/v1/apps -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"oms auth layer"}'
curl -s http://localhost:4000/api/v1/apps -H "Authorization: Bearer $TOKEN"
```

Expected: create returns `{"id":"...","name":"oms auth layer","description":null,"product_id":null,"product_name":null,"repository_id":null,"repository_name":null,"created_at":"..."}`; list includes it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/apps.service.ts backend/src/release/apps.controller.ts backend/src/release/release.module.ts
git commit -m "feat(apps): add apps CRUD + reverse server lookup"
```

---

## Task 3: Backend — server ↔ app linking + per-pairing config

**Files:**
- Create: `backend/src/release/server-apps.service.ts`
- Create: `backend/src/release/server-apps.controller.ts`
- Modify: `backend/src/release/release.module.ts`

**Interfaces:**
- Consumes: `PG_POOL`; `server_apps`, `apps`, `servers` tables.
- Produces: `ServerAppsService.list(serverId)`, `.link(serverId, input)`, `.updateConfig(serverId, appId, patch)`, `.unlink(serverId, appId)`, returning `ServerAppRow { id, app_id, app_name, app_description, nginx_config, php_fpm_config, php_ini_config, created_at, updated_at }`. Routes: `GET/POST /servers/:id/apps`, `PATCH/DELETE /servers/:id/apps/:appId` — Task 10's frontend calls these by exact path; Task 9's frontend also calls `POST`/`PATCH`/`DELETE` (linking/config-saving/unlinking from the app's side of the same relationship).

- [ ] **Step 1: Implement the service**

`backend/src/release/server-apps.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface ServerAppRow {
  id: string;
  app_id: string;
  app_name: string;
  app_description: string | null;
  nginx_config: string | null;
  php_fpm_config: string | null;
  php_ini_config: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerAppInput {
  app_id: string;
  nginx_config?: string;
  php_fpm_config?: string;
  php_ini_config?: string;
}

const SELECT = `
  SELECT sa.id, sa.app_id, a.name AS app_name, a.description AS app_description,
         sa.nginx_config, sa.php_fpm_config, sa.php_ini_config, sa.created_at, sa.updated_at
    FROM server_apps sa
    JOIN apps a ON a.id = sa.app_id`;

@Injectable()
export class ServerAppsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(serverId: string): Promise<ServerAppRow[]> {
    const { rows } = await this.pool.query(
      `${SELECT} WHERE sa.server_id = $1 ORDER BY a.name`, [serverId]);
    return rows;
  }

  private async getOne(id: string): Promise<ServerAppRow> {
    const { rows } = await this.pool.query(`${SELECT} WHERE sa.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Server app link not found');
    return rows[0];
  }

  async link(serverId: string, input: ServerAppInput): Promise<ServerAppRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO server_apps (server_id, app_id, nginx_config, php_fpm_config, php_ini_config)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [serverId, input.app_id, input.nginx_config ?? null, input.php_fpm_config ?? null, input.php_ini_config ?? null],
    );
    return this.getOne(rows[0].id);
  }

  async updateConfig(
    serverId: string,
    appId: string,
    patch: Partial<Omit<ServerAppInput, 'app_id'>>,
  ): Promise<ServerAppRow> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.nginx_config !== undefined) push('nginx_config', patch.nginx_config);
    if (patch.php_fpm_config !== undefined) push('php_fpm_config', patch.php_fpm_config);
    if (patch.php_ini_config !== undefined) push('php_ini_config', patch.php_ini_config);
    sets.push('updated_at = now()');
    params.push(serverId, appId);
    const { rows } = await this.pool.query(
      `UPDATE server_apps SET ${sets.join(', ')}
        WHERE server_id = $${params.length - 1} AND app_id = $${params.length}
        RETURNING id`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Server app link not found');
    return this.getOne(rows[0].id);
  }

  async unlink(serverId: string, appId: string): Promise<{ deleted: true }> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM server_apps WHERE server_id = $1 AND app_id = $2', [serverId, appId]);
    if (!rowCount) throw new NotFoundException('Server app link not found');
    return { deleted: true };
  }
}
```

- [ ] **Step 2: Implement the controller**

`backend/src/release/server-apps.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ServerAppsService } from './server-apps.service';

class LinkServerAppDto {
  @IsUUID() app_id!: string;
  @IsOptional() @IsString() nginx_config?: string;
  @IsOptional() @IsString() php_fpm_config?: string;
  @IsOptional() @IsString() php_ini_config?: string;
}
class UpdateServerAppDto {
  @IsOptional() @IsString() nginx_config?: string;
  @IsOptional() @IsString() php_fpm_config?: string;
  @IsOptional() @IsString() php_ini_config?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServerAppsController {
  constructor(private readonly serverApps: ServerAppsService) {}

  @Get(':id/apps')
  list(@Param('id') serverId: string) {
    return this.serverApps.list(serverId);
  }

  @Roles('admin', 'operator')
  @Post(':id/apps')
  link(@Param('id') serverId: string, @Body() dto: LinkServerAppDto) {
    return this.serverApps.link(serverId, dto);
  }

  @Roles('admin', 'operator')
  @Patch(':id/apps/:appId')
  update(@Param('id') serverId: string, @Param('appId') appId: string, @Body() dto: UpdateServerAppDto) {
    return this.serverApps.updateConfig(serverId, appId, dto);
  }

  @Roles('admin', 'operator')
  @Delete(':id/apps/:appId')
  unlink(@Param('id') serverId: string, @Param('appId') appId: string) {
    return this.serverApps.unlink(serverId, appId);
  }
}
```

- [ ] **Step 3: Register in `release.module.ts`**

Add `ServerAppsService` to `providers`, `ServerAppsController` to `controllers`.

- [ ] **Step 4: Verify manually**

```bash
TOKEN=$(cat /tmp/token.txt)
APP_ID=$(curl -s http://localhost:4000/api/v1/apps -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
SERVER_ID=$(curl -s http://localhost:4000/api/v1/servers -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
curl -s -X POST http://localhost:4000/api/v1/servers/$SERVER_ID/apps -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"app_id\":\"$APP_ID\",\"nginx_config\":\"server { listen 80; }\"}"
curl -s http://localhost:4000/api/v1/servers/$SERVER_ID/apps -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/v1/apps/$APP_ID/servers -H "Authorization: Bearer $TOKEN"
```

Expected: link created with the nginx_config stored; both list directions (`servers/:id/apps` and `apps/:id/servers`) return the same pairing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/server-apps.service.ts backend/src/release/server-apps.controller.ts backend/src/release/release.module.ts
git commit -m "feat(apps): add server<->app linking with per-pairing nginx/php-fpm/php.ini config"
```

---

## Task 4: Backend — app-scoped env vars/secrets (TDD)

**Files:**
- Create: `backend/src/release/app-env-vars.service.ts`
- Create: `backend/src/release/app-env-vars.service.spec.ts`

**Interfaces:**
- Consumes: `PG_POOL`; `encryptSecret` from `backend/src/common/crypto.util.ts`; `app_env_vars`, `channels` tables.
- Produces: `AppEnvVarsService.listEnvVars(appId, channelId?)`, `.upsertEnvVar(appId, input)`, `.deleteEnvVar(appId, id)`. `channelId` accepts a channel UUID, the literal string `'none'` (meaning "only channel-less rows"), or `undefined` (meaning "no filter — every row for this app"). Task 5's controller passes the raw query-string value straight through.

- [ ] **Step 1: Write the failing spec**

`backend/src/release/app-env-vars.service.spec.ts` (mirrors `environment.service.spec.ts`'s structure):

```ts
import { AppEnvVarsService } from './app-env-vars.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new AppEnvVarsService(pool);
  return { svc, query };
}

const OLD_ENV = process.env;
beforeEach(() => { process.env = { ...OLD_ENV, TOKEN_ENC_KEY: 'test-key-for-encryption' }; });
afterAll(() => { process.env = OLD_ENV; });

describe('AppEnvVarsService.listEnvVars', () => {
  it('masks secret values but passes through plain ones', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [
        { id: 'v1', app_id: 'a1', channel_id: null, key: 'API_URL', is_secret: false, value_plain: 'https://x', has_value: true, channel_name: null, updated_at: null },
        { id: 'v2', app_id: 'a1', channel_id: 'ch1', key: 'API_KEY', is_secret: true, value_plain: null, has_value: true, channel_name: 'Production', updated_at: null },
      ],
    });
    const result = await svc.listEnvVars('a1');
    expect(result[0]).toMatchObject({ key: 'API_URL', value: 'https://x', has_value: true });
    expect(result[1]).toMatchObject({ key: 'API_KEY', value: null, has_value: true, channel_name: 'Production' });
  });

  it('filters to only channel-less rows when channelId is "none"', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listEnvVars('a1', 'none');
    expect(query.mock.calls[0][0]).toContain('aev.channel_id IS NULL');
    expect(query.mock.calls[0][1]).toEqual(['a1']);
  });

  it('filters to a specific channel when a channel id is given', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listEnvVars('a1', 'ch1');
    expect(query.mock.calls[0][1]).toEqual(['a1', 'ch1']);
  });
});

describe('AppEnvVarsService.upsertEnvVar', () => {
  it('rejects a missing key or value', async () => {
    const { svc, query } = makeService();
    await expect(svc.upsertEnvVar('a1', { key: '', value: 'x' })).rejects.toThrow('key is required');
    await expect(svc.upsertEnvVar('a1', { key: 'K', value: '' })).rejects.toThrow('value is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts a new plain var when none exists yet', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    const result = await svc.upsertEnvVar('a1', { key: 'API_URL', value: 'https://x' });
    expect(result.id).toBe('v1');
    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO app_env_vars');
  });

  it('encrypts the value when is_secret is true', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await svc.upsertEnvVar('a1', { key: 'API_KEY', value: 'super-secret', is_secret: true });
    const insertCall = query.mock.calls[1];
    const [, , , valueEnc, valuePlain, isSecret] = insertCall[1];
    expect(isSecret).toBe(true);
    expect(valuePlain).toBeNull();
    expect(valueEnc).not.toBe('super-secret');
    expect(valueEnc).toContain(':'); // iv:tag:ciphertext format
  });

  it('updates in place when a matching (app, channel, key) row already exists, using IS NOT DISTINCT FROM for the channel-less case', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await svc.upsertEnvVar('a1', { key: 'API_URL', value: 'https://y' });
    const existsCall = query.mock.calls[0];
    expect(existsCall[0]).toContain('IS NOT DISTINCT FROM');
    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE app_env_vars');
  });
});

describe('AppEnvVarsService.deleteEnvVar', () => {
  it('throws NotFoundException when nothing was deleted', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(svc.deleteEnvVar('a1', 'v1')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest app-env-vars.service.spec.ts
```

Expected: FAIL — `Cannot find module './app-env-vars.service'`.

- [ ] **Step 3: Implement the service**

`backend/src/release/app-env-vars.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { encryptSecret } from '../common/crypto.util';

export interface UpsertAppEnvVarInput {
  key: string;
  value: string;
  is_secret?: boolean;
  channel_id?: string;
}

@Injectable()
export class AppEnvVarsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Masked list for the UI: secret values never leave the server. */
  async listEnvVars(appId: string, channelId?: string) {
    const where: string[] = ['aev.app_id = $1'];
    const params: any[] = [appId];
    if (channelId === 'none') {
      where.push('aev.channel_id IS NULL');
    } else if (channelId) {
      params.push(channelId);
      where.push(`aev.channel_id = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT aev.id, aev.app_id, aev.channel_id, aev.key, aev.is_secret,
              aev.value_plain, (aev.value_enc IS NOT NULL) AS has_value,
              c.name AS channel_name, aev.updated_at
         FROM app_env_vars aev
         LEFT JOIN channels c ON c.id = aev.channel_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.name NULLS FIRST, aev.key`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      app_id: r.app_id,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      key: r.key,
      is_secret: r.is_secret,
      value: r.is_secret ? null : r.value_plain,
      has_value: r.is_secret ? r.has_value : true,
      updated_at: r.updated_at,
    }));
  }

  async upsertEnvVar(appId: string, input: UpsertAppEnvVarInput) {
    const key = input.key?.trim();
    if (!key) throw new BadRequestException('key is required');
    if (input.value === undefined || input.value === null || input.value === '') {
      throw new BadRequestException('value is required');
    }
    const isSecret = !!input.is_secret;
    const channelId = input.channel_id || null;

    // Postgres UNIQUE(app_id, channel_id, key) doesn't catch duplicate NULL
    // channel_id rows (NULLs are distinct to it) — check explicitly.
    const existing = await this.pool.query(
      `SELECT id FROM app_env_vars
        WHERE app_id = $1 AND channel_id IS NOT DISTINCT FROM $2 AND key = $3`,
      [appId, channelId, key],
    );

    const valueEnc = isSecret ? encryptSecret(input.value) : null;
    const valuePlain = isSecret ? null : input.value;

    if (existing.rows[0]) {
      const { rows } = await this.pool.query(
        `UPDATE app_env_vars
            SET value_enc = $2, value_plain = $3, is_secret = $4, updated_at = now()
          WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, valueEnc, valuePlain, isSecret],
      );
      return rows[0];
    }
    const { rows } = await this.pool.query(
      `INSERT INTO app_env_vars (app_id, channel_id, key, value_enc, value_plain, is_secret)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [appId, channelId, key, valueEnc, valuePlain, isSecret],
    );
    return rows[0];
  }

  async deleteEnvVar(appId: string, id: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM app_env_vars WHERE id = $1 AND app_id = $2`,
      [id, appId],
    );
    if (!rowCount) throw new NotFoundException('Env var not found');
    return { deleted: true };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest app-env-vars.service.spec.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/app-env-vars.service.ts backend/src/release/app-env-vars.service.spec.ts
git commit -m "feat(apps): add app-scoped env vars/secrets service"
```

---

## Task 5: Backend — app env vars controller + final module wiring

**Files:**
- Create: `backend/src/release/app-env-vars.controller.ts`
- Modify: `backend/src/release/release.module.ts`

**Interfaces:**
- Consumes: `AppEnvVarsService` (Task 4); `PermissionGuard`/`RequirePermission` from `backend/src/access/` (already imported into `ReleaseModule` via `AccessModule`).
- Produces: `GET /apps/:id/env-vars?channel_id=`, `POST /apps/:id/env-vars`, `DELETE /apps/:id/env-vars/:varId` — Task 9's frontend calls these by exact path.

- [ ] **Step 1: Implement the controller**

`backend/src/release/app-env-vars.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AppEnvVarsService } from './app-env-vars.service';

class UpsertAppEnvVarDto {
  @IsString() key!: string;
  @IsString() value!: string;
  @IsOptional() @IsBoolean() is_secret?: boolean;
  @IsOptional() @IsString() channel_id?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('apps')
export class AppEnvVarsController {
  constructor(private readonly envVars: AppEnvVarsService) {}

  @Get(':id/env-vars')
  list(@Param('id') appId: string, @Query('channel_id') channelId?: string) {
    return this.envVars.listEnvVars(appId, channelId);
  }

  @Post(':id/env-vars')
  @RequirePermission('settings.manage')
  upsert(@Param('id') appId: string, @Body() dto: UpsertAppEnvVarDto) {
    return this.envVars.upsertEnvVar(appId, dto);
  }

  @Delete(':id/env-vars/:varId')
  @RequirePermission('settings.manage')
  remove(@Param('id') appId: string, @Param('varId') varId: string) {
    return this.envVars.deleteEnvVar(appId, varId);
  }
}
```

- [ ] **Step 2: Register in `release.module.ts` (final version)**

Add `AppEnvVarsService` to `providers`, `AppEnvVarsController` to `controllers`. At this point `release.module.ts`'s relevant sections should read:

```ts
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
    AppsService,
    ServerAppsService,
    AppEnvVarsService,
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
    AppsController,
    ServerAppsController,
    AppEnvVarsController,
  ],
```

(Plus the three corresponding `import` lines at the top of the file.)

- [ ] **Step 3: Run the full backend test suite and verify manually**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec backend npx jest
```

Expected: PASS, all suites including the new `app-env-vars.service.spec.ts` (8 tests).

```bash
TOKEN=$(cat /tmp/token.txt)
APP_ID=$(curl -s http://localhost:4000/api/v1/apps -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
curl -s -X POST http://localhost:4000/api/v1/apps/$APP_ID/env-vars -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"APP_ENV","value":"production"}'
curl -s "http://localhost:4000/api/v1/apps/$APP_ID/env-vars" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:4000/api/v1/apps/$APP_ID/env-vars?channel_id=none" -H "Authorization: Bearer $TOKEN"
```

Expected: upsert succeeds; both list calls return the `APP_ENV` var (since it was created with no `channel_id`, matching both "no filter" and `channel_id=none`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/release/app-env-vars.controller.ts backend/src/release/release.module.ts
git commit -m "feat(apps): wire up app env vars controller"
```

---

## Task 6: Frontend — API client methods

**Files:**
- Modify: `dashboard/lib/api.js`

**Interfaces:**
- Consumes: exact backend routes from Tasks 2–5.
- Produces: `api.apps()`, `.app()`, `.createApp()`, `.updateApp()`, `.deleteApp()`, `.appServers()`, `.serverApps()`, `.linkServerApp()`, `.updateServerApp()`, `.unlinkServerApp()`, `.appEnvVars()`, `.upsertAppEnvVar()`, `.deleteAppEnvVar()` — Tasks 7–10 call these by exact name.

- [ ] **Step 1: Add the methods**

Insert before the final `};` in `dashboard/lib/api.js`:

```js
  // ── Apps directory ──────────────────────────────────────────────────
  apps: () => req('/apps'),
  app: (id) => req(`/apps/${id}`),
  createApp: (body) => req('/apps', { method: 'POST', body: JSON.stringify(body) }),
  updateApp: (id, body) => req(`/apps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteApp: (id) => req(`/apps/${id}`, { method: 'DELETE' }),
  appServers: (appId) => req(`/apps/${appId}/servers`),
  serverApps: (serverId) => req(`/servers/${serverId}/apps`),
  linkServerApp: (serverId, body) => req(`/servers/${serverId}/apps`, { method: 'POST', body: JSON.stringify(body) }),
  updateServerApp: (serverId, appId, body) => req(`/servers/${serverId}/apps/${appId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  unlinkServerApp: (serverId, appId) => req(`/servers/${serverId}/apps/${appId}`, { method: 'DELETE' }),
  appEnvVars: (appId, channelId) => req(`/apps/${appId}/env-vars` + (channelId ? `?channel_id=${channelId}` : '')),
  upsertAppEnvVar: (appId, body) => req(`/apps/${appId}/env-vars`, { method: 'POST', body: JSON.stringify(body) }),
  deleteAppEnvVar: (appId, varId) => req(`/apps/${appId}/env-vars/${varId}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Verify it compiles**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs dashboard --tail 20
```

Expected: no new compile errors after the file save (Next's dev server hot-reloads and would log a syntax error if the edit broke the file).

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.js
git commit -m "feat(apps): add apps directory API client methods"
```

---

## Task 7: Frontend — shared server/app config editor component

**Files:**
- Create: `dashboard/components/ServerAppConfigCard.jsx`

**Interfaces:**
- Consumes: nothing new (plain React).
- Produces: `<ServerAppConfigCard title={string} config={{ nginx_config, php_fpm_config, php_ini_config }} onSave={(edits) => Promise} onUnlink={() => void}>` — Tasks 9 and 10 both render this component (once for "servers hosting this app", once for "apps hosted on this server") to avoid duplicating the three-textarea editor.

- [ ] **Step 1: Create the component**

`dashboard/components/ServerAppConfigCard.jsx`:

```jsx
'use client';
import { useState } from 'react';

export default function ServerAppConfigCard({ title, config, onSave, onUnlink }) {
  const [edits, setEdits] = useState({
    nginx_config: config.nginx_config || '',
    php_fpm_config: config.php_fpm_config || '',
    php_ini_config: config.php_ini_config || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    setSaving(true);
    try { await onSave(edits); } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{title}</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save config'}</button>
          <button style={{ background: '#f87171' }} onClick={onUnlink}>Unlink</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <label style={{ display: 'block', marginTop: 8 }}>Nginx config
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.nginx_config} onChange={(e) => setEdits({ ...edits, nginx_config: e.target.value })} />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>PHP-FPM config
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.php_fpm_config} onChange={(e) => setEdits({ ...edits, php_fpm_config: e.target.value })} />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>php.ini
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.php_ini_config} onChange={(e) => setEdits({ ...edits, php_ini_config: e.target.value })} />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/components/ServerAppConfigCard.jsx
git commit -m "feat(apps): add shared server/app config editor component"
```

---

## Task 8: Frontend — Apps list page + nav link

**Files:**
- Create: `dashboard/app/(app)/apps/page.jsx`
- Modify: `dashboard/components/Shell.jsx` (add nav link)

**Interfaces:**
- Consumes: `api.apps/createApp/updateApp/deleteApp` (Task 6), `api.products()`/`api.repositories()` (existing).
- Produces: `/apps` route, linking to `/apps/[id]` (Task 9).

- [ ] **Step 1: Add the nav link**

In `dashboard/components/Shell.jsx`, add this line right after the `/products` entry in the "Monitoring" section:

```jsx
        { href: '/apps',                 label: '🗂️ Apps' },
```

- [ ] **Step 2: Create the page**

`dashboard/app/(app)/apps/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const EMPTY_FORM = { name: '', description: '', product_id: '', repository_id: '' };

export default function AppsPage() {
  const [apps, setApps] = useState([]);
  const [products, setProducts] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.apps().then(setApps).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
    api.repositories().then(setRepositories).catch(() => {});
  }, []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const body = {
      name: form.name,
      description: form.description || undefined,
      product_id: form.product_id || undefined,
      repository_id: form.repository_id || undefined,
    };
    try {
      if (editingId) await api.updateApp(editingId, body);
      else await api.createApp(body);
      resetForm();
      load();
    } catch (e) { setErr(e.message); }
  };

  const edit = (a) => {
    setEditingId(a.id);
    setForm({
      name: a.name, description: a.description || '',
      product_id: a.product_id || '', repository_id: a.repository_id || '',
    });
  };

  const remove = async (a) => {
    if (!confirm(`Delete app "${a.name}"?`)) return;
    setErr('');
    try { await api.deleteApp(a.id); load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="page-head"><h2>🗂️ Apps</h2></div>
      {err && <div className="error">{err}</div>}

      <form className="inline-form" onSubmit={submit} style={{ flexWrap: 'wrap' }}>
        <input placeholder="name (e.g. oms auth layer)" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="description (optional)" style={{ minWidth: 200 }}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
          <option value="">— no Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={form.repository_id} onChange={(e) => setForm({ ...form, repository_id: e.target.value })}>
          <option value="">— no linked repository —</option>
          {repositories.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button type="submit">{editingId ? 'Save' : 'Add app'}</button>
        {editingId && <button type="button" onClick={resetForm}>Cancel</button>}
      </form>

      <table className="grid" style={{ marginTop: 16 }}>
        <thead>
          <tr><th>Name</th><th>Enterprise Project</th><th>Repository</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/apps/${a.id}`}>{a.name}</Link></td>
              <td>{a.product_name || '—'}</td>
              <td>{a.repository_name || '—'}</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => edit(a)}>Edit</button>
                <button onClick={() => remove(a)}>Delete</button>
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

Open `http://localhost:5173/apps`, confirm:
- The "🗂️ Apps" nav link appears in the Monitoring section, right after Products.
- The "oms auth layer" app created via curl in Task 2 appears in the table.
- Creating a new app (e.g. name `oms fe`, linked repository `OMS FE`) appears without a page reload, and its Repository column shows `OMS FE`.
- Clicking a row's name link navigates to `/apps/[id]` (will 404/blank until Task 9 — that's expected at this point).

- [ ] **Step 4: Commit**

```bash
git add "dashboard/app/(app)/apps/page.jsx" dashboard/components/Shell.jsx
git commit -m "feat(apps): add apps list page and nav link"
```

---

## Task 9: Frontend — App detail page (hosted servers + env vars)

**Files:**
- Create: `dashboard/app/(app)/apps/[id]/page.jsx`

**Interfaces:**
- Consumes: `api.app/appServers/linkServerApp/updateServerApp/unlinkServerApp/appEnvVars/upsertAppEnvVar/deleteAppEnvVar` (Task 6), `api.servers()`/`api.channels()` (existing), `<ServerAppConfigCard>` (Task 7).
- Produces: `/apps/[id]` route.

- [ ] **Step 1: Create the page**

`dashboard/app/(app)/apps/[id]/page.jsx`:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import ServerAppConfigCard from '@/components/ServerAppConfigCard';

export default function AppDetailPage() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [servers, setServers] = useState([]);
  const [allServers, setAllServers] = useState([]);
  const [linkServerId, setLinkServerId] = useState('');
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null); // { id: string|null, name }
  const [vars, setVars] = useState([]);
  const [form, setForm] = useState({ key: '', value: '', is_secret: false });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const loadServers = () => api.appServers(id).then(setServers).catch((e) => setErr(e.message));

  useEffect(() => {
    if (!id) return;
    api.app(id).then(setApp).catch((e) => setErr(e.message));
    loadServers();
    api.servers().then(setAllServers).catch(() => {});
    api.channels().then(setChannels).catch(() => {});
  }, [id]);

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const linkServer = () => guard(async () => {
    if (!linkServerId) { setErr('Pick a server first'); return; }
    await api.linkServerApp(linkServerId, { app_id: id });
    setLinkServerId('');
    await loadServers();
  }, 'Linked');

  const unlinkServer = (s) => guard(async () => {
    if (!confirm(`Unlink "${s.name}"?`)) return;
    await api.unlinkServerApp(s.id, id);
    await loadServers();
  }, 'Unlinked');

  const loadVars = (channelId) =>
    api.appEnvVars(id, channelId === null ? 'none' : channelId).then(setVars).catch((e) => setErr(e.message));
  const selectChannel = (ch) => { setSelectedChannel(ch); setErr(''); loadVars(ch.id); };

  const saveVar = () => guard(async () => {
    if (!form.key || !form.value) { setErr('Key and value are required'); return; }
    await api.upsertAppEnvVar(id, { ...form, channel_id: selectedChannel.id || undefined });
    setForm({ key: '', value: '', is_secret: false });
    await loadVars(selectedChannel.id);
  }, 'Saved');

  const removeVar = (v) => guard(async () => {
    if (!confirm(`Delete "${v.key}"?`)) return;
    await api.deleteAppEnvVar(id, v.id);
    await loadVars(selectedChannel.id);
  }, 'Deleted');

  if (!app) return <div>Loading…</div>;

  const linkedServerIds = new Set(servers.map((s) => s.id));
  const availableServers = allServers.filter((s) => !linkedServerIds.has(s.id));
  const scopes = [{ id: null, name: '— general (no channel) —' }, ...channels];

  return (
    <div>
      <div className="page-head">
        <h2>🗂️ {app.name}</h2>
        <span className="muted">
          {app.product_name || 'No Enterprise Project'}{app.repository_name ? ` · ${app.repository_name}` : ''}
        </span>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      {app.description && <p className="hint" style={{ marginBottom: 16 }}>{app.description}</p>}

      <h3>Servers hosting this app</h3>
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select value={linkServerId} onChange={(e) => setLinkServerId(e.target.value)}>
          <option value="">— select server —</option>
          {availableServers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={linkServer}>Link server</button>
      </div>
      {servers.length === 0 ? (
        <p className="empty">Not hosted on any server yet.</p>
      ) : (
        servers.map((s) => (
          <ServerAppConfigCard
            key={s.server_app_id}
            title={s.name}
            config={s}
            onSave={(edits) => api.updateServerApp(s.id, id, edits).then(loadServers)}
            onUnlink={() => unlinkServer(s)}
          />
        ))
      )}

      <h3 style={{ marginTop: 24 }}>Environment variables</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Scope</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scopes.map((c) => (
              <button key={c.id || 'general'} onClick={() => selectChannel(c)} style={{
                textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                background: selectedChannel?.id === c.id ? 'var(--panel-2)' : 'transparent',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {!selectedChannel ? (
          <p className="empty">Select a scope to manage its variables.</p>
        ) : (
          <div>
            <h4>{selectedChannel.name}</h4>
            <table className="grid">
              <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id}>
                    <td><code>{v.key}</code></td>
                    <td>{v.is_secret ? <span style={{ color: 'var(--muted)' }}>●●●●●●●● (secret)</span> : v.value}</td>
                    <td><button style={{ background: '#f87171' }} onClick={() => removeVar(v)}>Remove</button></td>
                  </tr>
                ))}
                {vars.length === 0 && <tr><td colSpan="3" className="empty">No variables set.</td></tr>}
              </tbody>
            </table>
            <form className="inline-form" style={{ marginTop: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); saveVar(); }}>
              <input placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} style={{ width: 160 }} />
              <input placeholder="value" type={form.is_secret ? 'password' : 'text'} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ width: 200 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input type="checkbox" checked={form.is_secret} onChange={(e) => setForm({ ...form, is_secret: e.target.checked })} />
                secret
              </label>
              <button type="submit">Save</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually in the browser**

Open `http://localhost:5173/apps` and click into "oms auth layer" (or `oms fe` if you created it in Task 8):

- Link a server (pick any from the dropdown), confirm it appears as a `ServerAppConfigCard`.
- Edit its Nginx config text area, click "Save config", reload the page, confirm the value persisted.
- Click "Unlink", confirm the card disappears and the server reappears in the "link server" dropdown.
- Click "— general (no channel) —" in the Scope list, add a var (key `APP_ENV`, value `production`, not secret), confirm it appears in the table.
- Click one of the real channel names (e.g. "Production"), add a var with the same key `APP_ENV` but value `staging-only` and check "secret" — confirm it saves and shows `●●●●●●●● (secret)`, and that switching back to "general" still shows the original plain `APP_ENV=production` unaffected (proving the two scopes are independent).

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/(app)/apps/[id]/page.jsx"
git commit -m "feat(apps): add app detail page (hosted servers + env vars)"
```

---

## Task 10: Frontend — "Hosted Apps" section on the server detail page

**Files:**
- Modify: `dashboard/app/(app)/servers/[id]/page.jsx`

**Interfaces:**
- Consumes: `api.serverApps/apps/linkServerApp/updateServerApp/unlinkServerApp` (Task 6), `<ServerAppConfigCard>` (Task 7).

- [ ] **Step 1: Add state and loaders**

In `dashboard/app/(app)/servers/[id]/page.jsx`, add to the imports:

```jsx
import ServerAppConfigCard from '@/components/ServerAppConfigCard';
```

Add new state right after the existing `events` state (`const [events, setEvents] = useState([]);`):

```jsx
  const [hostedApps, setHostedApps] = useState([]);
  const [allApps, setAllApps] = useState([]);
  const [linkAppId, setLinkAppId] = useState('');
  const [appsErr, setAppsErr] = useState('');
```

Add loaders inside the existing `useEffect` that already fetches `server`/`metrics`/`securityEvents` (append these two lines alongside the existing `api.server(id).then(...)` calls):

```jsx
    api.serverApps(id).then(setHostedApps).catch(() => {});
    api.apps().then(setAllApps).catch(() => {});
```

Add these handler functions before the `return (` statement:

```jsx
  const loadHostedApps = () => api.serverApps(id).then(setHostedApps).catch((e) => setAppsErr(e.message));

  const linkApp = async () => {
    if (!linkAppId) { setAppsErr('Pick an app first'); return; }
    setAppsErr('');
    try {
      await api.linkServerApp(id, { app_id: linkAppId });
      setLinkAppId('');
      await loadHostedApps();
    } catch (e) { setAppsErr(e.message); }
  };

  const unlinkApp = async (a) => {
    if (!confirm(`Unlink "${a.app_name}"?`)) return;
    setAppsErr('');
    try {
      await api.unlinkServerApp(id, a.app_id);
      await loadHostedApps();
    } catch (e) { setAppsErr(e.message); }
  };
```

- [ ] **Step 2: Render the section**

Add this JSX block right after the closing `</PaginatedEventList>` tag (before the final closing `</div>` of the component):

```jsx
      <div className="page-head" style={{ marginTop: '24px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Hosted apps</h3>
      </div>
      {appsErr && <div className="error">{appsErr}</div>}
      <div className="inline-form" style={{ marginBottom: 8 }}>
        <select value={linkAppId} onChange={(e) => setLinkAppId(e.target.value)}>
          <option value="">— select app —</option>
          {allApps
            .filter((a) => !hostedApps.some((h) => h.app_id === a.id))
            .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={linkApp}>Link app</button>
      </div>
      {hostedApps.length === 0 ? (
        <p className="empty">No apps linked to this server yet.</p>
      ) : (
        hostedApps.map((a) => (
          <ServerAppConfigCard
            key={a.id}
            title={a.app_name}
            config={a}
            onSave={(edits) => api.updateServerApp(id, a.app_id, edits).then(loadHostedApps)}
            onUnlink={() => unlinkApp(a)}
          />
        ))
      )}
```

- [ ] **Step 3: Verify manually in the browser**

Navigate to any server's detail page (e.g. click through from the Overview list), confirm:

- A new "Hosted apps" section appears below the security events list.
- The apps linked in Task 9's verification (via the `/apps/[id]` page) show up here too — proving both directions read the same `server_apps` rows.
- Linking a new app from this page, then navigating to that app's `/apps/[id]` page, shows the server there too.
- Editing config here and saving, then checking the `/apps/[id]` page, shows the updated config (same underlying row).

- [ ] **Step 4: Commit**

```bash
git add "dashboard/app/(app)/servers/[id]/page.jsx"
git commit -m "feat(apps): add hosted-apps section to the server detail page"
```

---

## Task 11: Documentation

**Files:**
- Modify: `docs/RELEASE_MANAGEMENT_GUIDE.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Add the section**

In `docs/RELEASE_MANAGEMENT_GUIDE.md`, insert a new section right after the existing `## 🌐 Environments` section (after its closing `---` at line 261):

```markdown
## 🗂️ Apps Directory

Documents which apps run on which monitored server — separate from (and
not fed into) the deploy pipeline above.

- **Apps** (`/apps`) — one entry per running application/service. Can
  optionally link to an existing Repository (for ones with a tracked git
  repo) and/or an Enterprise Project; neither is required, so entries
  without their own repo (e.g. an internal auth layer) fit too.
- **Servers hosting an app** — many-to-many: a server can host several
  apps, an app can run on several servers. Each server+app pairing has
  its own free-text Nginx vhost config, PHP-FPM pool config, and php.ini
  overrides, editable from either the app's page or the server's detail
  page — both show the same underlying data.
- **Environment variables** — app-scoped, optionally further scoped to
  one of the existing deploy channels (Canary/Beta/Production/
  Enterprise) or left in the channel-less "general" bucket for apps that
  don't distinguish environments. Same secret-encryption behavior as
  channel Environments above: mark a value secret to encrypt it at rest,
  and the UI only ever shows that one is set, never the value.

Requires `TOKEN_ENC_KEY` to be set, same as channel Environments, for any
secret app env var.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE_MANAGEMENT_GUIDE.md
git commit -m "docs(apps): document the Apps Directory feature"
```
