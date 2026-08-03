#!/usr/bin/env node
'use strict';
// Signs a built .deb with the agent-update private signing key. Run this on
// the same offline machine that holds the private key from
// generate-signing-key.js.
//
// Usage: node packaging/sign-agent-release.js <path-to.deb> <private-key.pem>
// Writes: <path-to.deb>.sig  (base64 Ed25519 signature — upload this
//         alongside the .deb when publishing via the dashboard's Agent
//         Updates page)
const fs = require('fs');
const { sign, createPrivateKey } = require('crypto');

const [, , debPath, keyPath] = process.argv;
if (!debPath || !keyPath) {
  console.error('Usage: node sign-agent-release.js <path-to.deb> <private-key.pem>');
  process.exit(2);
}

const privateKey = createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
const bytes = fs.readFileSync(debPath);
const signature = sign(null, bytes, privateKey).toString('base64');

const sigPath = `${debPath}.sig`;
fs.writeFileSync(sigPath, signature);
console.log(`Signature written to ${sigPath}`);
