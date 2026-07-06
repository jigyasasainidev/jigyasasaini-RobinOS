-- End-to-end verification: simulate a WarriorPlus SALE for ashadbuilds@gmail.com
-- and run process_webhook_event to confirm payment + subscription creation.

do $$
declare
  v_user_id uuid;
  v_event_id uuid;
  v_raw jsonb;
  v_result jsonb;
  v_payment_id uuid;
  v_subscription_id uuid;
  v_ipn_id text := 'test_ipn_' || extract(epoch from now())::text;
  v_txn_id text := 'test_txn_' || extract(epoch from now())::text;
  v_payload_hash text;
begin
  -- 1. Resolve the target user
  select id into v_user_id from auth.users where lower(email) = 'ashadbuilds@gmail.com' limit 1;
  if v_user_id is null then
    raise exception 'Test setup failed: ashadbuilds@gmail.com not found in auth.users';
  end if;

  -- 2. Build raw payload (mirrors WarriorPlus IPN)
  v_raw := jsonb_build_object(
    'WP_ACTION', 'sale',
    'IPN_ID', v_ipn_id,
    'WP_SALE', v_txn_id,
    'WP_ITEM_NUMBER', 'wso_abc123',
    'WP_BUYER_EMAIL', 'ashadbuilds@gmail.com',
    'WP_BUYER_NAME', 'Ashad Builds',
    'WP_SALE_AMOUNT', '39.00',
    'WP_SALE_CURRENCY', 'USD'
  );
  v_payload_hash := encode(digest(v_raw::text, 'sha256'), 'hex');

  -- 3. Insert webhook event directly with standardized_event_type set
  --    (payment-webhook edge function normally does this mapping).
  insert into public.webhook_events (
    provider_id, provider_event_id, provider_event_type,
    standardized_event_type, event_mapping_confidence,
    payload_hash, raw_payload, raw_headers,
    provider_transaction_id, trace_id, status
  ) values (
    'warriorplus', v_ipn_id, 'sale',
    'purchase.created', 'exact',
    v_payload_hash, v_raw, '{}'::jsonb,
    v_txn_id, gen_random_uuid(), 'received'
  )
  returning id into v_event_id;

  raise notice 'Created webhook event %', v_event_id;

  -- 4. Run the full pipeline
  v_result := public.process_webhook_event(v_event_id);

  raise notice 'process_webhook_event result: %', v_result;

  -- 5. Verify outcome
  if coalesce((v_result->>'success')::boolean, false) = false then
    raise exception 'Pipeline failed: %', v_result;
  end if;

  if (v_result->>'action') <> 'processed' then
    raise exception 'Expected action=processed, got %', v_result->>'action';
  end if;

  v_payment_id := (v_result->>'linked_purchase_id')::uuid;
  if v_payment_id is null then
    raise exception 'linked_purchase_id missing from result';
  end if;

  -- 6. Verify payments row
  select subscription_id into v_subscription_id
  from public.payments
  where id = v_payment_id;

  if v_subscription_id is null then
    raise exception 'payments.subscription_id was not set (entitlement failed)';
  end if;

  -- 7. Verify subscription row exists and is pro_creator with ~180 days
  if not exists (
    select 1 from public.user_subscriptions
    where id = v_subscription_id
      and user_id = v_user_id
      and plan = 'pro_creator'
      and expires_at > now() + interval '170 days'
  ) then
    raise exception 'Expected pro_creator subscription with ~180 days not found';
  end if;

  raise notice 'PASS: payment=%, subscription=%, user=%', v_payment_id, v_subscription_id, v_user_id;
end $$;
