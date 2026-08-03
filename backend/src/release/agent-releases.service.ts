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
 * agent-facing controller — same pattern as DeploymentsService backing both
 * DeploymentsController and DeployAgentController.
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
}
