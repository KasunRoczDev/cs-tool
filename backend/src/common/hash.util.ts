import { createHash, randomBytes } from 'crypto';

/** Hash an agent API key for storage / comparison (sha256 hex). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Generate a new opaque agent API key (shown once at onboarding). */
export function generateApiKey(): string {
  return 'agt_' + randomBytes(24).toString('hex');
}
