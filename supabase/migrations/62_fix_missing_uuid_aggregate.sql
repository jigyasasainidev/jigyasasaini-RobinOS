-- Fix: this Supabase instance is missing the built-in max(uuid) aggregate,
-- which causes resolve_or_create_user_from_purchase to fail with:
--   ERROR: 42883: function max(uuid) does not exist
--
-- Workaround: cast uuid to text for the max() call, then cast back to uuid.
-- No business logic changes.

create or replace function public.resolve_or_create_user_from_purchase(
  p_buyer_email          text,
  p_buyer_name           text,
  p_provider_id          text,
  p_provider_customer_id text default null,
  p_create_if_missing    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_normalized_email    text;
  v_match_count         int;
  v_matched_user_id     uuid;
  v_provider_exists     boolean;
begin
  -- ── 1. Normalize and validate buyer_email ────────────────
  if p_buyer_email is null or btrim(p_buyer_email) = '' then
    raise exception 'missing_buyer_email';
  end if;

  v_normalized_email := lower(btrim(p_buyer_email));

  -- ── 2. Validate provider_id ──────────────────────────────
  select exists(
    select 1 from public.payment_providers where id = p_provider_id
  ) into v_provider_exists;

  if not v_provider_exists then
    raise exception 'provider_not_found: %', p_provider_id;
  end if;

  -- ── 3. Search auth.users for exact normalized match ──────
  -- NOTE: max(id::text)::uuid is used because max(uuid) aggregate
  -- is not available in this Supabase database.
  select count(*), max(id::text)::uuid
    into v_match_count, v_matched_user_id
  from auth.users
  where lower(email) = v_normalized_email
    and email is not null
    and deleted_at is null;

  if v_match_count = 0 then
    return jsonb_build_object(
      'outcome',              'marked_guest_awaiting_claim',
      'user_id',              null,
      'buyer_email',          v_normalized_email,
      'buyer_name',           nullif(btrim(coalesce(p_buyer_name, '')), ''),
      'provider_id',          p_provider_id,
      'provider_customer_id', nullif(btrim(coalesce(p_provider_customer_id, '')), '')
    );
  elsif v_match_count = 1 then
    return jsonb_build_object(
      'outcome',              'resolved_existing_user',
      'user_id',              v_matched_user_id,
      'buyer_email',          v_normalized_email,
      'matched_by',           'email',
      'provider_id',          p_provider_id,
      'provider_customer_id', nullif(btrim(coalesce(p_provider_customer_id, '')), '')
    );
  else
    return jsonb_build_object(
      'outcome',       'resolution_failed',
      'error',         'ambiguous_match',
      'match_count',   v_match_count,
      'buyer_email',   v_normalized_email,
      'provider_id',   p_provider_id
    );
  end if;
end;
$$;

grant execute on function public.resolve_or_create_user_from_purchase(
  text, text, text, text, boolean
) to service_role;
