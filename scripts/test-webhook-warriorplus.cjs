#!/usr/bin/env node

/**
 * RobinOS — Local Webhook Simulation Script (Milestone 3)
 * =========================================================
 *
 * Sends simulated WarriorPlus IPN requests to a deployed
 * payment-webhook edge function so we can verify the receiver
 * end-to-end without a real WP account.
 *
 * Modes (positional arg, default: valid):
 *
 *   valid                — posts a correctly-formed IPN with a valid
 *                           WP_SECURITYKEY. Expects 200 { received:true, id }
 *
 *   duplicate            — posts the SAME IPN_ID twice. First call
 *                           creates a row; second returns 200 with
 *                           { duplicate:true, id }. Both must succeed.
 *
 *   invalid-sig          — posts with a corrupted WP_SECURITYKEY.
 *                           Expects 401 SIGNATURE_INVALID, no row inserted.
 *
 *   missing-required     — posts a body missing WP_ACTION. Expects
 *                           400 INVALID_PAYLOAD with field=WP_ACTION.
 *
 *   unknown-provider     — posts to /payment-webhook/nonexistent_id.
 *                           Expects 404 PROVIDER_NOT_FOUND.
 *
 *   wrong-content-type   — posts as application/json to the WP
 *                           endpoint. Expects 415 UNSUPPORTED_MEDIA_TYPE.
 *
 *   method-not-allowed   — sends GET. Expects 405.
 *
 *   options-preflight    — sends OPTIONS. Expects 204.
 *
 *   bulk --count N       — posts N unique valid IPNs. Useful for
 *                           stressing the rate limiter (limit=60/min).
 *
 * Environment variables (required):
 *
 *   SUPABASE_URL          — e.g. https://iitfxyasjizlbneevwsa.supabase.co
 *   WP_SHARED_SECRET      — the WP vendor's WP_SECURITYKEY (raw string)
 *                           Must match the secret stored in
 *                           payment_provider_secrets for 'warriorplus'
 *                           under secret_name='ipn_security_key'.
 *
 * Usage:
 *
 *   SUPABASE_URL="..." WP_SHARED_SECRET="..." \
 *     node scripts/test-webhook-warriorplus.cjs valid
 *
 *   SUPABASE_URL="..." WP_SHARED_SECRET="..." \
 *     node scripts/test-webhook-warriorplus.cjs bulk --count 5
 *
 * Exit codes:
 *   0  — every assertion in the chosen mode passed
 *   1  — at least one assertion failed or the request errored
 *
 * What this script does NOT do:
 *   - Provision the payment_provider_secrets row. Run the bootstrap
 *     SQL from .kimchi/docs/milestone-3-rollout-runbook.md first.
 *   - Deploy the edge function. Run `supabase functions deploy
 *     payment-webhook` first.
 *   - Test signature decryption. If 401 SIGNATURE_INVALID with
 *     reason=missing_stored_secret, the secret isn't seeded.
 */

const crypto = require('crypto');

// ── Args ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args[0] || 'valid';
const flagIdx = args.indexOf('--count');
const count = flagIdx !== -1 ? parseInt(args[flagIdx + 1], 10) : 1;

// ── Env ─────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const WP_SHARED_SECRET = process.env.WP_SHARED_SECRET;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL env var is required.');
  process.exit(1);
}
if (!WP_SHARED_SECRET && mode !== 'method-not-allowed'
                     && mode !== 'options-preflight'
                     && mode !== 'unknown-provider'
                     && mode !== 'wrong-content-type') {
  console.error('ERROR: WP_SHARED_SECRET env var is required for this mode.');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────

function randomIpnId() {
  // Mirrors WP IPN_ID shape: alphanumeric, ~24-32 chars.
  return 'ipn_' + crypto.randomBytes(12).toString('hex');
}

function randomTxId() {
  return 'tx_' + crypto.randomBytes(10).toString('hex');
}

function buildFormBody(fields) {
  const enc = encodeURIComponent;
  return Object.entries(fields)
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
}

function buildValidIpn({ ipnId, txId, securityKey, itemNumber, action }) {
  return buildFormBody({
    WP_ACTION:           action  ?? 'sale',
    IPN_ID:              ipnId   ?? randomIpnId(),
    WP_SALE:             txId    ?? randomTxId(),
    WP_TXNID:            txId    ?? randomTxId(),
    WP_ITEM_NUMBER:      itemNumber ?? 'wp_test_item_001',
    WP_SECURITYKEY:      securityKey ?? WP_SHARED_SECRET,
    WP_BUYER_EMAIL:      'test-buyer@example.com',
    WP_BUYER_NAME:       'Test Buyer',
    WP_SALE_AMOUNT:      '39.00',
    WP_SALE_CURRENCY:    'USD',
    WP_PAYMENT_STATUS:   'Completed',
    IPN_RCPT_TYPE:       'vend',
    IPN_DATE:            new Date().toISOString(),
    WP_ITEM_NAME:        'RobinOS Test Product',
  });
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

function assertContains(obj, key, label) {
  if (!(key in obj)) {
    console.error(`  ✗ ${label}: missing key "${key}" in ${JSON.stringify(obj)}`);
    return false;
  }
  console.log(`  ✓ ${label} (=${JSON.stringify(obj[key])})`);
  return true;
}

async function postToWebhook({ path, body, contentType, method }) {
  const url = `${SUPABASE_URL}/functions/v1/payment-webhook/${path}`;
  const init = {
    method: method ?? 'POST',
    headers: {
      'Content-Type': contentType ?? 'application/x-www-form-urlencoded',
      'User-Agent': 'WarriorPlus.com',
      'X-Forwarded-For': '203.0.113.42',
    },
  };
  if (body !== undefined && body !== null) {
    init.body = body;
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: resp.status, text, json, headers: resp.headers };
}

// ── Modes ───────────────────────────────────────────────────

async function runValid() {
  const ipnId = randomIpnId();
  console.log(`[valid] ipn_id=${ipnId}`);
  const body = buildValidIpn({ ipnId });
  const r = await postToWebhook({ path: 'warriorplus', body });
  console.log(`  HTTP ${r.status}`);
  console.log(`  ${r.text}`);
  let ok = true;
  ok = assertEq(r.status, 200, 'status == 200') && ok;
  if (r.json) {
    ok = assertEq(r.json.received, true, 'body.received == true') && ok;
    ok = assertContains(r.json, 'id', 'body has id') && ok;
    ok = assertEq(r.json.duplicate, undefined, 'body.duplicate is absent (new event)') && ok;
  } else {
    console.error('  ✗ response is not JSON');
    ok = false;
  }
  return ok;
}

async function runDuplicate() {
  const ipnId = randomIpnId();
  console.log(`[duplicate] ipn_id=${ipnId}`);

  console.log('  -- first delivery --');
  const r1 = await postToWebhook({ path: 'warriorplus', body: buildValidIpn({ ipnId }) });
  console.log(`  HTTP ${r1.status} ${r1.text}`);
  let ok = true;
  ok = assertEq(r1.status, 200, 'first status == 200') && ok;
  if (!r1.json || r1.json.received !== true || r1.json.duplicate) {
    console.error('  ✗ first call did not create a new row');
    ok = false;
    return ok;
  }
  const id1 = r1.json.id;

  console.log('  -- second delivery (same IPN_ID) --');
  const r2 = await postToWebhook({ path: 'warriorplus', body: buildValidIpn({ ipnId }) });
  console.log(`  HTTP ${r2.status} ${r2.text}`);
  ok = assertEq(r2.status, 200, 'second status == 200') && ok;
  if (r2.json) {
    ok = assertEq(r2.json.received, true, 'second body.received == true') && ok;
    ok = assertEq(r2.json.duplicate, true, 'second body.duplicate == true') && ok;
    ok = assertEq(r2.json.id, id1, 'second body.id matches first id (same row)') && ok;
  } else {
    ok = false;
  }
  return ok;
}

async function runInvalidSig() {
  const ipnId = randomIpnId();
  console.log(`[invalid-sig] ipn_id=${ipnId}`);
  const body = buildValidIpn({ ipnId, securityKey: 'this-is-not-the-real-secret' });
  const r = await postToWebhook({ path: 'warriorplus', body });
  console.log(`  HTTP ${r.status} ${r.text}`);
  let ok = true;
  ok = assertEq(r.status, 401, 'status == 401') && ok;
  if (r.json) {
    ok = assertEq(r.json.code, 'SIGNATURE_INVALID', 'body.code == SIGNATURE_INVALID') && ok;
    ok = assertEq(r.json.received, false, 'body.received == false') && ok;
  } else {
    ok = false;
  }
  return ok;
}

async function runMissingRequired() {
  const ipnId = randomIpnId();
  console.log(`[missing-required] ipn_id=${ipnId}`);
  const body = buildFormBody({
    IPN_ID:             ipnId,
    WP_ITEM_NUMBER:     'wp_test_item_001',
    WP_SECURITYKEY:     WP_SHARED_SECRET,
    WP_SALE_AMOUNT:     '39.00',
    WP_SALE_CURRENCY:   'USD',
    WP_PAYMENT_STATUS:  'Completed',
    // WP_ACTION intentionally omitted
  });
  const r = await postToWebhook({ path: 'warriorplus', body });
  console.log(`  HTTP ${r.status} ${r.text}`);
  let ok = true;
  ok = assertEq(r.status, 400, 'status == 400') && ok;
  if (r.json) {
    ok = assertEq(r.json.code, 'INVALID_PAYLOAD', 'body.code == INVALID_PAYLOAD') && ok;
    ok = assertEq(r.json.field, 'WP_ACTION', 'body.field == WP_ACTION') && ok;
  } else {
    ok = false;
  }
  return ok;
}

async function runUnknownProvider() {
  console.log('[unknown-provider] path=nonexistent_id');
  const body = buildValidIpn({ ipnId: randomIpnId() });
  const r = await postToWebhook({ path: 'nonexistent_id', body });
  console.log(`  HTTP ${r.status} ${r.text}`);
  let ok = true;
  ok = assertEq(r.status, 404, 'status == 404') && ok;
  if (r.json) {
    ok = assertEq(r.json.code, 'PROVIDER_NOT_FOUND', 'body.code == PROVIDER_NOT_FOUND') && ok;
  } else {
    ok = false;
  }
  return ok;
}

async function runWrongContentType() {
  const ipnId = randomIpnId();
  console.log(`[wrong-content-type] ipn_id=${ipnId}`);
  const json = JSON.stringify({ WP_ACTION: 'sale', IPN_ID: ipnId });
  const r = await postToWebhook({
    path: 'warriorplus',
    body: json,
    contentType: 'application/json',
  });
  console.log(`  HTTP ${r.status} ${r.text}`);
  let ok = true;
  ok = assertEq(r.status, 415, 'status == 415') && ok;
  if (r.json) {
    ok = assertEq(r.json.code, 'UNSUPPORTED_MEDIA_TYPE', 'body.code == UNSUPPORTED_MEDIA_TYPE') && ok;
  } else {
    ok = false;
  }
  return ok;
}

async function runMethodNotAllowed() {
  console.log('[method-not-allowed] GET /payment-webhook/warriorplus');
  const r = await postToWebhook({
    path: 'warriorplus',
    method: 'GET',
  });
  console.log(`  HTTP ${r.status}`);
  let ok = true;
  ok = assertEq(r.status, 405, 'status == 405') && ok;
  ok = assertEq(r.headers.get('allow'), 'POST, OPTIONS', 'Allow header == POST, OPTIONS') && ok;
  return ok;
}

async function runOptionsPreflight() {
  console.log('[options-preflight] OPTIONS /payment-webhook/warriorplus');
  const r = await postToWebhook({
    path: 'warriorplus',
    method: 'OPTIONS',
  });
  console.log(`  HTTP ${r.status}`);
  let ok = true;
  ok = assertEq(r.status, 204, 'status == 204') && ok;
  return ok;
}

async function runBulk() {
  console.log(`[bulk] posting ${count} unique valid IPNs`);
  let successCount = 0;
  for (let i = 0; i < count; i++) {
    const ipnId = randomIpnId();
    const body = buildValidIpn({ ipnId });
    const r = await postToWebhook({ path: 'warriorplus', body });
    if (r.status === 200 && r.json && r.json.received === true && !r.json.duplicate) {
      successCount++;
      console.log(`  [${i + 1}/${count}] 200  id=${r.json.id}`);
    } else {
      console.error(`  [${i + 1}/${count}] FAIL  status=${r.status}  body=${r.text}`);
    }
  }
  const ok = successCount === count;
  console.log(`  Result: ${successCount}/${count} succeeded`);
  return ok;
}

// ── Dispatch ────────────────────────────────────────────────

async function main() {
  console.log(`payment-webhook simulation — mode: ${mode}`);
  console.log(`target: ${SUPABASE_URL}/functions/v1/payment-webhook/warriorplus`);
  console.log('');

  let ok = false;
  switch (mode) {
    case 'valid':              ok = await runValid();              break;
    case 'duplicate':          ok = await runDuplicate();          break;
    case 'invalid-sig':        ok = await runInvalidSig();         break;
    case 'missing-required':   ok = await runMissingRequired();    break;
    case 'unknown-provider':   ok = await runUnknownProvider();    break;
    case 'wrong-content-type': ok = await runWrongContentType();   break;
    case 'method-not-allowed': ok = await runMethodNotAllowed();   break;
    case 'options-preflight':  ok = await runOptionsPreflight();   break;
    case 'bulk':               ok = await runBulk();               break;
    default:
      console.error(`Unknown mode: ${mode}`);
      console.error('Valid modes: valid, duplicate, invalid-sig, missing-required,');
      console.error('             unknown-provider, wrong-content-type,');
      console.error('             method-not-allowed, options-preflight, bulk');
      process.exit(1);
  }

  console.log('');
  console.log(ok ? '✓ All assertions passed.' : '✗ One or more assertions failed.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
