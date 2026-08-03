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
