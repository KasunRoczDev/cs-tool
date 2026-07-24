import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { GitService } from './git.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';

export interface CreateRepoInput {
  name: string;
  slug: string;
  remote_url: string;
  provider?: string;
  default_branch?: string;
  tech_stack?: string[];
  docker_image_name?: string;
  container_registry?: string;
  product_id?: string;
  github_token?: string;
}

// Columns safe to return to the client — never includes github_token_enc.
const PUBLIC_COLS = `id, name, slug, provider, remote_url, default_branch,
  tech_stack, docker_image_name, container_registry, branch_protection,
  metadata, is_active, last_synced_at, product_id, created_at, updated_at,
  (github_token_enc IS NOT NULL) AS has_token`;

@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly git: GitService,
  ) {}

  list() {
    return this.pool
      .query(
        `SELECT r.id, r.name, r.slug, r.provider, r.remote_url, r.default_branch,
                r.tech_stack, r.docker_image_name, r.container_registry,
                r.is_active, r.last_synced_at, r.product_id, p.name AS product_name,
                (r.github_token_enc IS NOT NULL) AS has_token,
                r.created_at,
                (SELECT count(*)::int FROM repo_versions v WHERE v.repository_id = r.id) AS version_count
           FROM repositories r
           LEFT JOIN products p ON p.id = r.product_id
          ORDER BY r.name`,
      )
      .then((res) => res.rows);
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${PUBLIC_COLS} FROM repositories WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Repository not found');
    return rows[0];
  }

  /** Internal: full row incl. encrypted token. Never returned to clients. */
  private async getRaw(id: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM repositories WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Repository not found');
    return rows[0];
  }

  /** Decrypt the stored GitHub token for a repo, or undefined if none set. */
  private async tokenFor(id: string): Promise<string | undefined> {
    const raw = await this.getRaw(id);
    if (!raw.github_token_enc) return undefined;
    return decryptSecret(raw.github_token_enc);
  }

  async create(input: CreateRepoInput) {
    if (input.github_token && (input.provider ?? 'github') === 'github') {
      await this.git.verifyToken({ slug: input.slug, remote_url: input.remote_url }, input.github_token);
    }
    const tokenEnc = input.github_token
      ? encryptSecret(input.github_token)
      : null;
    const { rows } = await this.pool.query(
      `INSERT INTO repositories
         (name, slug, remote_url, provider, default_branch, tech_stack,
          docker_image_name, container_registry, product_id, github_token_enc)
       VALUES ($1,$2,$3,COALESCE($4,'github')::vcs_provider,COALESCE($5,'main'),$6,$7,$8,$9,$10)
       RETURNING ${PUBLIC_COLS}`,
      [
        input.name,
        input.slug,
        input.remote_url,
        input.provider ?? null,
        input.default_branch ?? null,
        input.tech_stack ?? null,
        input.docker_image_name ?? null,
        input.container_registry ?? null,
        input.product_id || null, // '' (Unassigned) -> null
        tokenEnc,
      ],
    );
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<CreateRepoInput> & { is_active?: boolean },
  ) {
    if (patch.github_token) {
      const existing = await this.getRaw(id);
      const provider = patch.provider ?? existing.provider;
      const remoteUrl = patch.remote_url ?? existing.remote_url;
      if (provider === 'github') {
        await this.git.verifyToken({ slug: existing.slug, remote_url: remoteUrl }, patch.github_token);
      }
    }
    const cols: Record<string, unknown> = {
      name: patch.name,
      slug: patch.slug,
      remote_url: patch.remote_url,
      provider: patch.provider,
      default_branch: patch.default_branch,
      tech_stack: patch.tech_stack,
      docker_image_name: patch.docker_image_name,
      container_registry: patch.container_registry,
      product_id: patch.product_id === '' ? null : patch.product_id, // '' clears the product
      is_active: patch.is_active,
    };
    // A non-empty token sets/rotates it; an explicit empty string clears it.
    if (patch.github_token !== undefined) {
      cols.github_token_enc = patch.github_token
        ? encryptSecret(patch.github_token)
        : null;
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) {
      if (v !== undefined) {
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = now()`);
    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE repositories SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING ${PUBLIC_COLS}`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Repository not found');
    return rows[0];
  }

  async remove(id: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM repositories WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw new NotFoundException('Repository not found');
    return { deleted: true };
  }

  /** Force a VCS resync. Uses the repo's GitHub token when present. */
  async sync(id: string) {
    const repo = await this.getRaw(id);
    const token = repo.github_token_enc
      ? decryptSecret(repo.github_token_enc)
      : undefined;
    const res = await this.git.syncRepository(repo, token);
    const { rows } = await this.pool.query(
      `UPDATE repositories
          SET last_synced_at = now(),
              metadata = jsonb_set(metadata, '{head_sha}', to_jsonb($2::text), true),
              updated_at = now()
        WHERE id = $1
      RETURNING id, slug, last_synced_at, metadata`,
      [id, res.head_sha],
    );
    return rows[0];
  }

  /** List branches from the provider (GitHub) using the repo's token. */
  async branches(id: string) {
    const repo = await this.getRaw(id);
    const token = await this.tokenFor(id);
    if (!token) {
      throw new NotFoundException(
        'No GitHub token set for this repository. Add one to load branches.',
      );
    }
    return this.git.listBranches(repo, token);
  }

  /** Commit graph for a branch (defaults to the repo default branch). */
  async commits(id: string, branch?: string, limit?: number) {
    const repo = await this.getRaw(id);
    const token = await this.tokenFor(id);
    if (!token) {
      throw new NotFoundException(
        'No GitHub token set for this repository. Add one to load commits.',
      );
    }
    return this.git.listCommits(
      repo,
      token,
      branch || repo.default_branch || 'main',
      limit ?? 50,
    );
  }

  /** Branch history = commit list for a branch (alias of commits, explicit endpoint). */
  branchHistory(id: string, branch: string, limit?: number) {
    return this.commits(id, branch, limit);
  }

  /** Require a decrypted token or throw a helpful 404. */
  private async requireToken(id: string): Promise<{ repo: any; token: string }> {
    const repo = await this.getRaw(id);
    const token = await this.tokenFor(id);
    if (!token) {
      throw new NotFoundException(
        'No GitHub token set for this repository. Add one to manage branches.',
      );
    }
    return { repo, token };
  }

  /** Create a branch from a base ref (default: the repo default branch). */
  async createBranch(id: string, name: string, from?: string) {
    const { repo, token } = await this.requireToken(id);
    const base = from || repo.default_branch || 'main';
    return this.git.createBranch(repo, token, name, base);
  }

  /** Delete a branch by name. */
  async deleteBranch(id: string, name: string) {
    const { repo, token } = await this.requireToken(id);
    return this.git.deleteBranch(repo, token, name);
  }

  /** Compare base...head (ahead/behind, files, commits). */
  async compareBranches(id: string, base: string, head: string) {
    const { repo, token } = await this.requireToken(id);
    return this.git.compareBranches(repo, token, base, head);
  }

  /** Detect whether head merges cleanly into base (non-destructive). */
  async detectConflicts(id: string, base: string, head: string) {
    const { repo, token } = await this.requireToken(id);
    return this.git.detectConflicts(repo, token, base, head);
  }

  // ---- versions ----
  listVersions(repoId: string) {
    return this.pool
      .query(
        `SELECT * FROM repo_versions WHERE repository_id = $1
          ORDER BY major DESC, minor DESC, patch DESC, created_at DESC`,
        [repoId],
      )
      .then((r) => r.rows);
  }

  async createVersion(
    repoId: string,
    input: { version: string; commit_sha?: string; prerelease?: string },
  ) {
    await this.get(repoId); // 404 if missing
    const [major = 0, minor = 0, patch = 0] = input.version
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    const { rows } = await this.pool.query(
      `INSERT INTO repo_versions
         (repository_id, version, major, minor, patch, prerelease, commit_sha, released_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       RETURNING *`,
      [
        repoId,
        input.version,
        major,
        minor,
        patch,
        input.prerelease ?? null,
        input.commit_sha ?? null,
      ],
    );
    return rows[0];
  }
}
