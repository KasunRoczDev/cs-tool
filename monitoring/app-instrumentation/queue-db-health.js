'use strict';
// App-layer health probes for the OMS/courier/IoT stack: BullMQ queues, Redis,
// and Postgres. Returns plain objects you can POST to /api/v1/metrics (extend
// the schema) or expose on /metrics for Prometheus. No hard deps unless used.
//
//   const { collectAppHealth } = require('./queue-db-health');
//   const h = await collectAppHealth({ queues, redis, pgPool });

// ── BullMQ: backlog explosion, stuck workers, dead-letter pileup ────────────
async function queueHealth(queues = {}) {
  const out = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const counts = await queue.getJobCounts(
        'waiting', 'active', 'delayed', 'failed', 'completed', 'paused',
      );
      out[name] = {
        waiting: counts.waiting,        // backlog — alert if climbing
        active: counts.active,
        delayed: counts.delayed,
        failed: counts.failed,          // dead-letter equivalent — alert > 0 trend
        paused: counts.paused,
        // crude stuck-worker signal: work queued but nothing processing
        stuck: counts.waiting > 0 && counts.active === 0,
      };
    } catch (e) {
      out[name] = { error: String(e.message).slice(0, 80) };
    }
  }
  return out;
}

// ── Redis: hit ratio, memory pressure, evictions ───────────────────────────
async function redisHealth(redis) {
  if (!redis) return null;
  try {
    const raw = await redis.info();
    const kv = Object.fromEntries(
      raw.split('\n').filter((l) => l.includes(':')).map((l) => l.trim().split(':')),
    );
    const hits = Number(kv.keyspace_hits || 0);
    const misses = Number(kv.keyspace_misses || 0);
    return {
      hit_ratio: hits + misses ? hits / (hits + misses) : null, // < 0.8 = cache too small/cold
      used_memory_mb: Number(kv.used_memory || 0) / 1048576,
      mem_fragmentation_ratio: Number(kv.mem_fragmentation_ratio || 0),
      evicted_keys: Number(kv.evicted_keys || 0),                // > 0 = under memory pressure
      connected_clients: Number(kv.connected_clients || 0),
    };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

// ── Postgres: connection saturation, locks, replication lag, slow queries ───
async function pgHealth(pgPool) {
  if (!pgPool) return null;
  try {
    const q = async (sql) => (await pgPool.query(sql)).rows;
    const [conns] = await q(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state='active')::int AS active,
             count(*) FILTER (WHERE state='idle in transaction')::int AS idle_in_txn,
             current_setting('max_connections')::int AS max_conn
      FROM pg_stat_activity`);
    const [locks] = await q(`
      SELECT count(*)::int AS blocked
      FROM pg_locks WHERE NOT granted`);
    const [slow] = await q(`
      SELECT count(*)::int AS long_running
      FROM pg_stat_activity
      WHERE state='active' AND now()-query_start > interval '5 seconds'`);
    let replLagSec = null;
    try {
      const [r] = await q(`
        SELECT EXTRACT(EPOCH FROM (now()-pg_last_xact_replay_timestamp()))::float AS lag`);
      replLagSec = r?.lag ?? null; // null on primary
    } catch { /* not a replica */ }
    return {
      conn_used_pct: (conns.total / conns.max_conn) * 100, // alert > 80
      conn_active: conns.active,
      conn_idle_in_txn: conns.idle_in_txn,                 // leaked txns — alert if growing
      blocked_locks: locks.blocked,                        // deadlock/contention
      long_running_queries: slow.long_running,
      replication_lag_sec: replLagSec,                     // alert > 30
    };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

async function collectAppHealth({ queues, redis, pgPool } = {}) {
  const [queue, cache, db] = await Promise.all([
    queueHealth(queues),
    redisHealth(redis),
    pgHealth(pgPool),
  ]);
  return { timestamp: new Date().toISOString(), queues: queue, redis: cache, postgres: db };
}

module.exports = { collectAppHealth, queueHealth, redisHealth, pgHealth };
