'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLine } = require('../src/collectors/security');

test('parses SSH failed login', () => {
  const events = [];
  parseLine(
    'May 10 12:00:00 host sshd[123]: Failed password for invalid user root from 1.2.3.4 port 5',
    (e) => events.push(e),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'ssh_failed_login');
  assert.equal(events[0].source_ip, '1.2.3.4');
});

test('parses UFW block', () => {
  const events = [];
  parseLine(
    'May 10 12:00:00 host kernel: [UFW BLOCK] IN=eth0 SRC=9.9.9.9 DST=10.0.0.1 PROTO=TCP DPT=22',
    (e) => events.push(e),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'firewall_block');
  assert.equal(events[0].source_ip, '9.9.9.9');
});

test('ignores unrelated lines', () => {
  const events = [];
  parseLine('May 10 12:00:00 host systemd: Started Daily apt.', (e) => events.push(e));
  assert.equal(events.length, 0);
});
