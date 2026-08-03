'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { generateKeyPairSync, sign } = require('crypto');
const { Updater } = require('../src/updater');

function makeCfg(overrides) {
  return {
    server_url: 'http://example.invalid',
    api_key: 'k',
    self_update: { enabled: true, check_interval: 3600, updates_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'updater-test-')) },
    ...overrides,
  };
}

test('check() does nothing when the server reports not eligible', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(url.toString());
    return { ok: true, status: 200, json: async () => ({ eligible: false }) };
  });
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await updater.check();

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v1\/agent\/updates\/latest$/);
  assert.equal(spawned, false);
});

test('check() does nothing when the eligible version equals the current version', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';
  t.mock.method(global, 'fetch', async () => ({
    ok: true, status: 200, json: async () => ({ eligible: true, version: '1.1.0', sha256: 'x', signature: 'y' }),
  }));
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await updater.check();

  assert.equal(spawned, false);
});

test('check() downloads, verifies, writes the .deb, reports "applying", and spawns the sudo apply script for a genuinely new version', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkgBytes = Buffer.from('fake .deb contents');
  const signature = sign(null, pkgBytes, privateKey).toString('base64');
  const sha256 = require('../src/update/verify').sha256Hex(pkgBytes);

  const pubKeyPath = path.join(cfg.self_update.updates_dir, 'pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  updater.publicKeyPath = pubKeyPath;

  const requests = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    const u = url.toString();
    requests.push(u);
    if (u.endsWith('/agent/updates/latest')) {
      return { ok: true, status: 200, json: async () => ({ eligible: true, version: '1.2.0', sha256, signature }) };
    }
    if (u.endsWith('/agent/updates/1.2.0/package')) {
      return { ok: true, status: 200, arrayBuffer: async () => pkgBytes.buffer.slice(pkgBytes.byteOffset, pkgBytes.byteOffset + pkgBytes.byteLength) };
    }
    if (u.endsWith('/agent/updates/report')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  let spawnArgs = null;
  t.mock.method(cp, 'spawn', (cmd, args) => { spawnArgs = { cmd, args }; return { unref() {} }; });

  await updater.check();

  const debPath = path.join(cfg.self_update.updates_dir, 'monitor-agent_1.2.0.deb');
  assert.equal(fs.readFileSync(debPath).toString(), 'fake .deb contents');
  assert.ok(spawnArgs, 'apply script should have been spawned');
  assert.equal(spawnArgs.cmd, 'sudo');
  assert.equal(spawnArgs.args[1], debPath);
  assert.ok(requests.some((u) => u.endsWith('/agent/updates/report')));
});

test('check() does not spawn the apply script when signature verification fails', async (t) => {
  const cfg = makeCfg();
  const updater = new Updater(cfg);
  updater.currentVersion = '1.1.0';

  const { publicKey } = generateKeyPairSync('ed25519'); // real key...
  const pkgBytes = Buffer.from('fake .deb contents');
  const badSignature = Buffer.from('not-a-real-signature').toString('base64'); // ...but a bogus signature
  const sha256 = require('../src/update/verify').sha256Hex(pkgBytes);

  const pubKeyPath = path.join(cfg.self_update.updates_dir, 'pub.pem');
  fs.writeFileSync(pubKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  updater.publicKeyPath = pubKeyPath;

  t.mock.method(global, 'fetch', async (url) => {
    const u = url.toString();
    if (u.endsWith('/agent/updates/latest')) {
      return { ok: true, status: 200, json: async () => ({ eligible: true, version: '1.2.0', sha256, signature: badSignature }) };
    }
    if (u.endsWith('/agent/updates/1.2.0/package')) {
      return { ok: true, status: 200, arrayBuffer: async () => pkgBytes.buffer.slice(pkgBytes.byteOffset, pkgBytes.byteOffset + pkgBytes.byteLength) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  let spawned = false;
  t.mock.method(cp, 'spawn', () => { spawned = true; return { unref() {} }; });

  await assert.rejects(() => updater.check(), /signature verification failed/);
  assert.equal(spawned, false);
});
