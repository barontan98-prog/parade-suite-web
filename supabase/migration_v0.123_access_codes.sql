-- Parade Suite Web v0.123 - passcode users

create extension if not exists pgcrypto;

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  pin_salt text not null,
  pin_hash text not null,
  role text not null default 'user' check (role in ('admin','user')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create index if not exists access_codes_role_idx
  on public.access_codes(role);

create index if not exists access_codes_active_idx
  on public.access_codes(active);

alter table public.access_codes enable row level security;

create table if not exists public.access_attempts (
  fingerprint text primary key,
  attempt_count integer not null default 0,
  window_started timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.access_attempts enable row level security;

-- No anon/public policies are created for either table.
-- They are accessed only by Vercel server routes via SUPABASE_SERVICE_ROLE_KEY.
