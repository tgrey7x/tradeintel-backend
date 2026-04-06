-- ════════════════════════════════════════════════════════════════
-- Migration 001 — Brands + Custom Domains (Phase 1B Task #5)
-- Source of truth: CLAUDE.md — Simple Mode AI Search + Brand Swap + Custom Domain
--
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to run multiple times: uses IF NOT EXISTS / DROP POLICY guards.
-- ════════════════════════════════════════════════════════════════

-- ── BRANDS TABLE ──
-- One row per white-label tenant. The "ixintel" row is the default brand.
create table if not exists public.brands (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,                 -- e.g. "ixintel", "acme-trade"
  name           text not null,                        -- display name, e.g. "IXIntel"
  tagline        text default '',                      -- short marketing line
  logo_url       text default '',                      -- full URL to logo image
  favicon_url    text default '',
  primary_color  text default '#00ff9f',               -- hex color used for accents
  accent_color   text default '#00b8ff',
  support_email  text default '',
  owner_user_id  uuid references auth.users(id) on delete set null,
  is_default     boolean default false,                -- exactly one row should be true
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists brands_slug_idx on public.brands (slug);
create index if not exists brands_owner_idx on public.brands (owner_user_id);

-- ── CUSTOM DOMAINS TABLE ──
-- Maps host headers (e.g. "trade.acme.com") to a brand.
-- Verification happens by checking a TXT or CNAME record; stored here once verified.
create table if not exists public.custom_domains (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  hostname         text unique not null,                -- lowercased host, no scheme, no trailing dot
  verification_token text not null,                     -- random string the customer must publish
  verified         boolean default false,
  verified_at      timestamptz,
  ssl_status       text default 'pending',              -- pending | active | error
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists custom_domains_hostname_idx on public.custom_domains (hostname);
create index if not exists custom_domains_brand_idx on public.custom_domains (brand_id);

-- ── PROFILES → BRANDS LINK ──
-- Each user belongs to one brand (defaults to the default brand).
-- Adds brand_id column if it doesn't already exist.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'brand_id'
  ) then
    alter table public.profiles
      add column brand_id uuid references public.brands(id) on delete set null;
    create index profiles_brand_idx on public.profiles (brand_id);
  end if;
end $$;

-- ── SEED THE DEFAULT BRAND ──
-- Upsert so re-runs don't duplicate.
insert into public.brands (slug, name, tagline, primary_color, accent_color, is_default)
values ('ixintel', 'IXIntel', 'Global Trade Intelligence', '#00ff9f', '#00b8ff', true)
on conflict (slug) do nothing;

-- ── ROW-LEVEL SECURITY ──
alter table public.brands enable row level security;
alter table public.custom_domains enable row level security;

-- Everyone (even anon) can read brand rows so the public UI can theme itself.
drop policy if exists "brands_public_read" on public.brands;
create policy "brands_public_read"
  on public.brands for select
  using (true);

-- Only the brand owner or admins can update their brand.
drop policy if exists "brands_owner_update" on public.brands;
create policy "brands_owner_update"
  on public.brands for update
  using (
    auth.uid() = owner_user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','super_admin')
    )
  );

-- Only admins can insert new brands (server side uses service key and bypasses RLS).
drop policy if exists "brands_admin_insert" on public.brands;
create policy "brands_admin_insert"
  on public.brands for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','super_admin')
    )
  );

-- Custom domains: same permission model as brands.
drop policy if exists "custom_domains_public_read" on public.custom_domains;
create policy "custom_domains_public_read"
  on public.custom_domains for select
  using (verified = true);

drop policy if exists "custom_domains_owner_write" on public.custom_domains;
create policy "custom_domains_owner_write"
  on public.custom_domains for all
  using (
    exists (
      select 1 from public.brands b
      where b.id = custom_domains.brand_id
        and (b.owner_user_id = auth.uid()
             or exists (select 1 from public.profiles p
                        where p.id = auth.uid() and p.role in ('admin','super_admin')))
    )
  );
