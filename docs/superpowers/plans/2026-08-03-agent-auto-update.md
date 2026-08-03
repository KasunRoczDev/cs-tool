# Agent Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every installed monitoring agent detect, download, verify, and apply a new agent version on its own, closing the "Agent upgrades" gap tracked in `docs/RELEASE_MANAGEMENT_ROADMAP.md` §11.

**Architecture:** A separate, purpose-built self-update path (not the existing app-deployment `deploy_jobs` pipeline). Backend stores signed agent releases and resolves per-server eligibility (global kill switch, per-server exclusion, rollout percent). The unprivileged agent process checks, downloads, and cryptographically verifies a new `.deb`, then hands the actual install/restart/health-check/rollback to a root-run script via a narrowly-scoped `sudo` rule.

**Tech Stack:** NestJS + Postgres (backend, existing), Node.js built-ins only (agent — no new npm dependency), Next.js/React (dashboard, existing), bash (packaging scripts).

## Global Constraints

- No new npm dependency in `agent/` — use Node's built-in `crypto` module (Ed25519 sign/verify, sha256) exactly as `agent/package.json` today only depends on `js-yaml`.
- The signing private key is generated and used **only offline** (developer machine that builds releases) — it must never be written into the repo or uploaded to the backend. Only the **public** key (`packaging/agent-update-signing-pub.pem`) is committed.
- Backend tests use Jest (`backend/package.json` `"test": "jest"`, `rootDir: src`, files matching `*.spec.ts`), instantiating services directly with a mocked `{ query: jest.fn() }` pool — see `backend/src/release/environment.service.spec.ts` for the exact pattern to follow.
- Agent tests use Node's built-in test runner (`node --test`, see `agent/test/sender.test.js`, `agent/test/parser.test.js`), run via `npm test` inside `agent/`.
- All agent-facing HTTP endpoints go through `AgentAuthGuard` (`backend/src/common/agent-auth.guard.ts`), same as `/api/v1/metrics` and `/api/v1/agent/deploy-jobs/*`.
- All admin-facing HTTP endpoints for managing releases use `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission('settings.manage')` — the same permission already used by `calendar.controller.ts`, `environment.controller.ts`, and `status.controller.ts`'s workflow-config endpoints. No new RBAC permission needs to be added.
- Follow existing file conventions exactly: one service backs both an admin controller and an agent controller (mirrors `DeploymentsService` backing both `DeploymentsController` and `DeployAgentController`).

---

## Task 1: Database migrations

**Files:**
- Create: `database/agent_releases_migration.sql`
- Create: `database/agent_update_status_migration.sql`
- Modify: `backend/scripts/migrate.js` (append two new migration blocks)

**Interfaces:**
- Produces: table `agent_releases(id, version, changelog, package, sha256, signature, rollout_percent, is_active, created_by, created_at)`; new columns on `servers`: `agent_version`, `agent_update_status`, `agent_update_message`, `agent_auto_update_excluded`, `agent_last_update_at`; seeded `platform_settings` row `agent_auto_update_enabled = 'false'`. Later tasks' backend code (Task 2+) query these directly.

- [ ] **Step 1: Write `database/agent_releases_migration.sql`**

```sql
-- =====================================================================
-- Agent Releases: published monitor-agent .deb packages, signed offline
-- (Ed25519), pulled and self-applied by installed agents.
-- Apply after schema.sql (users) and settings_migration.sql (platform_settings).
--   psql -U monitor -d monitoring -f database/agent_releases_migration.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL UNIQUE,        -- semver, e.g. 1.2.0
  changelog       TEXT,
  package         BYTEA NOT NULL,              -- the .deb contents
  sha256          TEXT NOT NULL,               -- hex digest of `package`, computed server-side
  signature       TEXT NOT NULL,               -- base64 Ed25519 signature of `package`, signed offline
  rollout_percent SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  is_active       BOOLEAN NOT NULL DEFAULT true,  -- per-release kill switch
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_releases_active
  ON agent_releases (is_active, created_at DESC);

-- Global kill switch (in addition to per-release is_active and per-server
-- agent_auto_update_excluded). Read/written through the existing generic
-- platform_settings endpoints (backend/src/settings/).
INSERT INTO platform_settings (key, value) VALUES
  ('agent_auto_update_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Write `database/agent_update_status_migration.sql`**

```sql
-- =====================================================================
-- Per-server agent self-update tracking.
-- Apply after schema.sql (servers).
--   psql -U monitor -d monitoring -f database/agent_update_status_migration.sql
-- =====================================================================

ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_version TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_status TEXT
  NOT NULL DEFAULT 'idle';  -- idle|applying|succeeded|rolled_back|failed
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_update_message TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_auto_update_excluded BOOLEAN
  NOT NULL DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_last_update_at TIMESTAMPTZ;
```

- [ ] **Step 3: Wire both migrations into `backend/scripts/migrate.js`**

Insert this block right after the existing "Apply WebSocket (passkeys) migration" block (i.e. as the new last set of migrations, before the admin-user seed at the bottom of the file):

```js
  // Apply agent-releases migration (idempotent — IF NOT EXISTS). Must run
  // after schema.sql (users) and settings_migration.sql (platform_settings).
  const agentReleasesPath =
    process.env.AGENT_RELEASES_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/agent_releases_migration.sql');
  if (fs.existsSync(agentReleasesPath)) {
    console.log('Applying agent-releases migration...');
    await client.query(fs.readFileSync(agentReleasesPath, 'utf8'));
  }

  // Apply agent-update-status migration (idempotent — ADD COLUMN IF NOT
  // EXISTS). Must run after schema.sql (servers).
  const agentUpdateStatusPath =
    process.env.AGENT_UPDATE_STATUS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/agent_update_status_migration.sql');
  if (fs.existsSync(agentUpdateStatusPath)) {
    console.log('Applying agent-update-status migration...');
    await client.query(fs.readFileSync(agentUpdateStatusPath, 'utf8'));
  }
```

- [ ] **Step 4: Verify migrations apply cleanly**

Run (adjust `DATABASE_URL` to your local dev Postgres):

```bash
cd backend
DATABASE_URL=postgres://monitor:monitor@localhost:5432/monitoring node scripts/migrate.js
```

Expected: the log includes `Applying agent-releases migration...` and `Applying agent-update-status migration...` with no errors, and running it a second time immediately after also succeeds with no errors (idempotency check).

- [ ] **Step 5: Commit**

```bash
git add database/agent_releases_migration.sql database/agent_update_status_migration.sql backend/scripts/migrate.js
git commit -m "feat: add agent-releases and agent-update-status migrations"
```

---

## Task 2: `AgentReleasesService` — publish, list, update rollout

**Files:**
- Create: `backend/src/release/agent-releases.service.ts`
- Test: `backend/src/release/agent-releases.service.spec.ts`

**Interfaces:**
- Consumes: `PG_POOL` (from `backend/src/database/database.module.ts`, existing).
- Produces: `AgentReleasesService` with `publish(input: PublishAgentReleaseInput): Promise<{id, version, changelog, sha256, rollout_percent, is_active, created_at}>`, `list(): Promise<Array<same shape>>`, `updateRollout(id: string, patch: {rollout_percent?: number; is_active?: boolean}): Promise<same shape>`, `get(id: string): Promise<same shape>`. Task 3 adds more methods to this same class.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/release/agent-releases.service.spec.ts
import { AgentReleasesService } from './agent-releases.service';

function makeService() {
  const query = jest.fn();
  const pool = { query } as any;
  const svc = new AgentReleasesService(pool);
  return { svc, query };
}

describe('AgentReleasesService.publish', () => {
  it('rejects a version that does not look like semver', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: 'not-a-version', package: Buffer.from('x'), signature: 'sig' }),
    ).rejects.toThrow('version must look like');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing package buffer', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: '1.2.0', package: Buffer.alloc(0), signature: 'sig' }),
    ).rejects.toThrow('package file is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing signature', async () => {
    const { svc, query } = makeService();
    await expect(
      svc.publish({ version: '1.2.0', package: Buffer.from('x'), signature: '' }),
    ).rejects.toThrow('signature is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('computes the sha256 server-side and inserts the release', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({
      rows: [{ id: 'r1', version: '1.2.0', changelog: null, sha256: 'abc', rollout_percent: 0, is_active: true, created_at: 'now' }],
    });
    const result = await svc.publish({ version: '1.2.0', package: Buffer.from('hello'), signature: 'sig' });
    expect(result.id).toBe('r1');
    const insertCall = query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO agent_releases');
    const [version, changelog, pkg, sha256, signature] = insertCall[1];
    expect(version).toBe('1.2.0');
    expect(changelog).toBeNull();
    expect(pkg).toEqual(Buffer.from('hello'));
    // sha256('hello') is a well-known digest
    expect(sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(signature).toBe('sig');
  });
});

describe('AgentReleasesService.list', () => {
  it('returns all releases newest first', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r2' }, { id: 'r1' }] });
    const result = await svc.list();
    expect(result).toEqual([{ id: 'r2' }, { id: 'r1' }]);
    expect(query.mock.calls[0][0]).toContain('ORDER BY created_at DESC');
  });
});

describe('AgentReleasesService.updateRollout', () => {
  it('rejects an out-of-range rollout_percent', async () => {
    const { svc, query } = makeService();
    await expect(svc.updateRollout('r1', { rollout_percent: 150 })).rejects.toThrow('between 0 and 100');
    expect(query).not.toHaveBeenCalled();
  });

  it('updates rollout_percent and is_active together', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ id: 'r1', rollout_percent: 50, is_active: false }] });
    const result = await svc.updateRollout('r1', { rollout_percent: 50, is_active: false });
    expect(result).toEqual({ id: 'r1', rollout_percent: 50, is_active: false });
    expect(query.mock.calls[0][0]).toContain('UPDATE agent_releases');
  });

  it('throws NotFoundException when the release does not exist', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.updateRollout('bogus', { is_active: false })).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest agent-releases.service.spec.ts`
Expected: FAIL — `Cannot find module './agent-releases.service'`.

- [ ] **Step 3: Write `backend/src/release/agent-releases.service.ts`**

```typescript
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface PublishAgentReleaseInput {
  version: string;
  changelog?: string;
  package: Buffer;
  signature: string; // base64
  rollout_percent?: number;
  created_by?: string;
}

export interface AgentReleaseSummary {
  id: string;
  version: string;
  changelog: string | null;
  sha256: string;
  rollout_percent: number;
  is_active: boolean;
  created_at?: string;
}

const SEMVER_RE = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const RELEASE_COLUMNS = 'id, version, changelog, sha256, rollout_percent, is_active, created_at';

/**
 * Published monitor-agent releases (signed offline, uploaded here) and the
 * per-server eligibility resolution installed agents poll against. One
 * service backs both the admin controller (publish/list/rollout) and the
 * agent-facing controller (Task 5) — same pattern as DeploymentsService
 * backing both DeploymentsController and DeployAgentController.
 */
@Injectable()
export class AgentReleasesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async publish(input: PublishAgentReleaseInput): Promise<AgentReleaseSummary> {
    const version = input.version?.trim();
    if (!version || !SEMVER_RE.test(version)) {
      throw new BadRequestException('version must look like 1.2.3');
    }
    if (!input.package || !input.package.length) {
      throw new BadRequestException('package file is required');
    }
    if (!input.signature) {
      throw new BadRequestException('signature is required');
    }
    const rolloutPercent = input.rollout_percent ?? 0;
    if (rolloutPercent < 0 || rolloutPercent > 100) {
      throw new BadRequestException('rollout_percent must be between 0 and 100');
    }

    const sha256 = createHash('sha256').update(input.package).digest('hex');
    const { rows } = await this.pool.query(
      `INSERT INTO agent_releases (version, changelog, package, sha256, signature, rollout_percent, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${RELEASE_COLUMNS}`,
      [version, input.changelog ?? null, input.package, sha256, input.signature, rolloutPercent, input.created_by ?? null],
    );
    return rows[0];
  }

  async list(): Promise<AgentReleaseSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT ${RELEASE_COLUMNS} FROM agent_releases ORDER BY created_at DESC`,
    );
    return rows;
  }

  async get(id: string): Promise<AgentReleaseSummary> {
    const { rows } = await this.pool.query(
      `SELECT ${RELEASE_COLUMNS} FROM agent_releases WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Agent release not found');
    return rows[0];
  }

  async updateRollout(
    id: string,
    patch: { rollout_percent?: number; is_active?: boolean },
  ): Promise<AgentReleaseSummary> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.rollout_percent !== undefined) {
      if (patch.rollout_percent < 0 || patch.rollout_percent > 100) {
        throw new BadRequestException('rollout_percent must be between 0 and 100');
      }
      params.push(patch.rollout_percent);
      sets.push(`rollout_percent = $${params.length}`);
    }
    if (patch.is_active !== undefined) {
      params.push(patch.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) return this.get(id);
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE agent_releases SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${RELEASE_COLUMNS}`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Agent release not found');
    return rows[0];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest agent-releases.service.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/agent-releases.service.ts backend/src/release/agent-releases.service.spec.ts
git commit -m "feat: add AgentReleasesService publish/list/updateRollout"
```

---

## Task 3: `AgentReleasesService` — rollout eligibility, package fetch, update reporting

**Files:**
- Modify: `backend/src/release/agent-releases.service.ts`
- Modify: `backend/src/release/agent-releases.service.spec.ts`

**Interfaces:**
- Consumes: same `PG_POOL` as Task 2; extends the same `AgentReleasesService` class.
- Produces: `AgentReleasesService.bucketFor(serverId: string): number` (static), `latestFor(serverId: string): Promise<{eligible: false} | {eligible: true; version: string; sha256: string; signature: string}>`, `getPackage(version: string): Promise<Buffer>`, `reportUpdate(serverId: string, body: {version: string; status: string; message?: string}): Promise<{ok: true}>`. Task 4 and Task 5's controllers call these.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/release/agent-releases.service.spec.ts`:

```typescript
describe('AgentReleasesService.bucketFor', () => {
  it('is deterministic for the same server id', () => {
    const a = AgentReleasesService.bucketFor('server-123');
    const b = AgentReleasesService.bucketFor('server-123');
    expect(a).toBe(b);
  });

  it('returns a value between 0 and 99', () => {
    const b = AgentReleasesService.bucketFor('any-id');
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it('spreads different server ids across buckets (not all identical)', () => {
    const buckets = new Set(
      Array.from({ length: 50 }, (_, i) => AgentReleasesService.bucketFor(`server-${i}`)),
    );
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('AgentReleasesService.latestFor', () => {
  it('is not eligible when the server is individually excluded', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: true }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
    expect(query).toHaveBeenCalledTimes(1); // short-circuits before checking the kill switch
  });

  it('is not eligible when the global kill switch is off', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] }); // server lookup
    query.mockResolvedValueOnce({ rows: [{ value: 'false' }] }); // platform_settings
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is not eligible when there is no active release', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [] }); // no active release
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is not eligible when the server falls outside the rollout percent bucket', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [{ version: '2.0.0', sha256: 'a', signature: 'b', rollout_percent: 0 }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: false });
  });

  it('is eligible when everything lines up (rollout_percent 100 always matches)', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ agent_auto_update_excluded: false }] });
    query.mockResolvedValueOnce({ rows: [{ value: 'true' }] });
    query.mockResolvedValueOnce({ rows: [{ version: '2.0.0', sha256: 'a', signature: 'b', rollout_percent: 100 }] });
    const result = await svc.latestFor('s1');
    expect(result).toEqual({ eligible: true, version: '2.0.0', sha256: 'a', signature: 'b' });
  });
});

describe('AgentReleasesService.getPackage', () => {
  it('throws NotFoundException for an unknown or inactive version', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.getPackage('9.9.9')).rejects.toThrow('not found');
  });

  it('returns the package bytes for an active version', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [{ package: Buffer.from('deb-bytes') }] });
    const result = await svc.getPackage('1.2.0');
    expect(result).toEqual(Buffer.from('deb-bytes'));
    expect(query.mock.calls[0][0]).toContain('is_active = true');
  });
});

describe('AgentReleasesService.reportUpdate', () => {
  it('writes the reported status onto the server row', async () => {
    const { svc, query } = makeService();
    query.mockResolvedValueOnce({ rows: [] });
    const result = await svc.reportUpdate('s1', { version: '2.0.0', status: 'succeeded' });
    expect(result).toEqual({ ok: true });
    const call = query.mock.calls[0];
    expect(call[0]).toContain('UPDATE servers');
    expect(call[1]).toEqual(['s1', '2.0.0', 'succeeded', null]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest agent-releases.service.spec.ts`
Expected: FAIL — `bucketFor`, `latestFor`, `getPackage`, `reportUpdate` are not functions.

- [ ] **Step 3: Add the new methods to `AgentReleasesService`**

Append inside the `AgentReleasesService` class in `backend/src/release/agent-releases.service.ts` (after `updateRollout`):

```typescript
  /** Deterministic 0-99 bucket for a server id — the same server always lands in the same bucket, so raising rollout_percent only ever adds servers, never reshuffles who's already in. */
  static bucketFor(serverId: string): number {
    const hash = createHash('sha256').update(serverId).digest();
    return hash.readUInt32BE(0) % 100;
  }

  /**
   * Resolve what (if anything) a given server should update to, honoring the
   * per-server exclusion flag, the global kill switch (platform_settings),
   * and the active release's rollout percent.
   */
  async latestFor(
    serverId: string,
  ): Promise<{ eligible: false } | { eligible: true; version: string; sha256: string; signature: string }> {
    const { rows: srows } = await this.pool.query(
      `SELECT agent_auto_update_excluded FROM servers WHERE id = $1`,
      [serverId],
    );
    if (!srows[0] || srows[0].agent_auto_update_excluded) return { eligible: false };

    const { rows: setting } = await this.pool.query(
      `SELECT value FROM platform_settings WHERE key = 'agent_auto_update_enabled'`,
    );
    if (setting[0]?.value !== 'true') return { eligible: false };

    const { rows } = await this.pool.query(
      `SELECT version, sha256, signature, rollout_percent
         FROM agent_releases WHERE is_active = true ORDER BY created_at DESC LIMIT 1`,
    );
    const release = rows[0];
    if (!release) return { eligible: false };

    const bucket = AgentReleasesService.bucketFor(serverId);
    if (bucket >= release.rollout_percent) return { eligible: false };

    return { eligible: true, version: release.version, sha256: release.sha256, signature: release.signature };
  }

  /** Raw .deb bytes for an active version — streamed back to the requesting agent. */
  async getPackage(version: string): Promise<Buffer> {
    const { rows } = await this.pool.query(
      `SELECT package FROM agent_releases WHERE version = $1 AND is_active = true`,
      [version],
    );
    if (!rows[0]) throw new NotFoundException('Agent release not found');
    return rows[0].package;
  }

  /** Records what an agent reports about applying an update (called after apply-update.sh runs, whichever version ends up running). */
  async reportUpdate(
    serverId: string,
    body: { version: string; status: string; message?: string },
  ): Promise<{ ok: true }> {
    await this.pool.query(
      `UPDATE servers
          SET agent_version = $2, agent_update_status = $3, agent_update_message = $4, agent_last_update_at = now()
        WHERE id = $1`,
      [serverId, body.version, body.status, body.message ?? null],
    );
    return { ok: true };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest agent-releases.service.spec.ts`
Expected: PASS (all tests from Task 2 + Task 3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/release/agent-releases.service.ts backend/src/release/agent-releases.service.spec.ts
git commit -m "feat: add rollout eligibility, package fetch, and update reporting to AgentReleasesService"
```

---

## Task 4: Admin `AgentReleasesController` + module wiring

**Files:**
- Create: `backend/src/release/agent-releases.controller.ts`
- Modify: `backend/src/release/release.module.ts`

**Interfaces:**
- Consumes: `AgentReleasesService` (Tasks 2-3).
- Produces: `POST /api/v1/agent-releases` (multipart: `package` file + `version`/`changelog`/`signature`/`rollout_percent` fields), `GET /api/v1/agent-releases`, `PATCH /api/v1/agent-releases/:id`.

- [ ] **Step 1: Write `backend/src/release/agent-releases.controller.ts`**

```typescript
import {
  Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AgentReleasesService } from './agent-releases.service';

class PublishAgentReleaseDto {
  @IsString() version!: string;
  @IsOptional() @IsString() changelog?: string;
  @IsString() signature!: string;
  // Arrives as a string over multipart form-data; parsed to a number below.
  @IsOptional() @IsString() rollout_percent?: string;
}

class UpdateAgentReleaseDto {
  @IsOptional() rollout_percent?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('agent-releases')
export class AgentReleasesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get()
  @RequirePermission('settings.manage')
  list() {
    return this.releases.list();
  }

  /** Publish a new agent release: the .deb (multipart field "package") plus its offline-computed Ed25519 signature. */
  @Post()
  @RequirePermission('settings.manage')
  @UseInterceptors(FileInterceptor('package', { limits: { fileSize: 50 * 1024 * 1024 } }))
  publish(@Body() dto: PublishAgentReleaseDto, @UploadedFile() file: any, @Req() req: any) {
    return this.releases.publish({
      version: dto.version,
      changelog: dto.changelog,
      package: file?.buffer,
      signature: dto.signature,
      rollout_percent: dto.rollout_percent !== undefined ? Number(dto.rollout_percent) : undefined,
      created_by: req.user?.sub,
    });
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@Param('id') id: string, @Body() dto: UpdateAgentReleaseDto) {
    return this.releases.updateRollout(id, dto);
  }
}
```

- [ ] **Step 2: Wire into `backend/src/release/release.module.ts`**

Add the import and register the provider + controller:

```typescript
import { AgentReleasesService } from './agent-releases.service';
import { AgentReleasesController } from './agent-releases.controller';
```

In the `@Module({...})` decorator, add `AgentReleasesService` to `providers` and `AgentReleasesController` to `controllers`:

```typescript
  providers: [
    GitService,
    RepositoriesService,
    ReleasesService,
    DeploymentsService,
    ApprovalsService,
    StatusService,
    CalendarService,
    EnvironmentService,
    AgentReleasesService,
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
    AgentReleasesController,
  ],
```

- [ ] **Step 3: Verify the backend still builds**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/release/agent-releases.controller.ts backend/src/release/release.module.ts
git commit -m "feat: add admin AgentReleasesController for publishing agent releases"
```

---

## Task 5: Agent-facing `AgentUpdatesController` + module wiring

**Files:**
- Create: `backend/src/release/agent-updates.controller.ts`
- Modify: `backend/src/release/release.module.ts`

**Interfaces:**
- Consumes: `AgentReleasesService` (Tasks 2-3), `AgentAuthGuard` (existing, `backend/src/common/agent-auth.guard.ts`, attaches `req.server = {id, name}`).
- Produces: `GET /api/v1/agent/updates/latest`, `GET /api/v1/agent/updates/:version/package`, `POST /api/v1/agent/updates/report` — all `X-Api-Key`-authenticated. Task 8's agent `updater.js` calls these three.

- [ ] **Step 1: Write `backend/src/release/agent-updates.controller.ts`**

```typescript
import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { AgentAuthGuard } from '../common/agent-auth.guard';
import { AgentReleasesService } from './agent-releases.service';

class ReportUpdateDto {
  @IsString() version!: string;
  @IsIn(['applying', 'succeeded', 'rolled_back', 'failed']) status!: string;
  @IsOptional() @IsString() message?: string;
}

/**
 * Endpoints used by the on-server monitoring agent to self-update.
 * Authenticated with the same X-Api-Key as metric ingest and deploy jobs.
 *
 *   GET  /agent/updates/latest          -> eligibility + version/sha256/signature
 *   GET  /agent/updates/:version/package -> the .deb bytes
 *   POST /agent/updates/report          -> report the outcome of applying an update
 */
@UseGuards(AgentAuthGuard)
@Controller('agent/updates')
export class AgentUpdatesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get('latest')
  latest(@Req() req: any) {
    return this.releases.latestFor(req.server.id);
  }

  @Get(':version/package')
  async package(@Param('version') version: string, @Res() res: Response) {
    const buf = await this.releases.getPackage(version);
    res.setHeader('Content-Type', 'application/vnd.debian.binary-package');
    res.send(buf);
  }

  @Post('report')
  report(@Req() req: any, @Body() dto: ReportUpdateDto) {
    return this.releases.reportUpdate(req.server.id, dto);
  }
}
```

- [ ] **Step 2: Wire into `backend/src/release/release.module.ts`**

Add the import:

```typescript
import { AgentUpdatesController } from './agent-updates.controller';
```

Add `AgentUpdatesController` to the `controllers` array (added in Task 4):

```typescript
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
    AgentReleasesController,
    AgentUpdatesController,
  ],
```

- [ ] **Step 3: Verify the backend still builds**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/release/agent-updates.controller.ts backend/src/release/release.module.ts
git commit -m "feat: add agent-facing AgentUpdatesController for self-update polling"
```

---

## Task 6: Per-server exclusion toggle + agent-version visibility

**Files:**
- Modify: `backend/src/servers/servers.controller.ts`
- Modify: `backend/src/servers/servers.service.ts`

**Interfaces:**
- Consumes: existing `ServersService`/`ServersController` (no new class).
- Produces: `PATCH /api/v1/servers/:id` now also accepts `agent_auto_update_excluded: boolean`; `GET /api/v1/servers` and `GET /api/v1/servers/:id` now also return `agent_version`, `agent_update_status`, `agent_update_message`, `agent_auto_update_excluded`, `agent_last_update_at`. Task 14's dashboard page reads these from the existing `api.servers()` / writes via the existing `api.updateServer()`.

- [ ] **Step 1: Extend `UpdateServerDto` in `backend/src/servers/servers.controller.ts`**

```typescript
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
```

```typescript
class UpdateServerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() hostname?: string;
  @IsOptional() @IsObject() tags?: Record<string, string>;
  @IsOptional() @IsString() product_id?: string;
  @IsOptional() @IsBoolean() agent_auto_update_excluded?: boolean;
}
```

- [ ] **Step 2: Extend `ServersService.update` in `backend/src/servers/servers.service.ts`**

```typescript
  async update(
    id: string,
    patch: {
      name?: string;
      hostname?: string;
      tags?: Record<string, string>;
      product_id?: string | null;
      agent_auto_update_excluded?: boolean;
    },
  ) {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.hostname !== undefined) { params.push(patch.hostname); sets.push(`hostname = $${params.length}`); }
    if (patch.tags !== undefined) { params.push(JSON.stringify(patch.tags)); sets.push(`tags = $${params.length}`); }
    if (patch.product_id !== undefined) {
      params.push(patch.product_id === '' ? null : patch.product_id);
      sets.push(`product_id = $${params.length}`);
    }
    if (patch.agent_auto_update_excluded !== undefined) {
      params.push(patch.agent_auto_update_excluded);
      sets.push(`agent_auto_update_excluded = $${params.length}`);
    }
    if (sets.length === 0) return this.get(id);
    params.push(id);
    await this.pool.query(
      `UPDATE servers SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    return this.get(id);
  }
```

- [ ] **Step 3: Extend the `list()` and `get()` SELECTs to expose the new columns**

In `ServersService.list()`:

```typescript
  list() {
    return this.pool
      .query(
        `SELECT s.id, s.name, s.hostname, s.ip_address, s.os, s.status, s.last_seen,
                s.tags, s.created_at, s.product_id, p.name AS product_name,
                s.agent_version, s.agent_update_status, s.agent_update_message,
                s.agent_auto_update_excluded, s.agent_last_update_at
           FROM servers s
           LEFT JOIN products p ON p.id = s.product_id
          ORDER BY s.name`,
      )
      .then((r) => r.rows);
  }
```

In `ServersService.get()`:

```typescript
  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.name, s.hostname, s.ip_address, s.os, s.status, s.last_seen,
              s.tags, s.created_at, s.product_id, p.name AS product_name,
              s.agent_version, s.agent_update_status, s.agent_update_message,
              s.agent_auto_update_excluded, s.agent_last_update_at
         FROM servers s
         LEFT JOIN products p ON p.id = s.product_id
        WHERE s.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Server not found');
    return rows[0];
  }
```

- [ ] **Step 4: Verify the backend still builds**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/servers/servers.controller.ts backend/src/servers/servers.service.ts
git commit -m "feat: expose agent version/update status and per-server exclusion on servers endpoints"
```

---

## Task 7: Agent — package/signature verification helper

**Files:**
- Create: `agent/src/update/verify.js`
- Test: `agent/test/verify.test.js`

**Interfaces:**
- Produces: `sha256Hex(buf: Buffer): string`, `verifyPackage(buf: Buffer, {sha256, signature, publicKeyPem}: {sha256: string, signature: string, publicKeyPem: string}): true` (throws on any mismatch). Task 8's `updater.js` calls `verifyPackage`.

- [ ] **Step 1: Write the failing test**

```javascript
// agent/test/verify.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign } = require('crypto');
const { sha256Hex, verifyPackage } = require('../src/update/verify');

function signBuffer(buf, privateKey) {
  return sign(null, buf, privateKey).toString('base64');
}

test('sha256Hex matches a known digest', () => {
  assert.equal(sha256Hex(Buffer.from('hello')), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('verifyPackage succeeds when checksum and signature both match', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, privateKey);

  const result = verifyPackage(buf, { sha256: sha256Hex(buf), signature, publicKeyPem });
  assert.equal(result, true);
});

test('verifyPackage rejects a checksum mismatch (tampered or corrupted bytes)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, privateKey);

  assert.throws(
    () => verifyPackage(buf, { sha256: 'deadbeef', signature, publicKeyPem }),
    /checksum mismatch/,
  );
});

test('verifyPackage rejects a bad signature even when the checksum matches', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const { privateKey: otherPrivateKey } = generateKeyPairSync('ed25519'); // different keypair
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, otherPrivateKey); // signed with the WRONG key

  assert.throws(
    () => verifyPackage(buf, { sha256: sha256Hex(buf), signature, publicKeyPem }),
    /signature verification failed/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && node --test test/verify.test.js`
Expected: FAIL — `Cannot find module '../src/update/verify'`.

- [ ] **Step 3: Write `agent/src/update/verify.js`**

```javascript
'use strict';
const crypto = require('crypto');

/** SHA-256 hex digest of a Buffer. */
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Verify `buf` against an expected sha256 hex digest and a base64 Ed25519
 * signature, checked against `publicKeyPem` (SPKI PEM). Throws with a
 * specific reason on the first failing check; returns true if both pass.
 */
function verifyPackage(buf, { sha256, signature, publicKeyPem }) {
  const actual = sha256Hex(buf);
  if (actual !== sha256) {
    throw new Error(`checksum mismatch: expected ${sha256}, got ${actual}`);
  }
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const ok = crypto.verify(null, buf, publicKey, Buffer.from(signature, 'base64'));
  if (!ok) throw new Error('signature verification failed');
  return true;
}

module.exports = { sha256Hex, verifyPackage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && node --test test/verify.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/src/update/verify.js agent/test/verify.test.js
git commit -m "feat: add agent package checksum + Ed25519 signature verification"
```

---

## Task 8: Agent — `Updater` (check, download, verify, apply, report)

**Files:**
- Create: `agent/src/updater.js`
- Test: `agent/test/updater.test.js`

**Interfaces:**
- Consumes: `verifyPackage` from `agent/src/update/verify.js` (Task 7).
- Produces: `class Updater` with `constructor(cfg)` and `start(): () => void` (returns a stop function, mirrors `DeployRunner.start()` in `agent/src/deploy.js`). Task 9 wires this into `agent/src/index.js`.

- [ ] **Step 1: Write the failing test**

```javascript
// agent/test/updater.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { generateKeyPairSync, sign } = require('crypto');
const { Updater } = require('../src/updater');

function makeCfg(overrides) {
  return {
    server_url: 'http://example.invalid',
    api_key: 'k',
    self_update: { enabled: true, check_interval: 3600, updates_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'updater-test-')) },
    ...overrides,
  };
}

test('check() does nothing when the server reports not eligible', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(url.toString());
    return { ok: true, status: 200, json: async () => ({ eligible: false }) };
  });
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await updater.check();

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v1\/agent\/updates\/latest$/);
  assert.equal(spawned, false);
});

test('check() does nothing when the eligible version equals the current version', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';
  t.mock.method(global, 'fetch', async () => ({
    ok: true, status: 200, json: async () => ({ eligible: true, version: '1.1.0', sha256: 'x', signature: 'y' }),
  }));
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await updater.check();

  assert.equal(spawned, false);
});

test('check() downloads, verifies, writes the .deb, reports "applying", and spawns the sudo apply script for a genuinely new version', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkgBytes = Buffer.from('fake .deb contents');
  const signature = sign(null, pkgBytes, privateKey).toString('base64');
  const sha256 = require('../src/update/verify').sha256Hex(pkgBytes);

  const pubKeyPath = path.join(cfg.self_update.updates_dir, 'pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  updater.publicKeyPath = pubKeyPath;

  const requests = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    const u = url.toString();
    requests.push(u);
    if (u.endsWith('/agent/updates/latest')) {
      return { ok: true, status: 200, json: async () => ({ eligible: true, version: '1.2.0', sha256, signature }) };
    }
    if (u.endsWith('/agent/updates/1.2.0/package')) {
      return { ok: true, status: 200, arrayBuffer: async () => pkgBytes.buffer.slice(pkgBytes.byteOffset, pkgBytes.byteOffset + pkgBytes.byteLength) };
    }
    if (u.endsWith('/agent/updates/report')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  let spawnArgs = null;
  t.mock.method(cp, 'spawn', (cmd, args) => { spawnArgs = { cmd, args }; return { unref() {} }; });

  await updater.check();

  const debPath = path.join(cfg.self_update.updates_dir, 'monitor-agent_1.2.0.deb');
  assert.equal(fs.readFileSync(debPath).toString(), 'fake .deb contents');
  assert.ok(spawnArgs, 'apply script should have been spawned');
  assert.equal(spawnArgs.cmd, 'sudo');
  assert.equal(spawnArgs.args[1], debPath);
  assert.ok(requests.some((u) => u.endsWith('/agent/updates/report')));
});

test('check() does not spawn the apply script when signature verification fails', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';

  const { publicKey } = generateKeyPairSync('ed25519'); // real key...
  const pkgBytes = Buffer.from('fake .deb contents');
  const badSignature = Buffer.from('not-a-real-signature').toString('base64'); // ...but a bogus signature
  const sha256 = require('../src/update/verify').sha256Hex(pkgBytes);

  const pubKeyPath = path.join(cfg.self_update.updates_dir, 'pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  updater.publicKeyPath = pubKeyPath;

  t.mock.method(global, 'fetch', async (url) => {
    const u = url.toString();
    if (u.endsWith('/agent/updates/latest')) {
      return { ok: true, status: 200, json: async () => ({ eligible: true, version: '1.2.0', sha256, signature: badSignature }) };
    }
    if (u.endsWith('/agent/updates/1.2.0/package')) {
      return { ok: true, status: 200, arrayBuffer: async () => pkgBytes.buffer.slice(pkgBytes.byteOffset, pkgBytes.byteOffset + pkgBytes.byteLength) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await assert.rejects(() => updater.check(), /signature verification failed/);
  assert.equal(spawned, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && node --test test/updater.test.js`
Expected: FAIL — `Cannot find module '../src/updater'`.

- [ ] **Step 3: Write `agent/src/updater.js`**

```javascript
'use strict';
// Self-update checker. Runs on an interval alongside the metrics/security
// loops (agent/src/index.js). It only checks, downloads, and verifies — the
// actual install/restart/health-check/rollback is done by a root-run script
// (agent/scripts/apply-update.sh) invoked via a narrowly-scoped sudo rule,
// so the hardened, unprivileged main agent process never needs write access
// to /usr/lib or the ability to restart systemd units.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { verifyPackage } = require('./update/verify');

const DEFAULT_PUBLIC_KEY_PATH = '/etc/monitor-agent/update-signing-pub.pem';
const APPLY_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'apply-update.sh');

class Updater {
  constructor(cfg) {
    this.cfg = cfg;
    this.scfg = cfg.self_update || {};
    this.serverUrl = cfg.server_url.replace(/\/$/, '');
    this.apiKey = cfg.api_key;
    this.currentVersion = require('../package.json').version;
    this.updatesDir = this.scfg.updates_dir || '/var/lib/monitor-agent/updates';
    this.publicKeyPath = this.scfg.public_key_path || DEFAULT_PUBLIC_KEY_PATH;
  }

  async _get(pathName) {
    const res = await fetch(this.serverUrl + pathName, { headers: { 'X-Api-Key': this.apiKey } });
    if (!res.ok) throw new Error(`${pathName} -> HTTP ${res.status}`);
    return res.json();
  }

  async _report(body) {
    try {
      await fetch(this.serverUrl + '/api/v1/agent/updates/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.warn(`[updater] report failed: ${e.message}`);
    }
  }

  /** One check cycle: ask the platform, and if eligible for a genuinely new version, download, verify, and hand off to apply-update.sh. */
  async check() {
    const latest = await this._get('/api/v1/agent/updates/latest');
    if (!latest || !latest.eligible || latest.version === this.currentVersion) return;

    console.log(`[updater] new agent version available: ${latest.version}`);
    const res = await fetch(this.serverUrl + `/api/v1/agent/updates/${latest.version}/package`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    if (!res.ok) throw new Error(`package download -> HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const publicKeyPem = fs.readFileSync(this.publicKeyPath, 'utf8');
    verifyPackage(buf, { sha256: latest.sha256, signature: latest.signature, publicKeyPem });

    fs.mkdirSync(this.updatesDir, { recursive: true });
    const debPath = path.join(this.updatesDir, `monitor-agent_${latest.version}.deb`);
    fs.writeFileSync(debPath, buf);

    await this._report({ version: latest.version, status: 'applying' });

    // Detached: apply-update.sh restarts monitor-agent.service, which kills
    // this process — the child must survive that, not depend on it.
    const child = cp.spawn('sudo', [APPLY_SCRIPT, debPath], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  start() {
    if (!this.scfg.enabled) return () => {};
    const interval = (this.scfg.check_interval || 3600) * 1000;
    console.log(`[updater] self-update enabled — checking every ${interval / 1000}s`);
    const timer = setInterval(() => {
      this.check().catch((e) => console.warn(`[updater] ${e.message}`));
    }, interval);
    this.check().catch((e) => console.warn(`[updater] ${e.message}`));
    return () => clearInterval(timer);
  }
}

module.exports = { Updater };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && node --test test/updater.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/src/updater.js agent/test/updater.test.js
git commit -m "feat: add agent Updater (check/download/verify/apply/report)"
```

---

## Task 9: Wire `Updater` into the agent entrypoint + document config

**Files:**
- Modify: `agent/src/index.js`
- Modify: `agent/config/agent.example.yaml`

**Interfaces:**
- Consumes: `Updater` from `agent/src/updater.js` (Task 8).
- Produces: `cfg.self_update.enabled` opt-in wired the same way `cfg.deploy.enabled` already is.

- [ ] **Step 1: Add the require and wire `Updater` into `main()` in `agent/src/index.js`**

Add near the top with the other requires:

```javascript
const { Updater } = require('./updater');
```

In `main()`, alongside the existing `DeployRunner` wiring:

```javascript
  // Deploy runner: pulls and executes release jobs targeted at this server.
  let stopDeploy = () => {};
  if (cfg.deploy && cfg.deploy.enabled) {
    stopDeploy = new DeployRunner(cfg).start();
  }

  // Self-update: periodically checks for a newer agent version and applies it.
  let stopUpdater = () => {};
  if (cfg.self_update && cfg.self_update.enabled) {
    stopUpdater = new Updater(cfg).start();
  }
```

And in `shutdown()`, alongside `stopDeploy()`:

```javascript
  const shutdown = async (sig) => {
    console.log(`[agent] ${sig} received, flushing...`);
    clearInterval(metricsTimer);
    clearInterval(sendTimer);
    clearInterval(snapshotTimer);
    stopSecurity();
    stopLynis();
    stopDeploy();
    stopUpdater();
    await sender.flush().catch(() => {});
    process.exit(0);
  };
```

- [ ] **Step 2: Document the config section in `agent/config/agent.example.yaml`**

Add this block right after the existing `deploy:` section:

```yaml
# Agent self-update — periodically checks the platform for a newer agent
# version and applies it automatically (download -> verify Ed25519 signature
# -> sudo apply-update.sh -> restart -> health-check, with auto-rollback on
# failure). Requires the platform's global "Agent auto-update" setting to
# also be on, and this server not to be individually excluded (both are
# dashboard-managed, not set here).
self_update:
  enabled: false
  check_interval: 3600   # seconds between update checks
```

- [ ] **Step 3: Verify the agent still starts (config parses, no throw before the missing api_key check)**

Run:

```bash
cd agent
node -e "
const { loadConfig } = require('./src/config');
try { loadConfig('./config/agent.example.yaml'); } catch (e) { console.log('expected (no api_key set):', e.message); }
"
```

Expected output: `expected (no api_key set): api_key is required (set in config file or MONITOR_API_KEY)` — confirms the YAML still parses cleanly with the new `self_update:` block present (a parse error would throw a different message from the YAML loader itself, not this one).

- [ ] **Step 4: Commit**

```bash
git add agent/src/index.js agent/config/agent.example.yaml
git commit -m "feat: wire self-update into the agent entrypoint"
```

---

## Task 10: `apply-update.sh` — root-run install/restart/health-check/rollback

**Files:**
- Create: `agent/scripts/apply-update.sh`

**Interfaces:**
- Consumes: invoked as `apply-update.sh <path-to-new.deb>` (the one argument `Updater.check()` from Task 8 passes via `sudo`).
- Produces: exit 0 if the new version comes up healthy; exit 1 (after attempting rollback) otherwise. No other task calls this directly — it's installed by Task 12's packaging changes and invoked by `sudo` at runtime.

- [ ] **Step 1: Write `agent/scripts/apply-update.sh`**

```bash
#!/bin/bash
# =============================================================================
#  apply-update.sh — applies a downloaded monitor-agent .deb as root.
#
#  Invoked by the agent (unprivileged 'monitor-agent' user) via a narrowly
#  scoped sudoers rule (see packaging/debian/monitor-agent-updater.sudoers):
#    sudo /usr/lib/monitor-agent/scripts/apply-update.sh <path-to-new.deb>
#
#  Steps: back up current install -> dpkg -i -> restart -> health-check ->
#  roll back to the pre-update backup on failure.
# =============================================================================
set -uo pipefail

UPDATES_DIR="/var/lib/monitor-agent/updates"
BACKUP_DIR="/var/lib/monitor-agent/backup"
APP_DIR="/usr/lib/monitor-agent"
LOG_FILE="/var/log/monitor-agent-updater.log"
SERVICE="monitor-agent"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

NEW_DEB="${1:-}"
if [[ -z "$NEW_DEB" ]]; then
  log "FATAL: no package path given"
  exit 2
fi
# Defense in depth: the sudoers rule already pins this script's own path, but
# validate the argument stays inside the agent's writable updates dir too, so
# this script can't be tricked into dpkg-installing an arbitrary file.
case "$NEW_DEB" in
  "$UPDATES_DIR"/*) ;;
  *) log "FATAL: refusing to install a package outside $UPDATES_DIR: $NEW_DEB"; exit 2 ;;
esac
if [[ ! -f "$NEW_DEB" ]]; then
  log "FATAL: package not found: $NEW_DEB"
  exit 2
fi

restart_service() {
  systemctl restart "$SERVICE" >>"$LOG_FILE" 2>&1
}

health_check() {
  sleep 15
  systemctl is-active --quiet "$SERVICE" || return 1
  local restarts
  restarts="$(systemctl show "$SERVICE" -p NRestarts --value 2>/dev/null || echo 0)"
  [[ "${restarts:-0}" -eq 0 ]]
}

log "===== Applying agent update: $NEW_DEB ====="

mkdir -p "$BACKUP_DIR"
rm -rf "$BACKUP_DIR/current"
cp -a "$APP_DIR" "$BACKUP_DIR/current"
log "Backed up current install to $BACKUP_DIR/current"

if ! dpkg -i "$NEW_DEB" >>"$LOG_FILE" 2>&1; then
  log "dpkg -i failed — restoring backup"
  rm -rf "$APP_DIR"
  cp -a "$BACKUP_DIR/current" "$APP_DIR"
  restart_service
  exit 1
fi

restart_service || log "Restart command returned non-zero after install"

if health_check; then
  log "Update healthy"
  exit 0
fi

log "New version unhealthy after restart — rolling back to previous install"
rm -rf "$APP_DIR"
cp -a "$BACKUP_DIR/current" "$APP_DIR"
# Note: dpkg's own package database still records the failed version as
# installed at this point (files were restored directly, not through dpkg).
# This is cosmetic only — the next dpkg -i (any future update) still applies
# cleanly since dpkg isn't diffing file contents, and the files actually
# served by systemd (which is what this restores) are what determines
# behavior.
if restart_service && health_check; then
  log "Rollback succeeded"
else
  log "Rollback restart did not come up healthy — manual intervention needed"
fi
exit 1
```

Make it executable:

```bash
chmod +x agent/scripts/apply-update.sh
```

- [ ] **Step 2: Verify shell syntax**

Run: `bash -n agent/scripts/apply-update.sh`
Expected: no output, exit code 0 (syntax is valid).

- [ ] **Step 3: Manual verification against `packaging/docker-test`**

This script needs `systemctl`/`dpkg` to be meaningfully exercised, which requires a real (containerized) install — covered end-to-end in Task 12's verification step once the package build includes this script. Note that requirement here so it isn't skipped later.

- [ ] **Step 4: Commit**

```bash
git add agent/scripts/apply-update.sh
git commit -m "feat: add apply-update.sh (root-run install/restart/health-check/rollback)"
```

---

## Task 11: Signing key generation + offline signing script

**Files:**
- Create: `packaging/generate-signing-key.js`
- Create: `packaging/sign-agent-release.js`
- Create: `packaging/agent-update-signing-pub.pem` (generated in Step 2, committed)

**Interfaces:**
- Produces: `node packaging/generate-signing-key.js <output-dir>` (one-time/rotation), `node packaging/sign-agent-release.js <deb> <private-key.pem>` (per-release, writes `<deb>.sig`). Task 12's `build-deb.sh` reads `packaging/agent-update-signing-pub.pem`; an admin uses the `.sig` output when publishing via Task 4's `POST /agent-releases`.

- [ ] **Step 1: Write `packaging/generate-signing-key.js`**

```javascript
#!/usr/bin/env node
'use strict';
// One-time (or key-rotation) step: generates the Ed25519 keypair used to
// sign agent releases. Run this OFFLINE, on whatever machine builds
// releases — never on the backend server, and never commit the private key.
//
// Usage: node packaging/generate-signing-key.js <output-dir>
//
// Writes:
//   <output-dir>/agent-update-signing-key.pem   (PRIVATE — keep offline)
//   <output-dir>/agent-update-signing-pub.pem   (public — copy into packaging/, committed)
const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node generate-signing-key.js <output-dir>');
  console.error('Pick a directory OUTSIDE this repo — the private key must never be committed.');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPath = path.join(outDir, 'agent-update-signing-key.pem');
const pubPath = path.join(outDir, 'agent-update-signing-pub.pem');

fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));

console.log(`Private key: ${privPath}  (KEEP OFFLINE — never commit, never upload to the backend)`);
console.log(`Public key:  ${pubPath}   (copy this one into packaging/agent-update-signing-pub.pem and commit it)`);
```

- [ ] **Step 2: Generate the actual keypair (outside the repo) and commit the public half**

```bash
node "packaging/generate-signing-key.js" "$HOME/monitor-agent-signing-keys"
cp "$HOME/monitor-agent-signing-keys/agent-update-signing-pub.pem" "packaging/agent-update-signing-pub.pem"
```

Verify the private key was NOT written anywhere inside the repo:

```bash
find . -name 'agent-update-signing-key.pem' 2>/dev/null
```

Expected: no output (the private key only exists under `$HOME/monitor-agent-signing-keys`, outside the working tree).

- [ ] **Step 3: Write `packaging/sign-agent-release.js`**

```javascript
#!/usr/bin/env node
'use strict';
// Signs a built .deb with the agent-update private signing key. Run this on
// the same offline machine that holds the private key from
// generate-signing-key.js.
//
// Usage: node packaging/sign-agent-release.js <path-to.deb> <private-key.pem>
// Writes: <path-to.deb>.sig  (base64 Ed25519 signature — upload this
//         alongside the .deb when publishing via the dashboard's Agent
//         Updates page)
const fs = require('fs');
const { sign, createPrivateKey } = require('crypto');

const [, , debPath, keyPath] = process.argv;
if (!debPath || !keyPath) {
  console.error('Usage: node sign-agent-release.js <path-to.deb> <private-key.pem>');
  process.exit(2);
}

const privateKey = createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
const bytes = fs.readFileSync(debPath);
const signature = sign(null, bytes, privateKey).toString('base64');

const sigPath = `${debPath}.sig`;
fs.writeFileSync(sigPath, signature);
console.log(`Signature written to ${sigPath}`);
```

- [ ] **Step 4: Verify sign + verify round-trip end to end**

```bash
echo "test package bytes" > /tmp/test.deb
node packaging/sign-agent-release.js /tmp/test.deb "$HOME/monitor-agent-signing-keys/agent-update-signing-key.pem"
node -e "
const fs = require('fs');
const { verifyPackage, sha256Hex } = require('./agent/src/update/verify');
const buf = fs.readFileSync('/tmp/test.deb');
const signature = fs.readFileSync('/tmp/test.deb.sig', 'utf8');
const publicKeyPem = fs.readFileSync('packaging/agent-update-signing-pub.pem', 'utf8');
verifyPackage(buf, { sha256: sha256Hex(buf), signature, publicKeyPem });
console.log('verify OK');
"
rm -f /tmp/test.deb /tmp/test.deb.sig
```

Expected: prints `verify OK` with no thrown error — confirms the committed public key in `packaging/agent-update-signing-pub.pem` actually matches the private key used to sign, and that Task 7's `verifyPackage` accepts what `sign-agent-release.js` produces.

- [ ] **Step 5: Commit**

```bash
git add packaging/generate-signing-key.js packaging/sign-agent-release.js packaging/agent-update-signing-pub.pem
git commit -m "feat: add offline agent-release signing scripts and commit the public key"
```

---

## Task 12: Package the self-update assets into the `.deb`

**Files:**
- Create: `packaging/debian/monitor-agent-updater.sudoers`
- Modify: `packaging/build-deb.sh`
- Modify: `packaging/debian/postinst`
- Modify: `packaging/README.md`

**Interfaces:**
- Produces: every built `.deb` now also ships `agent/scripts/apply-update.sh`, `packaging/agent-update-signing-pub.pem` (as `/etc/monitor-agent/update-signing-pub.pem`), and a sudoers.d drop-in granting the `monitor-agent` user passwordless execution of exactly that one script.

- [ ] **Step 1: Write `packaging/debian/monitor-agent-updater.sudoers`**

```
monitor-agent ALL=(root) NOPASSWD: /usr/lib/monitor-agent/scripts/apply-update.sh
```

- [ ] **Step 2: Extend `packaging/build-deb.sh`**

After the existing "systemd unit" section (`cp "$PKGDIR/systemd/monitor-agent.service" "$STAGE/lib/systemd/system/"`), add:

```bash
# --- self-update assets ---
mkdir -p "$STAGE/usr/lib/monitor-agent/scripts"
cp "$AGENT/scripts/apply-update.sh" "$STAGE/usr/lib/monitor-agent/scripts/"
chmod 0755 "$STAGE/usr/lib/monitor-agent/scripts/apply-update.sh"
cp "$PKGDIR/agent-update-signing-pub.pem" "$STAGE/etc/monitor-agent/update-signing-pub.pem"
mkdir -p "$STAGE/etc/sudoers.d"
cp "$PKGDIR/debian/monitor-agent-updater.sudoers" "$STAGE/etc/sudoers.d/monitor-agent-updater"
chmod 0440 "$STAGE/etc/sudoers.d/monitor-agent-updater"
```

- [ ] **Step 3: Extend `packaging/debian/postinst`**

After the existing "State directory for offline buffer" block (`chmod 750 /var/lib/monitor-agent`), add:

```bash
# Self-update working dirs: 'updates' is written by the unprivileged agent
# process (downloaded .deb staging); 'backup' is written by the root-run
# apply-update.sh (pre-update rollback copy).
mkdir -p /var/lib/monitor-agent/updates /var/lib/monitor-agent/backup
chown -R monitor-agent:monitor-agent /var/lib/monitor-agent/updates
chown -R root:root /var/lib/monitor-agent/backup

# sudoers.d perms must be exactly 0440 root:root or sudo ignores the file —
# dpkg's own file-mode handling isn't guaranteed to land on that, so assert
# it explicitly.
chown root:root /etc/sudoers.d/monitor-agent-updater
chmod 0440 /etc/sudoers.d/monitor-agent-updater
```

- [ ] **Step 4: Document the feature in `packaging/README.md`**

Add a new section after "## Updating an already-installed agent":

```markdown
## Agent self-update

Installed agents can update themselves once `self_update.enabled: true` is
set in `agent.yaml` **and** an admin turns on the platform's global
"Agent auto-update" setting (off by default; see the dashboard's Agent
Updates page). To publish a new version for agents to pull:

1. Build the `.deb` as above (`./build-deb.sh`).
2. Sign it offline with the private key from `generate-signing-key.js`
   (never the backend — see `sign-agent-release.js`):
   ```bash
   node packaging/sign-agent-release.js dist/monitor-agent_<version>_all.deb /path/to/agent-update-signing-key.pem
   ```
3. Upload both the `.deb` and the resulting `.deb.sig` on the dashboard's
   **Agent Updates** page, along with the version number and an optional
   changelog. Set a rollout percent (0 keeps it published but inert; 100
   exposes it to every eligible server).

Each agent checks periodically, downloads, and verifies the signature
against the public key baked into its own package
(`/etc/monitor-agent/update-signing-pub.pem`) before applying anything — a
compromised backend account can serve bytes, but can't produce a signature
that verifies without the offline private key. Applying an update is handled
by `scripts/apply-update.sh`, invoked via `sudo` under a rule scoped to
exactly that script (`/etc/sudoers.d/monitor-agent-updater`); it backs up
the current install first and rolls back automatically if the new version
doesn't come up healthy within 15 seconds of restart.
```

- [ ] **Step 5: Build the `.deb` and verify the new files land in it**

```bash
cd packaging
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm
./build-deb.sh
dpkg-deb -c ../dist/monitor-agent_1.1.0_all.deb | grep -E 'apply-update.sh|update-signing-pub.pem|sudoers.d/monitor-agent-updater'
```

Expected: three lines listing `./usr/lib/monitor-agent/scripts/apply-update.sh`, `./etc/monitor-agent/update-signing-pub.pem`, and `./etc/sudoers.d/monitor-agent-updater`.

- [ ] **Step 6: End-to-end install verification via `packaging/docker-test`**

```bash
cd packaging/docker-test
./test-install.sh
```

Expected: the existing install test still passes (confirms `postinst`'s new `chown`/`chmod`/`mkdir` lines don't break the base install). Then, inside the same container, confirm the sudoers rule is syntactically valid and scoped correctly:

```bash
visudo -c -f /etc/sudoers.d/monitor-agent-updater
sudo -l -U monitor-agent
```

Expected: `visudo -c` reports the file is parsed OK, and `sudo -l -U monitor-agent` lists exactly `/usr/lib/monitor-agent/scripts/apply-update.sh` as a `NOPASSWD` command — nothing broader.

- [ ] **Step 7: Commit**

```bash
git add packaging/debian/monitor-agent-updater.sudoers packaging/build-deb.sh packaging/debian/postinst packaging/README.md
git commit -m "feat: package agent self-update assets into the .deb"
```

---

## Task 13: Dashboard API client additions

**Files:**
- Modify: `dashboard/lib/api.js`

**Interfaces:**
- Produces: `api.agentReleases()`, `api.publishAgentRelease(formData)`, `api.updateAgentRelease(id, body)`. Task 14's page uses these plus the already-existing `api.servers()` / `api.updateServer()` / `api.getSettings()` / `api.saveSettings()`.

- [ ] **Step 1: Add the new API methods to `dashboard/lib/api.js`**

Add after the `promoteWave` entry (end of the Release Management section, before "── AI Assistant ──"):

```javascript
  // ── Agent self-update ───────────────────────────────────────────────────
  agentReleases: () => req('/agent-releases'),
  updateAgentRelease: (id, body) => req(`/agent-releases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Multipart publish (package file + version/changelog/signature/rollout_percent) — must NOT force JSON content-type.
  publishAgentRelease: async (formData) => {
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/agent-releases`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (res.status === 401) {
      setToken(null);
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
```

- [ ] **Step 2: Verify the dashboard still builds**

Run: `cd dashboard && npx next build`
Expected: build completes with no errors (pre-existing warnings, if any, are unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.js
git commit -m "feat: add agent-release API client methods"
```

---

## Task 14: Dashboard — Agent Updates page + nav entry

**Files:**
- Create: `dashboard/app/(app)/agent-updates/page.jsx`
- Modify: `dashboard/components/Shell.jsx`

**Interfaces:**
- Consumes: `api.agentReleases`, `api.publishAgentRelease`, `api.updateAgentRelease`, `api.servers`, `api.updateServer`, `api.getSettings`, `api.saveSettings` (Task 13 + existing).

- [ ] **Step 1: Write `dashboard/app/(app)/agent-updates/page.jsx`**

```jsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AgentUpdatesPage() {
  const [releases, setReleases] = useState([]);
  const [servers, setServers] = useState([]);
  const [settings, setSettings] = useState({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const [form, setForm] = useState({ version: '', changelog: '', rollout_percent: '0' });
  const [pkgFile, setPkgFile] = useState(null);
  const [sigFile, setSigFile] = useState(null);

  const load = () => {
    api.agentReleases().then(setReleases).catch((e) => setErr(e.message));
    api.servers().then(setServers).catch((e) => setErr(e.message));
    api.getSettings().then(setSettings).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const guard = async (fn, m) => {
    setErr(''); setMsg('');
    try { await fn(); if (m) notify(m); } catch (e) { setErr(e.message); }
  };

  const toggleGlobalEnabled = () => guard(async () => {
    const next = settings.agent_auto_update_enabled === 'true' ? 'false' : 'true';
    await api.saveSettings({ agent_auto_update_enabled: next });
    load();
  }, 'Saved');

  const publish = () => guard(async () => {
    if (!pkgFile || !sigFile || !form.version) return setErr('Version, .deb, and .sig are all required');
    const fd = new FormData();
    fd.append('version', form.version);
    fd.append('changelog', form.changelog);
    fd.append('rollout_percent', form.rollout_percent);
    fd.append('package', pkgFile);
    const signature = (await sigFile.text()).trim();
    fd.append('signature', signature);
    await api.publishAgentRelease(fd);
    setForm({ version: '', changelog: '', rollout_percent: '0' });
    setPkgFile(null); setSigFile(null);
    load();
  }, 'Published');

  const setRollout = (id, rollout_percent) => guard(async () => {
    await api.updateAgentRelease(id, { rollout_percent: Number(rollout_percent) });
    load();
  });

  const toggleActive = (r) => guard(async () => {
    await api.updateAgentRelease(r.id, { is_active: !r.is_active });
    load();
  }, r.is_active ? 'Disabled' : 'Enabled');

  const toggleExcluded = (s) => guard(async () => {
    await api.updateServer(s.id, { agent_auto_update_excluded: !s.agent_auto_update_excluded });
    load();
  });

  return (
    <div>
      <div className="page-head"><h2>🛰️ Agent Updates</h2></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="hint">{msg}</div>}
      <p className="hint" style={{ marginBottom: 16 }}>
        Publish signed monitor-agent releases; installed agents pull and
        self-apply them (download → verify signature → restart → auto
        rollback on failure) once eligible. Nothing rolls out unless the
        global switch below is on, the release is active, and the server
        falls inside its rollout percent.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.agent_auto_update_enabled === 'true'}
            onChange={toggleGlobalEnabled}
          />
          <b>Agent auto-update enabled (global kill switch)</b>
        </label>
      </div>

      <h3>Publish a new release</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <form className="inline-form" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); publish(); }}>
          <input placeholder="version (e.g. 1.2.0)" value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })} style={{ width: 160 }} />
          <input placeholder="changelog (optional)" value={form.changelog}
            onChange={(e) => setForm({ ...form, changelog: e.target.value })} style={{ width: 260 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            rollout %
            <input type="number" min="0" max="100" value={form.rollout_percent}
              onChange={(e) => setForm({ ...form, rollout_percent: e.target.value })} style={{ width: 70 }} />
          </label>
          <label style={{ fontSize: 13 }}>
            .deb <input type="file" accept=".deb" onChange={(e) => setPkgFile(e.target.files[0])} />
          </label>
          <label style={{ fontSize: 13 }}>
            .sig <input type="file" accept=".sig" onChange={(e) => setSigFile(e.target.files[0])} />
          </label>
          <button type="submit">Publish</button>
        </form>
      </div>

      <h3>Releases</h3>
      <table className="grid">
        <thead><tr><th>Version</th><th>Changelog</th><th>Rollout %</th><th>Active</th><th>Published</th></tr></thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r.id}>
              <td><code>{r.version}</code></td>
              <td>{r.changelog || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td>
                <input type="number" min="0" max="100" defaultValue={r.rollout_percent} style={{ width: 60 }}
                  onBlur={(e) => e.target.value != r.rollout_percent && setRollout(r.id, e.target.value)} />
              </td>
              <td>
                <button style={{ background: r.is_active ? '#22c55e' : '#ef4444' }} onClick={() => toggleActive(r)}>
                  {r.is_active ? 'Active' : 'Disabled'}
                </button>
              </td>
              <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
            </tr>
          ))}
          {releases.length === 0 && <tr><td colSpan="5" className="empty">No agent releases published yet.</td></tr>}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Servers</h3>
      <table className="grid">
        <thead><tr><th>Server</th><th>Agent version</th><th>Update status</th><th>Last update</th><th>Excluded</th></tr></thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.agent_version || <span style={{ color: 'var(--muted)' }}>unknown</span>}</td>
              <td>{s.agent_update_status}</td>
              <td>{s.agent_last_update_at ? new Date(s.agent_last_update_at).toLocaleString() : <span style={{ color: 'var(--muted)' }}>never</span>}</td>
              <td>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!s.agent_auto_update_excluded} onChange={() => toggleExcluded(s)} />
                  excluded
                </label>
              </td>
            </tr>
          ))}
          {servers.length === 0 && <tr><td colSpan="5" className="empty">No servers registered.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav entry in `dashboard/components/Shell.jsx`**

In the `'Release Management'` section's `items` array, add a new admin-only entry alongside the existing `Workflow Config` one:

```javascript
        { href: '/environments', label: '🌐 Environments' },
        { href: '/ai',           label: '🤖 AI Assistant' },
        ...(role === 'admin' ? [{ href: '/release-workflows', label: '🧭 Workflow Config' }] : []),
        ...(role === 'admin' ? [{ href: '/agent-updates', label: '🛰️ Agent Updates' }] : []),
```

- [ ] **Step 3: Verify the dashboard builds and the page renders**

```bash
cd dashboard
npx next build
```

Expected: build completes with no errors.

Then start the dev server and manually check the page (requires the backend running with migrations applied from Task 1):

```bash
npm run dev
```

Open `/agent-updates` as an admin user. Expected: the page loads with an empty releases table, an empty servers table (or existing registered servers), and the global toggle checkbox unchecked (matches the `'false'` seeded default from Task 1).

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/\(app\)/agent-updates/page.jsx dashboard/components/Shell.jsx
git commit -m "feat: add Agent Updates dashboard page"
```

---

## Task 15: End-to-end verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises everything built in Tasks 1-14 together.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend
npm test
```

Expected: all tests pass, including the new `agent-releases.service.spec.ts` and the unchanged pre-existing specs.

- [ ] **Step 2: Run the full agent test suite**

```bash
cd agent
npm test
```

Expected: all tests pass, including the new `verify.test.js` and `updater.test.js`.

- [ ] **Step 3: Manual end-to-end walkthrough**

With the backend running (migrations applied) and a test server registered:

1. Build and sign a `.deb` at version `9.9.9` (an arbitrary version higher than whatever's installed) using Tasks 11-12's scripts.
2. On the dashboard's Agent Updates page, publish it with rollout 100%, and turn the global switch on.
3. On a test VM/container with the agent installed and `self_update.enabled: true` set in its `agent.yaml`, wait for (or manually trigger) a check cycle.
4. Confirm: the agent downloads the package, `apply-update.sh` runs, the service restarts, and the dashboard's Servers table shows `agent_version: 9.9.9`, `agent_update_status: succeeded`.
5. Repeat with a deliberately broken build (e.g. a `.deb` whose `ExecStart` binary is missing) to confirm the auto-rollback path: the server should end up back on its previous version with `agent_update_status: rolled_back` (or `failed` if rollback itself couldn't bring the service up).

This step has no fixed expected output beyond "the version reported by the server matches what was published, and the failure case rolls back" — record what you observe.

- [ ] **Step 4: Update `docs/release-management.md` cross-reference (optional but recommended)**

If the manual walkthrough succeeds, add a one-line mention under the existing "Deploy pipeline (agent-executed)" section noting that agent self-update is a separate mechanism (link to `packaging/README.md`'s new section), so a future reader doesn't confuse it with `deploy_jobs`.

- [ ] **Step 5: Final commit (if Step 4 made changes)**

```bash
git add docs/release-management.md
git commit -m "docs: cross-reference agent self-update from release-management docs"
```
