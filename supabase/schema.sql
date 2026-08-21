-- Parade Suite Web v0.104
create extension if not exists pgcrypto;

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Others',
  file_url text not null,
  source_name text,
  has_lib boolean not null default false,
  has_timing_map boolean not null default false,
  timing_map jsonb not null default '[]'::jsonb,
  repeat_start_ms integer,
  repeat_end_ms integer,
  repeat_mode text,
  lib_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.sequence_items (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  action text not null check (action in ('Repeat','End','Interlude')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sequence_items_position_idx on public.sequence_items(position);

alter table public.tracks enable row level security;
alter table public.sequence_items enable row level security;

-- Simple single-user/demo policies.
-- Replace with authenticated user_id policies before using this for multiple users.
drop policy if exists "public read tracks" on public.tracks;
create policy "public read tracks" on public.tracks for select using (true);

drop policy if exists "public insert tracks" on public.tracks;
create policy "public insert tracks" on public.tracks for insert with check (true);

drop policy if exists "public update tracks" on public.tracks;
create policy "public update tracks" on public.tracks for update using (true) with check (true);

drop policy if exists "public delete tracks" on public.tracks;
create policy "public delete tracks" on public.tracks for delete using (true);

drop policy if exists "public read sequence" on public.sequence_items;
create policy "public read sequence" on public.sequence_items for select using (true);

drop policy if exists "public insert sequence" on public.sequence_items;
create policy "public insert sequence" on public.sequence_items for insert with check (true);

drop policy if exists "public update sequence" on public.sequence_items;
create policy "public update sequence" on public.sequence_items for update using (true) with check (true);

drop policy if exists "public delete sequence" on public.sequence_items;
create policy "public delete sequence" on public.sequence_items for delete using (true);

insert into storage.buckets (id, name, public)
values ('music', 'music', true)
on conflict (id) do update set public = true;

drop policy if exists "public music read" on storage.objects;
create policy "public music read"
on storage.objects for select
using (bucket_id = 'music');

drop policy if exists "public music upload" on storage.objects;
create policy "public music upload"
on storage.objects for insert
with check (bucket_id = 'music');

drop policy if exists "public music delete" on storage.objects;
create policy "public music delete"
on storage.objects for delete
using (bucket_id = 'music');
