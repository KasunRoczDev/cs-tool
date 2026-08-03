'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign } = require('crypto');
const { sha256Hex, verifyPackage } = require('../src/update/verify');

function signBuffer(buf, privateKey) {
  return sign(null, buf, privateKey).toString('base64');
}

test('sha256Hex matches a known digest', () => {
  assert.equal(sha256Hex(Buffer.from('hello')), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('verifyPackage succeeds when checksum and signature both match', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, privateKey);

  const result = verifyPackage(buf, { sha256: sha256Hex(buf), signature, publicKeyPem });
  assert.equal(result, true);
});

test('verifyPackage rejects a checksum mismatch (tampered or corrupted bytes)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, privateKey);

  assert.throws(
    () => verifyPackage(buf, { sha256: 'deadbeef', signature, publicKeyPem }),
    /checksum mismatch/,
  );
});

test('verifyPackage rejects a bad signature even when the checksum matches', () => {
  const { publicKey } = generateKeyPairSync('ed25519'); // real key...
  const { privateKey: otherPrivateKey } = generateKeyPairSync('ed25519'); // different keypair
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const buf = Buffer.from('a fake .deb payload');
  const signature = signBuffer(buf, otherPrivateKey); // signed with the WRONG key

  assert.throws(
    () => verifyPackage(buf, { sha256: sha256Hex(buf), signature, publicKeyPem }),
    /signature verification failed/,
  );
});
