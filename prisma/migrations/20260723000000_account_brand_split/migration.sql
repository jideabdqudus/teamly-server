-- M1: Account / Brand split (destructive rebuild).
-- Splits the old 1:1 `organizations` (account + brand + billing) into:
--   accounts  — one per user (owns future BYO keys; no plan/stripe)
--   brands    — many per account (owns brand fields + all data)
-- All child tables move from `org_id` -> `brand_id`. RLS is re-chained brand -> account -> user.
-- Destructive: existing app data is dropped (pre-launch, disposable test data only).

-- ── Drop existing app tables (cascade removes policies, indexes, FKs) ──────────
drop table if exists public.alert_history cascade;
drop table if exists public.alert_rules cascade;
drop table if exists public.prompt_visibility_daily cascade;
drop table if exists public.visibility_daily cascade;
drop table if exists public.citations cascade;
drop table if exists public.mentions cascade;
drop table if exists public.responses cascade;
drop table if exists public.scans cascade;
drop table if exists public.competitors cascade;
drop table if exists public.prompts cascade;
drop table if exists public.brands cascade;
drop table if exists public.accounts cascade;
drop table if exists public.organizations cascade;
drop table if exists public.profiles cascade;

-- ── Profiles (extends Supabase auth.users) ────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Accounts (one per user — the workspace; owns BYO keys later) ───────────────
create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade unique,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_accounts_user on public.accounts(user_id);

-- ── Brands (many per account — a tracked company; owns all data) ───────────────
create table public.brands (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  name            text not null,
  brand_name      text not null,
  domain          text,
  industry        text,
  enabled_models  text[] not null default array['ChatGPT'],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_brands_account on public.brands(account_id);

-- ── Prompts ───────────────────────────────────────────────────────────────────
create table public.prompts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  text          text not null,
  country       text not null default 'United States',
  country_code  text not null default 'US',
  language      text not null default 'English',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_prompts_brand on public.prompts(brand_id);

-- ── Competitors ───────────────────────────────────────────────────────────────
create table public.competitors (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  domain      text,
  created_at  timestamptz not null default now()
);

create index idx_competitors_brand on public.competitors(brand_id);

-- ── Scans ─────────────────────────────────────────────────────────────────────
create table public.scans (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'running', 'completed', 'failed')),
  triggered_by    text not null default 'cron'
                  check (triggered_by in ('cron', 'manual', 'onboarding')),
  total_tasks     int not null default 0,
  completed_tasks int not null default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_scans_brand on public.scans(brand_id);

-- ── Responses ─────────────────────────────────────────────────────────────────
create table public.responses (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references public.scans(id) on delete cascade,
  brand_id          uuid not null references public.brands(id) on delete cascade,
  prompt_id         uuid not null references public.prompts(id) on delete cascade,
  model             text not null,
  status            text not null default 'pending'
                    check (status in ('pending', 'success', 'failed')),
  raw_response      text,
  snippet           text,
  brand_mentioned   boolean not null default false,
  mention_position  int,
  brand_sentiment   text
                    check (brand_sentiment in ('positive', 'neutral', 'negative') or brand_sentiment is null),
  queried_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index idx_responses_scan on public.responses(scan_id);
create index idx_responses_brand_prompt on public.responses(brand_id, prompt_id);
create index idx_responses_model on public.responses(model);

-- ── Mentions ──────────────────────────────────────────────────────────────────
create table public.mentions (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid not null references public.responses(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('brand', 'competitor')),
  position      int,
  created_at    timestamptz not null default now()
);

create index idx_mentions_response on public.mentions(response_id);
create index idx_mentions_brand on public.mentions(brand_id);

-- ── Citations ─────────────────────────────────────────────────────────────────
create table public.citations (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid not null references public.responses(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  prompt_id     uuid not null references public.prompts(id) on delete cascade,
  url           text not null,
  domain        text not null,
  title         text,
  model         text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index idx_citations_brand on public.citations(brand_id);
create index idx_citations_domain on public.citations(domain);

-- ── Visibility Daily (aggregated daily score per brand) ───────────────────────
create table public.visibility_daily (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  scan_id         uuid references public.scans(id) on delete set null,
  date            date not null,
  score           int not null default 0,
  total_responses int not null default 0,
  total_mentions  int not null default 0,
  total_citations int not null default 0,
  model_scores    jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (brand_id, date)
);

create index idx_visibility_brand_date on public.visibility_daily(brand_id, date desc);

-- ── Prompt Visibility Daily (per-prompt daily score) ──────────────────────────
create table public.prompt_visibility_daily (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  prompt_id   uuid not null references public.prompts(id) on delete cascade,
  date        date not null,
  score       int not null default 0,
  mentions    int not null default 0,
  responses   int not null default 0,
  citations   int not null default 0,
  avg_position numeric(4,2),
  created_at  timestamptz not null default now(),
  unique (brand_id, prompt_id, date)
);

create index idx_prompt_vis_brand_prompt on public.prompt_visibility_daily(brand_id, prompt_id, date desc);

-- ── Alert Rules ───────────────────────────────────────────────────────────────
create table public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  type        text not null
              check (type in ('visibility_drop', 'competitor_overtake', 'new_citation')),
  enabled     boolean not null default true,
  threshold   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_alert_rules_brand on public.alert_rules(brand_id);

-- ── Alert History ─────────────────────────────────────────────────────────────
create table public.alert_history (
  id        uuid primary key default gen_random_uuid(),
  brand_id  uuid not null references public.brands(id) on delete cascade,
  rule_id   uuid references public.alert_rules(id) on delete set null,
  type      text not null,
  message   text not null,
  read      boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_alert_history_brand on public.alert_history(brand_id, created_at desc);

-- ============================================================
-- Row Level Security (RLS) — re-chained brand -> account -> user
-- Note: the API uses the service_role key which bypasses RLS; these policies are
-- defense-in-depth for any future direct (authenticated-role) access.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.brands enable row level security;
alter table public.prompts enable row level security;
alter table public.competitors enable row level security;
alter table public.scans enable row level security;
alter table public.responses enable row level security;
alter table public.mentions enable row level security;
alter table public.citations enable row level security;
alter table public.visibility_daily enable row level security;
alter table public.prompt_visibility_daily enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_history enable row level security;

-- Profiles: users own their own row
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id);

-- Accounts: users own their own account
create policy "accounts_own" on public.accounts
  for all using (auth.uid() = user_id);

-- Brands: owned via account
create policy "brands_own" on public.brands
  for all using (
    exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())
  );

-- Child tables: owned via brand -> account -> user
create policy "prompts_own" on public.prompts
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "competitors_own" on public.competitors
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "scans_own" on public.scans
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "responses_own" on public.responses
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "mentions_own" on public.mentions
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "citations_own" on public.citations
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "visibility_daily_own" on public.visibility_daily
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "prompt_vis_daily_own" on public.prompt_visibility_daily
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "alert_rules_own" on public.alert_rules
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "alert_history_own" on public.alert_history
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

-- ── Grants (Supabase API roles; re-applied after any prisma migrate reset) ─────
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to postgres, anon, authenticated, service_role;
