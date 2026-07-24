import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Symmetric encryption for secrets at rest (e.g. per-repo GitHub PATs).
 *
 * AES-256-GCM. The 32-byte key is derived from TOKEN_ENC_KEY via SHA-256 so
 * the env var can be any length. Output format is `iv:tag:ciphertext`, each
 * part base64. Rotating TOKEN_ENC_KEY invalidates previously stored values.
 */
const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY;
  if (!secret) {
    throw new Error('TOKEN_ENC_KEY is not set — cannot encrypt/decrypt secrets.');
  }
  return createHash('sha256').update(secret).digest(); // 32 bytes
}

/** Encrypt a plaintext secret. Returns `iv:tag:ciphertext` (base64 parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt a value produced by encryptSecret. Throws if tampered/invalid. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
