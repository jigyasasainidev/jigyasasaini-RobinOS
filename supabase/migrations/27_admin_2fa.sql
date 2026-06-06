-- ============================================================
-- MIGRATION 27 — ADMIN 2FA (TOTP)
-- ============================================================
-- Stores encrypted TOTP secrets and hashed backup codes for
-- admin users. Service-role only — no direct client access.
--
-- Security decisions:
--   - RLS enabled: all policies DENY by default
--   - Secrets encrypted at rest (AES-256-GCM) by edge function
--   - Backup codes stored as bcrypt hashes, never plaintext
--   - last_verified_at enables session freshness checks
--   - failed_attempts + locked_until enable brute-force protection
-- ============================================================

create table if not exists public.admin_2fa (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  secret_encrypted    text not null,          -- AES-256-GCM encrypted TOTP secret
  is_enabled          boolean not null default false,
  backup_codes        text[] not null default '{}', -- bcrypt-hashed one-time codes
  failed_attempts     integer not null default 0,
  locked_until        timestamptz,            -- brute-force lockout expiry
  last_verified_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint admin_2fa_user_id_unique unique (user_id)
);

-- ── Indexes ────────────────────────────────────────────────
create index if not exists admin_2fa_user_id_idx on public.admin_2fa(user_id);

-- ── RLS: deny everything to all roles ─────────────────────
-- Edge functions use service_role which bypasses RLS entirely.
-- No client-side code can ever read or write this table.
alter table public.admin_2fa enable row level security;

-- Explicit deny-all policy (belt + suspenders)
create policy "admin_2fa_deny_all"
  on public.admin_2fa
  for all
  to authenticated, anon
  using (false)
  with check (false);

-- ── updated_at trigger ─────────────────────────────────────
create or replace function public.set_admin_2fa_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_2fa_updated_at on public.admin_2fa;
create trigger admin_2fa_updated_at
  before update on public.admin_2fa
  for each row execute function public.set_admin_2fa_updated_at();

-- ── Audit log table for 2FA events ────────────────────────
create table if not exists public.admin_2fa_audit (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null,   -- 'setup' | 'verified' | 'failed' | 'disabled' | 'recovery_used' | 'locked'
  ip_hint     text,            -- first 3 octets only (privacy-safe)
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_2fa_audit_user_id_idx on public.admin_2fa_audit(user_id);
create index if not exists admin_2fa_audit_created_at_idx on public.admin_2fa_audit(created_at desc);

alter table public.admin_2fa_audit enable row level security;
create policy "admin_2fa_audit_deny_all"
  on public.admin_2fa_audit
  for all
  to authenticated, anon
  using (false)
  with check (false);

comment on table public.admin_2fa is
  'Encrypted TOTP secrets for admin 2FA. Service-role only. Never expose to client.';
comment on table public.admin_2fa_audit is
  'Immutable audit log for all admin 2FA events.';
