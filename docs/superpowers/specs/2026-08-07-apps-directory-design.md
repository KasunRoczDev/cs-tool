# Apps Directory (Server → App → Env Vars/Config) — Design Spec

Status: approved
Date: 2026-08-07

## Problem

There is no way to record which applications/services run on which
monitored server, what environment variables or secrets each one needs,
or its nginx/php-fpm/php.ini configuration. Release Management already
tracks `repositories` (git-tracked codebases) and `channels`
(canary/beta/production/enterprise, with encrypted env vars), but:

- `repositories.remote_url` is required — too heavy for entries that
  don't have (or don't need) a tracked git repo, e.g. an internal
  "auth layer" service.
- `channel_env_vars` is scoped to `(channel_id, product_id)` — every
  repo/app under the same Enterprise Project on the same channel is
  forced to share one set of variables. Two different apps on the same
  channel can't have different values for the same key.
- Nothing links a `servers` row to what's actually deployed on it, and
  there's no place to store per-site nginx/php-fpm/php.ini config.

## Goals

- Record, per monitored server, which apps are hosted on it (many
  servers ↔ many apps), each with its own nginx vhost config, php-fpm
  pool config, and php.ini overrides (free text, since these are real
  config files, not clean key/value data).
- Each app can optionally link to an existing `repositories` row (for
  ones with a tracked git repo, e.g. "OMS FE") or stand alone (for ones
  that don't, e.g. "oms auth layer").
- Each app gets its own environment variables/secrets, optionally scoped
  to one of the existing channels (canary/beta/production/enterprise) or
  left channel-less for apps that don't distinguish environments.
- Reuse the existing secret-encryption approach
  (`common/crypto.util`) and UI conventions from the channel env vars
  page — don't invent a second env-var system from scratch.

## Non-goals

- No changes to the existing `channel_env_vars` table or the deploy
  pipeline's env var resolution (`EnvironmentService.resolveForDeploy`) —
  apps' env vars are a separate, parallel store, not wired into deploys
  in this pass. (If deploys should later pull from app-scoped vars
  instead of/in addition to channel-scoped ones, that's a follow-up.)
- No automated discovery of what's actually running on a server (no
  process scanning, no nginx-config-file import) — this is manually
  curated documentation, like the rest of Release Management's inventory.
- No validation of nginx/php-fpm/php.ini syntax — free text, stored and
  displayed as-is.
- No versioning/history of config changes — editing overwrites, same as
  every other free-text field in this app (e.g. `topologies.graph`).

## Data model

New `database/apps_migration.sql`, applied after `release_migration.sql`
and `environment_secrets_migration.sql` (needs `repositories`, `channels`,
`products`, `servers`, `users`).

```sql
CREATE TABLE apps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_apps_product ON apps (product_id);
CREATE INDEX idx_apps_repository ON apps (repository_id);

CREATE TABLE server_apps (
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
CREATE INDEX idx_server_apps_server ON server_apps (server_id);
CREATE INDEX idx_server_apps_app ON server_apps (app_id);

-- Mirrors channel_env_vars (same encryption approach), scoped to app_id
-- instead of product_id. channel_id nullable: NULL = one flat set not
-- tied to a specific environment.
CREATE TABLE app_env_vars (
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
  -- Postgres treats NULLs as distinct, so the channel_id IS NULL case is
  -- de-duplicated at the app layer (IS NOT DISTINCT FROM check), same
  -- pattern as channel_env_vars' product_id NULL handling.
  UNIQUE (app_id, channel_id, key)
);
CREATE INDEX idx_app_env_vars_app ON app_env_vars (app_id);
```

## Backend

All new files live in `backend/src/release/` (alongside the existing
`environment.controller.ts`/`environment.service.ts` this reuses
patterns from) and register in `release.module.ts`. `servers` isn't
owned by `ReleaseModule`, but `PG_POOL` is global
(`DatabaseModule` is `@Global()`), so no cross-module import is needed —
same approach the billing module already uses to query `servers`.

### `apps.service.ts` / `apps.controller.ts` — `AppsController`

CRUD for the `apps` table itself. Guarded like `RepositoriesController`
(`@Roles('admin', 'operator')` for writes — not secret data, no need for
the granular `PermissionGuard`).

- `GET /apps` — list, joined with product name and repository name.
- `GET /apps/:id`.
- `POST /apps` (admin, operator) — `{ name, description?, product_id?, repository_id? }`.
- `PATCH /apps/:id` (admin, operator).
- `DELETE /apps/:id` (admin) — cascades `server_apps` and `app_env_vars`
  (both `ON DELETE CASCADE`).

### `server-apps.service.ts` / `server-apps.controller.ts` — `ServerAppsController`

`@Controller('servers')` (a second controller on the existing `/servers`
path prefix — no route collision with `ServersController`'s existing
routes). `@Roles('admin', 'operator')` for writes.

- `GET /servers/:id/apps` — apps hosted on this server, with their
  `server_apps` config (nginx/php-fpm/php.ini) and app name/description.
  Response shape: `[{ id (server_apps.id), app_id, app_name,
  app_description, nginx_config, php_fpm_config, php_ini_config,
  created_at, updated_at }]`.
- `POST /servers/:id/apps` (admin, operator) — link an app:
  `{ app_id, nginx_config?, php_fpm_config?, php_ini_config? }`.
- `PATCH /servers/:id/apps/:appId` (admin, operator) — edit the config
  fields on an existing link.
- `DELETE /servers/:id/apps/:appId` (admin, operator) — unlink.

### `app-env-vars.service.ts` / `app-env-vars.controller.ts` — `AppEnvVarsController`

Directly ports `EnvironmentService`'s `listEnvVars`/`upsertEnvVar`/`deleteEnvVar`
logic (masking, `encryptSecret`/`decryptSecret` from `common/crypto.util`,
the `IS NOT DISTINCT FROM` dedup check), swapping `channel_id`+`product_id`
for `app_id`+`channel_id`. Guarded like `EnvironmentController`
(`@UseGuards(JwtAuthGuard, PermissionGuard)`, writes require
`@RequirePermission('settings.manage')` — the same permission key that
already gates channel env vars, since this is the same class of
sensitive data).

- `GET /apps/:id/env-vars?channel_id=` — list (optional filter; omit for
  all of this app's vars across every channel + the channel-less set).
  Response shape matches `listEnvVars`: `{ id, app_id, channel_id,
  channel_name, key, is_secret, value (null if secret), has_value,
  updated_at }`.
- `POST /apps/:id/env-vars` — upsert: `{ key, value, is_secret?, channel_id? }`.
- `DELETE /apps/:id/env-vars/:varId`.

## Frontend

### `/apps` page (new, added to the "Monitoring" nav group in
`Shell.jsx` — `{ href: '/apps', label: '🗂️ Apps' }` right after
`/products`, since individual servers are reached from the Overview
list rather than their own nav link)

- Table: Name, Enterprise Project, Linked Repository (or "—"), created
  date. Create/edit form: name, description, product select (optional),
  repository select (optional) — same inline-form pattern as
  `/products`.
- Clicking a row navigates to `/apps/[id]`.

### `/apps/[id]` page (new)

Two sections:

1. **Servers hosting this app** — table of linked servers (name,
   hostname) with an "Unlink" action, and an "Link a server" form
   (server select + optional initial nginx/php-fpm/php.ini text areas).
2. **Environment variables** — directly ports the `/environments` page's
   layout: a left-hand list of scopes (the existing channels, plus a
   leading "— general (no channel) —" entry for `channel_id = null`),
   and on the right a table of that scope's vars (masked secrets, same
   `●●●●●●●● (secret)` treatment) plus the add-var form (key, value,
   secret checkbox — no product selector, since this is already app
   scoped).

### Server detail page (`dashboard/app/(app)/servers/[id]/page.jsx`)

New "Hosted Apps" section appended after the security events list:
table of apps linked to this server (name, link to `/apps/[id]`), each
row expandable (or a separate small section per app) with three text
areas — Nginx Config, PHP-FPM Config, PHP.ini — editable inline with a
Save button per app, plus an "Add app" form (app select) and "Unlink"
per row.

### `dashboard/lib/api.js` additions

```js
apps: () => req('/apps'),
app: (id) => req(`/apps/${id}`),
createApp: (body) => req('/apps', { method: 'POST', body: JSON.stringify(body) }),
updateApp: (id, body) => req(`/apps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
deleteApp: (id) => req(`/apps/${id}`, { method: 'DELETE' }),
serverApps: (serverId) => req(`/servers/${serverId}/apps`),
linkServerApp: (serverId, body) => req(`/servers/${serverId}/apps`, { method: 'POST', body: JSON.stringify(body) }),
updateServerApp: (serverId, appId, body) => req(`/servers/${serverId}/apps/${appId}`, { method: 'PATCH', body: JSON.stringify(body) }),
unlinkServerApp: (serverId, appId) => req(`/servers/${serverId}/apps/${appId}`, { method: 'DELETE' }),
appEnvVars: (appId, channelId) => req(`/apps/${appId}/env-vars${channelId !== undefined ? `?channel_id=${channelId}` : ''}`),
upsertAppEnvVar: (appId, body) => req(`/apps/${appId}/env-vars`, { method: 'POST', body: JSON.stringify(body) }),
deleteAppEnvVar: (appId, varId) => req(`/apps/${appId}/env-vars/${varId}`, { method: 'DELETE' }),
```

## Testing

Following the codebase's convention (spec files for services with real
branching logic, not plain CRUD — see `products`/`topology` having none,
vs. `environment.service.spec.ts` (132 lines) covering
`EnvironmentService`'s masking/encryption/dedup logic in detail):

- No spec file for `apps.service.ts` / `server-apps.service.ts` (plain
  CRUD) — verified manually via the running dev stack, same as the
  billing module's `service-types`/`services`.
- `app-env-vars.service.spec.ts` — directly mirrors
  `environment.service.spec.ts`'s structure (same `makeService()` helper,
  same `TOKEN_ENC_KEY` env setup), adapted to `app_id`/`channel_id`
  instead of `channel_id`/`product_id`:
  - `listEnvVars` masks secret values but passes through plain ones.
  - `upsertEnvVar` rejects a missing key/value; inserts when no matching
    row exists; encrypts the value when `is_secret` is true (asserting
    `value_enc` is never the raw plaintext and follows the
    `iv:tag:ciphertext` format); updates in place when a matching
    `(app_id, channel_id, key)` row already exists, including the
    channel-less (`channel_id = null`) case via the same
    `IS NOT DISTINCT FROM` check `environment.service.ts` uses for
    `product_id`.
  - `deleteEnvVar` throws `NotFoundException` when nothing was deleted.

## Documentation

- Add an "Apps Directory" section to `docs/RELEASE_MANAGEMENT_GUIDE.md`
  (or `README.md` if that guide doesn't cover server-level concerns)
  describing the Server → App → Env Vars/Config model and how it relates
  to (but doesn't feed into) the existing repositories/channels deploy
  pipeline.
