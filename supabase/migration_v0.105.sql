-- Parade Suite Web v0.105 Windows Playback Parity migration
-- Run this once in Supabase SQL Editor before deploying v0.105.

alter table public.tracks
  add column if not exists timing_map jsonb not null default '[]'::jsonb;

alter table public.tracks
  add column if not exists repeat_start_ms integer;

alter table public.tracks
  add column if not exists repeat_end_ms integer;

alter table public.tracks
  add column if not exists repeat_mode text;

alter table public.tracks
  add column if not exists lib_name text;
