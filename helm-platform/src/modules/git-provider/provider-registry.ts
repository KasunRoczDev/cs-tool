import { Injectable } from '@nestjs/common';
import { GitProvider } from './git-provider.port';
import { GitHubAdapter } from './adapters/github.adapter';

/** Selects the adapter by repository.provider (blueprint I.2). Add a class to add a forge. */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, GitProvider>();
  constructor(github: GitHubAdapter) {
    this.register(github);
    // this.register(new GitLabAdapter()); this.register(new BitbucketAdapter());
  }
  register(p: GitProvider) { this.providers.set(p.key, p); }
  for(provider: string): GitProvider {
    const p = this.providers.get(provider);
    if (!p) throw new Error(`No git provider adapter registered for '${provider}'`);
    return p;
  }
}
