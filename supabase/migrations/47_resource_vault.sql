-- ============================================================
-- MIGRATION 47 — Creator Resource Vault
-- ============================================================
-- Creates the resources table, indexes, and storage buckets for
-- the Creator Resource Vault. Public can read/browse; only
-- admins can create, update, or delete resources.
-- ADDITIVE + SAFE: no data deleted, no tables dropped.
-- ============================================================

-- ── 1. Resources table ────────────────────────────────────
create table if not exists public.resources (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  description     text,
  category        text not null,
  pdf_url         text not null,
  cover_image_url text,
  featured        boolean not null default false,
  download_count  integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.resources is
  'Curated creator resources (PDFs, guides, templates, frameworks) available in the Resource Vault.';

-- ── 2. Indexes ────────────────────────────────────────────
create index if not exists idx_resources_slug on public.resources(slug);
create index if not exists idx_resources_category on public.resources(category);
create index if not exists idx_resources_featured on public.resources(featured desc, created_at desc);
create index if not exists idx_resources_search on public.resources
  using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));
create index if not exists idx_resources_created_at on public.resources(created_at desc);

-- ── 3. Updated-at trigger ─────────────────────────────────
create or replace function public.set_resources_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_resources_updated_at on public.resources;
create trigger trg_resources_updated_at
  before update on public.resources
  for each row
  execute function public.set_resources_updated_at();

-- ── 4. RLS policies ───────────────────────────────────────
alter table public.resources enable row level security;

drop policy if exists "Public can read resources" on public.resources;
create policy "Public can read resources"
  on public.resources for select to public using (true);

drop policy if exists "Admins can manage resources" on public.resources;
create policy "Admins can manage resources"
  on public.resources for all to authenticated
  using (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'))
  with check (public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support'));

-- ── 5. Storage buckets ────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('resource-pdfs', 'resource-pdfs', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('resource-covers', 'resource-covers', true)
  on conflict (id) do nothing;

-- ── 6. Storage policies: resource-pdfs ────────────────────
drop policy if exists "Public read resource-pdfs" on storage.objects;
create policy "Public read resource-pdfs"
  on storage.objects for select
  to public
  using (bucket_id = 'resource-pdfs');

drop policy if exists "Admins can upload resource-pdfs" on storage.objects;
create policy "Admins can upload resource-pdfs"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

drop policy if exists "Admins can update resource-pdfs" on storage.objects;
create policy "Admins can update resource-pdfs"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  )
  with check (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

drop policy if exists "Admins can delete resource-pdfs" on storage.objects;
create policy "Admins can delete resource-pdfs"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resource-pdfs'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

-- ── 7. Storage policies: resource-covers ──────────────────
drop policy if exists "Public read resource-covers" on storage.objects;
create policy "Public read resource-covers"
  on storage.objects for select
  to public
  using (bucket_id = 'resource-covers');

drop policy if exists "Admins can upload resource-covers" on storage.objects;
create policy "Admins can upload resource-covers"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

drop policy if exists "Admins can update resource-covers" on storage.objects;
create policy "Admins can update resource-covers"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  )
  with check (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );

drop policy if exists "Admins can delete resource-covers" on storage.objects;
create policy "Admins can delete resource-covers"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resource-covers'
    and public.get_admin_role(auth.uid()) in ('super_admin', 'admin', 'support')
  );
