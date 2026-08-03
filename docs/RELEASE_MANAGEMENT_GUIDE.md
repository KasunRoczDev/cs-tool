# Release Management Guide

A feature-by-feature reference for the Release Management tools, grouped by
sidebar page. For architecture/internals and the REST API surface, see
[`release-management.md`](./release-management.md); this guide covers what
each screen does and every option on it.

## Overview

Release Management adds eight pages under the **Release Management** sidebar
section, plus two admin-only configuration/oversight pages:

| Page | Path | Purpose |
|---|---|---|
| 📚 Repositories | `/repositories` | Register repos, manage branches/versions, GitHub tokens |
| 🚀 Releases | `/releases`, `/releases/:id` | Build a release: pin repos, bundle changes, approvals, status, deploy |
| 🗂️ Release Board | `/release-board` | Kanban view of every release by status |
| 🛳️ Deployments | `/deployments` | Channel pipeline board + deployment history/actions |
| 📈 Release Metrics | `/release-metrics` | DORA dashboard: deployment frequency, lead time, change failure rate, MTTR |
| 📅 Release Calendar | `/release-calendar` | Month view of planned releases, deployments, and freeze windows |
| 🌐 Environments | `/environments` | Per-channel env vars/secrets, locking, and a two-channel compare view |
| 🤖 AI Assistant | `/ai` | Risk scoring, failure prediction, PR intelligence, incident correlation |
| 🧭 Workflow Config *(admin only)* | `/release-workflows` | Build a custom per-product release status workflow |
| 🧾 Audit Log *(admin only)* | `/audit-log` | Unified, filterable, exportable timeline of release/deployment/approval/account events |

Mutating actions generally require the `admin` or `operator` role at minimum;
the fine-grained RBAC layer (product-wise roles/permissions) sits on top of
that — see [Roles & permissions](#roles--permissions) below.

---

## 📚 Repositories

Register the Git repositories that make up your product(s).

**Add repository** form fields:
- **Name** / **Slug** — display name and URL-safe identifier.
- **Remote URL** — clone URL.
- **Provider** — `github` (fully live against the GitHub REST API), `gitlab`
  or `bitbucket` (currently unimplemented stub adapters — sync/branches/PRs
  fall back to simulated data for these).
- **Product** — optional; groups repos for approvals, RBAC scoping, and the
  release-workflow-per-product feature.
- **Default branch**, **Tech stack** (comma-separated), **GitHub token**
  (optional, write-only — validated against GitHub on save; a bad PAT is
  rejected immediately).

**Per-repository actions:**
- **Branches** — create/delete branches, compare `base...head` (ahead/behind,
  files, commits), and non-destructive conflict detection. Requires a token.
- **Graph** — visual commit graph. Requires a token.
- **Set token / Token** — set, rotate, or clear the repo's GitHub token
  (leave blank to clear). Tokens are encrypted at rest and never sent back to
  the browser — the UI only shows whether one is set.
- **Sync** — force a resync; fetches the real tip SHA of the default branch
  and stores it in the repo's metadata.
- **Delete** — remove the repository.
- **Versions ▾** — expand to tag semantic versions (`version` + optional
  `commit_sha`) for the repo, independent of releases. `version` must look
  like `1.2.3`, `1.2`, or `1.2.3-rc.1` (an optional leading `v` is fine) —
  anything else is rejected rather than silently stored.

Repositories are grouped by product in the table, with an "— Unassigned —"
group for repos with no product.

---

## 🚀 Releases

### Release list (`/releases`)
All releases with their status, planned date, repo/item counts, and creator.
The draft form takes an optional **planned date**, shown on the
[Release Calendar](#-release-calendar).

### Release detail (`/releases/:id`)

**Planned date** — editable any time (not just while a draft); clear it by
emptying the date field.

**Draft builder** (only while status = `draft`):
- **Pin repositories** — attach a repository at a specific ref (branch/tag)
  or exact commit SHA (auto-resolved via the GitHub API when a token is
  set), with an optional free-text version label and branch name.
- **Bundle items** — attach `feature` / `bug` / `hotfix` changelog entries
  (key, title, author). Adding a `hotfix` item notifies subscribed channels
  immediately.
- Both pinned repos and bundled items can be removed while still a draft.

**Test Status** — click **Check GitHub status** to read live GitHub Check
Runs for each pinned repo's commit (GitHub Actions, and anything else
configured to report as a GitHub check — SonarQube Cloud, Codecov, Playwright
Cloud, etc.). Shown per repo: overall (`passed`/`failed`/`pending`/
`no_checks`/`unavailable`) and a badge per check linking to its GitHub page.
Nothing runs on this platform — it's read-only, on demand (not auto-polled).

**Recurring Deployments** — redeploy *this exact release* to a channel on a
daily or weekly schedule (time in UTC), e.g. a nightly environment refresh.
Deliberately not "redeploy whatever's latest" — that's too ambiguous/risky
to default to. Each firing goes through the same checks as a manual deploy
(approval gate, freeze windows, channel locking); a blocked firing is
skipped and logged, not forced through. Enable/disable or delete a rule any
time; **Last run** shows when it last actually fired.

**Generate release notes** — produces templated markdown combining:
1. manually bundled items, grouped by type;
2. live GitHub data per pinned repo (merged PRs + commits, best-effort —
   repos without a token are skipped, not failed);
3. Feature/Bug IDs auto-extracted from PR titles and commit messages;
4. the pinned artifacts (repo @ commit).

**Status workflow panel** — shows the current status and every transition
the signed-in user is allowed to make (permission- and approval-gated); each
has an optional note field. `Generate release notes`, `Archive`, and
`Deploy…` sit above it as page-level actions.

**Approvals panel** — per-product QA / BA / Dev Lead / Tech Lead sign-off.
Shows each required approver's decision, remark, and attachments; the
signed-in user (if a required approver, or an active delegate for one) gets
an inline **Approve** / **Reject** form with an optional remark and file
attachment. A release is only deployable/promotable once every configured
approver has signed off (admins can override).

- **View history** — every decision change over time (submit, delegate,
  expire, re-request), not just the current live state.
- **Expires** — shown under a decision when `APPROVAL_EXPIRY_DAYS` is set;
  a sign-off older than that reverts to needing re-approval automatically.
- **by delegate ...** — shown when someone submitted on the original
  approver's behalf via an active delegation.
- **Re-request** *(admin only)* — resets one approver's decision to pending
  and emails them, e.g. after a new commit invalidates a prior sign-off.
- **Delegate an approver's sign-off** *(admin only in this UI — any
  approver can self-delegate via the API)* — hand off one approver's slot to
  another user until a chosen date; the delegate's decisions count as the
  original approver's until it ends or is revoked.

**Deploy…** modal:
- **Environment** — target deploy channel (canary/beta/production/enterprise).
- **Target servers** — multi-select of monitored servers; defaults to only
  servers matching the release's product(s), with a "Show all servers"
  override. Leaving this empty creates a tracking-only deployment (no agent
  execution).
- **Branch** (optional) — overrides every pinned repo's branch for this
  deploy.
- **Rollout strategy** (shown once 2+ servers are selected):
  - **All at once** (default) — every server deploys together, as before.
  - **Rolling** — servers split into batches (**batch size** configurable);
    each batch must fully succeed before the next starts. A batch failure
    stops the rollout and cancels the not-yet-started batches.
  - **Canary** — a small first batch (**canary server count** configurable)
    deploys, then the deployment **pauses** (`awaiting_promotion`) until you
    click **Promote** on the Deployments page. A failed canary stops the
    rollout — nothing else deploys.
  - Blue-Green, A/B, and Shadow deployment aren't offered — they need real
    traffic-splitting infrastructure (load balancer / service mesh) this
    platform doesn't integrate with.
- **Custom commands** (optional, one per line) — run after the fixed
  pipeline (fetch → checkout → install → build → migrate → restart → health
  check). Migrations run automatically for Laravel repos; seeders/cache
  clears do not and must be listed here.
- **Schedule for later** (optional) — deploy at a future date/time instead of
  immediately. Scheduling *is* the approval decision — it skips the manual
  Approve click and executes automatically when the time arrives, unless an
  active freeze window covers that moment (deferred, re-checked every
  minute). A scheduled deployment can still be cancelled up until it fires.

---

## 📈 Release Metrics

A per-channel DORA (DevOps Research and Assessment) dashboard, computed live
from deployment history — no separate rollup table.

- **Filters** — channel (canary/beta/production/enterprise) and trailing
  window (7/30/90 days).
- **Deployment Frequency** — succeeded deploys per week to the channel, plus
  a daily bar chart for the window.
- **Lead Time for Changes** — median time from release creation to deploy
  (an approximation of commit-to-deploy lead time — see the in-page note).
- **Change Failure Rate** — the percentage of the channel's deployments in
  the window that ended `failed` or `rolled_back`.
- **MTTR** — mean time from a deployment entering `failed`/`rolled_back` to
  that same deployment later reaching `succeeded` (covers the retry flow).
- **Mean Deployment Duration** — average pipeline wall-clock time
  (start→finish) for succeeded deployments; distinct from Lead Time, which
  measures release-creation-to-deploy, not the pipeline run itself.
- **Rollback Frequency** — the percentage of the channel's deployments in
  the window that ended `rolled_back`. No standard DORA tier bands exist for
  this one, so it's shown as a raw number.

The four core DORA metrics each show an **Elite / High / Medium / Low** tier
badge using the commonly published DORA bands, so the numbers have context without having to
know the thresholds yourself.

---

## 📅 Release Calendar

A month-grid view combining three things, all fetched live for the visible
month:
- **📦 Planned releases** — releases with a planned date; click one to open it.
- **🛳️ Deployments** — colored by status, plotted on their scheduled date (if
  scheduled) or their finish/creation date otherwise.
- **🚫 Freeze windows** — shown as a red-tinted day background plus a chip
  naming the window. *(admin only)* create a window with a name, start/end
  time, optional channel and/or product scope, and a reason; delete one with
  the ✕ on its chip.

Freeze windows block `Deploy…` (immediate or scheduled) for their duration —
scoped to the specific channel/product if set, or platform-wide if left as
"all channels"/"all products". A non-admin deploy attempt inside an active
window is rejected with the window's name/reason; an admin can override.

---

## 🌐 Environments

Per-channel configuration that feeds directly into the deploy pipeline.

- **Variables & secrets** — key/value pairs scoped to a channel, optionally
  further scoped to a product (a product-specific value overrides a same-key
  global one for that product's repos). Mark a value **secret** to encrypt it
  at rest — secret values are write-only: once saved, the UI only ever shows
  that one is set, never the value. On deploy, each pinned repo's resolved
  vars are handed to the on-server agent, which writes them to a `.env` file
  (and exports them into the shell) before install/build/migrate — real
  pipeline injection, not just storage.
- **Lock / Unlock** *(admin only)* — blocks deploys to that channel (with an
  optional reason shown to whoever tries), the same way an active freeze
  window does; admins can still override. Locked channels show a 🔒 badge on
  this page and on the Deployments board.
- **Compare two channels** — pick channel A and B; see every variable key
  present on either side, whether it's on both, and (decrypted server-side,
  never returned) whether the values actually match.

Requires `TOKEN_ENC_KEY` to be set (same variable used for repository GitHub
tokens) — without it, saving or reading any secret value throws.

---

## 🧭 Workflow Configuration *(admin only)*

Build a custom release status workflow per product instead of the seeded
default (`draft → canary → beta → production → enterprise`, plus `archived`
reachable from anywhere). Requires the `settings.manage` permission.

- **New workflow** — name + product (workflows are always product-scoped
  here; there is exactly one global default workflow, seeded and
  undeletable).
- **Statuses** — key (lowercase/numbers/underscores, immutable once
  created), display name, rank (ordering), category (`draft` / `stage` /
  `terminal`), an optional deploy-channel mapping, and a color. Adding a
  status automatically provisions its `status.transition.<key>` permission
  in the RBAC catalog so a role can be granted access to it on the
  **Access Control** page. A status can't be deleted while any release is
  currently on it.
- **Transitions** — from status (or "any"), to status, kind
  (`forward` / `rollback` / `archive`), whether it requires the approvals
  gate, and whether it should auto-deploy.
- **Delete workflow** — blocked for the default workflow or while any
  release is currently on it.

---

## 🗂️ Release Board

A Kanban board of every non-archived release, grouped into columns by its
current status (from its resolved workflow — default or per-product
custom). Click a card to jump to that release's detail page.

---

## 🛳️ Deployments

**Channel pipeline board** — one card per channel showing the current
(latest succeeded) version, the previous version, and the pre-computed
rollback target, plus the latest deployment's status with inline
**Approve** / **Promote** / **Rollback** buttons where applicable.

**History table** — every deployment, most recent first, with a
**wave X/Y (strategy)** indicator when a rolling/canary deployment has more
than one wave, and per-row actions depending on status:
- **Approve** (`pending`) — approve and start execution.
- **Promote** (`awaiting_promotion`) — a canary's first wave succeeded;
  deploy the remaining server(s).
- **Cancel** (`scheduled`/`pending`/`approved`/`in_progress`/`awaiting_promotion`) —
  stops the deployment; any still-open agent jobs are marked cancelled so
  agents skip them.
- **Retry** (`failed`) — re-runs only the jobs that didn't succeed **in the
  wave that failed** (not later waves a failure already cancelled, and not a
  new deployment).
- **Rollback** (`succeeded`, if a rollback target is recorded) — one click;
  re-promotes the prior pinned artifact with no rebuild.
- **Pipeline** — drill into per-server, per-repo agent job status and
  pipeline step badges (fetch/checkout/install/build/migrate/restart/health
  check/custom), grouped by wave for multi-wave deployments.
- **Log** — the deployment's status-transition history.

Only one active deployment (`scheduled`/`pending`/`approved`/`in_progress`/
`awaiting_promotion`) is allowed per channel at a time. A job an agent never
reports back on auto-fails after `DEPLOY_JOB_TIMEOUT_MINUTES` (default 15) so
a deployment can't hang forever. The board live-updates over the existing
WebSocket connection.

---

## 🤖 AI Assistant

Release intelligence computed from your own data (deployments, jobs, PRs,
commits, alerts) — every capability works on heuristics alone; set
`AI_API_KEY` to additionally layer an LLM narrative on top.

**Release risk, failure prediction & rollback** (pick a release + channel):
- **Estimate risk** — 0–100 score + level (low/medium/high) with scored
  factors and a recommendation.
- **Predict failure** — failure-probability score with a stated basis and
  confidence.
- **Rollback plan** — a generated step list targeting the pre-computed
  rollback version.
- **AI release notes** — polishes the generated release notes (falls back
  to the raw notes with no LLM key).

**Pull request intelligence** (pick a repository):
- **Detect risky PRs** — scores every open PR by churn/files/age with
  reasons.
- **Recommend reviewers** (needs a PR number) — suggested reviewers with
  rationale.
- **Detect breaking changes** (needs a PR number) — flags with file, kind,
  and why.

**Production incident analysis** — pick a lookback window (24h/72h/168h);
correlates alerts against recent deployments to surface deployments that
likely caused an incident, plus a narrative summary.

---

## 🧾 Audit Log *(admin only)*

A single, filterable timeline over four event types that were already being
recorded — this page just makes them visible together instead of scattered
across per-release history panels:
- **release status** — every workflow transition (from `release_status_history`).
- **deployment** — every deployment status change (from `deployment_history`).
- **approval** — every approval decision, delegation, expiry, and re-request
  (from `release_approval_history`).
- **account** — general user-account actions (from `audit_log`).

Filter by release, type, and date range; **Export CSV** downloads the same
filtered rows for evidence/compliance purposes. Requires the `audit.read`
permission (already granted to `platform_admin`, `product_admin`,
`release_manager`, and `viewer` by default). This page gives you the raw
evidence trail — mapping it to a specific compliance framework
(SOX/ISO 27001/PCI DSS/HIPAA) is a controls exercise for your compliance
team, not something the app can assert on your behalf.

---

## Roles & permissions

Release Management ships nine seeded system roles (`platform_admin`,
`product_admin`, `release_manager`, `devops`, `developer`, `qa`, `ba`,
`tech_lead`, `viewer`) and permission keys such as `release.*`,
`status.transition.<key>`, `deploy.execute.<channel>`,
`deploy.approve.<channel>`, `deploy.rollback`, and `approval.*`. Assign
roles to users per-product (or globally) on the **Access Control** page.
`qa` / `ba` / `dev_lead` / `tech_lead` map to the four approval slots used
by the Approvals panel.

## Configuration (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | unset | Verifies `POST /webhooks/github` signatures. Without it, the endpoint accepts unsigned requests from anyone (a startup warning is logged). |
| `DEPLOY_JOB_TIMEOUT_MINUTES` | `15` | How long an agent job can sit `claimed`/`running` with no update before it's auto-failed. |
| `AI_PROVIDER` | `anthropic` | LLM provider for AI Assistant narrative enrichment. |
| `AI_API_KEY` | unset | Enables LLM narratives; all AI Assistant scoring works without it. |
| `AI_MODEL` | provider default | Model used for narrative enrichment. |
| `TOKEN_ENC_KEY` | unset (required for secrets) | Encrypts repository GitHub tokens and channel env-var secrets at rest. Rotating it invalidates every previously stored secret. |
| `APPROVAL_EXPIRY_DAYS` | `0` (disabled) | Days after which an approved sign-off auto-expires and needs re-approval. |
| `APPROVAL_REMINDER_HOURS` | `48` | How often a still-undecided approver is re-emailed. |

## Related docs
- [`release-management.md`](./release-management.md) — architecture, deploy
  pipeline internals, and the full REST API surface.
