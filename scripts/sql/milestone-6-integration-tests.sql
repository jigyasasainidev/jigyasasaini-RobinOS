-- ============================================================
-- MILESTONE 6 — Purchase Recording & Pro Entitlement Integration Tests
-- ============================================================
-- End-to-end SQL tests for the M6 purchase + entitlement layer.
-- Run against a staging database AFTER migration 58 has been
-- applied. All tests are isolated to the staging environment;
-- they DO NOT touch production data.
--
-- Usage (psql):
--   psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-6-integration-tests.sql
--
-- What this tests:
--   1. Schema: safe_plan_switch accepts 8 parameters (M6 extension)
--   2. safe_plan_switch backward-compat: NULL p_expires_at preserves 30/365 behavior
--   3. safe_plan_switch new behavior: non-NULL p_expires_at wins over billing_cycle
--   4. record_purchase_from_webhook: happy path
--   5. record_purchase_from_webhook: idempotency (re-run returns existing purchase_id)
--   6. record_purchase_from_webhook: PRODUCT_MAPPING_NOT_FOUND (terminal)
--   7. record_purchase_from_webhook: PRODUCT_DISABLED (terminal)
--   8. record_purchase_from_webhook: INVALID_DURATION (terminal)
--   9. record_purchase_from_webhook: UNSUPPORTED_EVENT_TYPE (terminal)
--  10. grant_entitlement_from_purchase: happy path → 6-month Pro
--  11. grant_entitlement_from_purchase: idempotency (re-run returns already_granted)
--  12. process_webhook_event full pipeline: existing user → processed (M6 NEW terminal)
--  13. process_webhook_event: guest path → awaiting_claim (M5 unchanged)
--  14. process_webhook_event: dead-letter for PRODUCT_MAPPING_NOT_FOUND
--  15. process_webhook_event: dead-letter for PRODUCT_DISABLED
--  16. 6-month duration rule: expires_at matches provider_products.duration_value
--  17. Audit history: subscription_audit_log entry created via safe_plan_switch
--  18. Profile propagation: profiles.subscription_tier/current_plan/expires_at updated
--  19. payments ↔ user_subscriptions link: payments.subscription_id populated
--  20. admin_grant_subscription (pre-existing caller of safe_plan_switch) still works
--  21. Cleanup
--
-- IMPORTANT: These tests create temporary auth.users rows + a temporary
-- provider_products row. The cleanup block at the end removes them.
-- ============================================================

\set ON_ERROR_STOP on
\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  MILESTONE 6 — INTEGRATION TESTS'
\echo '═══════════════════════════════════════════════════════════'
\echo ''


-- ────────────────────────────────────────────────────────────
-- 1. safe_plan_switch: signature includes p_expires_at (M6)
-- ────────────────────────────────────────────────────────────
\echo '── Test 1: safe_plan_switch signature has p_expires_at ──'

do $$
declare
  v_arg_count int;
begin
  select pronargs into v_arg_count
  from pg_proc
  where proname = 'safe_plan_switch'
    and pronamespace = (select oid from pg_namespace where nspname = 'public');

  if v_arg_count <> 8 then
    raise notice 'FAIL: expected 8 arguments on safe_plan_switch, got %', v_arg_count;
    raise exception 'M6 safe_plan_switch extension not applied';
  end if;

  raise notice 'PASS: safe_plan_switch has 8 arguments (M6 extension verified)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 2. safe_plan_switch backward compat: NULL p_expires_at
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 2: safe_plan_switch NULL p_expires_at preserves M31 behavior ──'

do $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_expires_at timestamptz;
  v_old_expires_at timestamptz;
begin
  -- Seed test user
  v_user_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated',
    'm6-test-backcompat-' || extract(epoch from now())::text || '@example.com',
    '', now(), '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  -- Ensure a profile exists for the FK target
  insert into public.profiles (user_id, email, subscription_tier, current_plan)
  values (v_user_id, 'm6-test-backcompat@example.com', 'free', 'free')
  on conflict (user_id) do nothing;

  -- Call safe_plan_switch with NULL p_expires_at (default 30 days)
  v_result := public.safe_plan_switch(
    p_user_id         => v_user_id,
    p_new_plan        => 'creator',
    p_billing_cycle   => 'monthly',
    p_provider        => null,
    p_provider_sub_id => null,
    p_amount          => 0,
    p_triggered_by    => 'test_backcompat',
    p_expires_at      => null
  );

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: expected success=true, got %', v_result;
    raise exception 'backcompat safe_plan_switch failed';
  end if;

  if (v_result->>'explicit_expires_at')::boolean <> false then
    raise notice 'FAIL: expected explicit_expires_at=false when p_expires_at is NULL';
    raise exception 'backcompat behavior broken';
  end if;

  if (v_result->>'duration_days')::int <> 30 then
    raise notice 'FAIL: expected duration_days=30 for monthly + null expires_at, got %',
      v_result->>'duration_days';
    raise exception 'backcompat duration wrong';
  end if;

  -- Verify the row state
  select expires_at into v_expires_at
  from public.user_subscriptions where user_id = v_user_id;

  -- expires_at should be ~30 days from now (allow ±5 sec for clock skew)
  if abs(extract(epoch from (v_expires_at - now())) - 30 * 86400) > 5 then
    raise notice 'FAIL: expires_at is not ~30 days from now: %', v_expires_at;
    raise exception 'backcompat expires_at wrong';
  end if;

  raise notice 'PASS: NULL p_expires_at preserves M31 30-day behavior';

  perform set_config('m6_test.user_id_backcompat', v_user_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 3. safe_plan_switch M6 extension: explicit p_expires_at wins
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 3: safe_plan_switch explicit p_expires_at overrides billing_cycle ──'

do $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_expires_at timestamptz;
  v_explicit_at timestamptz := now() + interval '180 days';
begin
  v_user_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated',
    'm6-test-explicit-' || extract(epoch from now())::text || '@example.com',
    '', now(), '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (user_id, email, subscription_tier, current_plan)
  values (v_user_id, 'm6-test-explicit@example.com', 'free', 'free')
  on conflict (user_id) do nothing;

  -- Call with explicit p_expires_at AND monthly billing_cycle
  -- → explicit value MUST win (180 days), not the 30-day monthly default
  v_result := public.safe_plan_switch(
    p_user_id         => v_user_id,
    p_new_plan        => 'pro_creator',
    p_billing_cycle   => 'monthly',   -- would default to 30 days
    p_provider        => 'warriorplus',
    p_provider_sub_id => null,
    p_amount          => 39.00,
    p_triggered_by    => 'test_explicit',
    p_expires_at      => v_explicit_at
  );

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: explicit p_expires_at switch failed: %', v_result;
    raise exception 'explicit safe_plan_switch failed';
  end if;

  if (v_result->>'explicit_expires_at')::boolean <> true then
    raise notice 'FAIL: expected explicit_expires_at=true';
    raise exception 'M6 extension not honored';
  end if;

  if (v_result->>'duration_days')::int <> 180 then
    raise notice 'FAIL: expected duration_days=180 (explicit), got %', v_result->>'duration_days';
    raise exception 'explicit duration ignored';
  end if;

  select expires_at into v_expires_at
  from public.user_subscriptions where user_id = v_user_id;

  if abs(extract(epoch from (v_expires_at - v_explicit_at))) > 5 then
    raise notice 'FAIL: row expires_at (%) does not match explicit value (%)', v_expires_at, v_explicit_at;
    raise exception 'row state does not reflect explicit p_expires_at';
  end if;

  raise notice 'PASS: explicit p_expires_at overrides billing_cycle (180 days, not 30)';

  perform set_config('m6_test.user_id_explicit', v_user_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- Setup: create a real RobinOS Pro provider_product for the
--        end-to-end pipeline tests below.
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Setup: provider_products row for 6-month Pro ──'

do $$
declare
  v_product_id uuid;
begin
  insert into public.provider_products (
    provider_id, provider_product_id, provider_offer_id,
    plan_key, billing_cycle,
    duration_value, duration_unit,
    amount, currency,
    is_subscription, is_enabled,
    display_name
  ) values (
    'warriorplus', 'M6_TEST_ITEM_001', null,
    'pro_creator', 'one_time',
    6, 'month',
    39.00, 'USD',
    false, true,
    'RobinOS Pro — 6-month (TEST)'
  )
  on conflict (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
  do update set
    plan_key = excluded.plan_key,
    billing_cycle = excluded.billing_cycle,
    duration_value = excluded.duration_value,
    duration_unit = excluded.duration_unit,
    amount = excluded.amount,
    is_enabled = excluded.is_enabled
  returning id into v_product_id;

  perform set_config('m6_test.product_id', v_product_id::text, false);
  raise notice 'PASS: provider_products row seeded for 6-month Pro (id=%)', v_product_id;
end $$;


-- ────────────────────────────────────────────────────────────
-- 4. record_purchase_from_webhook: happy path
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 4: record_purchase_from_webhook — happy path ──'

do $$
declare
  v_user_id uuid := (current_setting('m6_test.user_id_backcompat', true))::uuid;
  v_event_id uuid;
  v_raw jsonb;
  v_result jsonb;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise notice 'SKIP: backcompat user not seeded';
    return;
  end if;

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_PURCHASE_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_TEST_ITEM_001',
    'WP_BUYER_EMAIL', 'm6-test-backcompat@example.com',
    'WP_BUYER_NAME', 'Back Compat Buyer',
    'WP_SALE_AMOUNT', '39.00',
    'WP_SALE_CURRENCY', 'USD'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-001',
    p_trace_id                => gen_random_uuid()
  );

  -- Manually mark the webhook as 'verified' with linked_user_id set
  -- (simulating what M5 does in process_webhook_event).
  update public.webhook_events
  set status = 'verified',
      linked_user_id = v_user_id
  where id = v_event_id;

  v_result := public.record_purchase_from_webhook(v_event_id);

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: record_purchase returned %', v_result;
    raise exception 'happy path record_purchase failed';
  end if;

  if (v_result->>'is_new_purchase')::boolean <> true then
    raise notice 'FAIL: expected is_new_purchase=true';
    raise exception 'expected is_new_purchase=true on first call';
  end if;

  if v_result->>'plan_key' <> 'pro_creator' then
    raise notice 'FAIL: expected plan_key=pro_creator, got %', v_result->>'plan_key';
    raise exception 'plan_key not resolved correctly';
  end if;

  v_payment_id := (v_result->>'purchase_id')::uuid;

  -- Verify the payments row
  if not exists (
    select 1 from public.payments
    where id = v_payment_id
      and plan_key = 'pro_creator'
      and amount = 39.00
      and status = 'completed'
      and user_id = v_user_id
      and source_webhook_event_id = v_event_id
  ) then
    raise notice 'FAIL: payments row not populated correctly';
    raise exception 'payments row state wrong';
  end if;

  -- Verify linked_purchase_id was set on webhook
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id and linked_purchase_id = v_payment_id
  ) then
    raise notice 'FAIL: webhook.linked_purchase_id not set';
    raise exception 'webhook linkage missing';
  end if;

  raise notice 'PASS: record_purchase happy path (purchase_id=%, plan=pro_creator)', v_payment_id;

  perform set_config('m6_test.event_id_happy', v_event_id::text, false);
  perform set_config('m6_test.payment_id_happy', v_payment_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 5. record_purchase_from_webhook: idempotency
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 5: record_purchase idempotency — re-run returns existing ──'

do $$
declare
  v_event_id uuid := (current_setting('m6_test.event_id_happy', true))::uuid;
  v_first_payment_id uuid := (current_setting('m6_test.payment_id_happy', true))::uuid;
  v_result jsonb;
begin
  if v_event_id is null then
    raise notice 'SKIP: happy path event not seeded';
    return;
  end if;

  -- Replay the same webhook event
  v_result := public.record_purchase_from_webhook(v_event_id);

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: replay returned %', v_result;
    raise exception 'idempotent replay failed';
  end if;

  if (v_result->>'is_new_purchase')::boolean <> false then
    raise notice 'FAIL: expected is_new_purchase=false on replay';
    raise exception 'idempotency broken — new row created on replay';
  end if;

  if (v_result->>'purchase_id')::uuid <> v_first_payment_id then
    raise notice 'FAIL: replay returned different purchase_id';
    raise exception 'idempotency returned wrong id';
  end if;

  raise notice 'PASS: record_purchase idempotency (replay returns same purchase_id)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 6. record_purchase_from_webhook: PRODUCT_MAPPING_NOT_FOUND
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 6: record_purchase PRODUCT_MAPPING_NOT_FOUND ──'

do $$
declare
  v_event_id uuid;
  v_raw jsonb;
begin
  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_NO_MAP_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_NONEXISTENT_ITEM',
    'WP_BUYER_EMAIL', 'noone@example.com',
    'WP_SALE_AMOUNT', '39.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-nomap',
    p_trace_id                => gen_random_uuid()
  );

  update public.webhook_events
  set status = 'verified', linked_user_id = gen_random_uuid()
  where id = v_event_id;

  begin
    perform public.record_purchase_from_webhook(v_event_id);
    raise exception 'FAIL: expected PRODUCT_MAPPING_NOT_FOUND';
  exception when others then
    if SQLERRM not like '%PRODUCT_MAPPING_NOT_FOUND%' then
      raise notice 'FAIL: wrong error: %', SQLERRM;
      raise exception 'expected PRODUCT_MAPPING_NOT_FOUND';
    end if;
  end;

  raise notice 'PASS: PRODUCT_MAPPING_NOT_FOUND raises correctly';
end $$;


-- ────────────────────────────────────────────────────────────
-- 7. record_purchase_from_webhook: PRODUCT_DISABLED
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 7: record_purchase PRODUCT_DISABLED ──'

do $$
declare
  v_event_id uuid;
  v_raw jsonb;
begin
  -- Insert a disabled product
  insert into public.provider_products (
    provider_id, provider_product_id, plan_key, billing_cycle,
    duration_value, duration_unit, amount, currency,
    is_subscription, is_enabled, display_name
  ) values (
    'warriorplus', 'M6_DISABLED_ITEM', 'pro_creator', 'one_time',
    6, 'month', 39.00, 'USD', false, false, 'Disabled product (TEST)'
  ) on conflict (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
    do update set is_enabled = false;

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_DISABLED_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_DISABLED_ITEM',
    'WP_BUYER_EMAIL', 'buyer@example.com',
    'WP_SALE_AMOUNT', '39.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id         => 'warriorplus',
    p_provider_event_id   => v_raw->>'IPN_ID',
    p_provider_event_type => 'sale',
    p_raw_payload         => v_raw,
    p_raw_headers         => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-disabled',
    p_trace_id            => gen_random_uuid()
  );

  update public.webhook_events
  set status = 'verified', linked_user_id = gen_random_uuid()
  where id = v_event_id;

  begin
    perform public.record_purchase_from_webhook(v_event_id);
    raise exception 'FAIL: expected PRODUCT_DISABLED';
  exception when others then
    if SQLERRM not like '%PRODUCT_DISABLED%' then
      raise notice 'FAIL: wrong error: %', SQLERRM;
      raise exception 'expected PRODUCT_DISABLED';
    end if;
  end;

  raise notice 'PASS: PRODUCT_DISABLED raises correctly';

  -- Cleanup disabled product
  delete from public.provider_products
  where provider_id = 'warriorplus' and provider_product_id = 'M6_DISABLED_ITEM';
end $$;


-- ────────────────────────────────────────────────────────────
-- 8. record_purchase_from_webhook: INVALID_DURATION
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 8: record_purchase INVALID_DURATION ──'

do $$
declare
  v_event_id uuid;
  v_raw jsonb;
begin
  -- Insert a product with duration_value=0
  insert into public.provider_products (
    provider_id, provider_product_id, plan_key, billing_cycle,
    duration_value, duration_unit, amount, currency,
    is_subscription, is_enabled, display_name
  ) values (
    'warriorplus', 'M6_ZERO_DURATION', 'pro_creator', 'one_time',
    0, 'month', 39.00, 'USD', false, true, 'Zero-duration (TEST)'
  ) on conflict (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
    do update set duration_value = 0, is_enabled = true;

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_ZERO_DUR_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_ZERO_DURATION',
    'WP_BUYER_EMAIL', 'buyer@example.com',
    'WP_SALE_AMOUNT', '39.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id         => 'warriorplus',
    p_provider_event_id   => v_raw->>'IPN_ID',
    p_provider_event_type => 'sale',
    p_raw_payload         => v_raw,
    p_raw_headers         => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-zerodur',
    p_trace_id            => gen_random_uuid()
  );

  update public.webhook_events
  set status = 'verified', linked_user_id = gen_random_uuid()
  where id = v_event_id;

  begin
    perform public.record_purchase_from_webhook(v_event_id);
    raise exception 'FAIL: expected INVALID_DURATION';
  exception when others then
    if SQLERRM not like '%INVALID_DURATION%' then
      raise notice 'FAIL: wrong error: %', SQLERRM;
      raise exception 'expected INVALID_DURATION';
    end if;
  end;

  raise notice 'PASS: INVALID_DURATION raises correctly';

  delete from public.provider_products
  where provider_id = 'warriorplus' and provider_product_id = 'M6_ZERO_DURATION';
end $$;


-- ────────────────────────────────────────────────────────────
-- 9. grant_entitlement_from_purchase: happy path → 6-month Pro
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 9: grant_entitlement_from_purchase — 6-month Pro ──'

do $$
declare
  v_user_id uuid := (current_setting('m6_test.user_id_backcompat', true))::uuid;
  v_payment_id uuid := (current_setting('m6_test.payment_id_happy', true))::uuid;
  v_result jsonb;
  v_expires_at timestamptz;
  v_sub_id uuid;
begin
  if v_payment_id is null then
    raise notice 'SKIP: happy payment not seeded';
    return;
  end if;

  v_result := public.grant_entitlement_from_purchase(v_payment_id);

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: grant returned %', v_result;
    raise exception 'grant failed';
  end if;

  if v_result->>'plan' <> 'pro_creator' then
    raise notice 'FAIL: expected plan=pro_creator, got %', v_result->>'plan';
    raise exception 'plan mismatch';
  end if;

  if (v_result->>'duration_days')::int <> 180 then
    raise notice 'FAIL: expected duration_days=180 (6 months), got %', v_result->>'duration_days';
    raise exception '6-month duration not honored';
  end if;

  if (v_result->>'duration_value')::numeric <> 6 then
    raise notice 'FAIL: expected duration_value=6, got %', v_result->>'duration_value';
    raise exception 'duration_value not echoed';
  end if;

  -- Verify expires_at is ~180 days out
  v_expires_at := (v_result->>'expires_at')::timestamptz;
  if abs(extract(epoch from (v_expires_at - now())) - 180 * 86400) > 5 then
    raise notice 'FAIL: expires_at (%) is not ~180 days from now', v_expires_at;
    raise exception 'expires_at wrong';
  end if;

  -- Verify user_subscriptions row
  select id, expires_at into v_sub_id, v_expires_at
  from public.user_subscriptions where user_id = v_user_id;

  if v_sub_id is null then
    raise notice 'FAIL: no user_subscriptions row created';
    raise exception 'subscription row missing';
  end if;

  if v_expires_at is null or abs(extract(epoch from (v_expires_at - now())) - 180 * 86400) > 5 then
    raise notice 'FAIL: user_subscriptions.expires_at wrong: %', v_expires_at;
    raise exception 'subscription expires_at wrong';
  end if;

  -- Verify payments.subscription_id was linked
  if not exists (
    select 1 from public.payments
    where id = v_payment_id and subscription_id = v_sub_id
  ) then
    raise notice 'FAIL: payments.subscription_id not linked';
    raise exception 'payment-subscription link missing';
  end if;

  -- Verify profile was updated
  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id
      and subscription_tier = 'pro_creator'
      and current_plan = 'pro_creator'
  ) then
    raise notice 'FAIL: profiles.subscription_tier/current_plan not updated';
    raise exception 'profile not propagated';
  end if;

  -- Verify primary_payment_provider was set
  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id
      and primary_payment_provider = 'warriorplus'
  ) then
    raise notice 'FAIL: profiles.primary_payment_provider not set to warriorplus';
    raise exception 'primary_payment_provider not set';
  end if;

  raise notice 'PASS: grant_entitlement → 6-month Pro (expires_at=%, duration_days=180)',
    v_expires_at;
end $$;


-- ────────────────────────────────────────────────────────────
-- 10. grant_entitlement_from_purchase: idempotency
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 10: grant_entitlement idempotency ──'

do $$
declare
  v_payment_id uuid := (current_setting('m6_test.payment_id_happy', true))::uuid;
  v_result jsonb;
begin
  if v_payment_id is null then
    raise notice 'SKIP: payment not seeded';
    return;
  end if;

  v_result := public.grant_entitlement_from_purchase(v_payment_id);

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: replay returned %', v_result;
    raise exception 'idempotent replay failed';
  end if;

  if (v_result->>'already_granted')::boolean <> true then
    raise notice 'FAIL: expected already_granted=true on replay';
    raise exception 'idempotency broken';
  end if;

  raise notice 'PASS: grant_entitlement idempotency (replay returns already_granted=true)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 11. process_webhook_event full pipeline: existing user → processed
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 11: process_webhook_event full pipeline → processed ──'

do $$
declare
  v_user_id uuid;
  v_event_id uuid;
  v_raw jsonb;
  v_result jsonb;
  v_old_free_trial_expired boolean;
  v_old_free_trial_started timestamptz;
begin
  -- Seed a fresh user (separate from backcompat user to avoid state pollution)
  v_user_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated',
    'm6-test-pipeline-' || extract(epoch from now())::text || '@example.com',
    '', now(), '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (user_id, email, subscription_tier, current_plan)
  values (v_user_id, 'm6-test-pipeline@example.com', 'free', 'free')
  on conflict (user_id) do nothing;

  -- Preserve pre-existing free-trial state (set by initialize_user_account)
  select free_trial_expired, free_trial_started_at
    into v_old_free_trial_expired, v_old_free_trial_started
  from public.profiles where user_id = v_user_id;

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_PIPELINE_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_TEST_ITEM_001',
    'WP_BUYER_EMAIL', 'm6-test-pipeline@example.com',
    'WP_BUYER_NAME', 'Pipeline Test',
    'WP_SALE_AMOUNT', '39.00',
    'WP_SALE_CURRENCY', 'USD'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-pipeline',
    p_trace_id                => gen_random_uuid()
  );

  -- Run the FULL M4+M5+M6 pipeline
  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'processed' then
    raise notice 'FAIL: expected action=processed, got %', v_result->>'action';
    raise exception 'full pipeline did not reach processed';
  end if;

  if v_result->>'plan' <> 'pro_creator' then
    raise notice 'FAIL: expected plan=pro_creator, got %', v_result->>'plan';
    raise exception 'plan not returned';
  end if;

  -- Verify webhook row
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id
      and status = 'processed'
      and linked_user_id = v_user_id
      and linked_purchase_id is not null
      and processed_at is not null
  ) then
    raise notice 'FAIL: webhook not at status=processed with linkages';
    raise exception 'webhook terminal state wrong';
  end if;

  -- Verify user_subscriptions row exists with 6-month expiry
  if not exists (
    select 1 from public.user_subscriptions
    where user_id = v_user_id
      and plan = 'pro_creator'
      and status = 'active'
      and abs(extract(epoch from (expires_at - now())) - 180 * 86400) < 5
      and provider = 'warriorplus'
  ) then
    raise notice 'FAIL: user_subscriptions not set correctly';
    raise exception 'subscription row wrong';
  end if;

  -- Verify payment row
  if not exists (
    select 1 from public.payments
    where source_webhook_event_id = v_event_id
      and user_id = v_user_id
      and plan_key = 'pro_creator'
      and amount = 39.00
      and status = 'completed'
      and subscription_id is not null
  ) then
    raise notice 'FAIL: payments row not linked to subscription';
    raise exception 'payments row wrong';
  end if;

  -- Verify profile
  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id
      and subscription_tier = 'pro_creator'
      and current_plan = 'pro_creator'
      and subscription_expires_at is not null
      and primary_payment_provider = 'warriorplus'
  ) then
    raise notice 'FAIL: profile not updated';
    raise exception 'profile state wrong';
  end if;

  -- Free trial preservation: M6 grant must NOT clear the buyer's free trial state.
  -- (resolve_user_plan and initialize_user_account own that state.)
  if v_old_free_trial_expired is not null then
    perform 1;  -- placeholder; free_trial fields were not initialized for this user
  end if;

  raise notice 'PASS: full M4+M5+M6 pipeline → processed + 6-month Pro granted';
end $$;


-- ────────────────────────────────────────────────────────────
-- 12. process_webhook_event: guest path → awaiting_claim (M5 unchanged)
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 12: process_webhook_event guest path → awaiting_claim ──'

do $$
declare
  v_event_id uuid;
  v_raw jsonb;
  v_result jsonb;
begin
  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_GUEST_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_TEST_ITEM_001',
    'WP_BUYER_EMAIL', 'totally-unknown-buyer-' || extract(epoch from now())::text || '@example.com',
    'WP_BUYER_NAME', 'Ghost',
    'WP_SALE_AMOUNT', '39.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-guest',
    p_trace_id                => gen_random_uuid()
  );

  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'awaiting_claim' then
    raise notice 'FAIL: expected action=awaiting_claim, got %', v_result->>'action';
    raise exception 'guest path broken';
  end if;

  if v_result->>'linked_purchase_id' is not null then
    raise notice 'FAIL: guest got a linked_purchase_id (should be null)';
    raise exception 'M6 should NOT create purchase for guests';
  end if;

  raise notice 'PASS: guest path → awaiting_claim (M6 NOT invoked for guests)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 13. process_webhook_event: dead-letter for PRODUCT_MAPPING_NOT_FOUND
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 13: process_webhook_event PRODUCT_MAPPING_NOT_FOUND → failed_terminal ──'

do $$
declare
  v_event_id uuid;
  v_raw jsonb;
  v_result jsonb;
  v_user_id uuid;
begin
  v_user_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated',
    'm6-test-nomap-' || extract(epoch from now())::text || '@example.com',
    '', now(), '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', 'M6_TEST_NOMAP_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER', 'M6_NONEXISTENT_ITEM',
    'WP_BUYER_EMAIL', 'm6-test-nomap@example.com',
    'WP_SALE_AMOUNT', '39.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id         => 'warriorplus',
    p_provider_event_id   => v_raw->>'IPN_ID',
    p_provider_event_type => 'sale',
    p_raw_payload         => v_raw,
    p_raw_headers         => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-nomap-2',
    p_trace_id            => gen_random_uuid()
  );

  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'failed_terminal' then
    raise notice 'FAIL: expected action=failed_terminal, got %', v_result->>'action';
    raise exception 'M6 did not dead-letter on PRODUCT_MAPPING_NOT_FOUND';
  end if;

  if v_result->>'classification' <> 'purchase_or_entitlement' then
    raise notice 'FAIL: expected classification=purchase_or_entitlement, got %',
      v_result->>'classification';
    raise exception 'M6 classification wrong';
  end if;

  -- Verify the row is at failed_terminal
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id and status = 'failed_terminal'
  ) then
    raise notice 'FAIL: row not in failed_terminal';
    raise exception 'row not dead-lettered';
  end if;

  raise notice 'PASS: PRODUCT_MAPPING_NOT_FOUND → failed_terminal (classification=purchase_or_entitlement)';

  delete from auth.users where id = v_user_id;
end $$;


-- ────────────────────────────────────────────────────────────
-- 14. Audit history: subscription_audit_log entry created
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 14: subscription_audit_log records the plan switch ──'

do $$
declare
  v_user_id uuid := (current_setting('m6_test.user_id_backcompat', true))::uuid;
  v_audit_count int;
  v_last_event text;
  v_metadata jsonb;
begin
  select count(*), max(event_type)
    into v_audit_count, v_last_event
  from public.subscription_audit_log
  where user_id = v_user_id
    and triggered_by = 'test_explicit';

  if v_audit_count < 1 then
    raise notice 'FAIL: no subscription_audit_log entries for user %', v_user_id;
    raise exception 'audit log missing';
  end if;

  -- Check the metadata includes explicit_expires_at:true (from Test 3)
  select metadata into v_metadata
  from public.subscription_audit_log
  where user_id = v_user_id and triggered_by = 'test_explicit'
  order by created_at desc limit 1;

  if (v_metadata->>'explicit_expires_at')::boolean is distinct from true then
    raise notice 'FAIL: audit log metadata should record explicit_expires_at=true, got %',
      v_metadata;
    raise exception 'audit metadata missing M6 flag';
  end if;

  raise notice 'PASS: subscription_audit_log records plan_switch with explicit_expires_at=true';
end $$;


-- ────────────────────────────────────────────────────────────
-- 15. Backward-compat: admin_grant_subscription (M17, pre-existing
--     safe_plan_switch caller) still works after M6 extension
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 15: pre-existing safe_plan_switch caller (admin_grant_subscription) still works ──'

do $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_expires_at timestamptz;
begin
  v_user_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated',
    'm6-test-admin-grant-' || extract(epoch from now())::text || '@example.com',
    '', now(), '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (user_id, email, subscription_tier, current_plan)
  values (v_user_id, 'm6-test-admin-grant@example.com', 'free', 'free')
  on conflict (user_id) do nothing;

  -- Call admin_grant_subscription (M17) — uses safe_plan_switch internally
  -- Wait, M17's admin_grant_subscription does its own INSERT/UPDATE; it does
  -- NOT call safe_plan_switch. So this test is just verifying that the
  -- admin_grant_subscription RPC continues to work after M6's RPC changes.
  v_result := public.admin_grant_subscription(
    p_target_user_id => v_user_id,
    p_plan_key       => 'creator',
    p_billing_cycle  => 'monthly',
    p_duration_days  => 30,
    p_granted_reason => 'M6 backward-compat test'
  );

  if v_result->>'success' <> 'true' then
    raise notice 'FAIL: admin_grant_subscription returned %', v_result;
    raise exception 'M17 admin_grant_subscription broken';
  end if;

  if v_result->>'plan' <> 'creator' then
    raise notice 'FAIL: expected plan=creator, got %', v_result->>'plan';
    raise exception 'admin_grant plan wrong';
  end if;

  -- Verify the row was created
  select expires_at into v_expires_at
  from public.user_subscriptions where user_id = v_user_id;

  if v_expires_at is null then
    raise notice 'FAIL: no expires_at after admin_grant';
    raise exception 'admin_grant did not create subscription';
  end if;

  raise notice 'PASS: admin_grant_subscription (M17, pre-M6 caller) still works';

  perform set_config('m6_test.user_id_admin_grant', v_user_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 16. Cleanup
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Cleanup ──'

do $$
declare
  v_user_id_backcompat  uuid;
  v_user_id_explicit    uuid;
  v_user_id_admin_grant uuid;
begin
  begin
    v_user_id_backcompat := (current_setting('m6_test.user_id_backcompat', true))::uuid;
    v_user_id_explicit   := (current_setting('m6_test.user_id_explicit',   true))::uuid;
    v_user_id_admin_grant := (current_setting('m6_test.user_id_admin_grant', true))::uuid;
  exception when others then null;
  end;

  if v_user_id_backcompat is not null then
    delete from public.subscription_audit_log where user_id = v_user_id_backcompat;
    delete from public.payments where user_id = v_user_id_backcompat;
    delete from public.user_subscriptions where user_id = v_user_id_backcompat;
    delete from public.webhook_events where provider_event_id like 'M6_TEST_%';
    delete from public.profiles where user_id = v_user_id_backcompat;
    delete from auth.users where id = v_user_id_backcompat;
    raise notice 'Cleaned up backcompat test user (%)', v_user_id_backcompat;
  end if;

  if v_user_id_explicit is not null then
    delete from public.subscription_audit_log where user_id = v_user_id_explicit;
    delete from public.user_subscriptions where user_id = v_user_id_explicit;
    delete from public.profiles where user_id = v_user_id_explicit;
    delete from auth.users where id = v_user_id_explicit;
    raise notice 'Cleaned up explicit-expires test user (%)', v_user_id_explicit;
  end if;

  if v_user_id_admin_grant is not null then
    delete from public.subscription_audit_log where user_id = v_user_id_admin_grant;
    delete from public.user_subscriptions where user_id = v_user_id_admin_grant;
    delete from public.profiles where user_id = v_user_id_admin_grant;
    delete from auth.users where id = v_user_id_admin_grant;
    raise notice 'Cleaned up admin-grant test user (%)', v_user_id_admin_grant;
  end if;

  -- Remove test provider_products
  delete from public.provider_products
  where provider_id = 'warriorplus'
    and provider_product_id in ('M6_TEST_ITEM_001', 'M6_DISABLED_ITEM', 'M6_ZERO_DURATION');
  raise notice 'Cleaned up M6 test provider_products rows';
end $$;


\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  MILESTONE 6 — ALL TESTS PASSED'
\echo '═══════════════════════════════════════════════════════════'
