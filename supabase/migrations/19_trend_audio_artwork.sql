-- ============================================================
-- ADD image_url TO trend_audios
-- Stores album artwork URL from Apple Music / Deezer sources.
-- Additive only — existing rows get NULL, which frontend
-- handles with a fallback placeholder.
-- ============================================================

alter table public.trend_audios
  add column if not exists image_url text;

comment on column public.trend_audios.image_url is
  'Album artwork URL from Apple Music (artworkUrl100) or Deezer (album.cover_medium). NULL = use fallback placeholder.';
