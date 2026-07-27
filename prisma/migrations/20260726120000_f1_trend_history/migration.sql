-- F1: Trend deltas & history on every KPI.
-- Adds derived aggregates to visibility_daily and a per-competitor daily snapshot
-- so trends/deltas read from *_daily tables without re-scanning raw responses.

alter table public.visibility_daily
  add column if not exists brand_sov       int not null default 0,
  add column if not exists avg_position    numeric(4, 2),
  add column if not exists sentiment_score int; -- 0–100, nullable until F2 lands

-- Per-competitor daily snapshot — unblocks sovChange / positionChange.
create table if not exists public.competitor_visibility_daily (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands(id) on delete cascade,
  competitor_id  uuid not null references public.competitors(id) on delete cascade,
  date           date not null,
  share_of_voice int not null default 0,
  mentions       int not null default 0,
  avg_position   numeric(4, 2),
  created_at     timestamptz not null default now(),
  unique (brand_id, competitor_id, date)
);

create index if not exists idx_comp_vis_daily_brand_date
  on public.competitor_visibility_daily(brand_id, date desc);

-- RLS: owned via brand -> account -> user (service role bypasses; defence-in-depth).
alter table public.competitor_visibility_daily enable row level security;

create policy "comp_vis_daily_own" on public.competitor_visibility_daily
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

grant all on public.competitor_visibility_daily
  to postgres, anon, authenticated, service_role;
