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
}
