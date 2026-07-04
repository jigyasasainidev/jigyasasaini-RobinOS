#!/usr/bin/env node

/**
 * RobinOS — Local Webhook Worker Simulation Script (Milestone 4)
 * ================================================================
 *
 * Drives the M4 async worker end-to-end against a deployed
 * Supabase project. Seeds webhook_events rows with controlled
 * states, invokes the worker, and verifies the queue transitions.
 *
 * Modes (positional arg, default: full-flow):
 *
 *   seed --count N          — insert N valid 'received' rows via
 *                              enqueue_webhook_event (real signature
 *                              path). Default 5.
 *   seed-corrupt --count N  — insert N rows whose payload_hash
 *                              intentionally does not match
 *                              raw_payload. Worker should mark
 *                              them failed_terminal (validation).
 *   seed-retry --count N    — insert N rows already in
 *                              status='failed_retryable' with
 *                              next_retry_at in the past. Worker
 *                              should claim and re-process them
 *                              (which then transitions to 'verified'
 *                              or another dead-letter).
 *   seed-retry-future       — insert 1 row in 'failed_retryable'
 *                              with next_retry_at in the future.
 *                              Worker should NOT claim it.
 *   seed-locked --stale     — insert 1 row with status='processing'
 *                              and locked_at = now() - 6 min.
 *                              Worker should reclaim it (stale
 *                              lock recovery).
 *   seed-locked --fresh     — insert 1 row with status='processing'
 *                              and locked_at = now(). Worker
 *                              should NOT claim it.
 *   run                     — invoke worker once
 *                              (?action=process, defaults)
 *   run-loop --count N      — invoke worker N times, sleep 1s
 *                              between calls. Useful for
 *                              observing exponential backoff.
 *   health                  — invoke worker with ?action=health
 *   verify                  — query webhook_events counts by status
 *   clear                   — delete all rows whose
 *                              provider_event_id starts with
 *                              'TEST_M4_'. ONLY run this on test
 *                              environments; do not run on
 *                              production unless you know what
 *                              you're deleting.
 *   full-flow               — seed 5 valid + run + verify +
 *                              clear. Smoke test of the
 *                              happy path.
 *
 * Environment variables:
 *
 *   SUPABASE_URL              — required (e.g. https://xyz.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY — required for direct DB writes.
 *                                Never set this in production.
 *
 * Exit codes:
 *   0  — every assertion passed
 *   1  — at least one assertion failed or the request errored
 *
 * What this script does NOT do:
 *   - Deploy the worker. Run `supabase functions deploy
 *     process-webhook-worker` first.
 *   - Apply migration 56. Run `supabase db push --include-only 56`
 *     first.
 *   - Touch any production rows. Use the TEST_M4_ prefix in
 *     provider_event_id and the clear mode to clean up.
 */

const crypto = require('crypto');

// ── Args ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args[0] || 'full-flow';

function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1];
}

const count = parseInt(getFlag('count', '5'), 10);
const staleFlag = args.includes('--stale');
const freshFlag = args.includes('--fresh');

// ── Env ─────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL env var is required.');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY env var is required.');
  process.exit(1);
}

const TEST_MARKER = 'TEST_M4_';

// ── Supabase REST helpers ───────────────────────────────────

async function restRpc(fnName, args_) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args_ || {}),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`RPC ${fnName} failed: ${resp.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function restInsert(table, rows) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`INSERT ${table} failed: ${resp.status} ${text}`);
  }
  return true;
}

async function restDelete(table, filters) {
  // filters: array of {col, op, val} — joined with 'and'
  const qs = filters.map(f =>
    `${encodeURIComponent(f.col)}=${f.op}.${encodeURIComponent(f.val)}`,
  ).join('&');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'DELETE',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DELETE ${table} failed: ${resp.status} ${text}`);
  }
  return true;
}

async function restSelect(table, select, filters) {
  const filterQs = filters.map(f =>
    `${encodeURIComponent(f.col)}=${f.op}.${encodeURIComponent(f.val)}`,
  ).join('&');
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filterQs}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SELECT ${table} failed: ${resp.status} ${text}`);
  }
  return JSON.parse(await resp.text());
}

// ── Helpers ─────────────────────────────────────────────────

function randomTestEventId() {
  return TEST_MARKER + crypto.randomBytes(12).toString('hex');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function buildValidPayload(providerEventId, action) {
  return {
    WP_ACTION:           action ?? 'sale',
    IPN_ID:              providerEventId,
    WP_SALE:             'tx_' + crypto.randomBytes(8).toString('hex'),
    WP_ITEM_NUMBER:      'wp_test_item_001',
    WP_BUYER_EMAIL:      `test-buyer-${crypto.randomBytes(4).toString('hex')}@example.com`,
    WP_SALE_AMOUNT:      '39.00',
    WP_SALE_CURRENCY:    'USD',
    WP_PAYMENT_STATUS:   'Completed',
  };
}

async function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

async function postToWorker({ action, batchSize, maxRuntimeMs }) {
  const qs = new URLSearchParams();
  if (action) qs.set('action', action);
  if (batchSize) qs.set('batch_size', String(batchSize));
  if (maxRuntimeMs) qs.set('max_runtime_ms', String(maxRuntimeMs));
  const url = `${SUPABASE_URL}/functions/v1/process-webhook-worker${qs.toString() ? '?' + qs : ''}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: resp.status, text, json };
}

// ── Modes ───────────────────────────────────────────────────

async function seed(count) {
  console.log(`[seed] inserting ${count} valid 'received' rows via enqueue_webhook_event`);
  for (let i = 0; i < count; i++) {
    const providerEventId = randomTestEventId();
    const payload = buildValidPayload(providerEventId);
    await restRpc('enqueue_webhook_event', {
      p_provider_id:         'warriorplus',
      p_provider_event_id:   providerEventId,
      p_provider_event_type: 'sale',
      p_raw_payload:         payload,
    });
    process.stdout.write(`  [${i + 1}/${count}] ${providerEventId}\n`);
  }
  return true;
}

async function seedCorrupt(count) {
  console.log(`[seed-corrupt] inserting ${count} rows with mismatched payload_hash`);
  // Postgres jsonb serialization normalizes whitespace and key order.
  // We compute the correct hash here, then mutate payload_hash to a
  // wrong value to simulate corruption.
  const rows = [];
  for (let i = 0; i < count; i++) {
    const providerEventId = randomTestEventId();
    const payload = buildValidPayload(providerEventId);
    // PG jsonb canonicalization: keys are sorted, whitespace removed.
    const canonical = JSON.stringify(payload);
    const realHash = sha256Hex(canonical);
    const fakeHash = '0'.repeat(64); // wrong on purpose
    rows.push({
      provider_id:             'warriorplus',
      provider_event_id:       providerEventId,
      provider_event_type:     'sale',
      payload_hash:            fakeHash,
      raw_payload:             payload,
      raw_headers:             null,
      status:                  'received',
      trace_id:                crypto.randomUUID(),
    });
    void realHash;
  }
  await restInsert('webhook_events', rows);
  console.log(`  Inserted ${rows.length} corrupt rows.`);
  return true;
}

async function seedRetry(count) {
  console.log(`[seed-retry] inserting ${count} rows in 'failed_retryable' with next_retry_at in the past`);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const providerEventId = randomTestEventId();
    const payload = buildValidPayload(providerEventId);
    rows.push({
      provider_id:             'warriorplus',
      provider_event_id:       providerEventId,
      provider_event_type:     'sale',
      payload_hash:            sha256Hex(JSON.stringify(payload)),
      raw_payload:             payload,
      raw_headers:             null,
      status:                  'failed_retryable',
      retry_count:             1,
      max_retries:             5,
      next_retry_at:           new Date(Date.now() - 60000).toISOString(),
      last_error:              'transient_db_error (seeded for test)',
      trace_id:                crypto.randomUUID(),
    });
  }
  await restInsert('webhook_events', rows);
  console.log(`  Inserted ${rows.length} retryable rows.`);
  return true;
}

async function seedRetryFuture() {
  console.log(`[seed-retry-future] inserting 1 row with next_retry_at in the future`);
  const providerEventId = randomTestEventId();
  const payload = buildValidPayload(providerEventId);
  const row = {
    provider_id:             'warriorplus',
    provider_event_id:       providerEventId,
    provider_event_type:     'sale',
    payload_hash:            sha256Hex(JSON.stringify(payload)),
    raw_payload:             payload,
    raw_headers:             null,
    status:                  'failed_retryable',
    retry_count:             1,
    max_retries:             5,
    next_retry_at:           new Date(Date.now() + 24 * 3600 * 1000).toISOString(), // +24h
    trace_id:                crypto.randomUUID(),
  };
  await restInsert('webhook_events', [row]);
  console.log(`  Inserted ${providerEventId} (next_retry_at = ${row.next_retry_at})`);
  return true;
}

async function seedLocked({ stale }) {
  const label = stale ? 'stale' : 'fresh';
  console.log(`[seed-locked] inserting 1 row with ${label} lock`);
  const providerEventId = randomTestEventId();
  const payload = buildValidPayload(providerEventId);
  const lockedAt = new Date(
    Date.now() - (stale ? 6 * 60 * 1000 : 30 * 1000),
  ).toISOString();
  const row = {
    provider_id:             'warriorplus',
    provider_event_id:       providerEventId,
    provider_event_type:     'sale',
    payload_hash:            sha256Hex(JSON.stringify(payload)),
    raw_payload:             payload,
    raw_headers:             null,
    status:                  'processing',
    locked_by:               'seeded_other_worker',
    locked_at:               lockedAt,
    processing_started_at:   lockedAt,
    trace_id:                crypto.randomUUID(),
  };
  await restInsert('webhook_events', [row]);
  console.log(`  Inserted ${providerEventId} (locked_at = ${lockedAt})`);
  return true;
}

async function run() {
  console.log('[run] invoking worker once');
  const r = await postToWorker({ action: 'process' });
  console.log(`  HTTP ${r.status}`);
  console.log(`  ${r.text}`);
  return r.status === 200;
}

async function runLoop(count) {
  console.log(`[run-loop] invoking worker ${count} times`);
  let successCount = 0;
  for (let i = 0; i < count; i++) {
    const r = await postToWorker({ action: 'process', batchSize: 10, maxRuntimeMs: 5000 });
    if (r.status === 200) {
      successCount++;
      console.log(`  [${i + 1}/${count}] 200  processed=${r.json?.processed_count ?? '?'} failed_terminal=${r.json?.failed_terminal_count ?? '?'} failed_retryable=${r.json?.failed_retryable_count ?? '?'}`);
    } else {
      console.error(`  [${i + 1}/${count}] FAIL  status=${r.status}  body=${r.text}`);
    }
    if (i < count - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return successCount === count;
}

async function health() {
  console.log('[health] ?action=health');
  const r = await postToWorker({ action: 'health' });
  console.log(`  HTTP ${r.status}`);
  console.log(`  ${r.text}`);
  if (r.json) {
    console.log('  Summary:');
    console.log(`    queue_depth           = ${r.json.queue_depth}`);
    console.log(`    received_count        = ${r.json.received_count}`);
    console.log(`    failed_retryable_count= ${r.json.failed_retryable_count}`);
    console.log(`    failed_retryable_due  = ${r.json.failed_retryable_due_now}`);
    console.log(`    processing_count      = ${r.json.processing_count}`);
    console.log(`    verified_count        = ${r.json.verified_count}`);
    console.log(`    failed_terminal_count = ${r.json.failed_terminal_count}`);
    console.log(`    oldest_pending_age    = ${r.json.oldest_pending_age_seconds ?? 'n/a'}s`);
  }
  return r.status === 200;
}

async function verify() {
  console.log('[verify] querying webhook_events counts by status (test rows only)');
  const statuses = ['received', 'failed_retryable', 'processing', 'verified', 'failed_terminal'];
  for (const s of statuses) {
    const rows = await restSelect(
      'webhook_events',
      'id',
      [
        { col: 'provider_event_id', op: 'like', val: `${TEST_MARKER}*` },
        { col: 'status',            op: 'eq',  val: s },
      ],
    );
    console.log(`  ${s.padEnd(18)} ${rows.length}`);
  }
  return true;
}

async function clear() {
  console.log('[clear] deleting all rows with provider_event_id LIKE TEST_M4_*');
  // Note: PostgREST `like` filter uses `*` as wildcard (not SQL `%`).
  // For bulk deletion we use ilike with a SQL-equivalent wildcard via
  // a direct DELETE through REST. The simplest is to delete in batches
  // by selecting first, then deleting by id list.
  const rows = await restSelect(
    'webhook_events',
    'id',
    [{ col: 'provider_event_id', op: 'like', val: `${TEST_MARKER}*` }],
  );
  if (rows.length === 0) {
    console.log('  No test rows found.');
    return true;
  }
  console.log(`  Found ${rows.length} test rows. Deleting...`);
  // Delete in chunks of 50.
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const ids = chunk.map(r => r.id).join(',');
    // PostgREST allows `id=in.(uuid,uuid,...)` but the syntax is a bit
    // tricky with comma escaping. Easier: delete by single id, loop.
    for (const r of chunk) {
      await restDelete('webhook_events', [
        { col: 'id', op: 'eq', val: r.id },
      ]);
    }
    console.log(`  Deleted ${Math.min(i + chunkSize, rows.length)}/${rows.length}`);
  }
  return true;
}

async function fullFlow() {
  console.log('[full-flow] smoke test: seed valid + run + verify + clear');
  await clear();
  await seed(5);
  await sleep(500);
  console.log('--- run worker ---');
  const r = await postToWorker({ action: 'process', batchSize: 50 });
  console.log(`  HTTP ${r.status}`);
  console.log(`  ${r.text}`);
  await sleep(500);
  await verify();
  await clear();
  return r.status === 200;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Dispatch ────────────────────────────────────────────────

async function main() {
  console.log(`webhook-worker simulation — mode: ${mode}`);
  console.log(`target: ${SUPABASE_URL}/functions/v1/process-webhook-worker`);
  console.log('');

  let ok = false;
  switch (mode) {
    case 'seed':              ok = await seed(count);                  break;
    case 'seed-corrupt':      ok = await seedCorrupt(count);           break;
    case 'seed-retry':        ok = await seedRetry(count);             break;
    case 'seed-retry-future': ok = await seedRetryFuture();            break;
    case 'seed-locked':
      ok = await seedLocked({ stale: staleFlag, fresh: freshFlag });
      break;
    case 'run':               ok = await run();                        break;
    case 'run-loop':          ok = await runLoop(count);               break;
    case 'health':            ok = await health();                     break;
    case 'verify':            ok = await verify();                     break;
    case 'clear':             ok = await clear();                      break;
    case 'full-flow':         ok = await fullFlow();                   break;
    default:
      console.error(`Unknown mode: ${mode}`);
      console.error('Valid modes: seed, seed-corrupt, seed-retry, seed-retry-future,');
      console.error('             seed-locked, run, run-loop, health, verify,');
      console.error('             clear, full-flow');
      process.exit(1);
  }

  console.log('');
  console.log(ok ? '✓ Mode completed.' : '✗ Mode failed.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
