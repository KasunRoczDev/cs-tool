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
  notifications on every decision.
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
  `release_status_history` stay in sync either way.
- **Deployments** — a channel **pipeline board** showing current version, previous
  version and pre-computed rollback target per channel, with approval gates,
  history, and one-click **rollback** (re-promotes the prior pinned artifact, no
  rebuild). Only one active (`pending`/`approved`/`in_progress`) deployment is
  allowed per channel at a time — a second attempt is rejected with a clear
  error (DB-backed by a partial unique index, so it holds under races too).
  Live-updates over the existing WebSocket (`release_event`).

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

## Git integration

`backend/src/release/git.service.ts` is live against the GitHub REST API (branches,
compare, non-destructive conflict detection, commit/PR history, reviewer
suggestions) using a per-repository personal access token — no SDK dependency.
`syncRepository`/`resolveSha` fall back to a simulated SHA only when a repo has
no token or isn't `provider=github`. `execDeploy` (see above) and the provider
webhook signature-verification-only ingress (`webhooks.controller.ts`, GitHub
`pull_request` events → `pr.created`/`pr.merged` notifications) round out the
port; GitLab/Bitbucket adapters are still unimplemented stubs.

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
correlation, and AI-polished release notes.

## Run it

```bash
# 1. Apply DB schema + migrations (release_migration.sql, deploy_jobs_migration.sql,
#    deploy_cancel_migration.sql, release_approvals_migration.sql, rbac_migration.sql, ...)
cd backend && DATABASE_URL=postgres://monitor:monitor@localhost:5432/monitoring node scripts/migrate.js

# 2. Start backend + dashboard as usual
cd backend && npm run start:dev
cd dashboard && npm run dev

# 3. (optional) run the backend test suite
cd backend && npm test
```

New nav entries appear in the sidebar: **Repositories**, **Releases**,
**Deployments**, **Release Status Board**, **AI Assistant**. Mutating actions
require the `admin`/`operator` legacy role at minimum; the fine-grained
status-transition permissions layer on top of that (see Status workflow above).

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
GET/POST                /releases/:id/approvals
GET                    /workflows | /release-board
GET                    /releases/:id/status | /status-history
POST                   /releases/:id/transition                # fine-grained, permission-gated
GET                    /channels
GET                    /deployments | /deployments/board | /deployments/:id/history | /jobs
POST                   /releases/:id/deployments                # deploy to a channel
POST                   /deployments/:id/approve | /rollback | /cancel | /retry
POST                   /agent/deploy-jobs/claim | /:id/result   # on-server agent, X-Api-Key auth
POST                   /webhooks/github                          # GitHub PR webhook ingress
GET                    /ai/status | /ai/releases/:id/risk | /predict | /rollback-plan | /notes
GET                    /ai/repositories/:id/risky-prs | /prs/:number/reviewers | /breaking-changes
GET                    /ai/incidents
```
