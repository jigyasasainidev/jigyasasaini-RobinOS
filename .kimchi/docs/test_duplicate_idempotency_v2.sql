-- Duplicate / idempotency verification for WarriorPlus SALE pipeline (v2).
-- Re-runs after migration 64 made idx_payments_provider_event unique.
do $$
declare
  v_user_id uuid;
  v_existing_event_id uuid;
  v_existing_payment_id uuid;
  v_existing_sub_id uuid;
  v_existing_expires_at timestamptz;
  v_result jsonb;
  v_new_event_id uuid;
  v_payment_count integer;
  v_sub_count integer;
  v_new_payment_id uuid;
  v_raw jsonb;
  v_payload_hash text;
  v_txn_id text := 'test_txn_1783348837.074539';
  v_new_ipn_id text := 'test_ipn_dup_v2_' || extract(epoch from now())::text;
begin
  select id into v_user_id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1;
  if v_user_id is null then
    raise exception 'Test setup failed: ashadbuilds@gmail.com not found';
  end if;

  select id, linked_purchase_id into v_existing_event_id, v_existing_payment_id
  from public.webhook_events
  where raw_payload->>'WP_BUYER_EMAIL' ilike 'ashadbuilds@gmail.com'
    and status = 'processed'
  order by processed_at desc
  limit 1;

  if v_existing_event_id is null or v_existing_payment_id is null then
    raise exception 'No processed webhook/payment found for ashadbuilds@gmail.com';
  end if;

  select subscription_id into v_existing_sub_id
  from public.payments
  where id = v_existing_payment_id;

  select expires_at into v_existing_expires_at
  from public.user_subscriptions
  where id = v_existing_sub_id;

  raise notice 'Baseline: event=%, payment=%, sub=%, expires_at=%',
    v_existing_event_id, v_existing_payment_id, v_existing_sub_id, v_existing_expires_at;

  v_result := public.process_webhook_event(v_existing_event_id);
  raise notice 'Scenario A (re-process existing event): result=%', v_result;
  if v_result is not null then
    raise exception 'Scenario A failed: expected null (already processed), got %', v_result;
  end if;

  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', v_new_ipn_id,
    'WP_SALE', v_txn_id,
    'WP_ITEM_NUMBER', 'wso_abc123',
    'WP_BUYER_EMAIL', 'ashadbuilds@gmail.com',
    'WP_BUYER_NAME', 'Ashad Builds',
    'WP_SALE_AMOUNT', '39.00',
    'WP_SALE_CURRENCY', 'USD'
  );
  v_payload_hash := encode(digest(v_raw::text, 'sha256'), 'hex');

  insert into public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    standardized_event_type, event_mapping_confidence,
    payload_hash, raw_payload, raw_headers,
    provider_transaction_id, trace_id, status
  ) values (
    'warriorplus', v_new_ipn_id, 'sale',
    'purchase.created', 'exact',
    v_payload_hash, v_raw, '{}'::jsonb,
    v_txn_id, gen_random_uuid(), 'received'
  )
  returning id into v_new_event_id;

  v_result := public.process_webhook_event(v_new_event_id);
  raise notice 'Scenario B (same txn, new IPN): result=%', v_result;

  if coalesce((v_result->>'success')::boolean, false) = false then
    raise exception 'Scenario B failed: pipeline returned %', v_result;
  end if;

  select count(*) into v_payment_count
  from public.payments
  where user_id = v_user_id
    and provider = 'warriorplus'
    and provider_payment_id = v_txn_id;

  select count(*) into v_sub_count
  from public.user_subscriptions
  where user_id = v_user_id;

  if v_payment_count <> 1 then
    raise exception 'Scenario B failed: expected 1 payment for txn %, found %', v_txn_id, v_payment_count;
  end if;

  if v_sub_count <> 1 then
    raise exception 'Scenario B failed: expected 1 subscription, found %', v_sub_count;
  end if;

  select linked_purchase_id into v_new_payment_id
  from public.webhook_events
  where id = v_new_event_id;

  if v_new_payment_id is null or v_new_payment_id <> v_existing_payment_id then
    raise exception 'Scenario B failed: new webhook did not link to existing payment. expected %, got %',
      v_existing_payment_id, v_new_payment_id;
  end if;

  raise notice 'PASS: duplicate protection works. Existing payment reused, no duplicate subscription.';
end $$;
