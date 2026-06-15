-- Chunk 1: Resource Vault visibility toggle
-- Adds resource_vault_enabled boolean to platform_settings

alter table public.platform_settings
  add column if not exists resource_vault_enabled boolean not null default true;

comment on column public.platform_settings.resource_vault_enabled is
  'When false, the /resources page is unavailable and links are hidden.';