-- Parade Suite Web v0.106 - LIB matching/tick fix
-- Run this once in Supabase SQL Editor before using v0.106.

alter table public.tracks
  add column if not exists source_name text;

alter table public.tracks
  add column if not exists has_lib boolean not null default false;

-- Existing tracks that already had a usable timing map definitely had a LIB.
update public.tracks
set has_lib = true
where has_timing_map = true;
