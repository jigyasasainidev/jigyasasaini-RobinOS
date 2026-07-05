-- Unified schema inspection for migrations 50-58 objects
-- Run with: npx supabase db query --linked -f .kimchi/docs/schema_inspection_query.sql

with expected_tables(table_name) as (
  values ('payment_providers'), ('payment_provider_secrets'), ('provider_products'), ('webhook_events')
),
table_check as (
  select 'table_exists'::text as check_type,
         et.table_name as object_name,
         case when t.table_name is not null then 'exists'::text else 'missing'::text end as status,
         null::text as detail
  from expected_tables et
  left join information_schema.tables t
    on t.table_schema = 'public' and t.table_name = et.table_name
),
expected_payments_columns(column_name) as (
  values ('provider_subscription_id'), ('provider_order_id'), ('provider_invoice_id'),
         ('buyer_email'), ('buyer_email_hash'), ('buyer_name'), ('buyer_country'),
         ('plan_key'), ('source_webhook_event_id'), ('affiliate_user_id'),
         ('referral_code'), ('affiliate_commission_amount'), ('affiliate_commission_status'),
         ('raw_provider_payload')
),
payments_col_check as (
  select 'payments_column'::text as check_type,
         epc.column_name as object_name,
         case when c.column_name is not null then 'exists'::text else 'missing'::text end as status,
         c.data_type::text as detail
  from expected_payments_columns epc
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'payments' and c.column_name = epc.column_name
),
expected_platform_settings_columns(column_name) as (
  values ('warriorplus_page_enabled'), ('warriorplus_demo_video_url'),
         ('payment_provider_default'), ('payment_provider_require_email_verification')
),
platform_settings_col_check as (
  select 'platform_settings_column'::text as check_type,
         e.column_name as object_name,
         case when c.column_name is not null then 'exists'::text else 'missing'::text end as status,
         c.data_type::text as detail
  from expected_platform_settings_columns e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'platform_settings' and c.column_name = e.column_name
),
expected_webhook_columns(column_name) as (
  values ('provider_customer_id'), ('resolution_attempted_at'), ('resolution_outcome'), ('resolution_buyer_email_hash')
),
webhook_col_check as (
  select 'webhook_events_column'::text as check_type,
         e.column_name as object_name,
         case when c.column_name is not null then 'exists'::text else 'missing'::text end as status,
         c.data_type::text as detail
  from expected_webhook_columns e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'webhook_events' and c.column_name = e.column_name
),
expected_profile_columns(column_name) as (
  values ('primary_payment_provider')
),
profile_col_check as (
  select 'profiles_column'::text as check_type,
         e.column_name as object_name,
         case when c.column_name is not null then 'exists'::text else 'missing'::text end as status,
         c.data_type::text as detail
  from expected_profile_columns e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = e.column_name
),
enum_check as (
  select 'enum_value'::text as check_type,
         t.typname || '.' || e.enumlabel as object_name,
         'exists'::text as status,
         null::text as detail
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  where t.typnamespace = (select oid from pg_namespace where nspname = 'public')
    and t.typname in ('payment_provider', 'payment_status')
    and e.enumlabel in ('warriorplus','partially_refunded','charged_back','disputed')
),
expected_rpcs(proname) as (
  values
    ('enqueue_webhook_event'),
    ('retry_webhook_event'),
    ('mark_webhook_dead_letter'),
    ('process_webhook_event'),
    ('process_pending_webhook_events'),
    ('schedule_webhook_retry'),
    ('get_webhook_queue_stats'),
    ('admin_list_providers'),
    ('admin_get_provider'),
    ('admin_upsert_provider'),
    ('admin_toggle_provider'),
    ('admin_list_provider_products'),
    ('admin_upsert_provider_product'),
    ('admin_delete_provider_product'),
    ('admin_get_payment_provider_summary'),
    ('resolve_or_create_user_from_purchase'),
    ('record_purchase_from_webhook'),
    ('grant_entitlement_from_purchase'),
    ('recalculate_user_effective_plan'),
    ('search_payments'),
    ('search_webhook_events'),
    ('safe_plan_switch')
),
rpc_check as (
  select 'rpc'::text as check_type,
         e.proname as object_name,
         case when p.proname is not null then 'exists'::text else 'missing'::text end as status,
         coalesce(pg_get_function_arguments(p.oid), '') as detail
  from expected_rpcs e
  left join pg_proc p on p.proname = e.proname
    and p.pronamespace = (select oid from pg_namespace where nspname = 'public')
),
seed_check as (
  select 'seed_row'::text as check_type,
         'warriorplus provider row' as object_name,
         case when exists(select 1 from public.payment_providers where id = 'warriorplus')
              then 'exists'::text else 'missing'::text end as status,
         null::text as detail
),
trigger_check as (
  select 'trigger'::text as check_type,
         tg.tgname || ' on ' || c.relname as object_name,
         'exists'::text as status,
         p.proname as detail
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = tg.tgfoid
  where n.nspname = 'public'
    and c.relname in ('payment_providers','payment_provider_secrets','provider_products','webhook_events','payments')
    and not tg.tgisinternal
),
rls_check as (
  select 'rls_enabled'::text as check_type,
         c.relname as object_name,
         case when c.relrowsecurity then 'enabled'::text else 'disabled/missing'::text end as status,
         null::text as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('payment_providers','payment_provider_secrets','provider_products','webhook_events')
),
index_check as (
  select 'index'::text as check_type,
         i.relname as object_name,
         'exists'::text as status,
         c.relname as detail
  from pg_index ix
  join pg_class i on i.oid = ix.indexrelid
  join pg_class c on c.oid = ix.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and i.relname in (
      'idx_payment_providers_enabled',
      'idx_payment_provider_secrets_unique_active',
      'idx_payment_provider_secrets_provider',
      'idx_provider_products_unique',
      'idx_provider_products_enabled',
      'idx_provider_products_plan',
      'idx_webhook_events_idempotency',
      'idx_webhook_events_status_received_at',
      'idx_payments_buyer_hash',
      'idx_payments_provider_event',
      'idx_payments_subscription',
      'idx_payments_affiliate',
      'idx_payments_status_date',
      'idx_payments_plan_key',
      'idx_webhook_events_resolution_outcome',
      'idx_webhook_events_resolution_email_hash'
    )
)
select * from table_check
union all select * from payments_col_check
union all select * from platform_settings_col_check
union all select * from profile_col_check
union all select * from webhook_col_check
union all select * from enum_check
union all select * from rpc_check
union all select * from seed_check
union all select * from trigger_check
union all select * from rls_check
union all select * from index_check
order by check_type, object_name;
