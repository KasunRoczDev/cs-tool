'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sender } = require('../src/sender');

function makeCfg(overrides) {
  return {
    server_url: 'http://example.invalid',
    api_key: 'k',
    buffer_file: path.join(os.tmpdir(), `sender-test-${Math.random()}.ndjson`),
    buffer_max_items: 100,
    tls_verify: true,
    health_check_timeout: 1,
    ...overrides,
  };
}

test('does not POST metrics/events when the server health probe fails', async (t) => {
  const cfg = makeCfg();
  const sender = new Sender(cfg);
  sender.enqueueMetric({ cpu: 1 });
  sender.enqueueEvent({ event_type: 'x' });

  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    calls.push({ url: url.toString(), method: opts && opts.method });
    throw new Error('ECONNREFUSED');
  });

  await sender.flush();

  // Only the HEAD probe should have gone out — no metrics/events POST.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'HEAD');
  assert.equal(sender.metricsQueue.length, 1);
  assert.equal(sender.eventsQueue.length, 1);

  fs.rmSync(cfg.buffer_file, { force: true });
});

test('sends buffered data once the server is reachable again', async (t) => {
  const cfg = makeCfg();
  const sender = new Sender(cfg);
  sender.enqueueMetric({ cpu: 1 });

  t.mock.method(global, 'fetch', async (url, opts) => {
    return { ok: true, status: 200 };
  });

  await sender.flush();

  assert.equal(sender.metricsQueue.length, 0);

  fs.rmSync(cfg.buffer_file, { force: true });
});

test('flush is a no-op (no probe) when nothing is queued', async (t) => {
  const cfg = makeCfg();
  const sender = new Sender(cfg);

  let called = false;
  t.mock.method(global, 'fetch', async () => {
    called = true;
    return { ok: true, status: 200 };
  });

  await sender.flush();

  assert.equal(called, false);

  fs.rmSync(cfg.buffer_file, { force: true });
});
