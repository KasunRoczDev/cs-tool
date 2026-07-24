# Release & DevOps Management Platform — Technical Blueprint

**Product codename:** *Helm* (internal) — the central release engineering platform for Storemate OMS.
**Document type:** Multi-phase technical blueprint (architecture + MVP build spec + long-term roadmap)
**Owner:** Platform/DevOps Engineering
**Status:** Draft v1.0 — June 2026

---

## 0. How to read this document

This blueprint is organized so it can drive a multi-quarter build:

1. **Part A — Vision & Principles**: the "why" that constrains every later decision.
2. **Part B — Target Architecture**: the full system, including modules that won't be built for years. This exists so the MVP is built *into* the right shape rather than refactored later.
3. **Part C — MVP Specification**: concrete, build-ready detail — services, database DDL, API contracts, events, workflows, permissions, frontend structure.
4. **Part D — Long-Term Roadmap**: each future module, where it plugs in, and what it depends on.
5. **Part E — Cross-Cutting Engineering**: scalability, HA, DR, security, observability, versioning.
6. **Part F — Delivery Plan**: phasing, team shape, and sequencing.

Every significant decision is followed by a **"Why"** note explaining its fit for a *growing* engineering organization — i.e. one that adds repositories, services, environments, and people continuously.

---

# PART A — VISION & DESIGN PRINCIPLES

## A.1 Problem statement

Storemate OMS is a microservice OMS (currently Master-BE, Order-BE, Report-BE, Frontend, Authentication Service, Queue Service — and growing). Releases flow through four channels — **Canary → Beta → Production → Enterprise** — and today the work is manual: long-lived per-environment branches, hand-coordinated feature/bugfix/hotfix merges, manual version synchronization across repos, and manual cross-repository releases and approvals. This is slow, error-prone, and does not scale with repository or headcount growth.

The platform must **centralize and automate release engineering**, treating a *release* as a first-class, cross-repository object rather than a set of independent Git operations.

## A.2 Design principles

1. **Release is the aggregate root, not the repository.** The hardest current problem is *cross-repository* coordination and version synchronization. The data model and APIs are built around a Release that spans many repositories at pinned commit SHAs. — *Why: it directly attacks the coordination cost that grows combinatorially as repos multiply.*

2. **Git is the source of truth; the platform is the system of record for *intent and orchestration*.** We never duplicate Git history as primary data. We store pointers (SHAs, branch names, PR numbers) plus the orchestration metadata Git can't express (which feature belongs to which release, who approved which deployment). — *Why: avoids drift and a doomed attempt to mirror Git; keeps the platform a thin, reliable coordinator.*

3. **Provider-agnostic from day one, GitHub-first in implementation.** All Git operations go through a `GitProvider` interface; GitHub is the first adapter. GitLab/Bitbucket are added later without touching business logic. — *Why: prevents vendor lock-in and lets the org adopt other forges without a rewrite.*

4. **Event-driven core.** Every meaningful action emits a domain event onto a durable bus. Notifications, audit logs, analytics, and future modules (AI, CI/CD) are *consumers*, never inline code. — *Why: new modules attach as subscribers — the central goal of "add modules without major redesign."*

5. **Everything is auditable and reversible.** Every state change records actor, time, before/after, IP, and user-agent. Deployments always carry a rollback target. — *Why: release engineering is high-stakes; trust requires a complete, queryable history.*

6. **Modular monolith → microservices on demand.** The MVP ships as a small number of deployable services with strict internal module boundaries, not 20 microservices. Boundaries are drawn so any module can be extracted later. — *Why: a growing org should not pay distributed-systems overhead before it has the scale or team count to justify it; clean seams make extraction cheap when it does.*

7. **Configuration over code for org-specific policy.** Branch naming, protection rules, release channels, approval gates, and RBAC are data, not hardcoded. — *Why: the org's process will evolve; policy changes shouldn't require deploys.*

8. **API-first.** Every capability is a documented API before it is a UI. The web app is one client; CI runners, ChatOps, and the future AI assistant are others. — *Why: automation and integrations are the whole point of a DevOps platform.*

---

# PART B — TARGET ARCHITECTURE (the shape we build toward)

## B.1 Logical layering

```
┌─────────────────────────────────────────────────────────────┐
│  Clients: Web SPA · CLI · ChatOps · CI runners · AI Assistant │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS / WebSocket (REST + GraphQL gateway)
┌───────────────▼─────────────────────────────────────────────┐
│  API Gateway / BFF  (authn, rate limit, request routing)     │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼───────────── Domain Services ────────────────┐
│  Repo   Release  Merge   Deployment  Notification  Audit      │
│  Svc    Svc      Svc     Svc         Svc           Svc        │
│  Version Feature Bug/Hotfix  User/RBAC  Webhook-Ingest        │
└───────┬───────────────────────────────┬─────────────────────-┘
        │ domain events (publish)        │ commands/queries
┌───────▼────────────┐        ┌──────────▼───────────┐
│  Event Bus         │        │  Relational DB (PG)  │
│  (Redis Streams →  │        │  + Redis cache       │
│   Kafka/NATS later)│        │  + object storage    │
└───────┬────────────┘        └──────────────────────┘
        │ subscribe
┌───────▼───────── Async Workers / Consumers ──────────────────┐
│  Git-sync · Notifier · Audit-writer · Release-notes-gen ·    │
│  Analytics-rollup · (future) AI-analyzer · CI-orchestrator   │
└──────────────────────────────────────────────────────────────┘
        │ outbound
┌───────▼──────────────────────────────────────────────────────┐
│  External: GitHub/GitLab/Bitbucket · Slack/Teams/Discord ·    │
│  Email · K8s · Prometheus · Registries · Cloud providers      │
└──────────────────────────────────────────────────────────────┘
```

**Why this layering:** clients are decoupled from domain logic by a gateway; domain services own data and publish events; everything cross-cutting or future-facing is a consumer of those events. Adding "Security Center" or "AI Assistant" later means adding a consumer and some tables — not surgery on the core.

## B.2 Bounded contexts (the full map)

These are the *logical* domains. In the MVP several share one deployable; long-term each can be its own service.

| Context | Owns | MVP? |
|---|---|---|
| **Identity & Access** | Users, roles, permissions, API tokens, SSO | ✅ |
| **Repository** | Repos, metadata, branch-protection policy | ✅ |
| **Branch** | Branch lifecycle, comparisons, conflict detection | ✅ |
| **Version** | Per-service semver, compatibility matrix | ✅ |
| **Work Items** | Features, bugs, hotfixes and their linkage to PRs/releases | ✅ |
| **Release** | Cross-repo release aggregate, channel state, release notes | ✅ |
| **Merge** | Pending merges, conflicts, approvals, merge history | ✅ |
| **Deployment** | Channel deploy state, version pointers, rollback, history | ✅ (tracking) |
| **Git Provider Integration** | Adapters, webhooks, PR/tag/release sync | ✅ (GitHub) |
| **Notification** | Channel routing, templates, delivery | ✅ |
| **Audit** | Immutable action log | ✅ |
| **CI/CD Orchestration** | Pipeline definitions, runs, approvals | 🔜 |
| **Environment & Secrets** | Env vars, secrets, certs, domains | 🔜 |
| **Infrastructure** | Servers, K8s, Docker, cloud, datastores | 🔜 |
| **Observability** | Metrics, logs, traces, dashboards | 🔜 |
| **Security Center** | SAST/DAST/SCA, secrets, license, container scan | 🔜 |
| **Feature Flags** | Targeted flag evaluation | 🔜 |
| **Tenant & Licensing** | Multi-tenant OMS state, modules, migrations | 🔜 |
| **DB Migration Center** | Migration versions, rollback, compatibility | 🔜 |
| **Config Management** | Versioned central config + env overrides | 🔜 |
| **API Gateway Mgmt** | Routes, rate limits, policies, API versions | 🔜 |
| **Microservice Registry** | Service catalog, dependencies, health | 🔜 |
| **Incident Mgmt** | Incidents, RCA, postmortems | 🔜 |
| **AI Assistant** | Risk, reviewer rec, breaking-change detection | 🔜 |
| **Analytics & Executive** | DORA metrics, dashboards | 🔜 |

**Why a full map now:** naming every context up front means the MVP's database, events, and service boundaries reserve the right seams. The roadmap modules already have a home.

---

# PART C — MVP SPECIFICATION (build this first)

## C.1 MVP deployable topology

To avoid premature microservice sprawl, the MVP ships as **four deployables** plus shared infrastructure:

1. **`helm-api`** — the modular monolith holding all domain contexts marked ✅ above, exposed as REST + GraphQL. Internally split into modules with their own service/repository classes and *no* cross-module DB access (modules talk via service interfaces and events).
2. **`helm-worker`** — async consumers (git-sync, notifier, audit-writer, release-notes-generator, analytics-rollup). Same codebase as `helm-api`, different entrypoint.
3. **`helm-webhooks`** — a tiny, independently scalable ingress that receives provider webhooks (GitHub), verifies signatures, and drops normalized events on the bus. Kept separate so a webhook storm can't starve the main API.
4. **`helm-web`** — the React SPA.

Shared infra: **PostgreSQL** (primary store), **Redis** (cache + Streams event bus + queues), **object storage (S3-compatible)** for release-note artifacts/exports.

**Why this split:** webhook ingress and async workers have different scaling and failure profiles than the request/response API, so they're separate processes from day one — but they share the domain code, so we don't pay the cost of independent services/databases yet. When a context (say Deployment) needs to scale or deploy independently, it lifts out cleanly because it already has its own module boundary and event contracts.

## C.2 Recommended technology stack (MVP) with rationale

| Concern | Choice | Why |
|---|---|---|
| **Core API language/runtime** | **NestJS (TypeScript)** | The org already runs NestJS (Auth, Queue services) — reuse skills, libraries, conventions. Strong module system maps 1:1 to bounded contexts; first-class DI makes the `GitProvider` interface and event handlers clean. |
| **Alt considered** | Laravel (PHP) | Team also knows Laravel 11; viable. NestJS chosen because the platform is integration/event-heavy (TS typing of provider payloads, websockets, queue ergonomics) and shares types with the React frontend. |
| **Frontend** | **React + TypeScript + Vite**, TanStack Query, Zustand, Tailwind, shadcn/ui | Matches existing Frontend repo skills. TanStack Query fits an API-first, cache-heavy dashboard. |
| **Primary DB** | **PostgreSQL 16** | Relational integrity for releases↔repos↔commits; JSONB for flexible metadata; mature, HA-friendly. |
| **Cache / bus / queue (MVP)** | **Redis 7** (Streams + Sorted Sets) | One dependency covers cache, the event bus (Streams + consumer groups), and job queues (BullMQ). Lowers ops burden at MVP scale. |
| **Event bus (scale-out)** | **NATS JetStream** or **Kafka** | Drop-in for Redis Streams when throughput/retention demands grow; abstracted behind an `EventBus` port. |
| **ORM / migrations** | **Prisma** or **TypeORM** | Typed schema, first-class migrations (which this platform itself models for others). |
| **AuthN** | OIDC/SSO (Google/Azure AD) + the org's Authentication Service; JWT access + rotating refresh | Reuse the existing NestJS Auth Service; SSO is table stakes for an internal eng tool. |
| **API docs** | OpenAPI 3.1 (auto-generated) + GraphQL schema | API-first principle; clients self-serve. |
| **Containerization** | Docker + Docker Compose (dev), Kubernetes/Helm (prod) | Matches the OMS deployment target; the platform should dogfood K8s. |
| **CI for the platform itself** | GitHub Actions | GitHub-first; dogfood. |
| **Realtime** | WebSocket (Socket.IO) channel off the event bus | Live merge center, deploy dashboard, notifications. |

## C.3 Data model (PostgreSQL DDL)

Conventions: every table has `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`. Soft-delete via `deleted_at` where lifecycle matters. All money/time in UTC. The schema below is the build-ready MVP core (illustrative columns shown; indexes called out for hot paths).

### C.3.1 Identity & Access

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  display_name  text NOT NULL,
  avatar_url    text,
  sso_subject   text UNIQUE,              -- OIDC sub
  status        text NOT NULL DEFAULT 'active', -- active|suspended
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,       -- developer|qa|devops|release_manager|pm|admin
  name        text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false
);

CREATE TABLE permissions (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key  text UNIQUE NOT NULL              -- e.g. release.create, deploy.approve.production
);

CREATE TABLE role_permissions (
  role_id       uuid REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Roles can be scoped: global, or per-repository, or per-channel
CREATE TABLE user_role_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id      uuid REFERENCES roles(id),
  scope_type   text NOT NULL DEFAULT 'global', -- global|repository|channel
  scope_id     uuid,                            -- null for global
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id, scope_type, scope_id)
);

CREATE TABLE api_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  token_hash  text NOT NULL,             -- store hash only
  scopes      text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### C.3.2 Repository, Branch, Version

```sql
CREATE TABLE repositories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,             -- "Master-BE"
  slug              text UNIQUE NOT NULL,
  provider          text NOT NULL DEFAULT 'github', -- github|gitlab|bitbucket
  provider_full_name text NOT NULL,            -- "org/Master-BE"
  default_branch    text NOT NULL DEFAULT 'main',
  tech_stack        text[] NOT NULL DEFAULT '{}', -- ['laravel','php']
  docker_image_name text,                       -- "registry/storemate/master-be"
  container_registry text,
  metadata          jsonb NOT NULL DEFAULT '{}',-- arbitrary extra fields
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Declarative branch-protection policy (data, not code)
CREATE TABLE branch_protection_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id   uuid REFERENCES repositories(id) ON DELETE CASCADE,
  pattern         text NOT NULL,               -- 'main','release/*'
  require_reviews int NOT NULL DEFAULT 1,
  require_status_checks text[] NOT NULL DEFAULT '{}',
  enforce_linear_history boolean NOT NULL DEFAULT false,
  restrict_push_roles text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Cached/synced branch state (Git remains source of truth)
CREATE TABLE branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL,    -- main|feature|bugfix|hotfix|release
  head_sha      text,
  ahead_of_main int,              -- cached comparison
  behind_main   int,
  last_commit_at timestamptz,
  is_protected  boolean NOT NULL DEFAULT false,
  synced_at     timestamptz,
  UNIQUE (repository_id, name)
);
CREATE INDEX idx_branches_repo_type ON branches(repository_id, type);

CREATE TABLE service_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  version       text NOT NULL,    -- semver '1.7.0'
  channel       text,             -- channel where this version currently lives
  git_tag       text,
  commit_sha    text,
  released_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, version)
);

-- Declared compatibility between service versions
CREATE TABLE version_compatibility (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id      uuid REFERENCES repositories(id),
  version            text NOT NULL,
  depends_repo_id    uuid REFERENCES repositories(id),
  compatible_range   text NOT NULL,  -- semver range '>=1.6.0 <1.8.0'
  UNIQUE (repository_id, version, depends_repo_id)
);
```

### C.3.3 Work items (features, bugs, hotfixes)

```sql
CREATE TABLE work_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,    -- feature|bug|hotfix
  ref_code      text UNIQUE,      -- 'FEAT-128','BUG-91','HOT-12'
  title         text NOT NULL,
  description   text,
  priority      text,             -- critical|high|medium|low (bugs/hotfixes)
  developer_id  uuid REFERENCES users(id),
  repository_id uuid REFERENCES repositories(id),
  branch_name   text,
  pr_number     int,
  status        text NOT NULL DEFAULT 'open', -- open|in_review|merged|verified|released
  deployment_status text,         -- not_deployed|canary|beta|production|enterprise
  release_id    uuid,             -- set when attached to a release (FK below)
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_work_items_release ON work_items(release_id);
CREATE INDEX idx_work_items_repo_status ON work_items(repository_id, status);
```

**Why one `work_items` table with a `type`:** features, bugs, and hotfixes share ~90% of their fields and all need the same release/PR/deployment linkage. A single table with typed rows keeps queries (e.g. "everything in release 1.7.0") trivial and avoids three near-identical schemas. Type-specific fields live in `metadata` JSONB or typed columns. *Why not separate tables:* cross-type queries and the Merge Center would need unions everywhere.

### C.3.4 Release (the aggregate)

```sql
CREATE TABLE releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       text NOT NULL,          -- platform-level release '1.7.0'
  name          text,
  status        text NOT NULL DEFAULT 'draft',
     -- draft|canary|beta|production|enterprise|archived
  channel       text,                   -- current live channel
  release_notes_md text,
  notes_generated_at timestamptz,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);

-- A release pins each included repo to an exact commit + version
CREATE TABLE release_repositories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    uuid REFERENCES releases(id) ON DELETE CASCADE,
  repository_id uuid REFERENCES repositories(id),
  version       text NOT NULL,          -- '1.7.0' for Master-BE
  commit_sha    text NOT NULL,
  branch_name   text,                   -- e.g. 'release/1.7.0'
  git_tag       text,
  UNIQUE (release_id, repository_id)
);

-- work_items.release_id FK
ALTER TABLE work_items
  ADD CONSTRAINT fk_work_items_release
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE SET NULL;

-- Channel state transitions for a release (the Canary→...→Enterprise flow)
CREATE TABLE release_channel_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid REFERENCES releases(id) ON DELETE CASCADE,
  channel     text NOT NULL,            -- canary|beta|production|enterprise
  action      text NOT NULL,            -- promoted|rolled_back
  from_status text,
  approved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Why `release_repositories` is the heart of the model:** it captures the exact cross-repo snapshot — Master-BE 1.7.0 @ sha, Order-BE 1.7.0 @ sha, Report-BE 1.6.8 @ sha — that "version synchronization" and "cross-repository releases" require. Promotion, rollback, and the compatibility matrix all read from this one table.

### C.3.5 Merge Center

```sql
CREATE TABLE merge_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid REFERENCES repositories(id),
  provider_pr_number int,
  source_branch text NOT NULL,
  target_branch text NOT NULL,
  work_item_id  uuid REFERENCES work_items(id),
  release_id    uuid REFERENCES releases(id),
  title         text,
  author_id     uuid REFERENCES users(id),
  state         text NOT NULL DEFAULT 'pending',
     -- pending|conflict|approved|merged|closed
  has_conflicts boolean NOT NULL DEFAULT false,
  conflict_files text[],
  review_state  text,    -- approved|changes_requested|review_required
  mergeable     boolean,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_merge_state ON merge_requests(state);

CREATE TABLE merge_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_request_id uuid REFERENCES merge_requests(id) ON DELETE CASCADE,
  approver_id uuid REFERENCES users(id),
  decision    text NOT NULL,  -- approved|rejected
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### C.3.6 Deployment tracking

```sql
CREATE TABLE deployments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      uuid REFERENCES releases(id),
  channel         text NOT NULL,        -- canary|beta|production|enterprise
  status          text NOT NULL,        -- pending|in_progress|success|failed|rolled_back
  current_version text,
  previous_version text,
  rollback_target text,
  triggered_by    uuid REFERENCES users(id),
  approved_by     uuid REFERENCES users(id),
  started_at      timestamptz,
  finished_at     timestamptz,
  log_url         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deploy_channel ON deployments(channel, created_at DESC);
```

### C.3.7 Notifications & Audit

```sql
CREATE TABLE notification_channels (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type      text NOT NULL,      -- email|slack|teams|discord
  config    jsonb NOT NULL,     -- webhook url, channel id (secrets via secret store ref)
  events    text[] NOT NULL,    -- which event types route here
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid REFERENCES notification_channels(id),
  event_type  text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'queued', -- queued|sent|failed
  attempts    int NOT NULL DEFAULT 0,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only; never UPDATE/DELETE
CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid,
  actor_email  text,
  action       text NOT NULL,        -- 'release.promoted'
  entity_type  text NOT NULL,        -- 'release'
  entity_id    uuid,
  repository_id uuid,
  old_value    jsonb,
  new_value    jsonb,
  ip_address   inet,
  user_agent   text,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_actor_time ON audit_logs(actor_id, created_at DESC);
```

**Why audit is append-only with a bigint identity:** immutability is the whole point; using a monotonic identity (not UUID) keeps the hottest-written table's index compact and time-ordered. Partition by month (`created_at`) when volume grows.

## C.4 Event-driven architecture

### C.4.1 The event contract

Every domain mutation emits an event with a stable envelope:

```json
{
  "event_id": "uuid",
  "type": "release.promoted",
  "version": 1,
  "occurred_at": "2026-06-29T10:00:00Z",
  "actor": { "id": "uuid", "email": "..." },
  "subject": { "type": "release", "id": "uuid" },
  "data": { "from": "beta", "to": "production", "release_version": "1.7.0" },
  "trace": { "request_id": "...", "ip": "...", "user_agent": "..." }
}
```

**Why a versioned envelope:** consumers (audit, notifier, future AI) must keep working as payloads evolve. `version` + additive-only changes = no consumer breakage.

### C.4.2 Canonical MVP event catalog

| Event | Emitted when | Primary consumers |
|---|---|---|
| `repository.registered` | Repo added | audit, git-sync |
| `branch.created` / `branch.deleted` | Branch lifecycle | audit, notifier |
| `pr.opened` / `pr.merged` / `pr.closed` | PR webhook from provider | merge-center, work-item sync, notifier, audit |
| `merge.conflict_detected` | Sync finds conflicts | merge-center, notifier |
| `merge.approved` | Approval recorded | merge-center, audit |
| `workitem.status_changed` | Feature/bug/hotfix transitions | release, audit |
| `hotfix.created` | Hotfix branch auto-created | notifier, audit, release |
| `release.created` / `release.updated` | Release draft changes | audit |
| `release.promoted` | Channel transition | deployment, notifier, audit, analytics |
| `release.notes_generated` | Notes built | notifier |
| `deployment.started/succeeded/failed/rolled_back` | Deploy state | notifier, analytics, audit |

**The pattern:** producers never call notifier/audit/analytics directly. They publish; consumers react. Adding the Security Center later means subscribing to `pr.merged` and `release.promoted` — zero changes to the Release service.

### C.4.3 Transactional outbox

Domain writes and event publishes must be atomic. Each service writes the event to an `outbox` table *in the same DB transaction* as the state change; a relay process tails the outbox and publishes to the bus, marking rows sent.

```sql
CREATE TABLE event_outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  published    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_unpublished ON event_outbox(id) WHERE published = false;
```

**Why outbox:** without it, a crash between "commit DB" and "publish event" loses the event (no notification, no audit). The outbox makes the event a durable part of the same transaction — exactly-once-ish delivery with at-least-once semantics and idempotent consumers.

## C.5 Queue design

Three job classes on **BullMQ (Redis)** in the MVP, each its own queue with independent concurrency and retry:

| Queue | Jobs | Retry policy | Why isolated |
|---|---|---|---|
| `git-sync` | Fetch branches/PRs/commits/tags from provider; compute conflicts | Exponential backoff, 5 tries, respects provider rate-limit headers | Provider latency/rate limits must not block notifications |
| `notifications` | Deliver to Slack/Teams/Discord/Email | 3 tries, dead-letter on fail | Flaky third-party endpoints shouldn't retry-storm core |
| `general` | Release-notes generation, analytics rollups, exports | 3 tries | CPU-heavier, lower priority |

Cross-cutting rules: every job is **idempotent** (keyed by `event_id`/natural key), **dead-letter queue** per queue for poison messages, **rate-limited** per external provider, and **observable** (job metrics exported). Scheduled/cron jobs (periodic full git-sync reconciliation, stale-branch detection, token-expiry warnings) run via BullMQ repeatable jobs.

**Why Redis/BullMQ now, Kafka/NATS later:** at MVP volume one Redis handles cache+bus+queues with minimal ops. The `EventBus` and `Queue` ports are interfaces, so swapping to NATS JetStream/Kafka is a config change when retention, replay, or throughput demand it.

## C.6 API design

**Conventions:** REST for resource CRUD and actions; GraphQL for read-heavy dashboard composition (avoids N+1 round trips when a screen needs release + repos + work items + deployments). All endpoints under `/api/v1`. Versioning in the path. Auth via `Authorization: Bearer <jwt|token>`. Standard error envelope `{ "error": { "code", "message", "details" } }`. Pagination cursor-based. Every mutating endpoint requires a permission (see C.8) and emits an event.

### C.6.1 Representative REST endpoints

```
# Repositories
GET    /api/v1/repositories
POST   /api/v1/repositories                 perm: repository.manage
GET    /api/v1/repositories/{id}
PATCH  /api/v1/repositories/{id}
GET    /api/v1/repositories/{id}/branches
POST   /api/v1/repositories/{id}/branches    {name,type,from_sha}  perm: branch.create
DELETE /api/v1/repositories/{id}/branches/{name}                   perm: branch.delete
GET    /api/v1/repositories/{id}/branches/compare?base=&head=
GET    /api/v1/repositories/{id}/commits?branch=&since=
GET    /api/v1/repositories/{id}/protection-rules
PUT    /api/v1/repositories/{id}/protection-rules

# Versions & compatibility
GET    /api/v1/repositories/{id}/versions
POST   /api/v1/repositories/{id}/versions
GET    /api/v1/versions/compatibility-matrix?release={id}

# Work items (features / bugs / hotfixes)
GET    /api/v1/work-items?type=feature&status=&repository=&release=
POST   /api/v1/work-items
PATCH  /api/v1/work-items/{id}
POST   /api/v1/work-items/{id}/attach-release {release_id}

# Hotfix automation
POST   /api/v1/hotfixes  {repository_id, base_channel, title, developer_id}
       -> auto-creates hotfix/* branch, work_item, draft merge-backs

# Releases
GET    /api/v1/releases
POST   /api/v1/releases                       perm: release.create
GET    /api/v1/releases/{id}
PATCH  /api/v1/releases/{id}
POST   /api/v1/releases/{id}/repositories     {repository_id,version,commit_sha}
POST   /api/v1/releases/{id}/promote          {to_channel}  perm: deploy.approve.{channel}
POST   /api/v1/releases/{id}/rollback         {to_release_id}
POST   /api/v1/releases/{id}/generate-notes
POST   /api/v1/releases/{id}/archive

# Merge center
GET    /api/v1/merges?state=pending|conflict|approved
POST   /api/v1/merges/{id}/approve            perm: merge.approve
POST   /api/v1/merges/{id}/merge              perm: merge.execute   # one-click merge
GET    /api/v1/merges/history?repository=

# Deployments
GET    /api/v1/deployments?channel=
GET    /api/v1/deployments/dashboard          # channel pipeline view
POST   /api/v1/deployments/{id}/mark          {status}  # MVP: status tracking

# Users / RBAC
GET    /api/v1/users
POST   /api/v1/users/{id}/roles               perm: user.manage
GET    /api/v1/roles ; POST /api/v1/roles ; PUT /api/v1/roles/{id}/permissions

# Notifications / Audit
GET/POST /api/v1/notification-channels
GET    /api/v1/audit-logs?entity=&actor=&from=&to=   perm: audit.read

# Webhooks (provider -> platform)
POST   /api/v1/webhooks/github   (HMAC-verified, handled by helm-webhooks)
```

### C.6.2 GraphQL (dashboard reads)

A single `release(version)` query resolves the release, its pinned repos+versions, included work items grouped by type, current channel state, latest deployments per channel, and the compatibility matrix — one round trip for the release detail screen. Subscriptions (`onDeploymentChanged`, `onMergeUpdated`) push live updates over WebSocket.

**Why REST+GraphQL hybrid:** mutations and integrations want predictable, cacheable REST with clear permissions and audit; dashboards want flexible aggregation. Using each where it's strong avoids both bespoke "fat" REST endpoints and mutation-heavy GraphQL.

## C.7 Frontend module structure

```
helm-web/src/
  app/                      # router, providers, auth guard, layout shell
  shared/                   # ui kit (shadcn), api client, hooks, rbac <Can/>
  modules/
    repositories/           # list, detail, register, protection rules
    branches/               # branch explorer, compare, commit history, conflicts
    releases/               # release board, detail, repo pinning, promote/rollback
    versions/               # version matrix, compatibility view
    work-items/             # feature/bug/hotfix tables + kanban
    merge-center/           # pending/conflicts/approvals/history, one-click merge
    deployments/            # channel pipeline dashboard (Canary→Enterprise)
    release-notes/          # generated notes preview/edit/publish
    users/                  # users, roles, permission matrix
    notifications/          # channel config, event routing
    audit/                  # searchable audit log
    settings/               # org/provider/integration config
  realtime/                 # socket client, event→cache invalidation
```

Each module owns its routes, API hooks (TanStack Query), and components; shared `<Can permission="release.create">` gates UI by RBAC. **Why mirror backend bounded contexts:** a developer working on "merge-center" touches one backend module and one frontend module; ownership and code review stay clean as the team grows. Modules are lazy-loaded so the bundle scales with features, not page weight.

## C.8 Permission model

**Model:** RBAC with **scoped assignments** and fine-grained, namespaced permission keys (`resource.action[.qualifier]`). Roles bundle permissions; a user gets roles globally or scoped to a repository or channel.

### C.8.1 Default roles → key permissions (MVP)

| Permission | Dev | QA | DevOps | Release Mgr | PM | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `repository.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repository.manage` | | | ✓ | | | ✓ |
| `branch.create` | ✓ | | ✓ | ✓ | | ✓ |
| `branch.delete` | | | ✓ | ✓ | | ✓ |
| `workitem.create` | ✓ | ✓ | | ✓ | ✓ | ✓ |
| `workitem.verify` | | ✓ | | ✓ | | ✓ |
| `merge.approve` | ✓* | | ✓ | ✓ | | ✓ |
| `merge.execute` | | | ✓ | ✓ | | ✓ |
| `hotfix.create` | ✓ | | ✓ | ✓ | | ✓ |
| `release.create` | | | | ✓ | | ✓ |
| `release.edit` | | | ✓ | ✓ | | ✓ |
| `deploy.approve.canary` | | | ✓ | ✓ | | ✓ |
| `deploy.approve.beta` | | ✓ | ✓ | ✓ | | ✓ |
| `deploy.approve.production` | | | | ✓ | | ✓ |
| `deploy.approve.enterprise` | | | | ✓ | | ✓ |
| `deploy.rollback` | | | ✓ | ✓ | | ✓ |
| `user.manage` | | | | | | ✓ |
| `audit.read` | | | ✓ | ✓ | ✓ | ✓ |

*\*Dev `merge.approve` is typically scoped to repos they own.*

**Why scoped RBAC with namespaced keys (not plain global roles):** a growing org needs "DevOps for Order-BE but read-only elsewhere" and "production approval only by Release Managers." Per-channel deploy permissions (`deploy.approve.production`) encode the four-channel gate directly. Permissions are data (`role_permissions`), so the org reconfigures policy without a deploy. The model is forward-compatible with ABAC (add condition predicates to assignments) if needed later.

## C.9 Core workflows

### C.9.1 Git workflow (the branching model the platform enforces)

Trunk-based with short-lived branches and per-release stabilization branches:

```
main ─────●─────●─────────●───────────●──────────►  (always releasable)
           \     \         \           ▲
   feature/* \     bugfix/*  \          │ merge-back
              ●──PR──►main     ●──PR──►main
                                         │
release/1.7.0  ●───(cut from main)───●──┴── stabilization, only bugfixes cherry-picked
                                      │
hotfix/1.7.1   ●──(cut from release/prod tag)──► merge to main AND active release/*
```

Rules the platform enforces via policy + automation:
- `feature/*`, `bugfix/*` branch from `main`, merge to `main` via PR.
- `release/x.y.0` is cut from `main` at a chosen SHA; only targeted bugfixes are cherry-picked in. The release object pins each repo's SHA.
- `hotfix/*` is cut from the *production* tag, and on merge the platform **automatically opens merge-backs into `main` and every active `release/*`** so fixes never get lost — the single most error-prone manual step today.

**Why trunk-based + release branches instead of long-lived per-environment branches:** the current pain is maintaining four long-lived environment branches and reconciling them. Replacing them with *channels as promotion state on a release* (data) plus short-lived `release/*` branches eliminates perpetual branch divergence. Environments stop being branches and become deployment targets fed by promotion.

### C.9.2 Release workflow

```
Draft ──► Canary ──► Beta ──► Production ──► Enterprise ──► Archived
  │          │         │          │              │
  │   (each arrow = promote, gated by deploy.approve.{channel} + checks)
  └─ assemble: pick repos, pin SHAs/versions, attach features/bugs/hotfixes,
     run compatibility check, generate notes
```

1. **Assemble (Draft):** Release Manager creates release `1.7.0`, adds repositories with pinned commit SHAs and versions, attaches work items. Platform runs the **compatibility matrix** check and flags mismatches (e.g. Report-BE 1.6.8 vs declared ranges).
2. **Promote Canary → Beta → Production → Enterprise:** each promotion requires the channel's approval permission and passing gates (all attached work items in required status, no open blocking conflicts). Each transition writes `release_channel_history`, emits `release.promoted`, and notifies.
3. **Rollback:** sets a deployment's `rollback_target` to the previous release's pinned SHAs and emits events.
4. **Archive:** terminal; release becomes read-only history.

### C.9.3 Deployment workflow (MVP = orchestration/tracking; Phase 2 = execution)

In the MVP the platform **tracks and gates** deployments (status, version pointers, rollback target, history, approvals) while the actual deploy is triggered in existing CI (GitHub Actions) — the platform calls the workflow_dispatch API and records results via webhook/callback. The Deployment context's interface is identical to what the future CI/CD Orchestration module will implement, so Phase 2 swaps tracking for native execution with no API change for clients.

**Why track-before-execute:** it delivers the coordination/visibility value immediately and safely (no production-deploy authority concentrated in a new, unproven system) while establishing the contract the full pipeline engine will fulfill later.

### C.9.4 Merge workflow (Merge Center)

Provider webhooks keep `merge_requests` in sync. The Merge Center surfaces four buckets — pending, conflict, approved, history. "One-click merge" calls the provider adapter to merge the PR (respecting branch-protection), updates the work item, and emits `pr.merged`. Conflicts detected during git-sync raise `merge.conflict_detected` and notify the author. **Why centralize:** today merges are scattered across repos; one board with consistent approval gates removes the "which PR in which repo is blocking the release?" problem.

## C.10 Git provider integration (the extensibility seam)

A single port defines every Git capability the platform needs; adapters implement it per provider.

```typescript
interface GitProvider {
  listBranches(repo): Promise<Branch[]>;
  createBranch(repo, name, fromSha): Promise<Branch>;
  deleteBranch(repo, name): Promise<void>;
  compareBranches(repo, base, head): Promise<Comparison>;   // ahead/behind, files
  listCommits(repo, branch, since?): Promise<Commit[]>;
  getPullRequest(repo, number): Promise<PullRequest>;
  createPullRequest(repo, src, dst, title, body): Promise<PullRequest>;
  mergePullRequest(repo, number, strategy): Promise<MergeResult>;
  closePullRequest(repo, number): Promise<void>;
  getReviewStatus(repo, number): Promise<ReviewStatus>;
  createTag(repo, name, sha): Promise<Tag>;
  createRelease(repo, tag, notes): Promise<Release>;
  detectConflicts(repo, src, dst): Promise<ConflictReport>;
  verifyWebhook(headers, body): boolean;
  normalizeWebhook(payload): DomainEvent;
}
```

Adapters: `GitHubProvider` (MVP, via Octokit + GitHub Apps for fine-grained tokens), then `GitLabProvider`, `BitbucketProvider`. **Why a GitHub App, not a PAT:** App installation tokens are short-lived, per-repo scoped, and rate-limited per installation — far safer and more scalable than a shared personal token as repo count grows. **Why the port abstraction:** "Future support: GitLab, Bitbucket" becomes two new classes and zero changes to Release/Merge/Branch logic.

---

# PART D — LONG-TERM ROADMAP (modules & where they plug in)

Each module is an event consumer and/or a new bounded context with its own tables. None requires redesigning the core; all attach via the event bus, the `GitProvider`/`Deployment` ports, or new ports following the same pattern.

### D.1 Phase 2 — CI/CD & Environments (makes the platform *do*, not just track)
- **CI/CD Pipeline Builder:** visual DAG editor (build→test→docker build→push→deploy→approval→rollback). Stored as versioned pipeline definitions (JSON/YAML); executed by a runner orchestrator (start with GitHub Actions dispatch, evolve to a native runner/Argo/Tekton). Implements the Deployment port from C.9.3.
- **Environment Management:** Development/QA/Staging/Canary/Beta/Production/Enterprise as first-class environments storing variables, secrets, certificates, domains. Secrets via a real secret backend (Vault/cloud KMS) — the platform stores *references*, never plaintext.

### D.2 Phase 3 — Infrastructure & Observability
- **Kubernetes Management** (clusters, namespaces, pods, deployments, ingress, Helm charts) via the K8s API.
- **Docker Management** (images, registries, tags, cleanup policies, history).
- **Infrastructure Management** (servers, VMs, cloud providers, databases, Redis, RabbitMQ, storage) — read-only inventory first, then actions.
- **Monitoring** integrations: Prometheus, Grafana, Loki, OpenTelemetry, Sentry; live dashboards embedded via their APIs/iframes.

### D.3 Phase 4 — Governance, Security & Multi-tenancy
- **Security Center:** dependency scanning (SCA), SAST, DAST, container scanning, secrets detection, license compliance — each a consumer of `pr.merged`/`release.promoted` that writes findings; unified security reports.
- **Feature Flag Management:** evaluate flags by tenant/customer/region/environment/version/subscription plan. SDK + edge evaluation; ties into Tenant Management.
- **Tenant Management:** since Storemate OMS is multi-tenant — tenants, licenses, enabled modules/features, DB version, migration status, deployment status per tenant.
- **Database Migration Center:** migration versions, rollback scripts, applied status, DB compatibility per service/tenant. Critical companion to cross-repo releases.
- **Configuration Management:** central, versioned config repository with environment overrides and full history.

### D.4 Phase 5 — Platform intelligence & gateway
- **API Gateway Management:** routes, rate limits, auth policies, JWT, API versions for the OMS's own gateway.
- **Microservice Registry:** service catalog with dependencies, owners, health, version, status (auto-populated from repositories + deployments + monitoring).
- **Incident Management:** incidents, RCA, recovery time, postmortems, linked releases (correlate incidents to `release.promoted` events for change-failure analysis).
- **AI Assistant:** consumes the event history + Git data to predict deployment failures, flag risky PRs, recommend reviewers, generate release notes, detect breaking changes, suggest rollback plans, estimate release risk, analyze incidents. Built as an isolated service reading the event stream and warehouse — *why last:* it needs the historical data the earlier phases generate.
- **Analytics & Executive Dashboards:** DORA metrics (deployment frequency, lead time, change failure rate, MTTR) plus repository activity, developer productivity, release success rate, environment stability; executive roll-ups (active releases, system health, team productivity, deployment trends, release calendar, infra status, security posture). Fed by an analytics rollup consumer into a read-optimized store (Postgres materialized views → ClickHouse/warehouse at scale).

**Sequencing logic:** track → execute (CI/CD) → see (infra/observability) → govern (security/tenant) → optimize (AI/analytics). Each phase produces the data the next phase consumes, so intelligence comes last by necessity, not accident.

---

# PART E — CROSS-CUTTING ENGINEERING

## E.1 Versioning strategy
- **Per-service semantic versioning** (`MAJOR.MINOR.PATCH`). Each repo versions independently (Master-BE 1.7.0, Report-BE 1.6.8) — they are decoupled microservices and must not be forced to a single lockstep number.
- **Release version** is a separate platform-level label that *pins* a set of service versions (the `release_repositories` snapshot). This is the "version synchronization" answer: services keep independent versions; the release records the validated combination.
- **Compatibility matrix** (`version_compatibility`) declares allowed dependency ranges; the assemble step validates the snapshot against it.
- **API versioning:** path-based (`/api/v1`) for the platform; event envelope carries `version` for additive evolution.

**Why decoupled service versions + a pinning release:** lockstep versioning forces every service to bump on any change — painful and false. Independent versions + an explicit pinned-and-validated release combination is how mature multi-repo orgs (and tools like a release "train") actually ship.

## E.2 Scalability strategy
- **Stateless services** (`helm-api`, `helm-webhooks`, `helm-worker`) scale horizontally behind a load balancer / as K8s Deployments with HPA on CPU + queue depth.
- **Separate read/write concerns:** dashboards hit read replicas / materialized views; the hot audit and outbox tables are partitioned by time.
- **Queue-based load leveling:** spikes (webhook storms, mass syncs) absorb into queues; workers drain at a controlled rate respecting provider limits.
- **Caching:** Redis caches branch/version/compatibility reads with event-driven invalidation (a `branch.created` event busts the relevant key).
- **Bus upgrade path:** Redis Streams → NATS JetStream/Kafka when event volume or replay/retention needs grow; consumers unaffected behind the `EventBus` port.
- **Data growth:** partition `audit_logs`, `event_outbox`, `deployments`, `notifications` by month; move analytics to a columnar store at scale.

**Why this scales with the org:** the bottlenecks that grow with repos/people (Git sync, webhooks, audit volume, dashboard reads) are each independently scalable, and the modular-monolith seams let any context become its own service when its load justifies it.

## E.3 High availability
- **No single points of failure:** ≥2 replicas of every stateless service across availability zones.
- **PostgreSQL:** primary + synchronous standby with automatic failover (Patroni / cloud-managed Multi-AZ RDS).
- **Redis:** clustered/Sentinel or managed HA; treat as cache+transport, with the DB outbox as the durable source so a Redis loss doesn't lose events.
- **Idempotent consumers + outbox** mean at-least-once delivery is safe across restarts.
- **Graceful degradation:** if a provider or notifier is down, jobs retry/dead-letter; the core stays up. The platform must never be a hard dependency for the OMS to *run* — only to *release*.

## E.4 Disaster recovery
- **Backups:** automated PITR for PostgreSQL (continuous WAL archiving), daily snapshots, object-storage versioning; backups tested by periodic restore drills.
- **RPO/RTO targets (proposed):** RPO ≤ 5 min (WAL shipping), RTO ≤ 30 min (managed failover + IaC re-provision).
- **Infrastructure as Code:** the whole platform reproducible from Terraform + Helm; recovery is "re-apply IaC + restore DB."
- **Source of truth resilience:** because Git is the system of record for code, the worst-case platform loss is recoverable — re-sync from providers rebuilds branch/PR/commit caches; only orchestration metadata (releases, approvals, audit) needs DB restore, hence its rigorous backup.
- **Runbooks:** documented for DB failover, region failover, provider outage, and event-bus rebuild from outbox.

## E.5 Security
- **AuthN:** SSO/OIDC, MFA enforced, short-lived JWT + rotating refresh; API tokens hashed at rest, scoped, expiring.
- **AuthZ:** RBAC enforced at the API boundary on every mutation (C.8); production/enterprise promotion gated behind dedicated permissions.
- **Secrets:** never in DB plaintext — references to Vault/cloud KMS; webhook secrets and provider tokens encrypted; GitHub App keys in KMS.
- **Webhook security:** HMAC signature verification in `helm-webhooks`; replay protection via delivery-id dedupe.
- **Audit everything:** the append-only log (actor, time, repo, old/new, IP, UA) satisfies compliance and forensic needs.
- **Transport:** TLS everywhere; mTLS between internal services when split out.
- **Supply chain (matures in Security Center):** signed images, SBOMs, scanning gates on release promotion.

## E.6 Observability (for the platform itself)
Structured JSON logs with `request_id` correlation; metrics (RED/USE) to Prometheus; distributed tracing via OpenTelemetry; queue depth, job latency, event-lag, and provider-rate-limit dashboards in Grafana; error tracking via Sentry. The platform dogfoods the monitoring stack it will later manage.

---

# PART F — DELIVERY PLAN

## F.1 Phasing

| Phase | Theme | Key deliverables | Rough effort |
|---|---|---|---|
| **0** | Foundations | Repo scaffolding, auth/SSO, RBAC, DB + migrations, event bus + outbox, GitHub adapter, audit | 4–6 wks |
| **1a** | Core release engine | Repositories, Branches, Versions, Work Items, Releases + pinning, compatibility check | 6–8 wks |
| **1b** | Coordination surfaces | Merge Center, Deployment tracking dashboard, Release Notes generation, Notifications | 5–7 wks |
| **1c** | Hardening | HA, backups/DR drills, observability, security review, docs | 3–4 wks |
| **2** | CI/CD + Environments | Pipeline builder, env/secrets, native deploy execution | next |
| **3+** | Per Part D roadmap | Infra, observability, security, tenant, AI, analytics | ongoing |

**MVP = Phases 0–1c.** That delivers the centralized, automated release engineering the org needs now, on an architecture that absorbs every roadmap module.

## F.2 Team shape (suggested)
A small platform pod can ship the MVP: 1 tech lead/architect, 2–3 backend (NestJS), 1–2 frontend (React), with DevOps/SRE part-time for infra and a Release Manager as product owner. The modular structure lets backend engineers own contexts independently.

## F.3 Definition of done for MVP
Every MVP module is "done" when it has: API with OpenAPI docs, RBAC enforcement, emitted domain events, audit coverage, automated tests (unit + integration against a GitHub sandbox), a UI module, and a runbook. A release can be assembled across all current repos, promoted Canary→Enterprise with approvals, auto-generate notes, notify all four channels, and produce a complete audit trail — with hotfix branches auto-created and auto-merged-back.

---

# PART G — GAP ANALYSIS & MISSING FUNCTIONS

A review of v1.0 against the spec and against production realities surfaced capabilities that were implied but not designed. They are added here. Each is small relative to the core but removes a real operational gap.

## G.1 Gap summary

| # | Gap | Risk if omitted | Added in |
|---|---|---|---|
| 1 | **Approval policy engine** (who must approve which gate, quorum, self-approval) | Promotions can be approved by the wrong person; no quorum | G.2 |
| 2 | **Automated rollback execution & health gates** | Rollback was data-only; no trigger logic | G.3 |
| 3 | **Outbound webhooks** (platform → external systems) | Third parties can't subscribe to platform events | G.4 |
| 4 | **Global search & saved filters** | Finding "which PR blocks 1.7.0" is manual | G.5 |
| 5 | **Idempotency, optimistic concurrency, rate limiting** | Double-promotes, lost updates, abuse | G.6 |
| 6 | **Import/bulk-onboarding & export** | Registering many repos by hand; no data portability | G.7 |
| 7 | **Health, readiness & status surfaces** | No self-health; ops blind | G.8 |
| 8 | **Release calendar, freeze windows & scheduling** | Conflicting/holiday deploys; no change freeze | G.9 |
| 9 | **Comments / activity feed on entities** | Coordination happens off-platform | G.10 |
| 10 | **Provider sync reconciliation & drift detection** | Cache silently diverges from Git | G.11 |
| 11 | **Soft-delete, archival & data retention** | Accidental loss; unbounded growth | G.12 |
| 12 | **Settings/feature-config service** | Org policy hardcoded | G.13 |
| 13 | **Dependency / blocking model for work items & releases** | Releases ship missing prerequisites | G.14 |

## G.2 Approval policy engine

Promotion gates were enforced only by a static permission. Real release governance needs *configurable* policies: how many approvals, from which roles, whether the author can self-approve, and which automated checks must pass.

```sql
CREATE TABLE approval_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  applies_to      text NOT NULL,        -- channel:production | release | merge
  scope_id        uuid,                 -- optional repo/channel scope
  min_approvals   int NOT NULL DEFAULT 1,
  required_roles  text[] NOT NULL DEFAULT '{}',   -- e.g. {release_manager}
  allow_self_approval boolean NOT NULL DEFAULT false,
  required_checks text[] NOT NULL DEFAULT '{}',    -- e.g. {ci_passing,no_open_conflicts,compat_ok}
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     uuid REFERENCES approval_policies(id),
  subject_type  text NOT NULL,          -- release|merge|deployment
  subject_id    uuid NOT NULL,
  gate          text,                   -- 'promote:production'
  state         text NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired
  required_approvals int NOT NULL,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approval_decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid REFERENCES approval_requests(id) ON DELETE CASCADE,
  approver_id        uuid REFERENCES users(id),
  decision           text NOT NULL,     -- approved|rejected
  comment            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_request_id, approver_id)
);
```

A promotion now creates an `approval_request` from the matching policy; it can only proceed when decisions satisfy `min_approvals` from `required_roles` and all `required_checks` pass. **Why data-driven:** the four-channel governance differs per channel (Canary may auto-approve; Production needs two Release Managers) and will change — policy as data avoids redeploys.

## G.3 Automated rollback & health gates

v1.0 stored a `rollback_target` but never defined the trigger. Added:

- **Health gate definition** per channel: after a deployment reaches `success`, the platform polls configured health checks (HTTP endpoint, monitoring query) for a soak window. Failure within the window triggers **auto-rollback** to `rollback_target`.
- **Manual rollback** action remains (perm `deploy.rollback`), now driving the same execution path.
- New events `deployment.health_check_failed`, `deployment.auto_rollback_triggered`.

```sql
CREATE TABLE health_gates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL,
  check_type    text NOT NULL,        -- http|prometheus|manual
  config        jsonb NOT NULL,       -- url/query/threshold
  soak_seconds  int NOT NULL DEFAULT 300,
  auto_rollback boolean NOT NULL DEFAULT true
);
```

**Why:** "rollback target" without an automated trigger is a checklist item, not a safety net. Health-gated promotion is what makes Canary→Beta progression trustworthy.

## G.4 Outbound webhooks

The platform consumes provider webhooks but had no way for *external* systems (an internal portal, a data pipeline, a customer's tooling) to subscribe to platform events.

```sql
CREATE TABLE outbound_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text NOT NULL,
  secret_ref  text NOT NULL,          -- HMAC signing key reference
  events      text[] NOT NULL,        -- subscribed event types
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbound_webhook_deliveries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_id  uuid REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL,
  status      text NOT NULL,          -- pending|delivered|failed
  response_code int,
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Deliveries are signed (HMAC), retried with backoff, and dead-lettered — same machinery as notifications. **Why:** an API-first platform must be subscribable, not just queryable; this is how the org's other tools integrate without polling.

## G.5 Global search & saved filters

A cross-entity search service (releases, repos, branches, work items, PRs by id/title/SHA/author) backed by Postgres full-text (`tsvector` columns + GIN indexes) in the MVP, swappable for OpenSearch at scale via a `SearchIndex` port. Users can persist named filters per module (e.g. "my open hotfixes", "conflicts blocking 1.7.0").

```sql
CREATE TABLE saved_filters (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  module    text NOT NULL,
  name      text NOT NULL,
  query     jsonb NOT NULL
);
```

**Why:** the platform's core value is answering "what's blocking this release?" fast; search is that capability made first-class.

## G.6 Idempotency, optimistic concurrency, rate limiting

- **Idempotency keys:** all unsafe POSTs accept an `Idempotency-Key` header; the platform stores key→result for 24h so retries (network, double-click) don't double-promote or double-merge.
- **Optimistic concurrency:** mutable resources carry a `version int` (or `ETag`); `PATCH`/promote require `If-Match`; mismatch → `409 conflict`. Prevents lost updates when two Release Managers edit one release.
- **Rate limiting:** per-token and per-IP at the gateway (sliding window in Redis); separate, higher limits for service tokens.

```sql
CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  user_id     uuid,
  request_hash text NOT NULL,
  response    jsonb,
  status_code int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Why:** release actions are high-consequence and frequently retried; these three controls are what make a multi-user, automation-driven API safe.

## G.7 Import / bulk onboarding & export

- **Bulk repo import:** point at a GitHub org/installation; the platform lists repos and registers selected ones with sensible metadata defaults — onboarding the growing repo list in minutes, not one form at a time.
- **Export:** any release (manifest of repos/SHAs/versions/work items) and audit ranges export to JSON/CSV/PDF for compliance and stakeholder sharing.

New endpoints in H; new events `repository.bulk_imported`, `release.exported`.

## G.8 Health, readiness & status

Every deployable exposes `/healthz` (liveness), `/readyz` (DB/Redis/bus reachable), `/metrics` (Prometheus). A public-internal `/api/v1/status` aggregates dependency health (provider API reachability, queue depth, event lag, last successful sync per repo) for an at-a-glance platform status page. **Why:** the platform that monitors others must be observable itself; ops needs a single status surface.

## G.9 Release calendar, freeze windows & scheduling

```sql
CREATE TABLE freeze_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  channels    text[] NOT NULL,        -- which channels are frozen
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  override_roles text[] NOT NULL DEFAULT '{admin}'
);

CREATE TABLE scheduled_promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid REFERENCES releases(id),
  to_channel  text NOT NULL,
  run_at      timestamptz NOT NULL,
  state       text NOT NULL DEFAULT 'scheduled', -- scheduled|done|cancelled
  created_by  uuid REFERENCES users(id)
);
```

Promotions during an active freeze are blocked unless the actor holds an override role. A read-only **release calendar** view aggregates scheduled promotions, freeze windows, and historical deploys. **Why:** change freezes (holidays, peak retail) and scheduled releases are standard release-management needs the spec's executive "release calendar" implies.

## G.10 Comments & activity feed

A polymorphic comment/activity model so discussion and the chronological event history live on the entity (release, work item, merge), not in scattered chats.

```sql
CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  author_id   uuid REFERENCES users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

The **activity feed** per entity is a projection over `audit_logs` + `comments`. **Why:** keeps the "why did we do this?" context attached to the release forever.

## G.11 Provider sync reconciliation & drift detection

Beyond webhook-driven updates, a scheduled **reconciliation job** periodically full-syncs each repo (branches, open PRs, tags) and flags drift between cached state and the provider (e.g. a branch deleted directly on GitHub). Surfaces a `sync_status` per repo (`healthy|stale|error`, `last_synced_at`) and emits `repository.sync_drift_detected`. **Why:** webhooks can be missed (downtime, delivery failures); reconciliation guarantees eventual consistency with Git, the source of truth.

## G.12 Soft-delete, archival & retention

Lifecycle entities (releases, work items, repos) soft-delete (`deleted_at`) with an admin-only restore window before hard purge. Retention policies (configurable) archive old audit/notification/deployment rows to cold object storage. **Why:** protects against accidental deletion and keeps hot tables bounded as the org grows.

## G.13 Settings / feature-config service

A central, typed settings store (org-, repo-, and user-scoped) for policy that isn't big enough for its own table: default branch-naming patterns, channel order, notification defaults, session/token TTLs, feature toggles for the platform's own modules. Versioned with history. **Why:** operationalizes the "configuration over code" principle and is the seed of the Phase-3 Configuration Management module.

## G.14 Dependency / blocking model

Work items and releases can declare blockers (`blocked_by`), so a release can't promote while a required work item is unresolved, and cross-repo ordering ("Auth 1.3 must ship before Order-BE 1.7") is explicit.

```sql
CREATE TABLE dependencies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   text NOT NULL,   -- work_item|release
  source_id     uuid NOT NULL,
  blocks_type   text NOT NULL,
  blocks_id     uuid NOT NULL,
  kind          text NOT NULL DEFAULT 'blocks',
  UNIQUE (source_type, source_id, blocks_type, blocks_id)
);
```

**Why:** cross-repo releases routinely have ordering constraints; encoding them prevents the classic "shipped the consumer before the provider" failure.

---

# PART H — COMPLETE MVP API REFERENCE

Conventions (recap): base `/api/v1`; `Authorization: Bearer`; unsafe writes accept `Idempotency-Key`; mutable resources use `If-Match`/ETag; cursor pagination (`?cursor=&limit=`); list filtering via documented query params; all responses JSON. Standard error envelope:

```json
{ "error": { "code": "release_not_promotable", "message": "Compatibility check failed",
  "details": [{ "repo": "Report-BE", "issue": "1.6.8 outside range >=1.7.0" }] } }
```

**Standard error codes:** `unauthenticated` (401), `forbidden` (403), `not_found` (404), `validation_failed` (422), `conflict`/`version_mismatch` (409), `idempotency_replay` (200, cached), `rate_limited` (429), `provider_error` (502), `internal` (500). Domain codes are namespaced (`release_not_promotable`, `merge_has_conflicts`, `freeze_active`, `approval_required`).

### H.1 Auth & users
```
POST   /auth/login                 # OIDC callback exchange -> tokens
POST   /auth/refresh
POST   /auth/logout
GET    /me                         # current user + effective permissions
GET    /users            ?status=&role=&q=
POST   /users                      perm user.manage
GET    /users/{id}
PATCH  /users/{id}                 perm user.manage   (If-Match)
POST   /users/{id}/roles           {role_key, scope_type, scope_id}   perm user.manage
DELETE /users/{id}/roles/{assignmentId}                               perm user.manage
GET    /roles
POST   /roles                      perm user.manage
PUT    /roles/{id}/permissions     {permission_keys[]}                perm user.manage
GET    /permissions
GET    /api-tokens ; POST /api-tokens {name,scopes,expires_at} ; DELETE /api-tokens/{id}
```

### H.2 Repositories, branches, protection
```
GET    /repositories     ?provider=&active=&q=
POST   /repositories               perm repository.manage   (Idempotency-Key)
POST   /repositories/import        {provider, installation_id, repo_full_names[]}  perm repository.manage
GET    /repositories/{id}
PATCH  /repositories/{id}          perm repository.manage   (If-Match)
DELETE /repositories/{id}          perm repository.manage   # soft-delete
POST   /repositories/{id}/restore  perm admin
GET    /repositories/{id}/sync-status
POST   /repositories/{id}/resync   perm repository.manage   # force reconciliation

GET    /repositories/{id}/branches        ?type=&q=
POST   /repositories/{id}/branches        {name,type,from_sha}   perm branch.create
DELETE /repositories/{id}/branches/{name} perm branch.delete
GET    /repositories/{id}/branches/compare?base=&head=          # ahead/behind + files
GET    /repositories/{id}/branches/{name}/history               # commit history
GET    /repositories/{id}/commits         ?branch=&since=&author=&cursor=
GET    /repositories/{id}/commits/{sha}

GET    /repositories/{id}/protection-rules
PUT    /repositories/{id}/protection-rules {rules[]}            perm repository.manage
GET    /repositories/{id}/tags
POST   /repositories/{id}/tags            {name, sha}          perm release.edit
```

### H.3 Versions & compatibility
```
GET    /repositories/{id}/versions
POST   /repositories/{id}/versions        {version, commit_sha, git_tag, channel}
GET    /versions/matrix                   ?release={id}        # full compatibility grid
GET    /versions/compatibility            ?repo={id}&version=
PUT    /versions/compatibility            {repo_id,version,depends_repo_id,range}
```

### H.4 Work items (features / bugs / hotfixes)
```
GET    /work-items       ?type=&status=&repository=&release=&developer=&priority=&q=
POST   /work-items                 {type,title,repository_id,branch_name,...}
GET    /work-items/{id}
PATCH  /work-items/{id}            (If-Match)
POST   /work-items/{id}/transition {to_status}                # validated state machine
POST   /work-items/{id}/attach-release   {release_id}
DELETE /work-items/{id}/release
GET    /work-items/{id}/activity
POST   /work-items/{id}/comments   {body}
POST   /work-items/{id}/dependencies {blocks_id, blocks_type}
```

### H.5 Hotfixes
```
POST   /hotfixes        {repository_id, base_channel, title, developer_id}  perm hotfix.create
       # auto-creates hotfix/* branch from prod tag, work_item, and draft merge-backs
GET    /hotfixes/{id}
POST   /hotfixes/{id}/complete     # merges to main + active release/* branches
GET    /hotfixes/{id}/merge-backs  # status of each target merge
```

### H.6 Releases
```
GET    /releases         ?status=&channel=&q=
POST   /releases                   {version,name}              perm release.create  (Idempotency-Key)
GET    /releases/{id}              # full aggregate (repos, work items, deployments, matrix)
PATCH  /releases/{id}             (If-Match)                   perm release.edit
DELETE /releases/{id}             # soft-delete draft only
POST   /releases/{id}/repositories {repository_id,version,commit_sha,branch_name}
DELETE /releases/{id}/repositories/{repoId}
GET    /releases/{id}/preflight    # runs all gate checks, returns pass/fail per check
POST   /releases/{id}/promote      {to_channel}               perm deploy.approve.{channel} (If-Match)
POST   /releases/{id}/rollback     {to_release_id, reason}    perm deploy.rollback
POST   /releases/{id}/generate-notes {format?}
GET    /releases/{id}/notes
PUT    /releases/{id}/notes        {markdown}                 # manual edit of generated notes
POST   /releases/{id}/archive
GET    /releases/{id}/export       ?format=json|csv|pdf
POST   /releases/{id}/schedule-promotion {to_channel, run_at}
GET    /releases/{id}/activity ; POST /releases/{id}/comments {body}
```

### H.7 Merge center
```
GET    /merges           ?state=&repository=&release=&author=
GET    /merges/{id}
POST   /merges/{id}/approve        {comment?}                 perm merge.approve
POST   /merges/{id}/reject         {comment}                  perm merge.approve
POST   /merges/{id}/merge          {strategy?}                perm merge.execute  (Idempotency-Key)
POST   /merges/{id}/recheck-conflicts
GET    /merges/history             ?repository=&from=&to=
GET    /merges/board               # buckets: pending|conflict|approved (dashboard read)
```

### H.8 Deployments
```
GET    /deployments      ?channel=&release=&status=
GET    /deployments/dashboard      # Canary->Beta->Production->Enterprise pipeline state
GET    /deployments/{id}
POST   /deployments                {release_id, channel}      # trigger (dispatches CI in MVP)
POST   /deployments/{id}/mark      {status, log_url?}         # CI callback / manual
POST   /deployments/{id}/rollback  {reason}                   perm deploy.rollback
GET    /deployments/{id}/history
GET    /channels/{channel}/current # current + previous version per channel
```

### H.9 Approvals, freezes, calendar
```
GET    /approval-policies ; POST /approval-policies ; PUT /approval-policies/{id}   perm admin
GET    /approval-requests ?subject=&state=
POST   /approval-requests/{id}/decide  {decision, comment}
GET    /freeze-windows ; POST /freeze-windows ; DELETE /freeze-windows/{id}         perm admin
GET    /calendar         ?from=&to=     # promotions + freezes + history
```

### H.10 Notifications, webhooks, audit, search, status
```
GET    /notification-channels ; POST /notification-channels ; PATCH /notification-channels/{id}
POST   /notification-channels/{id}/test     # send test message
GET    /outbound-webhooks ; POST /outbound-webhooks ; DELETE /outbound-webhooks/{id}
GET    /outbound-webhooks/{id}/deliveries
POST   /webhooks/{provider}                 # inbound, HMAC-verified (helm-webhooks)
GET    /audit-logs       ?entity=&entity_id=&actor=&action=&from=&to=&cursor=   perm audit.read
GET    /audit-logs/export ?format=csv|json                                       perm audit.read
GET    /search           ?q=&types=release,work_item,repo,merge
GET    /saved-filters ; POST /saved-filters ; DELETE /saved-filters/{id}
GET    /status           # aggregated platform + dependency health
GET    /settings ; PUT /settings/{key}      perm admin
GET    /healthz ; GET /readyz ; GET /metrics
```

### H.11 GraphQL & realtime
```
POST   /graphql          # dashboard composition queries
WS     /realtime         # subscribe: deployment.*, merge.*, release.*, notification.*
```

---

# PART I — GIT PROVIDER INTERFACE (EXPANDED) & ADAPTERS

## I.1 Full `GitProvider` port

The v1.0 interface covered the happy path. Production integration needs auth lifecycle, pagination, rate-limit awareness, checks/statuses, and richer webhook handling. The complete port:

```typescript
interface GitProvider {
  readonly key: 'github' | 'gitlab' | 'bitbucket';

  // ---- Auth / installation lifecycle ----
  getInstallationToken(repo: RepoRef): Promise<ScopedToken>;   // short-lived, per-install
  revokeToken(token: ScopedToken): Promise<void>;
  listInstallationRepos(installationId: string): Promise<RepoSummary[]>; // for bulk import

  // ---- Repository / branches ----
  getRepository(repo: RepoRef): Promise<RepoMeta>;
  listBranches(repo: RepoRef, page?: Cursor): Promise<Page<Branch>>;
  getBranch(repo: RepoRef, name: string): Promise<Branch | null>;
  createBranch(repo: RepoRef, name: string, fromSha: string): Promise<Branch>;
  deleteBranch(repo: RepoRef, name: string): Promise<void>;
  compareBranches(repo: RepoRef, base: string, head: string): Promise<Comparison>;
  detectConflicts(repo: RepoRef, src: string, dst: string): Promise<ConflictReport>;

  // ---- Commits / tags / releases ----
  listCommits(repo: RepoRef, opts: CommitQuery, page?: Cursor): Promise<Page<Commit>>;
  getCommit(repo: RepoRef, sha: string): Promise<Commit>;
  createTag(repo: RepoRef, name: string, sha: string): Promise<Tag>;
  listTags(repo: RepoRef, page?: Cursor): Promise<Page<Tag>>;
  createRelease(repo: RepoRef, tag: string, notes: string, opts?): Promise<ProviderRelease>;

  // ---- Pull/merge requests ----
  listPullRequests(repo: RepoRef, state: PrState, page?: Cursor): Promise<Page<PullRequest>>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest>;
  createPullRequest(repo: RepoRef, input: CreatePrInput): Promise<PullRequest>;
  updatePullRequest(repo: RepoRef, number: number, patch: PrPatch): Promise<PullRequest>;
  mergePullRequest(repo: RepoRef, number: number, strategy: MergeStrategy): Promise<MergeResult>;
  closePullRequest(repo: RepoRef, number: number): Promise<void>;
  getReviewStatus(repo: RepoRef, number: number): Promise<ReviewStatus>;
  listPrFiles(repo: RepoRef, number: number): Promise<ChangedFile[]>;  // for risk/breaking-change

  // ---- Checks / statuses (CI signal) ----
  getCombinedStatus(repo: RepoRef, sha: string): Promise<CheckSummary>;
  listCheckRuns(repo: RepoRef, sha: string): Promise<CheckRun[]>;

  // ---- Branch protection (push/sync org policy) ----
  getBranchProtection(repo: RepoRef, pattern: string): Promise<ProtectionRule | null>;
  setBranchProtection(repo: RepoRef, pattern: string, rule: ProtectionRule): Promise<void>;

  // ---- Webhooks ----
  ensureWebhook(repo: RepoRef, callbackUrl: string, secret: string): Promise<void>;
  verifyWebhook(headers: Headers, rawBody: Buffer): boolean;     // HMAC + delivery-id dedupe
  normalizeWebhook(headers: Headers, body: unknown): DomainEvent[]; // provider -> canonical events

  // ---- Rate limit awareness ----
  getRateLimit(repo: RepoRef): Promise<RateLimitInfo>;           // remaining, reset; drives backoff
}
```

Cross-cutting adapter behavior (shared base class): exponential backoff honoring `Retry-After`/rate-limit reset headers, cursor pagination normalization, ETag conditional requests to save quota, structured error mapping to platform error codes, and per-installation token caching.

**Why these additions:** `getInstallationToken`/`revokeToken` make the GitHub-App security model real; `getCombinedStatus`/`listCheckRuns` feed the CI gate in approval policies; `listPrFiles` feeds the future AI risk/breaking-change detection; `getRateLimit` + backoff keep large multi-repo syncs from being throttled into failure.

## I.2 Adapter mapping (GitHub MVP, GitLab/Bitbucket next)

| Concept | GitHub | GitLab | Bitbucket |
|---|---|---|---|
| Change request | Pull Request | Merge Request | Pull Request |
| Auth model | GitHub App installation token | Project/Group access token or OAuth | App password / OAuth / Forge app |
| CI signal | Checks API + commit status | Pipelines / commit status | Pipelines / build status |
| Webhook signature | `X-Hub-Signature-256` (HMAC-SHA256) | `X-Gitlab-Token` (shared secret) | HMAC (configurable) |
| Protected branches | Branch protection / rulesets | Protected branches API | Branch restrictions API |
| Merge strategies | merge / squash / rebase | merge / squash / ff | merge / squash / fast-forward |
| Pagination | `Link` header / cursor | header-based page links | `next` URL in body |

Each adapter implements `GitProvider` and registers itself in a `ProviderRegistry`; the repository's `provider` column selects the implementation at runtime. **Why a registry, not conditionals:** adding Bitbucket is "write `BitbucketProvider`, register it" — no `switch (provider)` scattered through the codebase, satisfying the "future support without redesign" requirement.

## I.3 Webhook normalization

Each provider's webhook payloads map to the canonical event catalog (C.4.2). Example: GitHub `pull_request.closed` with `merged=true` → `pr.merged`; GitLab `merge_request` `action=merge` → `pr.merged`. Normalization lives entirely in the adapter, so every downstream consumer sees one shape regardless of forge.

---

# PART J — SERVICE-LAYER FUNCTION SPECS

Concrete methods per backend module. Each is transactional, emits the noted event(s) via the outbox, enforces the noted permission, and writes audit. Signatures are TypeScript-style; `ctx` carries actor, request-id, IP, UA.

## J.1 ReleaseService
```typescript
createRelease(ctx, {version, name}): Release            // event: release.created  perm: release.create
addRepository(ctx, releaseId, {repoId, version, sha, branch})  // validates SHA exists via provider
removeRepository(ctx, releaseId, repoId)
runPreflight(ctx, releaseId): PreflightResult           // compat matrix + work-item status + conflicts + freeze
promote(ctx, releaseId, toChannel): Release             // event: release.promoted  perm: deploy.approve.{channel}
   // guards: preflight green, approval_request satisfied, no active freeze (or override)
rollback(ctx, releaseId, toReleaseId, reason): Deployment// event: deployment.rolled_back
generateNotes(ctx, releaseId): ReleaseNotes             // event: release.notes_generated
archive(ctx, releaseId)
export(ctx, releaseId, format): Buffer
schedulePromotion(ctx, releaseId, toChannel, runAt)     // creates scheduled_promotions row
```
`promote` is the keystone: it loads the release, runs `runPreflight`, checks the matching `approval_policy`/`approval_request`, checks `freeze_windows`, transitions status, writes `release_channel_history`, triggers the deployment, and emits events — all in one transaction with the outbox.

## J.2 BranchService
```typescript
createBranch(ctx, repoId, {name, type, fromSha})        // validates name vs protection pattern; provider.createBranch
deleteBranch(ctx, repoId, name)                         // blocks if protected
compare(ctx, repoId, base, head): Comparison            // cached; provider.compareBranches on miss
getHistory(ctx, repoId, name): Commit[]
detectConflicts(ctx, repoId, src, dst): ConflictReport
syncBranches(ctx, repoId)                               // reconciliation; emits sync_drift_detected on divergence
```

## J.3 MergeService
```typescript
ingestProviderPr(prEvent)                               // upsert merge_requests from webhook
approve(ctx, mergeId, comment)                          // records merge_approval; checks approval_policy
reject(ctx, mergeId, comment)
executeMerge(ctx, mergeId, strategy)                    // guards: approved + mergeable + no conflicts; provider.mergePullRequest
   // on success: update work_item.status, emit pr.merged
recheckConflicts(ctx, mergeId)
getBoard(ctx, filters): {pending, conflict, approved}
```

## J.4 HotfixService
```typescript
createHotfix(ctx, {repoId, baseChannel, title, developerId}): Hotfix
   // resolves prod tag for channel, provider.createBranch hotfix/x.y.z, creates work_item(type=hotfix),
   // prepares merge-back PRs into main + every active release/* ; emit hotfix.created
completeHotfix(ctx, hotfixId)                           // executes the merge-backs; tracks each in merge_backs
getMergeBackStatus(ctx, hotfixId): MergeBack[]
```
**Why a dedicated service:** the auto-create-branch + auto-merge-back-to-all-active-releases logic is the single biggest manual-error source today; isolating it makes it testable and reusable.

## J.5 WorkItemService
```typescript
create(ctx, input)
transition(ctx, id, toStatus)                           // enforces state machine: open->in_review->merged->verified->released
attachToRelease(ctx, id, releaseId) / detach(ctx, id)
addDependency(ctx, id, blocksId, type)                  // feeds release preflight blockers
syncFromPr(prEvent)                                     // keep status/PR/deployment fields current
```

## J.6 VersionService
```typescript
recordVersion(ctx, repoId, {version, sha, tag, channel})
setCompatibility(ctx, repoId, version, dependsRepoId, range)
buildMatrix(releaseId): CompatibilityMatrix             // used by ReleaseService.runPreflight
checkCompatibility(snapshot): {ok, violations[]}
```

## J.7 DeploymentService
```typescript
trigger(ctx, {releaseId, channel}): Deployment          // dispatches CI (MVP) via provider/Actions
markStatus(ctx, deployId, status, logUrl)               // CI callback; emits deployment.{succeeded|failed}
startHealthGate(deployId)                               // polls health_gates for soak window
autoRollback(deployId, reason)                          // on health failure -> rollback target; emit auto_rollback_triggered
getDashboard(): ChannelPipeline                         // current/previous/rollback per channel
```

## J.8 ApprovalService / PolicyService
```typescript
resolvePolicy(subjectType, gate, scopeId): ApprovalPolicy
openRequest(ctx, subject, gate): ApprovalRequest
decide(ctx, requestId, decision, comment)               // recompute state vs min_approvals/required_roles
isSatisfied(requestId): boolean                         // called by ReleaseService.promote / MergeService
```

## J.9 NotificationService & WebhookService
```typescript
// NotificationService (event consumer)
onEvent(event)                                          // route via notification_channels.events -> queue deliveries
renderTemplate(channelType, event): Message
// OutboundWebhookService (event consumer)
onEvent(event)                                          // match subscriptions, sign (HMAC), enqueue delivery, retry/DLQ
```

## J.10 AuditService & SearchService
```typescript
// AuditService (event consumer) — append-only
record(event)                                           // actor, action, entity, old/new, ip, ua, request_id
// SearchService
index(entity) / reindex(type)                           // maintain tsvector / OpenSearch docs
query(ctx, q, types): SearchResult[]
```

## J.11 Shared infrastructure services
```typescript
EventBus.publish(event) / subscribe(type, handler)      // port: Redis Streams -> NATS/Kafka
OutboxRelay.poll()                                      // tail event_outbox -> EventBus, mark published
IdempotencyService.run(key, fn)                         // store-and-replay for unsafe POSTs
RateLimiter.check(principal, bucket)
ProviderRegistry.for(repo): GitProvider                 // selects adapter by repo.provider
```

**Why specify services this thinly-but-completely:** these signatures are the contract between the API layer (Part H) and the data model (Part C/G). They make the modular-monolith boundaries explicit — each service is the *only* writer of its tables — which is exactly what makes later extraction into microservices mechanical rather than risky.

---

## Appendix A — Glossary
- **Channel:** a release stage (Canary/Beta/Production/Enterprise) represented as promotion state on a release, not a long-lived branch.
- **Release pin / snapshot:** the exact `(repository, version, commit_sha)` set a release includes (`release_repositories`).
- **Outbox:** DB table making event publication atomic with state changes.
- **Port/Adapter:** an interface (`GitProvider`, `EventBus`, `Deployment`) and its swappable implementations.

## Appendix B — Key decisions log
1. Release as aggregate root spanning repos at pinned SHAs.
2. Modular monolith (4 deployables) over premature microservices.
3. NestJS + PostgreSQL + Redis(Streams/BullMQ) for MVP; NATS/Kafka later.
4. Provider abstraction with GitHub App first.
5. Event-driven core + transactional outbox + idempotent consumers.
6. Channels as promotion state; trunk-based + short-lived `release/*`; auto hotfix merge-back.
7. Scoped RBAC with namespaced, per-channel deploy permissions stored as data.
8. Track-then-execute deployments to de-risk and reuse the Phase-2 contract.
