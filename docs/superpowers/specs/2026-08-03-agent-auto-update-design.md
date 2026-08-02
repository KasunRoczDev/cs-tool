# Agent Auto-Update

Status: Approved
Date: 2026-08-03

## Problem

The monitoring agent (`agent/`) has no update mechanism. Getting a new agent
version onto an already-installed server today means manually rebuilding the
`.deb` (`packaging/build-deb.sh`) and running `dpkg -i` on every target host
by hand — see `packaging/README.md`'s "Updating an already-installed agent"
section. `docs/RELEASE_MANAGEMENT_ROADMAP.md` §11 explicitly tracks this gap
("❌ Agent upgrades"). We're adding a self-update path: the platform publishes
a new agent version, and every installed agent detects it, pulls it, and
applies it on its own.

This is a distinct problem from the existing app-deployment pipeline
(`deploy_jobs` / `DeployRunner` / `deploy-release.sh`), which deploys
*customer application code* to servers. That pipeline is *executed by* the
agent process — reusing it to update the agent itself would mean the running
process has to kill and replace itself mid-script, which is fragile and hard
to reason about for success/failure reporting. Agent self-update is therefore
a **separate, purpose-built mechanism**, not a new deploy-job type.

## Existing architecture (context)

- The agent (`agent/src/index.js`) runs as an unprivileged systemd service
  (`monitor-agent` user), hardened with `NoNewPrivileges=true`,
  `ProtectSystem=strict`, and `ReadWritePaths=/var/lib/monitor-agent` only
  (`packaging/systemd/monitor-agent.service`). It cannot write to
  `/usr/lib/monitor-agent` or restart systemd units on its own.
- Agent-facing endpoints (`/api/v1/metrics`, `/api/v1/security-events`,
  `/api/v1/agent/deploy-jobs/*`) are authed via `X-Api-Key` through
  `AgentAuthGuard` (`backend/src/common/agent-auth.guard.ts`), which hashes
  the key (`hashApiKey`, sha256) and looks it up against
  `servers.api_key_hash`, attaching `req.server`.
- `servers` (in `database/schema.sql`) already tracks `status`/`last_seen`
  per server; there's no per-server agent-version tracking yet.
- `platform_settings` (`database/settings_migration.sql`) is a generic
  key/value table already used for admin-configurable options (SMTP creds
  today) — the right home for a global kill switch, no new table needed.
- Migrations are individual idempotent `.sql` files under `database/`, each
  wired into `backend/scripts/migrate.js` in dependency order.
- The existing deploy pipeline's pattern — agent polls, runs a script,
  reports back, auto-rolls-back its own failed step
  (`agent/scripts/deploy-release.sh`) — is the model this design borrows for
  its own apply/rollback step, without reusing the `deploy_jobs` machinery
  itself.

## Architecture

```
[Release builder, offline]
   build-deb.sh -> monitor-agent_x.y.z_all.deb
   sign-agent-release.sh (Ed25519 private key, never touches the backend) -> .sig
        |
        v  (admin dashboard upload: .deb + .sig + version + changelog)
[Backend]
   agent_releases table (version, deb blob, sha256, signature, rollout_percent, is_active)
   platform_settings['agent_auto_update_enabled']  (global kill switch)
   servers.agent_version / agent_update_status / agent_auto_update_excluded
        |
        |  GET /api/v1/agent/updates/latest       (X-Api-Key)
        v
[Agent, unprivileged monitor-agent user]
   updater.js: check -> download to /var/lib/monitor-agent/updates/ -> verify
   sha256 + Ed25519 signature (public key baked into the package at build time)
        |
        |  sudo (NOPASSWD, one whitelisted script, no shell-expandable args)
        v
[apply-update.sh, root]
   dpkg -i new .deb -> systemctl restart monitor-agent -> health-check
   -> on failure: dpkg -i previously-cached .deb, restart again (rollback)
        |
        v
[Agent, new or rolled-back version]
   POST /api/v1/agent/updates/report {version, status, message}
```

The private signing key is generated once and kept **only** with whoever
builds releases — never uploaded to or stored by the backend. This is the
reason to use a signature instead of a checksum alone: a checksum only
protects against transit corruption, but since the backend already computes
and would serve the checksum itself, a compromised backend account could
serve a checksum matching *anything* it wants. A signature verified against a
public key baked into the package at build time means even a compromised
backend can't produce an update the agent will accept.

## Data model

### `database/agent_releases_migration.sql`

```sql
CREATE TABLE IF NOT EXISTS agent_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL UNIQUE,        -- semver, e.g. 1.2.0
  changelog       TEXT,
  package         BYTEA NOT NULL,              -- the .deb contents
  sha256          TEXT NOT NULL,               -- hex digest of `package`
  signature       TEXT NOT NULL,               -- base64, Ed25519 sig of `package`
  rollout_percent SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  is_active       BOOLEAN NOT NULL DEFAULT true,  -- per-release kill switch
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_releases_active
  ON agent_releases (is_active, created_at DESC);
```

### `database/agent_update_status_migration.sql`

```sql
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_version TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_status TEXT
  NOT NULL DEFAULT 'idle';  -- idle|checking|downloading|applying|succeeded|rolled_back|failed
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_message TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_auto_update_excluded BOOLEAN
  NOT NULL DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_last_update_at TIMESTAMPTZ;
```

### `platform_settings` seed (added to `settings_migration.sql`'s seed list, or a
tiny follow-up idempotent `INSERT ... ON CONFLICT DO NOTHING`)

```sql
INSERT INTO platform_settings (key, value) VALUES
  ('agent_auto_update_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

Both new files are wired into `backend/scripts/migrate.js` after
`deploy_jobs_migration.sql` (needs `servers`) — same idempotent-migration
convention as every existing file there.

## Backend

### Agent-facing (`backend/src/release/agent-updates.controller.ts`, `AgentAuthGuard`, same auth as metrics/deploy-jobs)

- `GET /api/v1/agent/updates/latest` — resolves the latest `is_active` release
  in `agent_releases`, checks the global `agent_auto_update_enabled` setting,
  `req.server.agent_auto_update_excluded`, and rollout-percent eligibility
  (`hash(server.id) % 100 < rollout_percent`, deterministic so the same
  servers stay in/out as the percent increases). Returns `{eligible: false}`
  or `{version, sha256, signature, download_url}`.
- `GET /api/v1/agent/updates/:version/package` — streams the `.deb` bytes for
  an active release.
- `POST /api/v1/agent/updates/report` — body `{version, status, message?}`;
  updates `servers.agent_version` / `agent_update_status` /
  `agent_update_message` / `agent_last_update_at` for `req.server.id`.

### Admin-facing (`backend/src/release/agent-releases.controller.ts`, JWT + a new `agent.releases.manage` permission, same RBAC pattern as `settings.manage`)

- `POST /agent-releases` — multipart upload: `.deb` file, `.sig` file,
  `version`, `changelog`. Backend computes the sha256 itself (never trusts a
  client-supplied checksum); the signature is stored as-is for the agent to
  verify against its own baked-in public key.
- `GET /agent-releases` — list, most recent first.
- `PATCH /agent-releases/:id` — update `rollout_percent` / `is_active`.
- `PATCH /servers/:id` (extend existing endpoint, or a small dedicated one) —
  toggle `agent_auto_update_excluded` per server.
- `PATCH /settings` (existing `platform_settings` admin surface) — toggle
  `agent_auto_update_enabled`, the global kill switch.

## Agent

### `agent/src/updater.js` (new)

Wired into `agent/src/index.js` `main()` as a new optional interval, gated by
`cfg.self_update.enabled` (default `false` in `agent.yaml`, same opt-in
pattern as `cfg.deploy.enabled`) and `cfg.self_update.check_interval`
(default 3600s — this doesn't need metrics-loop frequency).

1. `GET /agent/updates/latest`. If not eligible or already on that version,
   done for this cycle.
2. Download the `.deb` to `/var/lib/monitor-agent/updates/<version>.deb` (the
   agent's only writable path).
3. Verify: sha256 matches, then verify the Ed25519 signature over the raw
   bytes using `crypto.verify('ed25519', bytes, publicKey, signature)` — a
   public key file installed alongside the agent at package-build time
   (`/etc/monitor-agent/update-signing-pub.pem`, shipped in the `.deb` itself,
   analogous to how `agent.example.yaml` ships as the default config). No new
   npm dependency — Node 18's built-in `crypto` supports Ed25519 sign/verify
   natively.
4. Report `agent_update_status: applying` via `POST /agent/updates/report`
   *before* triggering the restart (belt-and-suspenders: if the server never
   reports again, the dashboard at least shows the last known state was "an
   update was applied", not silence).
5. Spawn (detached) `sudo /usr/lib/monitor-agent/scripts/apply-update.sh
   /var/lib/monitor-agent/updates/<version>.deb`.

### `agent/scripts/apply-update.sh` (new, root, via `sudoers.d`)

A `sudoers.d/monitor-agent-updater` drop-in (installed by `postinst`, same
pattern as the rest of packaging) grants exactly:

```
monitor-agent ALL=(root) NOPASSWD: /usr/lib/monitor-agent/scripts/apply-update.sh
```

The script itself validates its one argument is a path under
`/var/lib/monitor-agent/updates/` before touching anything (defense in depth
— the sudoers rule already pins the script path, not arbitrary commands).

Steps, mirroring `deploy-release.sh`'s auto-rollback-on-failure model:

1. Copy the currently-installed `.deb` metadata / cache the current
   `/usr/lib/monitor-agent` version aside (or keep the previously-applied
   `.deb` file cached from its own last run) so there's something to revert
   to.
2. `dpkg -i <new .deb>`.
3. `systemctl restart monitor-agent`.
4. Wait 15 seconds, then check `systemctl is-active monitor-agent` and that
   `systemctl show monitor-agent -p NRestarts` hasn't incremented (i.e. it
   hasn't crash-looped since the restart in step 3).
5. Healthy → exit 0 (the new agent's own next report call reflects the new
   version).
6. Unhealthy → `dpkg -i` the cached previous `.deb`, `systemctl restart
   monitor-agent` again, exit non-zero. Whichever version ends up running
   reports `rolled_back` on its next cycle.

## Dashboard

A new **Agent Updates** page (or a tab under an existing admin area):

- Publish form: upload `.deb` + `.sig`, version, changelog.
- Release list with per-release `rollout_percent` slider and `is_active`
  kill switch.
- Global `agent_auto_update_enabled` toggle (reads/writes `platform_settings`
  via the existing settings surface).
- Server table: `agent_version`, `agent_update_status`,
  `agent_last_update_at`, with a per-server exclude toggle.

## Signing / key management

- `packaging/sign-agent-release.sh` (new): takes a `.deb` and a private key
  file path, outputs a `.sig` (base64 Ed25519 signature over the raw bytes),
  using Node's `crypto.sign('ed25519', bytes, privateKey)` — zero new
  dependencies, consistent with the rest of `packaging/`.
- Key generation is a one-time, manual, offline step (documented in
  `packaging/README.md`, not automated by any script that touches the
  backend): `crypto.generateKeyPairSync('ed25519')`, private key kept outside
  the repo and outside the backend entirely, public key committed to
  `packaging/` and copied into the `.deb` by `build-deb.sh` at
  `/etc/monitor-agent/update-signing-pub.pem`.
- Rotating the signing key requires a normal (manual) agent update to ship
  the new public key first — out of scope to automate further here.

## Error handling

- Download or verification failure (bad sha256, bad signature, network
  error) → the cycle is skipped, no `sudo` call happens, retried next
  interval. Nothing written outside `/var/lib/monitor-agent/updates/`.
- Apply failure (new version fails to come up cleanly) →
  `apply-update.sh` auto-rolls back to the previously-cached `.deb`, per the
  design above.
- Total silence after an update (server dies, disk full, etc.) → surfaces as
  a stale `agent_update_status`/`agent_last_update_at` plus the platform's
  existing `servers.status`/`last_seen` offline detection — no new detection
  machinery needed.
- A bad release that somehow passes signing (e.g. a legitimate but broken
  build) is contained by `rollout_percent` (staged exposure) and the
  per-release `is_active` kill switch (an admin can flip it off mid-rollout
  to stop new servers from picking it up; already-updated servers rely on
  the apply-time health check / auto-rollback).

## Testing

- Unit tests (`agent/test/`, matching the existing `parser.test.js` /
  `sender.test.js` pattern): signature/checksum verification against known
  good/bad fixtures, and rollout-percent bucketing determinism.
- `apply-update.sh` exercised against `packaging/docker-test/` (already
  exists for install testing) with a deliberately-broken "new version" build
  to confirm the rollback path actually restores service.
- Backend: unit tests for the eligibility resolution (`GET
  /agent/updates/latest`) covering the kill-switch / exclusion / rollout-
  percent / inactive-release combinations, following the existing
  `*.service.spec.ts` pattern (e.g. `deployments.service.spec.ts`).

## Out of scope

- The `agent/standalone/monitor-agent.js` single-file variant is not covered
  by this design — it's a zero-dependency fallback, not the packaged/
  deployed artifact this update mechanism targets.
- Reusing this mechanism to also push app-level `.deb`s or other software is
  not addressed — this is specifically the monitoring agent updating itself.
- CI auto-publish (wiring `build-deb.sh` + `sign-agent-release.sh` into a
  pipeline that calls `POST /agent-releases` automatically) is a natural
  follow-up but not built here; the admin-upload endpoint is designed so a
  CI job could call it later without any redesign.
- Signing-key rotation tooling/automation.
