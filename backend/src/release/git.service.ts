import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Git / VCS integration.
 *
 * GitHub is implemented live against the REST API (https://api.github.com)
 * using Node's global fetch and a per-repository personal access token. No SDK
 * dependency — keeps the CommonJS build clean. GitLab/Bitbucket and the deploy
 * executor / webhook ingestor remain stubs (the signatures are the port).
 *
 * Callers pass the decrypted token; this service never touches the DB or
 * encryption — RepositoriesService owns that.
 */
export interface RepoRef {
  id?: string;
  slug: string;
  provider?: string;
  remote_url?: string;
  default_branch?: string;
}

export interface GitBranch {
  name: string;
  commit_sha: string;
  protected: boolean;
}

export interface GitCommit {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
  url: string;
}

const GH_API = 'https://api.github.com';

@Injectable()
export class GitService {
  private readonly log = new Logger('GitService');

  /** Parse "https://github.com/owner/repo(.git)" → { owner, repo }. */
  parseGithub(remoteUrl?: string): { owner: string; repo: string } {
    if (!remoteUrl) throw new BadRequestException('Repository has no remote_url.');
    const m = remoteUrl
      .trim()
      .replace(/\.git$/, '')
      .match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
    if (!m) {
      throw new BadRequestException(
        `Could not parse a GitHub owner/repo from "${remoteUrl}".`,
      );
    }
    return { owner: m[1], repo: m[2] };
  }

  private async gh<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${GH_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'monitoring-platform',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.warn(`GitHub ${res.status} for ${path}: ${body.slice(0, 200)}`);
      throw new BadRequestException(
        `GitHub API error ${res.status}${res.status === 401 ? ' (check the repo token)' : ''}.`,
      );
    }
    return (await res.json()) as T;
  }

  /**
   * Generic GitHub request for write/non-GET verbs. Returns the raw Response so
   * callers can branch on status (e.g. 409 = merge conflict) without throwing.
   */
  private async ghRaw(
    path: string,
    token: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${GH_API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'monitoring-platform',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async ghWrite<T>(
    path: string,
    token: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.ghRaw(path, token, method, body);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn(`GitHub ${method} ${res.status} for ${path}: ${text.slice(0, 200)}`);
      throw new BadRequestException(
        `GitHub API error ${res.status} on ${method} ${path}` +
          (res.status === 422 ? ' (branch may already exist / invalid ref)' : '') +
          (res.status === 401 ? ' (check the repo token)' : ''),
      );
    }
    return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
  }

  /** Create a branch `name` pointing at the commit that `fromRef` resolves to. */
  async createBranch(
    repo: RepoRef,
    token: string,
    name: string,
    fromRef: string,
  ): Promise<GitBranch> {
    const { owner, repo: r } = this.parseGithub(repo.remote_url);
    const sha = await this.resolveSha(repo, fromRef, token);
    await this.ghWrite(`/repos/${owner}/${r}/git/refs`, token, 'POST', {
      ref: `refs/heads/${name}`,
      sha,
    });
    return { name, commit_sha: sha, protected: false };
  }

  /** Delete a branch by name (git ref). */
  async deleteBranch(repo: RepoRef, token: string, name: string): Promise<{ deleted: boolean }> {
    const { owner, repo: r } = this.parseGithub(repo.remote_url);
    await this.ghWrite(
      `/repos/${owner}/${r}/git/refs/heads/${encodeURIComponent(name)}`,
      token,
      'DELETE',
    );
    return { deleted: true };
  }

  /** Compare two branches: ahead/behind, status, changed files, and commits. */
  async compareBranches(
    repo: RepoRef,
    token: string,
    base: string,
    head: string,
  ): Promise<{
    status: string;
    ahead_by: number;
    behind_by: number;
    total_commits: number;
    files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
    commits: GitCommit[];
  }> {
    const { owner, repo: r } = this.parseGithub(repo.remote_url);
    const data = await this.gh<any>(
      `/repos/${owner}/${r}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      token,
    );
    return {
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      files: (data.files ?? []).map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      commits: (data.commits ?? []).map((c: any) => ({
        sha: c.sha,
        parents: (c.parents ?? []).map((p: any) => p.sha),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name ?? 'unknown',
        date: c.commit.author?.date ?? '',
        url: c.html_url,
      })),
    };
  }

  /**
   * Detect whether `head` merges cleanly into `base` — non-destructively.
   * GitHub has no merge dry-run, so we merge into a throwaway temp branch cut
   * from base's tip and then delete it. The real branches are never touched.
   *   201 -> merged cleanly (no conflict)
   *   204 -> nothing to merge (already up to date, no conflict)
   *   409 -> merge conflict
   */
  async detectConflicts(
    repo: RepoRef,
    token: string,
    base: string,
    head: string,
  ): Promise<{ conflicts: boolean; status: string; ahead_by: number; behind_by: number }> {
    const { owner, repo: r } = this.parseGithub(repo.remote_url);
    const cmp = await this.compareBranches(repo, token, base, head);
    const baseSha = await this.resolveSha(repo, base, token);
    const temp = `tmp/helm-conflict-check-${Date.now().toString(36)}`;
    let conflicts = false;
    try {
      await this.ghWrite(`/repos/${owner}/${r}/git/refs`, token, 'POST', {
        ref: `refs/heads/${temp}`,
        sha: baseSha,
      });
      const res = await this.ghRaw(`/repos/${owner}/${r}/merges`, token, 'POST', {
        base: temp,
        head,
        commit_message: `conflict-check ${head} -> ${base}`,
      });
      conflicts = res.status === 409;
      if (!res.ok && res.status !== 409 && res.status !== 204) {
        const text = await res.text().catch(() => '');
        this.log.warn(`conflict-probe merge ${res.status}: ${text.slice(0, 160)}`);
      }
    } finally {
      // Always clean up the temp branch.
      await this.ghRaw(
        `/repos/${owner}/${r}/git/refs/heads/${encodeURIComponent(temp)}`,
        token,
        'DELETE',
      ).catch(() => undefined);
    }
    return { conflicts, status: cmp.status, ahead_by: cmp.ahead_by, behind_by: cmp.behind_by };
  }

  /** List branches for a GitHub repo. */
  async listBranches(repo: RepoRef, token: string): Promise<GitBranch[]> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const data = await this.gh<
      Array<{ name: string; commit: { sha: string }; protected: boolean }>
    >(`/repos/${owner}/${name}/branches?per_page=100`, token);
    return data.map((b) => ({
      name: b.name,
      commit_sha: b.commit.sha,
      protected: b.protected,
    }));
  }

  /**
   * Fetch the commit history for a branch, including each commit's parents so
   * the dashboard can render a branch/merge graph.
   */
  async listCommits(
    repo: RepoRef,
    token: string,
    branch: string,
    limit = 50,
  ): Promise<GitCommit[]> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const per = Math.min(Math.max(limit, 1), 100);
    const data = await this.gh<
      Array<{
        sha: string;
        html_url: string;
        parents: Array<{ sha: string }>;
        commit: { message: string; author: { name: string; date: string } };
      }>
    >(
      `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(branch)}&per_page=${per}`,
      token,
    );
    return data.map((c) => ({
      sha: c.sha,
      parents: c.parents.map((p) => p.sha),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name ?? 'unknown',
      date: c.commit.author?.date ?? '',
      url: c.html_url,
    }));
  }

  /**
   * List recently merged pull requests (most recent first). Used by the
   * release-notes generator to pull PR titles + numbers and extract work IDs.
   */
  async listMergedPullRequests(
    repo: RepoRef,
    token: string,
    base?: string,
    limit = 30,
  ): Promise<Array<{ number: number; title: string; author: string; merged_at: string; url: string }>> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const per = Math.min(Math.max(limit, 1), 100);
    const baseQ = base ? `&base=${encodeURIComponent(base)}` : '';
    const data = await this.gh<
      Array<{
        number: number;
        title: string;
        html_url: string;
        merged_at: string | null;
        user: { login: string } | null;
      }>
    >(
      `/repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=${per}${baseQ}`,
      token,
    );
    return data
      .filter((p) => p.merged_at)
      .map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? 'unknown',
        merged_at: p.merged_at as string,
        url: p.html_url,
      }));
  }

  /**
   * Extract Feature / Bug work-item IDs from free text (PR titles, commit
   * messages). Matches FEAT-123, FEATURE 12, BUG-9, FIX 45, HOTFIX-3, JIRA-style
   * KEY-123, and #123 PR references.
   */
  extractWorkIds(text: string): { features: string[]; bugs: string[]; refs: string[] } {
    const features = new Set<string>();
    const bugs = new Set<string>();
    const refs = new Set<string>();
    const feat = /\b(FEAT(?:URE)?)[-\s]?(\d+)\b/gi;
    const bug = /\b(BUG|FIX|HOTFIX|DEFECT)[-\s]?(\d+)\b/gi;
    const key = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g; // e.g. OMS-123
    const pr = /#(\d+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = feat.exec(text))) features.add(`${m[1].toUpperCase()}-${m[2]}`);
    while ((m = bug.exec(text))) bugs.add(`${m[1].toUpperCase()}-${m[2]}`);
    while ((m = key.exec(text))) {
      const id = `${m[1]}-${m[2]}`;
      if (/BUG|FIX|HOTFIX|DEFECT/i.test(m[1])) bugs.add(id);
      else if (/FEAT/i.test(m[1])) features.add(id);
      else refs.add(id);
    }
    while ((m = pr.exec(text))) refs.add(`#${m[1]}`);
    return { features: [...features], bugs: [...bugs], refs: [...refs] };
  }

  /** List OPEN pull requests (number, title, author, age). */
  async listOpenPullRequests(
    repo: RepoRef,
    token: string,
    limit = 30,
  ): Promise<Array<{ number: number; title: string; author: string; created_at: string; url: string; base: string; head: string }>> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const per = Math.min(Math.max(limit, 1), 100);
    const data = await this.gh<any[]>(
      `/repos/${owner}/${name}/pulls?state=open&sort=created&direction=desc&per_page=${per}`,
      token,
    );
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? 'unknown',
      created_at: p.created_at,
      url: p.html_url,
      base: p.base?.ref,
      head: p.head?.ref,
    }));
  }

  /** Per-PR change stats (additions/deletions/changed files + mergeable state). */
  async getPullRequestStats(
    repo: RepoRef,
    token: string,
    number: number,
  ): Promise<{ additions: number; deletions: number; changed_files: number; mergeable_state: string; commits: number }> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const p = await this.gh<any>(`/repos/${owner}/${name}/pulls/${number}`, token);
    return {
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changed_files: p.changed_files ?? 0,
      mergeable_state: p.mergeable_state ?? 'unknown',
      commits: p.commits ?? 0,
    };
  }

  /** Files changed by a PR (path + churn + status). */
  async listPullRequestFiles(
    repo: RepoRef,
    token: string,
    number: number,
  ): Promise<Array<{ filename: string; additions: number; deletions: number; status: string }>> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const data = await this.gh<any[]>(
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100`,
      token,
    );
    return data.map((f) => ({
      filename: f.filename,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      status: f.status,
    }));
  }

  /**
   * Rank recent authors who have touched the given paths — the basis for
   * reviewer recommendations. Queries commit history per path (bounded).
   */
  async topAuthorsForPaths(
    repo: RepoRef,
    token: string,
    paths: string[],
    exclude?: string,
  ): Promise<Array<{ login: string; touches: number }>> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    const counts = new Map<string, number>();
    for (const p of paths.slice(0, 10)) {
      try {
        const commits = await this.gh<any[]>(
          `/repos/${owner}/${name}/commits?path=${encodeURIComponent(p)}&per_page=20`,
          token,
        );
        for (const c of commits) {
          const login = c.author?.login || c.commit?.author?.name;
          if (!login || login === exclude) continue;
          counts.set(login, (counts.get(login) ?? 0) + 1);
        }
      } catch {
        /* ignore a path we can't read */
      }
    }
    return [...counts.entries()]
      .map(([login, touches]) => ({ login, touches }))
      .sort((a, b) => b.touches - a.touches)
      .slice(0, 5);
  }

  /**
   * Validate a token actually works for this repo before it's persisted, so a bad
   * PAT fails clearly here instead of surfacing later as an opaque error on first
   * sync/branch-list. Reuses gh()'s existing error formatting (401 hint included).
   */
  async verifyToken(repo: RepoRef, token: string): Promise<void> {
    const { owner, repo: name } = this.parseGithub(repo.remote_url);
    await this.gh<{ id: number }>(`/repos/${owner}/${name}`, token);
  }

  /**
   * Force a VCS resync. With a GitHub token, returns the real tip SHA of the
   * default branch; otherwise falls back to a simulated SHA so non-GitHub /
   * tokenless repos still exercise the flow.
   */
  async syncRepository(
    repo: RepoRef,
    token?: string,
  ): Promise<{ head_sha: string; synced_at: string }> {
    if (token && (repo.provider ?? 'github') === 'github') {
      const { owner, repo: name } = this.parseGithub(repo.remote_url);
      const branch = repo.default_branch || 'main';
      const head_sha = await this.gh<{ sha: string }>(
        `/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`,
        token,
      ).then((c) => c.sha);
      return { head_sha, synced_at: new Date().toISOString() };
    }
    this.log.debug(`stub sync ${repo.slug} (no token / non-github)`);
    return { head_sha: this.fakeSha(), synced_at: new Date().toISOString() };
  }

  /** Resolve a branch/ref to a commit SHA. Real for GitHub-with-token. */
  async resolveSha(repo: RepoRef, ref: string, token?: string): Promise<string> {
    if (token && (repo.provider ?? 'github') === 'github') {
      const { owner, repo: name } = this.parseGithub(repo.remote_url);
      return this.gh<{ sha: string }>(
        `/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`,
        token,
      ).then((c) => c.sha);
    }
    this.log.debug(`stub resolve ${repo.slug}@${ref}`);
    return this.fakeSha();
  }

  /**
   * DeployExecutor port — STUB. In production this triggers a GitHub Action /
   * CI pipeline and the result arrives asynchronously.
   */
  async execDeploy(input: {
    releaseVersion: string;
    channel: string;
    deploymentId: string;
  }): Promise<{ ok: boolean; logs_url: string }> {
    this.log.log(
      `stub deploy ${input.releaseVersion} -> ${input.channel} (dep ${input.deploymentId})`,
    );
    return {
      ok: true,
      logs_url: `https://ci.example/internal/deployments/${input.deploymentId}`,
    };
  }

  /** Webhook handler — STUB. A real impl verifies the provider signature. */
  handleWebhook(provider: string, _payload: unknown): { received: boolean } {
    this.log.debug(`stub webhook from ${provider}`);
    return { received: true };
  }

  private fakeSha(): string {
    return Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }
}
