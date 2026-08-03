# Release Management

Ported from the *Release & DevOps Platform* blueprint (Core + Deployments board)
into the monitoring platform, following the same NestJS module / Next.js page
conventions as the rest of the app. Since the initial port, a product-wise RBAC +
configurable status workflow layer was added on top (`Product-RBAC-Release-Status-Design.md`)
and the deploy pipeline was made agent-executed with cancel/retry/timeout recovery.

## What it adds

- **Repositories** — register repos (provider, remote, branch, tech stack, docker
  image), tag semantic **versions**, force a VCS resync, and manage branches
  (create/delete/compare/conflict-check) — all **live against the GitHub REST API**
  when a repo has a token (GitLab/Bitbucket remain stubs). A token is validated
  against GitHub on save; a bad PAT is rejected immediately instead of failing
  later on first sync.
- **Approvals** — per-product QA / BA / Dev Lead / Tech Lead sign-off. A release
  is only deployable/promotable once every approver configured for its product(s)
  has approved (admins can override). Approvers get threaded email + chat
  notifications on every decision. Every decision change is logged to
  `release_approval_history` (submit, delegate, expire, re-request), independent
  of the live `release_approvals` upsert. **Delegation** lets one user submit on
  another's behalf for a time window (self-service, or admin-set for anyone).
  **Expiration** (`APPROVAL_EXPIRY_DAYS`, default off) demotes a stale approved
  sign-off back to needing re-approval. **Reminders**
  (`APPROVAL_REMINDER_HOURS`, default 48) re-email a still-undecided approver.
  Admins can **re-request** a specific approver's sign-off, resetting it to
  pending and notifying them. Sequential/conditional approval gating and
  digital signatures are deliberately not built — no product-level definition
  of "what order"/"what condition" to key off, and no PKI/signing
  infrastructure to back a real signature.
- **Releases** — draft builder: pin repositories at exact commit SHAs, bundle
  feature / bug / hotfix items, generate templated markdown **release notes**
  (data-driven, plus live GitHub PR/commit aggregation), and move through a
  **configurable status workflow** — see below.
- **Status workflow** — statuses/transitions are DB rows (`release_workflows` /
  `release_statuses` / `release_transitions`), not a hardcoded enum. The default
  workflow mirrors the classic channel order (`draft → canary → beta →
  production → enterprise`, plus `archived` reachable from anywhere), but each
  product can have its own. Each transition is permission-gated
  (`status.transition.<key>`, checked via `AccessService`) and can require the
  approvals gate. The Status panel on a release's detail page shows only the
  transitions the current user is allowed to make; `POST /releases/:id/promote`
  and `/archive` remain as legacy convenience endpoints (same coarse
  admin/operator gate as before, no fine-grained permission check) so existing
  operator accounts aren't cut off mid-migration — both delegate to the same
  transition engine underneath, so `releases.status`/`status_id` and
  `release_status_history` stay in sync either way. `releases.status` is plain
  TEXT (`release_workflow_config_migration.sql`), not the old fixed
  `release_channel` enum, so a per-product workflow's status keys aren't
  limited to draft/canary/beta/production/enterprise/archived.
- **Workflow configuration** — a `settings.manage`-gated admin surface
  (**Workflow Config** in the sidebar) to build a custom status workflow per
  product: add/remove statuses (key, name, rank, category, deploy channel,
  color) and transitions (from/to, forward/rollback/archive, approval gate,
  auto-deploy) instead of being stuck with the single seeded "Default"
  workflow. Adding a status auto-provisions its `status.transition.<key>`
  permission in the RBAC catalog so a role can actually be granted it.
- **Deployments** — a channel **pipeline board** showing current version, previous
  version and pre-computed rollback target per channel, with approval gates,
  history, and one-click **rollback** (re-promotes the prior pinned artifact, no
  rebuild). Only one active (`pending`/`approved`/`in_progress`) deployment is
  allowed per channel at a time — a second attempt is rejected with a clear
  error (DB-backed by a partial unique index, so it holds under races too).
  Live-updates over the existing WebSocket (`release_event`).
- **Deployment strategies** — when more than one target server is selected,
  choose **Rolling** (batches; auto-advances once each batch fully succeeds)
  or **Canary** (a small first batch, then pauses in `awaiting_promotion`
  for a manual `POST /deployments/:id/promote-wave`) instead of the default
  **All at once**. A batch failure fails the whole deployment and cancels
  any not-yet-started later-wave jobs. Blue-Green/A-B/Shadow deployment are
  intentionally not modeled — they need real traffic-splitting infrastructure
  (load balancer / service mesh) this platform doesn't integrate with.
- **Recurring deployments** — redeploy a *fixed* release to a channel on a
  daily/weekly schedule (e.g. a nightly environment refresh), not "redeploy
  whatever's latest" (too ambiguous/risky to default to). Each firing goes
  through the exact same `deploy()` path as a manual deploy — approval gate,
  freeze windows, and channel locking all still apply; a blocked firing is
  skipped and logged, never forced through.
- **Environment variables & secrets** — per-channel key/value pairs
  (optionally product-scoped, overriding a same-key global one) resolved at
  job-creation time and handed to the on-server agent, which writes them to a
  `.env` file (and exports them into the shell) before install/build/migrate.
  Secrets are encrypted at rest (`common/crypto.util`, same as repo GitHub
  tokens) and never returned in plaintext by any read endpoint. Channels can
  also be **locked** (with a reason) to block deploys the same way a freeze
  window does; a **compare** view diffs two channels' variables by key.
- **Audit Log** — a unified, filterable, exportable (CSV) timeline over
  release status transitions, deployment status transitions, approval
  decisions, and account actions — normalizing the audit trails those
  features already write (`release_status_history`, `deployment_history`,
  `release_approval_history`, `audit_log`) into one read-only feed. Gated
  by the `audit.read` permission. Mapping this evidence to a specific
  compliance framework (SOX/ISO 27001/PCI DSS/HIPAA) is a controls exercise
  for your compliance team, not something the app asserts.
- **Release Metrics** — a per-channel DORA dashboard (Deployment Frequency,
  Lead Time for Changes, Change Failure Rate, MTTR), each with an
  Elite/High/Medium/Low tier badge, plus **Mean Deployment Duration**
  (pipeline wall-clock, start→finish — distinct from lead time) and
  **Rollback Frequency** (no standard DORA tier bands, shown as raw numbers),
  and a daily deployment-count chart. Computed live from
  `deployments`/`deployment_history`/`releases` for a selectable channel +
  trailing window (7/30/90 days) — no rollup table.
- **Release Calendar & Scheduling** — releases get an optional `planned_date`;
  deployments can be scheduled for a future time instead of deploying
  immediately (`scheduled` status, executed automatically by a once-a-minute
  sweep — scheduling is treated as the approval decision, so it doesn't wait
  for a manual Approve click). Admin-managed **freeze/blackout windows**
  (optionally scoped to a channel and/or product) block deploys — immediate
  or scheduled — for their duration; admins can override. The
  **Release Calendar** page shows planned releases, deployments, and freeze
  windows on a month grid.

## Deploy pipeline (agent-executed)

Deploying with target servers selected creates one `deploy_jobs` row per
(server × pinned repo). The monitoring agent on each server polls
`POST /agent/deploy-jobs/claim` (X-Api-Key auth), runs
`agent/scripts/deploy-release.sh` (fetch → checkout → install → build → migrate
→ restart → health-check → custom commands, auto-rollback to the pre-deploy SHA
on failure), and reports back via `POST /agent/deploy-jobs/:id/result`. The
parent deployment settles (`succeeded`/`failed`) once every job finishes.

- **Cancel** (`POST /deployments/:id/cancel`) stops a `pending`/`approved`/
  `in_progress` deployment; any still-open jobs are marked `cancelled` so agents
  skip them on their next poll.
- **Retry** (`POST /deployments/:id/retry`) re-runs only the jobs that didn't
  succeed on a `failed` deployment — not a whole new deployment.
- **Stuck-job recovery** — a job left `claimed`/`running` with no update for
  `DEPLOY_JOB_TIMEOUT_MINUTES` (env var, default 15) is auto-failed by a
  once-a-minute sweep and its deployment settled, so a crashed/partitioned agent
  can't hang a deployment forever.
- With no servers selected, a deployment is tracking-only (no agent execution) —
  falls back to `GitService.execDeploy`, a stub for wiring in a real external
  CI trigger (e.g. dispatching a GitHub Actions workflow) later.

This is distinct from **agent self-update** (the agent updating its own
software) — see `packaging/README.md`'s "Agent self-update" section.

## Git integration

`backend/src/release/git.service.ts` is live against the GitHub REST API (branches,
compare, non-destructive conflict detection, commit/PR history, reviewer
suggestions, **check runs**) using a per-repository personal access token — no SDK
dependency. `syncRepository`/`resolveSha` fall back to a simulated SHA only when a repo has
no token or isn't `provider=github`. `execDeploy` (see above) and the provider
webhook signature-verification-only ingress (`webhooks.controller.ts`, GitHub
`pull_request` events → `pr.created`/`pr.merged` notifications) round out the
port; GitLab/Bitbucket adapters are still unimplemented stubs.

**Testing integration** (`GET /releases/:id/test-status`) reads GitHub's Check
Runs API for each pinned repo's commit — this is deliberately a read of
whatever already posts a check there (GitHub Actions, and any third-party tool
configured to report as a GitHub check, e.g. SonarQube Cloud, Codecov,
Playwright Cloud), not something the platform executes itself. Per repo:
`passed` (every check succeeded), `failed` (any failure/timeout/action-required),
`pending` (a check is still running), `no_checks` (GitHub has none for that
commit), or `unavailable` (no token / non-GitHub / API error).

Set `GITHUB_WEBHOOK_SECRET` before exposing `POST /api/v1/webhooks/github`
publicly — without it the endpoint accepts unsigned requests from anyone (the
backend logs a startup warning if it's unset). Configure it under repo →
Settings → Webhooks → Secret.

## AI Assistant

`backend/src/ai/` layers heuristic scoring + an optional LLM narrative
(`AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL`; every capability still works on
heuristics alone with no key set) on top of the release/git data above: release
risk scoring, deployment-failure prediction, risky-PR detection, reviewer
recommendations, breaking-change detection, a rollback-plan generator, incident
correlation, and AI-polished release notes. A release scored **high risk**
fires the `release.ai_high_risk` platform event to any subscribed
notification channel (throttled to once per release+channel per 6h, since
risk is (re)computed on every page view, not on a schedule).

## Notifications

`backend/src/notifications/` supports **Email**, **Discord**, **Slack**,
**Microsoft Teams**, and a **generic webhook** channel type (plain JSON POST
— `{event, title, lines, severity, sent_at}` — for any receiver that isn't
one of the other three). Channels subscribe to platform events via
`config.events` (see `PLATFORM_EVENTS` in `notifications/dto.ts`).

## Run it

```bash
# 1. Apply DB schema + migrations (release_migration.sql, deploy_jobs_migration.sql,
#    deploy_cancel_migration.sql, release_approvals_migration.sql, rbac_migration.sql,
#    release_workflow_config_migration.sql, release_calendar_migration.sql,
#    deployment_strategy_migration.sql, environment_secrets_migration.sql,
#    approval_workflows_migration.sql, recurring_deployment_migration.sql, ...)
cd backend && DATABASE_URL=postgres://monitor:monitor@localhost:5432/monitoring node scripts/migrate.js

# 2. Start backend + dashboard as usual
cd backend && npm run start:dev
cd dashboard && npm run dev

# 3. (optional) run the backend test suite
cd backend && npm test
```

New nav entries appear in the sidebar: **Repositories**, **Releases**,
**Deployments**, **Release Metrics**, **Release Calendar**, **Environments**,
**Release Status Board**, **AI Assistant**, and (admin-only)
**Workflow Config** and **Audit Log**. Mutating actions require the
`admin`/`operator` legacy role at minimum; the fine-grained status-transition permissions layer on top
of that (see Status workflow above).

## API surface (under `/api/v1`)

```
GET/POST/PATCH/DELETE  /repositories[/:id]
POST                   /repositories/:id/sync
GET/POST               /repositories/:id/branches | /versions
DELETE                 /repositories/:id/branches
GET                    /repositories/:id/branches/compare | /conflicts | /history
GET                    /repositories/:id/commits
GET/POST/PATCH         /releases[/:id]
POST/DELETE            /releases/:id/repositories[/:linkId]
POST/DELETE            /releases/:id/items[/:itemId]
POST                   /releases/:id/promote | /archive        # legacy convenience
POST                   /releases/:id/release-notes/generate
GET                    /releases/:id/release-notes
GET                    /releases/:id/test-status                # live GitHub Check Runs per pinned repo
GET/POST                /releases/:id/approvals
GET                     /releases/:id/approvals/history
POST                    /releases/:id/approvals/:approverId/re-request  # admin/operator
GET/POST/DELETE         /approval-delegations[/:id]
GET                     /audit-log                              # audit.read; ?release_id=&actor_id=&type=&from=&to=
GET                     /audit-log/export.csv                   # same filters, CSV download
GET                    /workflows | /release-board
GET                    /releases/:id/status | /status-history
POST                   /releases/:id/transition                # fine-grained, permission-gated
POST/GET/PATCH/DELETE  /workflows[/:id]                        # settings.manage — workflow config
POST/PATCH/DELETE      /workflows/:id/statuses[/:statusId]
POST/DELETE            /workflows/:id/transitions[/:transitionId]
GET                    /channels
GET                    /deployments | /deployments/board | /deployments/:id/history | /jobs
GET                    /deployments/metrics                    # DORA metrics, ?channel=&days=
GET                    /release-calendar                       # ?from=&to= — releases/deployments/freeze windows
GET/POST/DELETE        /freeze-windows[/:id]                   # settings.manage for POST/DELETE
POST                   /releases/:id/deployments                # deploy to a channel
POST                   /deployments/:id/approve | /rollback | /cancel | /retry | /promote-wave
GET/POST/DELETE        /recurring-deployments[/:id]            # ?release_id= to filter
POST                   /recurring-deployments/:id/enable | /disable
GET/POST/DELETE        /channels/:id/env-vars[/:varId]         # settings.manage for POST/DELETE
GET                    /channels/compare-env                   # ?a=&b=
POST                   /channels/:id/lock | /unlock
POST                   /agent/deploy-jobs/claim | /:id/result   # on-server agent, X-Api-Key auth
POST                   /webhooks/github                          # GitHub PR webhook ingress
GET                    /ai/status | /ai/releases/:id/risk | /predict | /rollback-plan | /notes
GET                    /ai/repositories/:id/risky-prs | /prs/:number/reviewers | /breaking-changes
GET                    /ai/incidents
```
