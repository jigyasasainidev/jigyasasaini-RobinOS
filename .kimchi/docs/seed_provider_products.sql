-- One-time data fix: seed provider_products mapping for WarriorPlus Pro Creator (180-day) product.
-- This resolves PRODUCT_MAPPING_NOT_FOUND in record_purchase_from_webhook.
-- Preserves architecture: provider_products remains the source of truth for plan/duration mapping.

insert into public.provider_products (
  provider_id,
  provider_product_id,
  provider_offer_id,
  plan_key,
  billing_cycle,
  duration_value,
  duration_unit,
  amount,
  currency,
  is_enabled,
  display_name
)
values
  -- Mapping for the existing test event (wso_abc123)
  ('warriorplus', 'wso_abc123', null,
   'pro_creator', 'one_time', 6, 'month', 39.00, 'USD', true,
   'RobinOS Pro Creator — 6-month'),
  -- Mapping for the JS test script default item (wp_test_item_001)
  ('warriorplus', 'wp_test_item_001', null,
   'pro_creator', 'one_time', 6, 'month', 39.00, 'USD', true,
   'RobinOS Pro Creator — 6-month (test)')
on conflict (provider_id, provider_product_id, coalesce(provider_offer_id, ''))
  do update set
    plan_key      = excluded.plan_key,
    billing_cycle = excluded.billing_cycle,
    duration_value = excluded.duration_value,
    duration_unit = excluded.duration_unit,
    amount        = excluded.amount,
    currency      = excluded.currency,
    is_enabled    = excluded.is_enabled,
    display_name  = excluded.display_name;
