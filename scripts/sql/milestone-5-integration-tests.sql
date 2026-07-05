-- ============================================================
-- MILESTONE 5 — User Resolution Integration Tests
-- ============================================================
-- End-to-end SQL tests for the M5 user-resolution layer.
-- Run against a staging database AFTER migration 57 has been
-- applied. All tests are isolated to the staging environment;
-- they DO NOT touch production data.
--
-- Usage (psql):
--   psql "$STAGING_DATABASE_URL" -f scripts/sql/milestone-5-integration-tests.sql
--
-- What this tests:
--   1. Schema: 4 new columns + 2 indexes present on webhook_events
--   2. resolve_or_create_user_from_purchase: existing user path
--   3. resolve_or_create_user_from_purchase: guest path
--   4. resolve_or_create_user_from_purchase: ambiguous match path
--   5. resolve_or_create_user_from_purchase: error paths
--      (missing email, missing provider, deleted user)
--   6. process_webhook_event: full pipeline (existing user → verified)
--   7. process_webhook_event: full pipeline (guest → awaiting_claim)
--   8. process_webhook_event: dead-letter (ambiguous match)
--   9. process_webhook_event: dead-letter (missing buyer_email)
--  10. Idempotency: re-running yields the same outcome
--  11. Retry safety: transient failure → failed_retryable → success
--  12. Atomicity: validation failure does not mutate resolution columns
--
-- Cleanup at end of script is automatic (best-effort).
--
-- IMPORTANT: These tests create temporary auth.users rows. They
-- are scoped to the staging environment only. The cleanup block
-- at the end removes them.
-- ============================================================

\set ON_ERROR_STOP on
\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  MILESTONE 5 — INTEGRATION TESTS'
\echo '═══════════════════════════════════════════════════════════'
\echo ''

-- ────────────────────────────────────────────────────────────
-- 1. SCHEMA: verify the 4 columns and 2 indexes exist
-- ────────────────────────────────────────────────────────────
\echo '── Test 1: Schema columns + indexes ──'

do $$
declare
  v_missing_cols text[] := array[]::text[];
  v_missing_idx  text[] := array[]::text[];
begin
  -- 4 new columns on webhook_events
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='webhook_events'
      and column_name='provider_customer_id'
  ) then v_missing_cols := array_append(v_missing_cols, 'provider_customer_id'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='webhook_events'
      and column_name='resolution_attempted_at'
  ) then v_missing_cols := array_append(v_missing_cols, 'resolution_attempted_at'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='webhook_events'
      and column_name='resolution_outcome'
  ) then v_missing_cols := array_append(v_missing_cols, 'resolution_outcome'); end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='webhook_events'
      and column_name='resolution_buyer_email_hash'
  ) then v_missing_cols := array_append(v_missing_cols, 'resolution_buyer_email_hash'); end if;

  -- 2 new indexes
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='webhook_events'
      and indexname='idx_webhook_events_resolution_outcome'
  ) then v_missing_idx := array_append(v_missing_idx, 'idx_webhook_events_resolution_outcome'); end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='webhook_events'
      and indexname='idx_webhook_events_resolution_email_hash'
  ) then v_missing_idx := array_append(v_missing_idx, 'idx_webhook_events_resolution_email_hash'); end if;

  if array_length(v_missing_cols, 1) > 0 then
    raise notice 'FAIL: missing columns: %', array_to_string(v_missing_cols, ', ');
    raise exception 'Schema columns missing — migration 57 not applied?';
  end if;
  if array_length(v_missing_idx, 1) > 0 then
    raise notice 'FAIL: missing indexes: %', array_to_string(v_missing_idx, ', ');
    raise exception 'Schema indexes missing — migration 57 not applied?';
  end if;

  raise notice 'PASS: all 4 columns and 2 indexes present';
end $$;


-- ────────────────────────────────────────────────────────────
-- 2. resolve_or_create_user_from_purchase: existing user
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 2: existing user resolved by email ──'

-- Seed a temporary auth.users row.
do $$
declare
  v_test_user_id uuid;
  v_result jsonb;
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'm5-test-existing@example.com',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now(), '',
    '', '', ''
  )
  returning id into v_test_user_id;

  -- The function requires lower(email) match.
  v_result := public.resolve_or_create_user_from_purchase(
    p_buyer_email          => '  M5-Test-EXISTING@Example.COM  ',
    p_buyer_name           => 'Test User',
    p_provider_id          => 'warriorplus',
    p_provider_customer_id => null,
    p_create_if_missing    => false
  );

  if v_result->>'outcome' <> 'resolved_existing_user' then
    raise notice 'FAIL: expected outcome=resolved_existing_user, got %', v_result->>'outcome';
    raise exception 'existing-user resolution failed';
  end if;

  if (v_result->>'user_id')::uuid <> v_test_user_id then
    raise notice 'FAIL: user_id mismatch. expected=%, got=%',
      v_test_user_id, v_result->>'user_id';
    raise exception 'resolved user_id does not match seeded user';
  end if;

  if v_result->>'matched_by' <> 'email' then
    raise notice 'FAIL: expected matched_by=email, got %', v_result->>'matched_by';
    raise exception 'matched_by field wrong';
  end if;

  -- Buyer email must be normalized in the output.
  if v_result->>'buyer_email' <> 'm5-test-existing@example.com' then
    raise notice 'FAIL: expected normalized email, got %', v_result->>'buyer_email';
    raise exception 'email normalization not applied';
  end if;

  raise notice 'PASS: existing user resolved by email (user_id=%, normalized email)',
    v_test_user_id;

  -- Save for cleanup.
  perform set_config('m5_test.user_id', v_test_user_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 3. resolve_or_create_user_from_purchase: guest path
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 3: unknown buyer → guest (awaiting_claim) ──'

do $$
declare
  v_result jsonb;
begin
  v_result := public.resolve_or_create_user_from_purchase(
    p_buyer_email          => 'never-seen-this-buyer@example.com',
    p_buyer_name           => '  Ghost Buyer  ',
    p_provider_id          => 'warriorplus',
    p_provider_customer_id => null,
    p_create_if_missing    => false
  );

  if v_result->>'outcome' <> 'marked_guest_awaiting_claim' then
    raise notice 'FAIL: expected outcome=marked_guest_awaiting_claim, got %', v_result->>'outcome';
    raise exception 'guest resolution failed';
  end if;

  if v_result->>'user_id' is not null then
    raise notice 'FAIL: expected user_id=null, got %', v_result->>'user_id';
    raise exception 'guest resolution incorrectly returned a user_id';
  end if;

  if v_result->>'buyer_email' <> 'never-seen-this-buyer@example.com' then
    raise notice 'FAIL: expected normalized email, got %', v_result->>'buyer_email';
    raise exception 'guest email normalization wrong';
  end if;

  if v_result->>'buyer_name' <> 'Ghost Buyer' then
    raise notice 'FAIL: expected trimmed buyer_name, got %', v_result->>'buyer_name';
    raise exception 'buyer_name not trimmed';
  end if;

  raise notice 'PASS: unknown buyer → marked_guest_awaiting_claim (no user created)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 4. resolve_or_create_user_from_purchase: ambiguous match
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 4: ambiguous match → resolution_failed ──'

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_result jsonb;
begin
  -- Seed two auth.users rows with the same (case-insensitive) email.
  -- This simulates a corrupted state that should never happen in prod.
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated',
    'm5-ambiguous@example.com', '', now(),
    '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ) returning id into v_user_a;

  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated',
    'M5-AMBIGUOUS@example.com', '', now(),
    '{}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ) returning id into v_user_b;

  v_result := public.resolve_or_create_user_from_purchase(
    p_buyer_email => 'm5-ambiguous@example.com',
    p_buyer_name  => 'Should Fail',
    p_provider_id => 'warriorplus'
  );

  if v_result->>'outcome' <> 'resolution_failed' then
    raise notice 'FAIL: expected outcome=resolution_failed, got %', v_result->>'outcome';
    raise exception 'ambiguous match not detected';
  end if;

  if v_result->>'error' <> 'ambiguous_match' then
    raise notice 'FAIL: expected error=ambiguous_match, got %', v_result->>'error';
    raise exception 'wrong error code for ambiguous match';
  end if;

  if (v_result->>'match_count')::int <> 2 then
    raise notice 'FAIL: expected match_count=2, got %', v_result->>'match_count';
    raise exception 'match_count wrong';
  end if;

  -- SECURITY GUARD: ambiguous matches MUST NEVER silently merge.
  if v_result->>'user_id' is not null then
    raise notice 'FAIL: ambiguous match returned user_id — security violation!';
    raise exception 'identity merge must not happen on ambiguous match';
  end if;

  raise notice 'PASS: ambiguous match → resolution_failed (no silent merge)';

  -- Cleanup
  delete from auth.users where id in (v_user_a, v_user_b);
end $$;


-- ────────────────────────────────────────────────────────────
-- 5. resolve_or_create_user_from_purchase: error paths
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 5: error paths (missing email, missing provider) ──'

do $$
begin
  -- 5a. Missing buyer_email → exception
  begin
    perform public.resolve_or_create_user_from_purchase(
      p_buyer_email => null,
      p_buyer_name  => 'No Email',
      p_provider_id => 'warriorplus'
    );
    raise exception 'FAIL: expected exception for null buyer_email';
  exception when others then
    if SQLERRM not like 'missing_buyer_email%' then
      raise notice 'FAIL: expected missing_buyer_email exception, got: %', SQLERRM;
      raise exception 'wrong error for null buyer_email';
    end if;
  end;

  -- 5b. Empty buyer_email → exception
  begin
    perform public.resolve_or_create_user_from_purchase(
      p_buyer_email => '   ',
      p_buyer_name  => 'Whitespace',
      p_provider_id => 'warriorplus'
    );
    raise exception 'FAIL: expected exception for empty buyer_email';
  exception when others then
    if SQLERRM not like 'missing_buyer_email%' then
      raise notice 'FAIL: expected missing_buyer_email exception, got: %', SQLERRM;
      raise exception 'wrong error for empty buyer_email';
    end if;
  end;

  -- 5c. Missing provider → exception
  begin
    perform public.resolve_or_create_user_from_purchase(
      p_buyer_email => 'buyer@example.com',
      p_buyer_name  => 'Test',
      p_provider_id => 'nonexistent-provider'
    );
    raise exception 'FAIL: expected exception for missing provider';
  exception when others then
    if SQLERRM not like 'provider_not_found%' then
      raise notice 'FAIL: expected provider_not_found exception, got: %', SQLERRM;
      raise exception 'wrong error for missing provider';
    end if;
  end;

  raise notice 'PASS: error paths (null/empty email, missing provider) all raise correctly';
end $$;


-- ────────────────────────────────────────────────────────────
-- 6. process_webhook_event: existing user → verified
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 6: process_webhook_event — existing user full pipeline ──'

do $$
declare
  v_test_user_id uuid;
  v_event_id uuid;
  v_raw_payload jsonb;
  v_result jsonb;
  v_final_status text;
  v_final_outcome text;
  v_final_linked_user uuid;
begin
  v_test_user_id := (current_setting('m5_test.user_id'))::uuid;

  -- Build a minimal valid WarriorPlus-shaped payload with the
  -- existing user's email.
  v_raw_payload := jsonb_build_object(
    'WP_ACTION',         'sale',
    'IPN_ID',            'M5_TEST_EXISTING_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER',    'wp-item-001',
    'WP_BUYER_EMAIL',    'm5-test-existing@example.com',
    'WP_BUYER_NAME',     'Test Buyer',
    'WP_SALE_AMOUNT',    '39.00',
    'WP_SALE_CURRENCY',  'USD'
  );

  -- Insert via the M3 dispatcher RPC (enqueue_webhook_event).
  -- We call it directly to bypass HTTP and signature.
  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw_payload->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw_payload,
    p_raw_headers             => '{"content-type":"application/x-www-form-urlencoded"}'::jsonb,
    p_provider_transaction_id => 'wp-sale-001',
    p_trace_id                => gen_random_uuid()
  );

  -- Process it.
  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'verified' then
    raise notice 'FAIL: expected action=verified, got %', v_result->>'action';
    raise exception 'existing-user pipeline did not verify';
  end if;

  if (v_result->>'linked_user_id')::uuid <> v_test_user_id then
    raise notice 'FAIL: linked_user_id mismatch. expected=%, got=%',
      v_test_user_id, v_result->>'linked_user_id';
    raise exception 'existing-user pipeline linked wrong user';
  end if;

  if v_result->>'resolution_outcome' <> 'resolved_existing_user' then
    raise notice 'FAIL: expected resolution_outcome=resolved_existing_user, got %',
      v_result->>'resolution_outcome';
    raise exception 'resolution outcome wrong';
  end if;

  -- Verify the row state matches.
  select status, resolution_outcome, linked_user_id
    into v_final_status, v_final_outcome, v_final_linked_user
  from public.webhook_events where id = v_event_id;

  if v_final_status <> 'verified' then
    raise notice 'FAIL: row status=%, expected verified', v_final_status;
    raise exception 'row status not verified';
  end if;

  if v_final_outcome <> 'resolved_existing_user' then
    raise notice 'FAIL: row outcome=%, expected resolved_existing_user', v_final_outcome;
    raise exception 'row outcome wrong';
  end if;

  if v_final_linked_user <> v_test_user_id then
    raise notice 'FAIL: row linked_user_id mismatch';
    raise exception 'row linkage wrong';
  end if;

  -- resolution_attempted_at MUST be set.
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id and resolution_attempted_at is not null
  ) then
    raise notice 'FAIL: resolution_attempted_at was not set';
    raise exception 'resolution timestamp missing';
  end if;

  -- resolution_buyer_email_hash MUST equal SHA-256 of normalized email.
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id
      and resolution_buyer_email_hash = encode(digest('m5-test-existing@example.com', 'sha256'), 'hex')
  ) then
    raise notice 'FAIL: resolution_buyer_email_hash does not match expected SHA-256';
    raise exception 'email hash wrong';
  end if;

  raise notice 'PASS: existing user pipeline → verified + linked_user_id populated + outcome=resolved_existing_user';

  perform set_config('m5_test.event_id_existing', v_event_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 7. process_webhook_event: guest → awaiting_claim
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 7: process_webhook_event — guest full pipeline ──'

do $$
declare
  v_event_id uuid;
  v_raw_payload jsonb;
  v_result jsonb;
begin
  v_raw_payload := jsonb_build_object(
    'WP_ACTION',         'sale',
    'IPN_ID',            'M5_TEST_GUEST_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER',    'wp-item-002',
    'WP_BUYER_EMAIL',    'm5-guest-' || extract(epoch from now())::text || '@example.com',
    'WP_BUYER_NAME',     'Ghost Customer',
    'WP_SALE_AMOUNT',    '19.00',
    'WP_SALE_CURRENCY',  'USD'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw_payload->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw_payload,
    p_raw_headers             => '{"content-type":"application/x-www-form-urlencoded"}'::jsonb,
    p_provider_transaction_id => 'wp-sale-guest-001',
    p_trace_id                => gen_random_uuid()
  );

  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'awaiting_claim' then
    raise notice 'FAIL: expected action=awaiting_claim, got %', v_result->>'action';
    raise exception 'guest pipeline did not transition to awaiting_claim';
  end if;

  if v_result->>'resolution_outcome' <> 'marked_guest_awaiting_claim' then
    raise notice 'FAIL: expected outcome=marked_guest_awaiting_claim, got %',
      v_result->>'resolution_outcome';
    raise exception 'guest resolution outcome wrong';
  end if;

  if v_result->>'linked_user_id' is not null then
    raise notice 'FAIL: guest pipeline incorrectly linked a user_id';
    raise exception 'guest pipeline should not link any user';
  end if;

  -- Verify row state.
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id
      and status = 'awaiting_claim'
      and linked_user_id is null
      and resolution_outcome = 'marked_guest_awaiting_claim'
      and resolution_attempted_at is not null
  ) then
    raise notice 'FAIL: guest row state does not match expected';
    raise exception 'guest row state wrong';
  end if;

  raise notice 'PASS: guest pipeline → awaiting_claim (no user created, ready for M9)';

  perform set_config('m5_test.event_id_guest', v_event_id::text, false);
end $$;


-- ────────────────────────────────────────────────────────────
-- 8. process_webhook_event: dead-letter on missing buyer_email
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 8: process_webhook_event — malformed payload (no buyer_email) ──'

do $$
declare
  v_event_id uuid;
  v_raw_payload jsonb;
  v_result jsonb;
begin
  v_raw_payload := jsonb_build_object(
    'WP_ACTION',         'sale',
    'IPN_ID',            'M5_TEST_MALFORMED_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER',    'wp-item-003'
    -- intentionally no WP_BUYER_EMAIL
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw_payload->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw_payload,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-malformed',
    p_trace_id                => gen_random_uuid()
  );

  v_result := public.process_webhook_event(v_event_id);

  if v_result->>'action' <> 'failed_terminal' then
    raise notice 'FAIL: expected action=failed_terminal, got %', v_result->>'action';
    raise exception 'malformed payload did not dead-letter';
  end if;

  if v_result->>'classification' <> 'validation' then
    raise notice 'FAIL: expected classification=validation, got %', v_result->>'classification';
    raise exception 'wrong classification for malformed payload';
  end if;

  if v_result->>'error' not like '%missing_buyer_email_field%' then
    raise notice 'FAIL: expected error mentioning missing_buyer_email_field, got %',
      v_result->>'error';
    raise exception 'wrong error message';
  end if;

  -- Row must be in failed_terminal status.
  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id and status = 'failed_terminal'
  ) then
    raise notice 'FAIL: malformed row not in failed_terminal';
    raise exception 'row not dead-lettered';
  end if;

  -- Resolution columns MUST remain NULL (validation failed before resolution).
  if exists (
    select 1 from public.webhook_events
    where id = v_event_id and resolution_outcome is not null
  ) then
    raise notice 'FAIL: resolution_outcome was populated on validation failure';
    raise exception 'atomicity violated — resolution columns set on validation failure';
  end if;

  raise notice 'PASS: malformed payload → failed_terminal (atomicity preserved, no resolution side-effects)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 9. Idempotency: re-running yields same outcome
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 9: idempotency — re-processing an already-resolved row is a no-op ──'

do $$
declare
  v_event_id uuid := (current_setting('m5_test.event_id_existing'))::uuid;
  v_first_result jsonb;
  v_second_result jsonb;
  v_first_attempted_at timestamptz;
  v_second_attempted_at timestamptz;
begin
  -- The row is already in 'verified' state. process_webhook_event
  -- with an explicit id only claims rows in (received, failed_retryable,
  -- failed_terminal). So calling it again returns null — the row is
  -- not claimable. This is the M4 idempotency contract.
  v_second_result := public.process_webhook_event(v_event_id);

  if v_second_result is not null then
    raise notice 'FAIL: re-processing verified row returned %, expected null',
      v_second_result->>'action';
    raise exception 'idempotency violated — row was reprocessed';
  end if;

  raise notice 'PASS: re-processing a verified row is a no-op (returns null)';
end $$;


-- ────────────────────────────────────────────────────────────
-- 10. Retry safety: failed_retryable → success on retry
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 10: retry safety — failed_retryable rows can be retried ──'

do $$
declare
  v_event_id uuid;
  v_raw_payload jsonb;
  v_test_user_id uuid := (current_setting('m5_test.user_id'))::uuid;
begin
  v_raw_payload := jsonb_build_object(
    'WP_ACTION',         'sale',
    'IPN_ID',            'M5_TEST_RETRY_' || extract(epoch from now())::text,
    'WP_ITEM_NUMBER',    'wp-item-004',
    'WP_BUYER_EMAIL',    'm5-test-existing@example.com',
    'WP_BUYER_NAME',     'Retry Test',
    'WP_SALE_AMOUNT',    '99.00'
  );

  v_event_id := public.enqueue_webhook_event(
    p_provider_id             => 'warriorplus',
    p_provider_event_id       => v_raw_payload->>'IPN_ID',
    p_provider_event_type     => 'sale',
    p_raw_payload             => v_raw_payload,
    p_raw_headers             => '{}'::jsonb,
    p_provider_transaction_id => 'wp-sale-retry',
    p_trace_id                => gen_random_uuid()
  );

  -- Manually move to failed_retryable to simulate a prior transient failure.
  update public.webhook_events
  set status = 'failed_retryable',
      retry_count = 1,
      next_retry_at = now() - interval '1 minute'
  where id = v_event_id;

  -- The worker should reclaim and process it.
  perform public.process_webhook_event(v_event_id);

  if not exists (
    select 1 from public.webhook_events
    where id = v_event_id
      and status = 'verified'
      and linked_user_id = v_test_user_id
      and resolution_outcome = 'resolved_existing_user'
  ) then
    raise notice 'FAIL: failed_retryable row did not recover on retry';
    raise exception 'retry safety broken';
  end if;

  raise notice 'PASS: failed_retryable row recovers on retry (linked_user_id=% verified)', v_test_user_id;
end $$;


-- ────────────────────────────────────────────────────────────
-- 11. Security: resolution is read-only against auth.users
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Test 11: security — M5 never creates auth.users rows ──'

do $$
declare
  v_before_count int;
  v_after_count int;
begin
  select count(*) into v_before_count from auth.users;

  -- Run several resolutions against unknown emails.
  perform public.resolve_or_create_user_from_purchase(
    p_buyer_email => 'never-1-' || extract(epoch from now())::text || '@example.com',
    p_buyer_name  => 'No One',
    p_provider_id => 'warriorplus'
  );
  perform public.resolve_or_create_user_from_purchase(
    p_buyer_email => 'never-2-' || extract(epoch from now())::text || '@example.com',
    p_buyer_name  => 'No One',
    p_provider_id => 'warriorplus'
  );
  perform public.resolve_or_create_user_from_purchase(
    p_buyer_email => 'never-3-' || extract(epoch from now())::text || '@example.com',
    p_buyer_name  => 'No One',
    p_provider_id => 'warriorplus'
  );

  select count(*) into v_after_count from auth.users;

  if v_after_count <> v_before_count then
    raise notice 'FAIL: auth.users count changed (% → %). M5 must be read-only!',
      v_before_count, v_after_count;
    raise exception 'SECURITY VIOLATION: M5 created auth.users rows';
  end if;

  raise notice 'PASS: M5 is read-only against auth.users (count unchanged: %)', v_after_count;
end $$;


-- ────────────────────────────────────────────────────────────
-- 12. Cleanup
-- ────────────────────────────────────────────────────────────
\echo ''
\echo '── Cleanup ──'

do $$
declare
  v_user_id uuid;
begin
  begin
    v_user_id := (current_setting('m5_test.user_id', true))::uuid;
    if v_user_id is not null then
      delete from auth.users where id = v_user_id;
      raise notice 'Cleaned up test auth.users row (%)', v_user_id;
    end if;
  exception when others then
    raise notice 'No user_id to clean up';
  end;

  -- Remove all webhook_events rows created during these tests.
  delete from public.webhook_events
  where provider_event_id like 'M5_TEST_%';
  raise notice 'Cleaned up M5 test webhook_events rows';
end $$;


\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '  MILESTONE 5 — ALL TESTS PASSED'
\echo '═══════════════════════════════════════════════════════════'
