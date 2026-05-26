-- ============================================================
-- MIGRATION 37 — Admin Realtime Notifications
-- ============================================================
-- Creates admin_notifications table with RLS.
-- Supabase Realtime listens to INSERT events on this table.
-- Notifications are written by:
--   - dodo-webhook (payment events)
--   - process_subscription_expiry (lifecycle events)
--   - Future: moderation, affiliate, system events
-- ============================================================

create table if not exists public.admin_notifications (
  id          uuid        primary key default gen_random_uuid(),
  type        text        not null,   -- payment | affiliate | user | withdrawal | security | system
  title       text        not null,
  message     text        not null,
  priority    text        not null default 'info',  -- info | success | warning | critical
  read        boolean     not null default false,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now() at time zone 'UTC'
);

comment on table public.admin_notifications is
  'Realtime admin notifications. Supabase Realtime broadcasts INSERT events '
  'to the admin panel. Priority: info | success | warning | critical.';

create index if not exists idx_admin_notifications_created_at
  on public.admin_notifications (created_at desc);

create index if not exists idx_admin_notifications_read
  on public.admin_notifications (read, created_at desc)
  where read = false;

-- RLS: only admins can read; service_role writes
alter table public.admin_notifications enable row level security;

create policy "Admins can read notifications"
  on public.admin_notifications for select
  to authenticated
  using (public.get_admin_role(auth.uid()) is not null);

create policy "Admins can mark read"
  on public.admin_notifications for update
  to authenticated
  using (public.get_admin_role(auth.uid()) is not null)
  with check (public.get_admin_role(auth.uid()) is not null);

create policy "Service role manages notifications"
  on public.admin_notifications for all to service_role
  using (true) with check (true);

-- Enable Realtime on this table
alter publication supabase_realtime add table public.admin_notifications;

-- ── Helper: push_admin_notification() ─────────────────────
-- Called by webhook handlers and cron jobs to emit notifications.
-- Non-blocking: errors are swallowed so they never crash callers.

create or replace function public.push_admin_notification(
  p_type     text,
  p_title    text,
  p_message  text,
  p_priority text    default 'info',
  p_metadata jsonb   default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.admin_notifications (type, title, message, priority, metadata)
  values (p_type, p_title, p_message, p_priority, p_metadata)
  returning id into v_id;
  return v_id;
exception when others then
  -- Never let notification emit crash the caller
  return null;
end;
$$;

grant execute on function public.push_admin_notification(text,text,text,text,jsonb)
  to service_role, authenticated;

comment on function public.push_admin_notification(text,text,text,text,jsonb) is
  'Emit an admin notification. Non-blocking — exceptions are swallowed. '
  'Realtime broadcasts the INSERT to subscribed admin clients.';

-- ── Auto-notify on new user signup ────────────────────────
create or replace function public.trg_notify_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_admin_notification(
    'user',
    '👤 New user registered',
    coalesce(NEW.email, NEW.user_id::text),
    'info',
    jsonb_build_object('user_id', NEW.user_id, 'email', NEW.email)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_new_user on public.profiles;
create trigger trg_notify_new_user
  after insert on public.profiles
  for each row execute function public.trg_notify_new_user();

-- ── Auto-notify on new withdrawal request ─────────────────
create or replace function public.trg_notify_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'pending' then
    perform public.push_admin_notification(
      'withdrawal',
      '💸 Withdrawal request submitted',
      '$' || NEW.amount::text || ' — USDT TRC20',
      'warning',
      jsonb_build_object('user_id', NEW.user_id, 'amount', NEW.amount, 'request_id', NEW.id)
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_withdrawal on public.withdrawal_requests;
create trigger trg_notify_withdrawal
  after insert on public.withdrawal_requests
  for each row execute function public.trg_notify_withdrawal();
