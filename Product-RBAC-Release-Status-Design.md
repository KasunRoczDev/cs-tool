# Product-Wise RBAC, Permissions & Release Status Management — Technical Plan & Design

**Scope:** two related subsystems for the Storemate release platform:
1. **Product-wise Role & Permission** — fine-grained access control scoped per product.
2. **Release Status Management** — a configurable release state machine with gated transitions.

**Status:** Design v1 (build-ready). Grounds every decision in the existing codebase.

---

## 1. Context & goals

### 1.1 Where we are today
- **Products** exist (`products`) and already scope **servers**, **repositories**, and **users** (`product_id`).
- **Auth/RBAC is coarse and global**: `users.role ∈ {admin, operator, viewer}` enforced by `JwtAuthGuard` + the `@Roles(...)` decorator. A user has exactly **one** global role.
- **Approvals are product-scoped**: `users.approval_role ∈ {qa, ba, dev_lead, tech_lead}` + `users.product_id`; a release (scoped to its repos' product) requires all such approvers to sign off before promote/deploy (hard gate).
- **Release status** is a **fixed enum** on `releases.status ∈ {draft, canary, beta, production, enterprise, archived}` with a hardcoded promotion order in `ReleasesService`.

### 1.2 Problems to solve
1. A user can only hold **one role** and belong to **one product**. Real teams need *different roles on different products* (e.g. QA on OMS, Tech Lead on Billing).
2. Permissions are **binary and global** (`admin/operator/viewer`) — no fine-grained, per-action control, and no way to grant "can deploy to Production on Product X only".
3. Release **statuses and transitions are hardcoded** — the four channels, their order, and who may move a release between them cannot be configured per product or changed without a code deploy.
4. No **transition audit** beyond deployment history; no single, queryable "why/who moved this release".

### 1.3 Goals
- **G1** — Per-product membership: a user has a set of `(product, role)` grants.
- **G2** — Fine-grained, namespaced **permissions** bundled into **roles**; roles assignable per product; org-customizable.
- **G3** — Enforcement at the API boundary that resolves the **product scope** of any request (from release/repo/server/deployment) and checks the caller's effective permissions for that product.
- **G4** — A **configurable release status model** (statuses + allowed transitions) with each transition **gated** by permission + approval + automated checks, recorded in an immutable history.
- **G5** — **Backward compatible** rollout — nothing breaks while we migrate off the coarse role.

### 1.4 Design principles
- **Deny by default**; every mutating endpoint declares the permission it needs.
- **Permissions are data, not code** — new roles/permissions are DB rows, editable by admins.
- **Product is the primary scope**; a `global` scope exists for platform administration.
- **Additive & reversible** — new tables + columns alongside the old `users.role`, which stays as a fallback until cutover.
- **One source of truth for "can this user do X on product P"** — a single `AccessService.can(user, permission, productId)`.

---

# PART A — PRODUCT-WISE ROLE & PERMISSION

## A.1 Core concepts

| Concept | Meaning |
|---|---|
| **Permission** | An atomic capability, namespaced `resource.action[.qualifier]` (e.g. `release.promote`, `deploy.execute.production`). |
| **Role** | A named bundle of permissions. **System roles** ship built-in; **custom roles** are org-defined. |
| **Membership** | A grant of one role to one user, scoped to one product (or `global`). A user has many memberships. |
| **Scope** | `global` or a specific `product_id`. Global memberships apply everywhere. |
| **Effective permissions** | For a `(user, product)` pair: the union of permissions from the user's memberships whose scope is `global` or that `product`. |

**Why membership rows instead of a single `users.role`:** a user legitimately needs "QA Lead on OMS, Viewer on Billing." A join table `(user, product, role)` expresses that directly; a single column cannot. — This is the central change.

## A.2 Permission catalog (initial)

Namespaced keys; grouped by resource. This is seed data in `permissions`.

```
# Products & membership
product.read              product.manage            member.manage

# Repositories & branches
repository.read           repository.manage
branch.create             branch.delete             branch.merge

# Work items
workitem.read             workitem.create           workitem.verify

# Releases
release.read              release.create            release.edit
release.attach_repo       release.generate_notes    release.archive

# Release status / transitions (see Part B)
status.transition.<statusKey>     # e.g. status.transition.beta
release.promote                   # convenience: any forward transition allowed by policy

# Approvals
approval.submit           approval.override         # override = bypass the approval gate

# Deployments
deploy.execute.<channel>          # deploy.execute.canary … deploy.execute.enterprise
deploy.approve.<channel>
deploy.rollback

# Governance / platform
role.manage               permission.read
audit.read                settings.manage
notification.manage       ai.use
```

**Why namespaced with qualifiers (`deploy.execute.production`):** encodes the four-channel gate and lets a role grant Canary/Beta but not Production. `<channel>`/`<statusKey>` qualifiers are generated from the configurable status set (Part B), so adding a status auto-creates its transition permission.

## A.3 Default system roles (seed)

Bundles chosen to mirror today's reality plus the finer control. Editable after install.

| Role (key) | Intent | Key permissions |
|---|---|---|
| `platform_admin` | Global superuser | `*` (all, including `role.manage`, `member.manage`, `settings.manage`) |
| `product_admin` | Owns a product | everything on the product *except* platform-global settings |
| `release_manager` | Drives releases | `release.*`, `status.transition.*`, `deploy.approve.*`, `deploy.rollback`, `approval.override` |
| `devops` | Runs deployments | `deploy.execute.*`, `deploy.rollback`, `repository.manage`, `branch.*` |
| `developer` | Builds features | `repository.read`, `branch.create`, `workitem.create`, `release.attach_repo`, `approval.submit` (dev_lead) |
| `qa` | Quality sign-off | `workitem.verify`, `approval.submit`, `release.read` |
| `ba` | Business sign-off | `approval.submit`, `release.read` |
| `tech_lead` | Technical sign-off + gate | `approval.submit`, `status.transition.*` (up to staging), `release.read` |
| `viewer` | Read-only | `*.read` |

**Approval roles fold in here:** the QA/BA/DEV Lead/Tech Lead approval roles become **roles that carry `approval.submit`** plus an `approval_role` tag used by the approval engine to know *which* sign-off slot they fill (Part B integrates this).

## A.4 Data model (DDL)

```sql
-- Permissions catalog (seeded; rarely changes)
CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,             -- 'release.promote'
  description TEXT,
  resource    TEXT NOT NULL,               -- 'release'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles (system + custom)
CREATE TABLE IF NOT EXISTS roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT UNIQUE NOT NULL,        -- 'release_manager'
  name         TEXT NOT NULL,
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT false,   -- system roles can't be deleted
  approval_slot TEXT,                        -- qa|ba|dev_lead|tech_lead|null (ties into approvals)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- Membership: a user holds a role, scoped global or to one product
CREATE TABLE IF NOT EXISTS memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'product',  -- 'global' | 'product'
  product_id UUID REFERENCES products(id) ON DELETE CASCADE, -- null when global
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (user_id, role_id, scope_type, product_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user    ON memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_product ON memberships (product_id);

-- A materialized/queried view of a user's effective permissions per product is
-- computed on the fly (see AccessService) and cached in Redis for the token TTL.
```

**Why keep `permissions.key` as the PK (text):** permission keys are stable identifiers used in code (`@RequirePermission('release.promote')`); a text PK keeps joins and role editing legible, and avoids an extra id lookup on the hot authz path.

## A.5 Enforcement architecture

### A.5.1 Effective-permission resolution
`AccessService.effective(userId, productId?)` returns the set of permission keys:
```
SELECT DISTINCT rp.permission_key
  FROM memberships m
  JOIN role_permissions rp ON rp.role_id = m.role_id
 WHERE m.user_id = $userId
   AND (m.scope_type = 'global' OR m.product_id = $productId)
```
Result cached in Redis under `perm:{userId}:{productId}` for the JWT TTL; invalidated on any membership/role change (publish a `rbac.invalidated` event).

`AccessService.can(userId, permission, productId?)` = `effective(...).has(permission)` OR the user has a `global` `platform_admin` membership (superuser shortcut).

### A.5.2 Scope resolution — the key mechanism
Most endpoints act on an entity that *belongs to a product*. A `ProductScopeResolver` maps request → `productId`:

| Entity in route | How product is derived |
|---|---|
| `product/:id` | the id itself |
| `repositories/:id`, `servers/:id` | `SELECT product_id …` |
| `releases/:id` | union of products of the release's pinned repos (see Part B for multi-product handling) |
| `deployments/:id` | via its release |
| body `{product_id}` on create | from the payload |

For **release-scoped** actions where a release spans multiple products, the required permission must hold on **every** product in scope (strictest interpretation) — configurable to "any" per permission if needed.

### A.5.3 Guard + decorator (NestJS)
```ts
@RequirePermission('release.promote')          // declares the needed permission
@UseGuards(JwtAuthGuard, PermissionGuard)      // PermissionGuard runs after auth
@Post('releases/:id/promote')
promote(@Param('id') id: string) { … }
```
`PermissionGuard`:
1. reads the required permission from metadata,
2. resolves `productId(s)` via `ProductScopeResolver`,
3. calls `AccessService.can(user, perm, productId)` for each product in scope,
4. throws `403 { error: { code: 'forbidden', message, required, product } }` on failure.

**Why a guard + resolver, not inline checks:** centralizes authz, keeps controllers declarative, and makes the "which product?" logic testable and consistent. It coexists with the legacy `@Roles` guard during migration (both run; either can allow).

## A.6 API (RBAC administration)

```
# Roles & permissions (perm: role.manage / permission.read)
GET    /api/v1/permissions
GET    /api/v1/roles
POST   /api/v1/roles                     {key,name,description,permission_keys[],approval_slot?}
PATCH  /api/v1/roles/:id                  {name,description}
PUT    /api/v1/roles/:id/permissions      {permission_keys[]}
DELETE /api/v1/roles/:id                  # system roles rejected

# Memberships (perm: member.manage on the target product)
GET    /api/v1/products/:id/members
POST   /api/v1/products/:id/members       {user_id, role_id}
DELETE /api/v1/products/:id/members/:membershipId
GET    /api/v1/users/:id/memberships
POST   /api/v1/memberships                {user_id, role_id, scope_type, product_id?}  # global grants (platform_admin)

# Introspection
GET    /api/v1/me/permissions?product=:id  # effective permission keys for the UI to gate controls
```

## A.7 Migration from the coarse role (backward compatible)

1. **Ship tables + seed** permissions and system roles. No behavior change yet.
2. **Backfill memberships** from existing data:
   - `users.role = 'admin'` → global `platform_admin` membership.
   - `users.role = 'operator'` + `users.product_id` → `devops` on that product (global if no product).
   - `users.role = 'viewer'` → global `viewer`.
   - `users.approval_role` + `product_id` → the matching approval role membership on that product.
3. **Dual-guard phase:** `PermissionGuard` runs *alongside* `@Roles`. A request is allowed if **either** passes. New endpoints use `@RequirePermission` only.
4. **Cutover:** once all endpoints declare permissions and admins are comfortable, remove `@Roles` and treat `users.role` as legacy/display-only.
5. **Decommission:** drop reliance on `users.role`/`users.product_id` for authz (keep columns for a release, then remove).

**Why dual-guard:** zero downtime and no "big bang" — teams migrate endpoint-by-endpoint and can roll back instantly.

---

# PART B — RELEASE STATUS MANAGEMENT

## B.1 From fixed enum to configurable state machine

Today `releases.status` is a fixed enum with a hardcoded order. We replace it with a **configurable, per-product-capable state machine**:

- A **status set** (workflow) is an ordered list of statuses: e.g. `Draft → Canary → Beta → Production → Enterprise → Archived`, but editable (add `Staging`, `Hotfix`, `Rolled Back`, etc.).
- A **transition** defines an allowed move `from → to`, plus the **guards** that must pass (permission, approvals, checks).
- Each release carries its **current status** (FK to a status row) and an immutable **status history**.

**Why configurable:** the org will add stages (Staging, UAT), rename them, or run different flows per product line. Encoding this as data + a state machine removes the recurring code change and the hardcoded promotion order.

## B.2 Workflow scoping

- A **default workflow** ships (the current 6 statuses) and applies to all products.
- A product may **override** with its own workflow (`workflows.product_id`). Resolution: product workflow if present, else the default.

**Why default + per-product override:** most products share one flow; a few need a bespoke one. Override-with-fallback avoids duplicating the common case.

## B.3 Transition guards (the heart of it)

A transition executes only if **all** its configured guards pass:

1. **Permission guard** — caller has `status.transition.<toStatusKey>` on the release's product(s). (Part A.)
2. **Approval guard** — the release is fully approved by all required approvers (existing `ApprovalsService.isFullyApproved`) when the transition's `require_approval = true`. `approval.override` permission bypasses.
3. **Check guard** — configurable automated checks must pass, e.g. `compatibility_ok`, `no_open_conflicts`, `all_workitems_verified`, `no_active_freeze`, `deploy_succeeded` (the prior channel's deploy is green). Reuses the AI/preflight signals.
4. **Direction guard** — `is_forward` transitions vs `rollback`/`archive` are typed so the UI and policies can treat them differently.

On success: update `releases.status_id`, append `release_status_history`, emit `release.status_changed`, and (optionally) trigger the linked deployment channel.

## B.4 Data model (DDL)

```sql
-- A workflow = an ordered set of statuses; default (product_id null) or per-product
CREATE TABLE IF NOT EXISTS release_workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,  -- null = default workflow
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id)                                          -- one workflow per product
);

CREATE TABLE IF NOT EXISTS release_statuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES release_workflows(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,               -- 'production'
  name        TEXT NOT NULL,               -- 'Production'
  rank        INT NOT NULL,                -- order in the pipeline
  category    TEXT NOT NULL DEFAULT 'stage', -- draft|stage|terminal
  channel_key TEXT,                        -- links a status to a deploy channel (nullable)
  color       TEXT,
  UNIQUE (workflow_id, key)
);

CREATE TABLE IF NOT EXISTS release_transitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    UUID NOT NULL REFERENCES release_workflows(id) ON DELETE CASCADE,
  from_status_id UUID REFERENCES release_statuses(id) ON DELETE CASCADE, -- null = "from any"
  to_status_id   UUID NOT NULL REFERENCES release_statuses(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'forward',  -- forward|rollback|archive
  require_approval BOOLEAN NOT NULL DEFAULT true,
  required_checks  TEXT[] NOT NULL DEFAULT '{}',    -- {compatibility_ok,no_active_freeze,...}
  required_permission TEXT,                          -- default: status.transition.<toKey>
  auto_deploy    BOOLEAN NOT NULL DEFAULT false,     -- trigger the channel deploy on transition
  UNIQUE (workflow_id, from_status_id, to_status_id)
);

-- Release now points at a status row (FK) instead of the old enum.
ALTER TABLE releases ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES release_statuses(id);
-- Legacy releases.status (enum text) is kept in sync during migration for display/back-compat.

CREATE TABLE IF NOT EXISTS release_status_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id     UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  from_status_id UUID REFERENCES release_statuses(id),
  to_status_id   UUID NOT NULL REFERENCES release_statuses(id),
  transition_id  UUID REFERENCES release_transitions(id),
  actor_id       UUID REFERENCES users(id),
  note           TEXT,
  checks_snapshot JSONB,                     -- which guards passed at the time
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_history_release ON release_status_history (release_id, created_at DESC);
```

**Why `from_status_id` nullable ("from any"):** archive/rollback often apply from multiple states; a null `from` avoids enumerating every source. **Why `channel_key` on a status:** keeps the status model the single source of truth while still driving the existing deploy-channel machinery.

## B.5 Transition workflow (sequence)

```
Actor requests transition (release, toStatus, note)
  → resolve product(s) + workflow
  → find transition (from current → to) in the workflow; 404 if not allowed
  → PermissionGuard: status.transition.<toKey> on product(s)          [Part A]
  → if require_approval: ApprovalsService.isFullyApproved OR approval.override
  → run required_checks (compatibility, freeze, conflicts, prior deploy green)
  → BEGIN tx:
       UPDATE releases SET status_id = to
       INSERT release_status_history (+ checks_snapshot)
       (mirror legacy releases.status for back-compat)
       emit release.status_changed
       if transition.auto_deploy && status.channel_key: create Deployment on that channel
     COMMIT
  → notify subscribers (chat channels + threaded email if part of approval flow)
```

## B.6 API (status management)

```
# Workflow admin (perm: settings.manage / product_admin)
GET    /api/v1/workflows                         # default + per-product
POST   /api/v1/workflows                         {name, product_id?}
POST   /api/v1/workflows/:id/statuses            {key,name,rank,category,channel_key,color}
POST   /api/v1/workflows/:id/transitions         {from,to,kind,require_approval,required_checks,...}
DELETE /api/v1/workflows/:id/(statuses|transitions)/:sid

# Release status operations
GET    /api/v1/releases/:id/status               # current + workflow + allowed next transitions (for THIS user)
POST   /api/v1/releases/:id/transition           {to_status_key, note}   perm: status.transition.<toKey>
GET    /api/v1/releases/:id/status-history
GET    /api/v1/releases/board                     # kanban: releases grouped by status (per workflow)
```

`GET /releases/:id/status` returns only the transitions the **current user is allowed to perform** (permission + guard preview), so the UI shows exactly the buttons they can use.

## B.7 Integration with existing promote / deploy / approvals

- The existing `promote` becomes a **forward transition** in the default workflow; `ReleasesService.promote` delegates to `StatusService.transition(release, nextForwardStatus)`.
- The **approval hard gate** (Part of the current build) becomes the transition's `require_approval` guard — same `ApprovalsService`, now driven by config instead of always-on.
- `DeploymentsService.deploy` keeps working; a transition with `auto_deploy` + a `channel_key` creates the deployment (which then flows to the agent pipeline). Manual deploys still allowed where policy permits.
- Legacy `releases.status` enum is written on every transition during migration so any un-migrated query/UI keeps working; removed after cutover.

**Why fold promote into transitions:** one consistent, auditable, permission-gated mechanism for *every* status change instead of separate `promote`/`archive`/`rollback` code paths.

---

# PART C — BACKEND STRUCTURE

New/changed modules (NestJS, alongside existing `release/`, `users/`, `notifications/`):

```
src/access/                         # NEW — RBAC
  access.service.ts                 # effective(), can(), Redis cache + invalidation
  product-scope.resolver.ts         # request -> product_id(s)
  permission.guard.ts               # @RequirePermission enforcement (dual-guard aware)
  require-permission.decorator.ts
  roles.service.ts  roles.controller.ts
  memberships.service.ts  memberships.controller.ts
  access.module.ts

src/release/status/                 # NEW — release status state machine
  workflow.service.ts   workflow.controller.ts     # workflow/status/transition admin
  status.service.ts     status.controller.ts       # transition(), allowedTransitions(), history, board
  status.module.ts

# Changed
release/releases.service.ts         # promote() delegates to StatusService.transition()
release/deployments.service.ts      # deploy gate reads permission + status guards
common/jwt-auth.guard.ts            # unchanged; PermissionGuard runs after it
```

Dependency direction: `status` → `access` (for the permission guard) and → `ApprovalsService` (approval guard). `access` depends on nothing in `release` (avoids cycles). Both are imported by `ReleaseModule`/`AppModule`.

---

# PART D — FRONTEND

New admin + operational surfaces (Next.js, matching existing patterns):

1. **Access Control admin** (`/admin/roles`, gated by `role.manage`):
   - **Roles & permissions matrix** — roles as rows, permissions as grouped columns; toggle to grant. System roles read-only-ish (clone to customize).
   - **Product members** — per product: table of `(user, role)` with add/remove; reuse the product picker pattern.
   - **User memberships** — from a user, see/assign all their `(product, role)` grants.

2. **Release status workflow editor** (`/admin/workflows`, `settings.manage`):
   - Visual list/graph of statuses (rank-ordered) and transitions; edit guards (`require_approval`, `required_checks`, `auto_deploy`, permission).
   - Default workflow + per-product overrides.

3. **Release status board** (`/releases/board`):
   - Kanban of releases grouped by status (from the workflow). Cards show version, product, approval progress, and the **transition buttons the current user is allowed to use** (from `GET /releases/:id/status`).

4. **Gating everywhere:** the SPA fetches `GET /me/permissions?product=` and gates buttons via a `<Can permission="release.promote" product={id}>` wrapper — the same pattern the current approval gate uses, generalized. Server-side checks remain the source of truth; UI gating is UX only.

**Why a `<Can>` wrapper + server truth:** avoids scattering permission logic in components and prevents "button visible but action 403s"; the server still enforces, so a stale UI is safe.

---

# PART E — EVENTS, AUDIT & NOTIFICATIONS

- New domain events: `rbac.invalidated`, `release.status_changed`, `workflow.updated`. All flow through the existing event/notification path.
- `release.status_changed` is added to `PLATFORM_EVENTS` so Slack/Teams/Discord/email channels can subscribe; threaded email reused when the transition is part of the approval flow.
- Every transition and every membership/role change writes an **audit** row (reuse `audit_log`), giving one queryable trail: who changed which release's status / who granted which role on which product.

---

# PART F — SECURITY CONSIDERATIONS

- **Deny by default:** unknown permission or unresolved product scope → 403.
- **Superuser containment:** only `global platform_admin` bypasses product scoping; grantable only by an existing platform admin; guarded by `member.manage` on `global`.
- **Cache poisoning / staleness:** permission cache keyed by `(user, product)` with short TTL and explicit invalidation on membership/role edits; a stale cache can only *under*-grant briefly (fail-safe), never over-grant beyond TTL.
- **Privilege escalation:** editing a role you hold can't add permissions you don't have (a role edit requires `role.manage`, itself a high privilege); block self-granting `platform_admin` without an existing global admin.
- **Multi-product releases:** default to "must hold permission on ALL products in scope" so a user with rights on one product can't move a release that also touches another.
- **Attachment/route authz:** approval attachments and status history are product-scoped reads (`release.read`).

---

# PART G — ROLLOUT PLAN (phased, backward-compatible)

| Phase | Deliverable | Gate to next |
|---|---|---|
| **0** | Migrations (permissions, roles, role_permissions, memberships, workflows, statuses, transitions, history) + seed system roles/default workflow; backfill from `users.role`/`approval_role` | Data verified; no behavior change |
| **1** | `AccessService` + `PermissionGuard` in **dual-guard** mode; `/me/permissions`, roles/membership APIs + admin UI | Admins can manage roles/members; old `@Roles` still active |
| **2** | Status state machine: workflow/status/transition tables live; `StatusService.transition`; `promote` delegates; legacy enum mirrored; status board + history UI | Transitions work with guards; deploy/approval gates intact |
| **3** | Migrate endpoints to `@RequirePermission`; workflow editor UI; per-product workflows | All mutating endpoints permission-gated |
| **4** | Cutover: remove `@Roles`, retire `users.role`/`users.product_id` for authz; drop legacy status enum writes | Sign-off; monitoring clean |

**Rollback:** every phase is additive; disabling `PermissionGuard` (feature flag `RBAC_ENFORCE=false`) reverts to legacy `@Roles` instantly.

---

# PART H — TESTING PLAN

- **Unit:** `AccessService.effective/can` truth table (global vs product, superuser, deny-by-default); `ProductScopeResolver` per entity; transition guard combinations (permission×approval×checks).
- **Integration (against a test DB):** backfill correctness; membership CRUD invalidates cache; a `devops`-on-OMS user can deploy OMS but 403s on Billing; a release spanning two products requires perms on both.
- **State machine:** every seeded transition; illegal transition → 409; approval-required transition blocked until approved; `approval.override` bypasses; `auto_deploy` creates a deployment.
- **E2E:** assign roles per product → move a release Draft→…→Production with the right users, blocked with the wrong ones; status board shows only permitted buttons; audit + history rows written.
- **Security regression:** self-escalation attempts; stale-cache under-grant; cross-product leakage.

---

# PART I — OPEN DECISIONS

1. **Multi-product release policy:** require permission on ALL vs ANY product in scope (recommend ALL; make per-permission configurable).
2. **Custom permissions:** allow orgs to define *new* permission keys, or restrict to the shipped catalog (recommend catalog-only initially; keys are code-referenced).
3. **Workflow scope granularity:** per-product only, or also per-product-line/environment (recommend per-product now, extensible).
4. **Approval slot vs role:** keep `approval_slot` on roles (a role fills a sign-off slot) vs a separate mapping (recommend on-role for simplicity).
5. **Keeping `deploy.approve.<channel>`** as distinct from `status.transition.<status>` when a status maps 1:1 to a channel (recommend keep both; deploy approval ≠ status move).

---

## Appendix — Effort estimate (indicative)

| Phase | Backend | Frontend | Total |
|---|---|---|---|
| 0 Migrations + backfill | 3–4 d | — | ~4 d |
| 1 RBAC engine + admin | 5–6 d | 4–5 d | ~2 wks |
| 2 Status state machine | 5–6 d | 3–4 d | ~2 wks |
| 3 Endpoint migration + workflow editor | 3–4 d | 4–5 d | ~2 wks |
| 4 Cutover + hardening | 2–3 d | 1–2 d | ~1 wk |

A single pod can deliver Phases 0–2 (the usable core: per-product roles + configurable gated statuses) in ~4–5 weeks, with 3–4 as follow-on.
