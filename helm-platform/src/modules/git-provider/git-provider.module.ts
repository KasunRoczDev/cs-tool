import { Module } from '@nestjs/common';
import { GitHubAdapter } from './adapters/github.adapter';
import { ProviderRegistry } from './provider-registry';

@Module({
  providers: [GitHubAdapter, ProviderRegistry],
  exports: [ProviderRegistry],
})
export class GitProviderModule {}
