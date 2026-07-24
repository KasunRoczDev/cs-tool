# Helm Platform — MVP Delivery Backlog (Phases 0–1c)

Sprint-ordered backlog for the MVP defined in `../../Release-DevOps-Platform-Blueprint.md`. Estimates are story points (Fibonacci); a 2-week sprint for the suggested pod (1 lead, 2–3 BE, 1–2 FE, part-time SRE) targets ~25–35 pts. Each story lists acceptance criteria (AC). "DoD" for every story = API + OpenAPI entry, RBAC enforced, domain events emitted, audit coverage, tests, and a UI surface where user-facing (blueprint F.3).

## Epic map

| Epic | Phase | Goal |
|---|---|---|
| E0 Foundations | 0 | Auth/SSO, RBAC, DB, event bus + outbox, GitHub adapter, audit |
| E1 Repositories & Branches | 1a | Register repos, branch ops, protection, sync |
| E2 Versions & Work Items | 1a | Versioning, compatibility, feature/bug/hotfix tracking |
| E3 Releases | 1a | Cross-repo release aggregate, pinning, preflight, promote, rollback |
| E4 Merge Center | 1b | PR sync, conflicts, approvals, one-click merge |
| E5 Deployment & Notes | 1b | Channel dashboard, deploy tracking, release notes |
| E6 Notifications & Governance | 1b | Channels, outbound webhooks, approval policies, freezes |
| E7 Hardening | 1c | HA, backups/DR drills, observability, security review, docs |

---

## Phase 0 — Foundations

### Sprint 1 — Platform skeleton
- **E0-1 Repo & CI scaffolding** (3) — NestJS monorepo, lint/test/build pipeline in GitHub Actions, Docker Compose for Postgres/Redis. *AC:* `npm run build` + `docker compose up` green; PR checks run.
- **E0-2 Prisma data model + migrations** (5) — implement `schema.prisma`; first migration creates all MVP tables. *AC:* `prisma migrate` applies clean; seed script inserts default roles/permissions.
- **E0-3 Event bus + transactional outbox** (5) — `EventBus` port, Redis Streams impl, `OutboxService`, `OutboxRelay` in worker. *AC:* writing a domain row + outbox row in one tx; relay publishes; consumer receives; idempotent on replay.
- **E0-4 Audit consumer** (3) — append-only writer subscribing to core events. *AC:* every emitted event yields one immutable `audit_logs` row with actor/ip/ua/request_id.

### Sprint 2 — Identity, RBAC, GitHub
- **E0-5 OIDC/SSO login + JWT** (5) — integrate existing Authentication Service; `req.user` populated with effective permissions + roles. *AC:* login round-trips; expired token → 401.
- **E0-6 RBAC guard + scoped permissions** (5) — `PermissionGuard`, `@RequirePermission`, permission catalog, scope (global/repo/channel) resolution. *AC:* missing permission → 403 with standard envelope; per-channel `deploy.approve.*` honored.
- **E0-7 GitHub App adapter (read paths)** (8) — installation tokens, list branches/PRs/commits/tags, rate-limit-aware backoff, ETag caching. *AC:* live calls against a sandbox org; token cached per installation; 403/rate-limit handled.
- **E0-8 Idempotency + optimistic concurrency middleware** (3) — `Idempotency-Key` store-and-replay; `If-Match`/ETag on mutations. *AC:* duplicate POST returns cached result; stale `If-Match` → 409.

---

## Phase 1a — Core release engine

### Sprint 3 — Repositories & branches
- **E1-1 Repository register + metadata + bulk import** (5) — *AC:* register single repo; bulk-import selected repos from an installation; soft-delete + restore.
- **E1-2 Branch ops via provider** (5) — create/delete (respecting protection), compare (ahead/behind + files), commit history. *AC:* create `feature/*` blocked names rejected; compare returns diff stats.
- **E1-3 Branch protection rules (data + sync)** (3) — store rules; push to provider. *AC:* rule edit reflected on GitHub.
- **E1-4 Sync reconciliation + drift detection** (5) — scheduled full-sync job; `sync_status`; `repository.sync_drift_detected`. *AC:* a branch deleted directly on GitHub is flagged within one cycle.

### Sprint 4 — Versions & work items
- **E2-1 Service versions + channel tracking** (3) — record versions, current channel per service. *AC:* version list per repo; current prod tag resolvable.
- **E2-2 Compatibility matrix** (5) — declare ranges; `checkRelease()` with real `semver.satisfies`. *AC:* incompatible pin produces a violation with found/expected.
- **E2-3 Work items (feature/bug/hotfix) + state machine** (5) — CRUD, validated transitions, PR linkage, dependencies. *AC:* illegal transition rejected; `blocked_by` enforced downstream.
- **E2-4 Work item sync from PRs** (3) — keep status/PR/deployment fields current from events. *AC:* `pr.merged` moves linked item to `merged`.

### Sprint 5 — Releases (the keystone)
- **E3-1 Release CRUD + repo pinning** (5) — draft release, pin `(repo, version, sha)`. *AC:* `release_repositories` snapshot persisted; SHA validated via provider.
- **E3-2 Preflight checks** (5) — repos present, compatibility, work-items-ready, freeze, approvals. *AC:* `/preflight` returns per-check pass/fail; matches promote guard.
- **E3-3 Promote across channels** (8) — transactional promote with channel history + deployment + events. *AC:* gated by `deploy.approve.{channel}`; writes history; emits `release.promoted` + `deployment.started`.
- **E3-4 Rollback** (3) — set rollback target to previous release; emit events. *AC:* rollback recorded with target version.

---

## Phase 1b — Coordination surfaces

### Sprint 6 — Merge center
- **E4-1 PR ingest from webhooks** (5) — upsert `merge_requests`; conflict flagging. *AC:* opened/closed/merged reflected; conflict files captured.
- **E4-2 Approvals + policy gate** (5) — record approvals; check `approval_policy`. *AC:* merge blocked until min approvals from required roles.
- **E4-3 One-click merge** (5) — guarded provider merge; updates work item; idempotent. *AC:* merge blocked on conflicts; success emits `pr.merged`.
- **E4-4 Merge board + history** (3) — pending/conflict/approved buckets; history. *AC:* board reflects live state via realtime.

### Sprint 7 — Hotfix, deployment, notes
- **E2-5 Hotfix automation + merge-back** (8) — auto-branch from prod tag; compute + execute merge-backs into main + active `release/*`. *AC:* completing a hotfix opens/merges PRs to all targets; nothing lost.
- **E5-1 Deployment tracking dashboard** (5) — channel pipeline (current/previous/rollback), CI dispatch + callback. *AC:* `deployments/dashboard` shows Canary→Enterprise; CI callback updates status.
- **E5-2 Release notes generation** (5) — assemble from PRs/commits/feature+bug IDs; editable. *AC:* `generate-notes` produces markdown; manual edit persists.

### Sprint 8 — Notifications & governance
- **E6-1 Notification channels (Email/Slack/Teams/Discord)** (5) — channel config + event routing + delivery via BullMQ + DLQ. *AC:* `release.promoted` delivers to subscribed channels; failures retried/dead-lettered.
- **E6-2 Outbound webhooks** (3) — subscriptions, HMAC signing, retries. *AC:* external endpoint receives signed `release.promoted`.
- **E6-3 Approval policies UI + freeze windows + scheduling** (5) — configure policies/freezes; scheduled promotions. *AC:* promote during freeze blocked unless override; scheduled promotion fires at `run_at`.
- **E6-4 Global search + saved filters** (3) — cross-entity search; saved filters. *AC:* search returns releases/repos/work items/PRs; filter persists.

---

## Phase 1c — Hardening

### Sprint 9 — Reliability & security
- **E7-1 HA topology** (5) — ≥2 replicas/service, Postgres Multi-AZ, Redis HA, HPA on CPU+queue depth. *AC:* single-node loss causes no downtime in a chaos test.
- **E7-2 Backups + DR drill** (5) — PITR/WAL archiving, snapshots, restore runbook; tested restore. *AC:* RPO ≤ 5 min, RTO ≤ 30 min demonstrated.
- **E7-3 Observability** (3) — structured logs w/ request_id, Prometheus metrics, OTel traces, Grafana dashboards (queue depth, event lag, sync health), Sentry. *AC:* status page reflects dependency health.
- **E7-4 Security review + audit export** (3) — token hashing, secret references (Vault/KMS), webhook replay protection, pen-test checklist; audit export. *AC:* security checklist signed off; audit exports to CSV/JSON.

### Sprint 10 — Launch readiness
- **E7-5 End-to-end acceptance** (5) — assemble a real cross-repo release (Master-BE, Order-BE, Frontend, Report-BE), promote Canary→Enterprise with approvals, auto-notes, notify all channels, full audit trail; hotfix auto-merge-back. *AC:* blueprint F.3 DoD passes end to end.
- **E7-6 Docs + runbooks + onboarding** (3) — operator + developer docs, failover/provider-outage/event-bus-rebuild runbooks. *AC:* a new engineer onboards a repo and ships a release using docs only.

---

## Risk register (top 5)

| Risk | Mitigation |
|---|---|
| GitHub rate limits during mass sync | Per-installation tokens, ETag conditional requests, backoff, reconciliation batching |
| Lost events between DB commit and publish | Transactional outbox + idempotent consumers (E0-3) |
| Production-promote authority concentrated in new system | Track-then-execute deployments; per-channel approval policies; freeze windows |
| Cache drift vs Git source of truth | Scheduled reconciliation + drift detection (E1-4) |
| Scope creep from roadmap modules | Hard MVP cut at Phase 1c; roadmap modules attach as event consumers later |

## Cross-cutting "definition of ready"
A story is ready when: it has AC, an OpenAPI delta, named events, the permission key(s) it enforces, and a test plan. This keeps the modular-monolith boundaries clean and the audit/event coverage complete from the first commit.
