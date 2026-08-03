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
