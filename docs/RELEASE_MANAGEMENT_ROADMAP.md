# Release Management — Gap Analysis & Roadmap

A category-by-category assessment of Release Management against a
GitLab/Harness/Octopus Deploy/Azure DevOps-Releases feature bar. Each item is
marked against what's actually in the codebase today (not assumed):

- ✅ **Exists** — implemented and usable now.
- ⚠️ **Partial** — a real building block exists but the specific capability
  named doesn't (noted).
- ❌ **Missing** — nothing today.

See [`RELEASE_MANAGEMENT_GUIDE.md`](./RELEASE_MANAGEMENT_GUIDE.md) for what
*does* exist, and [`release-management.md`](./release-management.md) for
architecture/API.

---

## 1. Release Planning
- ✅ Release calendar — the **Release Calendar** page (`/release-calendar`,
  `GET /release-calendar`) shows planned releases, deployments, and freeze
  windows on a month grid.
- ✅ Planned release dates — `releases.planned_date`, editable on the
  release list/detail pages.
- ✅ Freeze window scheduling / ✅ Maintenance window scheduling — the same
  `deployment_freeze_windows` table covers both (a "maintenance window" and
  a "freeze window" are the same blocking-period concept here); optionally
  scoped to a channel and/or product, admin-managed, override-able by admins.
- ❌ Sprint/Milestone association — no external issue-tracker integration.
- ❌ Release roadmap (a longer-range/quarterly view — the calendar is
  month-scale)
- ❌ Capacity planning
- ❌ Release dependencies (tracked separately, see §26)
- ❌ Cross-product release planning
- ❌ Release templates

## 2. Release Creation
The draft builder exists (pin repos at a commit, bundle feature/bug/hotfix
items) but every item below it is missing — `releases` has no labels,
priority, category, or ownership columns, and there's no template concept.

- ❌ Clone previous release
- ❌ Release template
- ❌ Import release from milestone
- ❌ Auto-create release from tag
- ❌ Release scheduling
- ❌ Release ownership transfer (there's `created_by`, but no transfer flow)
- ❌ Release labels/tags
- ❌ Release priority
- ❌ Release categories
- ❌ Release dependency validation

## 5. Release Notes
`generateNotes()` produces markdown from bundled items + live GitHub PR/commit
aggregation (`releases.release_notes`), and the AI Assistant can polish it.

- ❌ Editable release notes — `UpdateReleaseDto` only allows editing `name`,
  not `release_notes`; notes are regenerate-only.
- ❌ Version history — one column, overwritten on every regenerate.
- ❌ Markdown preview — frontend renders it as plain `<pre>` text.
- ❌ HTML export
- ❌ PDF export
- ❌ Email release notes — `NotificationsService` can send email, but nothing
  wires "email these release notes" as an action.
- ❌ Customer-friendly vs. internal notes — single audience, single template.
- ❌ Multiple templates — one hardcoded template in `generateNotes()`.
- ❌ Localization

## 6. Approval System
Per-product QA/BA/Dev Lead/Tech Lead sign-off, hard-gating deploy/promote.

- ✅ Parallel approvals — every required approver approves independently;
  this is the only *ordering* mode today (still no sequential gate).
- ✅ Approval delegation — one user can submit on another's behalf for a
  time window (self-service, or admin-set for anyone); recorded under the
  delegator's slot with `decided_on_behalf_of` set.
- ✅ Approval expiration — `APPROVAL_EXPIRY_DAYS` (default off) demotes a
  stale approved sign-off back to needing re-approval, via an hourly sweep.
- ✅ Approval reminders — `APPROVAL_REMINDER_HOURS` (default 48) re-emails
  a still-undecided approver, via an hourly sweep.
- ⚠️ Approval SLA — the data to compute one now exists
  (`release_approval_history.occurred_at` per decision), but no dedicated
  SLA report/dashboard reads it yet (see §22).
- ✅ Approval history comparison — `release_approval_history` is a real
  audit trail (every submit/delegate/expire/re-request), independent of the
  live upsert; `GET /releases/:id/approvals/history`.
- ✅ Re-request approval — admin action resets one approver to pending and
  emails them.
- ❌ Sequential approvals — no ordering between approvers. Deliberately not
  built: there's no product-level definition yet of what order roles should
  gate in beyond the existing fixed QA/BA/Dev-Lead/Tech-Lead labels.
- ❌ Conditional approvals (e.g. skip QA when no UI changed) — deliberately
  not built: no concrete signal exists yet for "what changed" to condition on.
- ❌ Digital signatures — deliberately not built: needs real PKI/signing
  infrastructure this platform doesn't have; a checkbox labeled "signed"
  would be theater, not a signature. File attachments
  (`release_approval_attachments`) remain the evidence mechanism.

## 7. Deployment
Channel pipeline (canary→beta→production→enterprise) with agent-executed
jobs is solid, but the enterprise deployment-strategy/control layer is thin.

**Deployment Strategy**
- ✅ Rolling deployment — servers split into configurable batches; each
  batch must fully succeed before the next auto-starts, and a batch failure
  stops the rollout and cancels not-yet-started batches.
- ✅ Canary — server-count-based (not percentage-of-traffic — there's no
  load balancer to split traffic by percentage): a small first batch, then
  a **manual promotion gate** (`awaiting_promotion`) before the rest ships.
- ❌ Blue-Green / ❌ A/B deployment / ❌ Shadow deployment — deliberately not
  modeled. All three need real traffic-splitting/mirroring infrastructure
  (load balancer / service mesh) this platform doesn't integrate with;
  faking the labels without real traffic control would be misleading rather
  than useful.

**Deployment Control**
- ⚠️ Pause / ⚠️ Resume — not literal pause/resume, but a canary's
  `awaiting_promotion` gate is functionally a pause point, and Cancel is
  available at any wave. No true "pause mid-batch, resume later" though.
- ❌ Step-by-step deployment / ❌ Manual checkpoint (beyond the canary gate) —
  the pipeline (fetch→checkout→install→build→migrate→restart→health-check→
  custom) still runs straight through *within* a wave once started.
- ❌ Dry run
- ❌ Simulation mode

**Deployment Scheduling**
- ✅ Scheduled deployment — the Deploy modal's "Schedule for later" option;
  a once-a-minute sweep executes it automatically (treated as pre-approved).
- ✅ Maintenance window enforcement / ✅ Blackout periods — freeze windows
  (§1) block both immediate and scheduled deploys for their duration,
  re-checked at execution time.
- ✅ Recurring deployment — redeploy a *fixed* release to a channel daily or
  weekly at a set time (UTC), managed from the release detail page. Every
  firing goes through `deploy()` itself (approval/freeze/lock all still
  apply); a blocked firing is skipped and logged.

**Deployment Validation**
- ⚠️ Health check exists post-restart in the fixed pipeline, but there's no
  dedicated gate for:
- ❌ Smoke tests
- ❌ Integration tests
- ❌ Performance tests
- ❌ Security validation
- ❌ Database compatibility validation

## 8. Rollback
- ✅ One-click rollback — re-promotes the pre-computed prior version, no
  rebuild (`POST /deployments/:id/rollback`).
- ⚠️ Automatic rollback — `agent/scripts/deploy-release.sh` auto-rolls back
  to the pre-deploy SHA **on a failed deploy step**, but there's no
  platform-level "auto-rollback if error rate spikes post-deploy."
- ❌ Partial rollback — rollback always targets the whole
  deployment/version, not a single repo/service within it.
- ❌ Database rollback — migrations only run forward
  (`artisan migrate --force`); no down-migration tooling.
- ❌ Configuration rollback — no config versioning at all.
- ❌ Rollback verification — no dedicated post-rollback health gate distinct
  from the normal pipeline health check.
- ❌ Rollback simulation
- ❌ Rollback approval — `rollback()` is `admin`/`operator`-gated only, no
  approval requirement.

## 9. Environment Management
The unit of "environment" here is still the channel (no separate entity was
invented) — but it's no longer just a name.
- ✅ Environment variables — per-channel, optionally product-scoped
  key/value pairs (`channel_env_vars`), actually injected into the deploy
  pipeline (agent writes a `.env` file + exports them) via `/environments`.
- ✅ Secret management — the same table with `is_secret=true`, encrypted at
  rest (reusing `common/crypto.util`, same as repo GitHub tokens), masked
  in every read path; only the deploy-job-creation path decrypts, server-side.
- ✅ Environment comparison — diff two channels' variables by key
  (`GET /channels/compare-env`).
- ✅ Environment locking — manual lock/unlock per channel with a reason,
  blocking deploys like a freeze window (admin-overridable).
- ⚠️ Environment cloning — not a dedicated endpoint; copying vars between
  channels today means reading one and re-saving on the other by hand.
- ❌ Environment health — deliberately not built: there's no persistent
  servers↔channel binding (servers are picked ad-hoc per deploy), so a real
  "which servers back this channel" view doesn't exist without inventing
  one. General server health is already covered by the platform's existing
  monitoring pages.
- ❌ Environment reservation — no clear ownership/booking model elsewhere in
  the system to hang this off; low value for the complexity.
- ❌ Temporary / preview environments — would need to dynamically provision
  new servers/containers, which this platform doesn't do (it only manages
  already-registered monitored servers).

## 11. Deployment Agent
- ✅ Agent authentication — `X-Api-Key` (`deploy-agent.controller.ts`, same
  key as metric ingest).
- ✅ Agent logs — `deploy_jobs.log` stores combined stdout/stderr per job,
  readable via `GET /deploy-jobs/:id/log`.
- ⚠️ Agent heartbeat/reconnect — the general monitoring agent has its own
  last-seen/online tracking outside the release module; there's no
  deploy-job-specific heartbeat, and the poll model (agent pulls jobs) makes
  "reconnect" a non-issue rather than a handled state.
- ❌ Agent registration (as a distinct flow — it rides on server registration)
- ❌ Agent upgrades
- ❌ Agent diagnostics
- ❌ Agent capabilities (negotiation)
- ❌ Agent queue status — `deploy_jobs` has the data (status per server) but
  nothing surfaces it as a queue view.

## 12. Monitoring
- ✅ **Deployment metrics** — the **Release Metrics** page
  (`/release-metrics`, `GET /deployments/metrics`) now ships Deployment
  Frequency, Lead Time for Changes, Change Failure Rate, and MTTR, each with
  an Elite/High/Medium/Low tier, per channel over a selectable window.
- ⚠️ MTTR — implemented, but scoped to deployment failures specifically
  (deployment enters `failed`/`rolled_back` → later `succeeded`), not a
  general incident/MTTR across all alert types.
- ❌ MTBF (Mean Time Between Failures)
- ✅ Failure trends / ✅ Deployment duration — the daily deployment-count
  chart + CFR cover trend visibility; no separate "duration" (pipeline wall
  clock) metric yet, see below.
- ❌ Pipeline duration (job-level timing — `deploy_jobs` has
  `started_at`/`finished_at` already, so this is additive, not new plumbing)
- ❌ Health dashboards / ❌ SLA dashboards (beyond the DORA tiers)
- ⚠️ Live monitoring — the Deployments board live-updates over WebSocket
  (status, not metrics); Release Metrics is a manual-refresh dashboard today.

## 13. Notifications
**Not** missing entirely — this is the biggest correction to the source
list. `backend/src/notifications/` has real, working services:
- ✅ Email (`email.service.ts`)
- ✅ Slack (`slack.service.ts`)
- ✅ Microsoft Teams (`teams.service.ts`)
- ✅ Discord (`discord.service.ts`)
- ✅ Generic outbound webhook (`webhook.service.ts`) — plain JSON POST for
  any receiver that isn't one of the other three.
- ❌ SMS
- ❌ Push notifications
- ✅ Events — release-management already fires: release created
  (`release.created`), approval submitted/rejected/fully approved/delegated/
  expired/re-requested, hotfix created, PR opened/merged (via GitHub webhook
  ingress), release status-changed, deployment created/successful/failed/
  cancelled/scheduled/awaiting_promotion/wave_advanced, rollback.
- ✅ "AI high-risk alert" — `release.ai_high_risk` fires when a release
  scores high risk (throttled to once per release+channel per 6h, since the
  score is recomputed on every AI Assistant page view, not on a schedule).

## 16. Access Control
- ✅ Custom roles — `POST /roles` + `PUT /roles/:id/permissions`
  (`access.controller.ts`) already supports arbitrary custom roles.
- ⚠️ Environment-specific permissions — `deploy.execute.<channel>` /
  `deploy.approve.<channel>` are already channel(environment)-scoped
  permission keys; there's no per-environment grant *UI*, but the model
  supports it.
- ❌ Permission inheritance (role hierarchy)
- ❌ Temporary / time-limited permissions — `memberships` has no expiry.
- ❌ Repository-specific permissions — grants are product-scoped, not
  per-repository within a product.
- ❌ Approval matrix editor — approvers are implicit (anyone with the right
  `approval_role` + `product_id`); no dedicated matrix UI.

## 17. AI Assistant
Existing: release risk scoring, deployment-failure prediction, rollback-plan
generation, AI-polished release notes, risky-PR detection, reviewer
recommendations, breaking-change detection, incident correlation.
- ⚠️ Deployment recommendations — the risk score includes a
  `recommendation` string; there's no separate go/no-go engine.
- ⚠️ Auto-generated rollback commands — a rollback *plan* (steps) exists;
  it's not literal executable commands.
- ⚠️ Release summary generation — release-notes polishing covers this.
- ⚠️ Change impact analysis — breaking-change detection is adjacent but
  narrower (title/diff heuristics, not full impact analysis).
- ❌ Root cause analysis
- ❌ Incident prediction (current incident correlation is reactive/post-hoc,
  not predictive)
- ❌ Cost analysis
- ❌ PR summarization (risky-PR detection scores PRs, doesn't summarize them)
- ❌ Commit summarization
- ❌ Test impact analysis
- ❌ Dependency risk analysis
- ❌ AI chatbot — every capability today is a fixed button/endpoint, no
  conversational interface.

## 20. Testing Integration
- ✅ Unit/integration/E2E test status, coverage, SonarQube, Playwright — all
  covered by one honest mechanism: `GET /releases/:id/test-status` reads
  live **GitHub Check Runs** for each pinned repo's commit. This isn't the
  platform running or polling each tool individually — it's reading the one
  place GitHub already aggregates them, since GitHub Actions and most
  third-party quality tools (SonarQube Cloud, Codecov, Playwright Cloud,
  etc.) post their result as a GitHub check when configured. A repo with no
  such integration simply shows `no_checks`, not a fabricated pass.
- ⚠️ A repo using a CI system that posts the legacy Combined Status API
  instead of Check Runs (some older integrations) won't show up — only the
  newer Check Runs API is queried today.

## 21. Compliance
- ⚠️ Change approvals — the approvals system is a real, working change-gate;
  it's just not framed/reported as a compliance control.
- ✅ Audit evidence — the **Audit Log** page (`/audit-log`, admin-only)
  unifies `release_status_history`, `deployment_history`,
  `release_approval_history`, and `audit_log` into one filterable timeline,
  finally putting the seeded-but-previously-unused `audit.read` permission
  to work.
- ✅ Compliance reports (as evidence export) — CSV export of the same
  filtered audit feed (`GET /audit-log/export.csv`).
- ❌ SOX / ISO 27001 / PCI DSS / HIPAA — deliberately not built: framework
  compliance is a controls-mapping exercise your compliance team owns: this
  app can hand over the evidence trail, not certify against a framework on
  your behalf.

## 22. Reports & Analytics
- ✅ Release frequency / ✅ Deployment success rate / ✅ Deployment failures /
  ✅ Lead time for changes / ✅ Mean deployment duration / ✅ Rollback
  frequency — all on the Release Metrics page (§12); the last two have no
  standard DORA tier bands, so they're shown as raw numbers.
- ❌ Failed-approval rate / ❌ Repository activity / ❌ Team performance /
  ❌ AI accuracy metrics — still nothing dedicated; the underlying event
  data (`release_approval_history`, `deployment_history`,
  `release_status_history`, all now visible via the Audit Log, §21) exists
  to compute most of these from.

## 23. Dashboard
❌ Missing — the platform's `/` overview is general server monitoring, not
release-specific. No widget for active releases, pending approvals, failed
deployments, upcoming releases, current production version, recent
rollbacks, pipeline health, or a deployment calendar.

## 24. Search & Filtering
❌ Missing — no global search, advanced/saved filters, or search-by-PR /
commit / version / repository / environment anywhere in the release UI.

## 25. Release Comparison
❌ Missing — no release-vs-release, environment-vs-environment,
version-vs-version, or config-diff views.

## 26. Release Dependencies
❌ Missing — no blocking/dependent-release graph, service/DB dependency
declarations, or API-compatibility checks.

## 27. Disaster Recovery
❌ Missing — no backup-before-deploy, restore points, DB snapshots, or
config backups tied to releases. (The deploy pipeline's per-step
auto-rollback-on-failure, §8, is the closest existing safety net, and it's
narrower than DR.)

## 28. Multi-Tenancy / Multi-Product
- ✅ Products — the existing grouping/RBAC/workflow-scoping unit; this is
  the real foundation everything else in this section would build on.
- ❌ Organization/workspace layer above products
- ❌ Product portfolio dashboard
- ❌ Cross-product releases
- ❌ Shared repositories — a repository belongs to exactly one product today.
- ⚠️ Product ownership — products can be assigned members/roles, but there's
  no single "owner" concept.
- ❌ Tenant isolation (beyond RBAC product-scoping)
- ❌ Cross-product dependencies

## 30. User Experience Enhancements
- ✅ Dark mode — already platform-wide (Settings page / theme toggle),
  applies to every release-management page too.
- ❌ Favorites
- ❌ Recent releases
- ❌ Keyboard shortcuts
- ❌ Bulk actions — every action in the UI is single-item.
- ❌ Drag-and-drop ordering
- ❌ Import/export
- ❌ CSV/Excel export
- ❌ Personal dashboards (the existing `DashboardCustomizer` is for the
  general monitoring dashboard's widget visibility, not a per-user release
  view)

---

## Priority Recommendations

Re-ordered against what's actually already there:

1. ~~**Deployment Monitoring & Metrics**~~ ✅ **Done** (§12, §22) — the
   Release Metrics page ships Deployment Frequency, Lead Time, Change
   Failure Rate, and MTTR with DORA tiers.
2. ~~**Release Calendar & Scheduling**~~ ✅ **Done** (§1, §7) — planned
   release dates, the Release Calendar page, scheduled deployments (a
   once-a-minute sweep executes them), and admin-managed freeze/blackout
   windows (channel/product-scoped, override-able by admins).
3. ~~**Canary and Rolling deployment strategies**~~ ✅ **Done** (§7) —
   batch-based rolling (auto-advance) and canary (manual promotion gate)
   rollouts across selected servers. Blue-Green/A-B/Shadow deliberately
   *not* built — no load balancer/service mesh integration exists to back
   them honestly.
4. ~~**Environment & Secrets Management**~~ ✅ **Done** (§9) — per-channel
   env vars/secrets (encrypted, actually injected into the deploy pipeline
   via the agent), locking, and a compare view. Environment health/
   reservation/temporary environments deliberately excluded — no real data
   or infrastructure to back them.
5. ~~**Advanced Approval Workflows**~~ ✅ **Done** (§6) — delegation,
   expiration, reminders, and a real decision history on top of the existing
   parallel sign-off. Sequential/conditional gating and digital signatures
   deliberately excluded — no product definition for the former, no PKI for
   the latter.
6. ~~**Audit Log viewer + Compliance reporting**~~ ✅ **Done** (§21) — a
   unified, filterable, CSV-exportable timeline over release/deployment/
   approval/account history. Framework certification (SOX/ISO/PCI/HIPAA)
   deliberately excluded — that's a controls-mapping exercise, not
   something to fake.
7. ~~**Notifications: fill the gaps**~~ ✅ **Done** (§13) — generic webhook
   channel type, plus the `release.ai_high_risk` event wired from real risk
   scoring (throttled, not spammy). SMS/push still open — no provider
   integration exists for either.
8. ~~**Reports & Analytics: mean deployment duration + rollback
   frequency**~~ ✅ **Done** (§22) — added to the Release Metrics page.
   Failed-approval rate, repo activity, and team performance still need new
   aggregation (no dedicated report yet, though the Audit Log makes the raw
   events queryable).
9. ~~**Testing Integration**~~ ✅ **Done** (§20) — live GitHub Check Runs
   per pinned repo's commit on the release detail page, covering CI/coverage/
   SonarQube/Playwright uniformly via whatever already posts as a GitHub
   check — no per-tool integrations built or faked.
10. ~~**Recurring deployments**~~ ✅ **Done** (§7) — daily/weekly redeploy
    of a fixed release, managed from the release detail page, fully gated
    by the same approval/freeze/lock checks as a manual deploy.

**All ten priority items from this list are now done.** Notably *not*
re-prioritized up: **Artifact Management** (Docker/Helm/package registries)
— not assessed above because it wasn't in the per-category list; worth a
follow-up pass if it matters to you. Beyond that, the remaining ❌/⚠️ items
throughout this document are the ones deliberately left for a future pass,
each with a stated reason (needs infrastructure this platform doesn't have,
needs a product decision only you can make, or is genuinely low value for
its complexity) rather than silently dropped.
