-- Pulseo initial schema (same as migrations/001_initial_schema.sql)

-- Profiles (extends Supabase auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Organizations (one per user — no multi-seat in MVP)
create table if not exists public.organizations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade unique,
  name              text not null,
  brand_name        text not null,
  domain            text,
  industry          text,
  plan_tier         text not null default 'free'
                    check (plan_tier in ('free', 'starter', 'pro', 'agency')),
  enabled_models    text[] not null default array['ChatGPT'],
  stripe_customer_id        text,
  stripe_subscription_id    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_orgs_user on public.organizations(user_id);

-- Prompts
create table if not exists public.prompts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  text          text not null,
  country       text not null default 'United States',
  country_code  text not null default 'US',
  language      text not null default 'English',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_prompts_org on public.prompts(org_id);

-- Competitors
create table if not exists public.competitors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  domain      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_competitors_org on public.competitors(org_id);

-- Scans (a batch execution: all prompts × all enabled models)
create table if not exists public.scans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
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

create index if not exists idx_scans_org on public.scans(org_id);

-- Responses (one per prompt × model per scan)
create table if not exists public.responses (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references public.scans(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
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

create index if not exists idx_responses_scan on public.responses(scan_id);
create index if not exists idx_responses_org_prompt on public.responses(org_id, prompt_id);
create index if not exists idx_responses_model on public.responses(model);

-- Mentions (brand/competitor occurrences extracted from responses)
create table if not exists public.mentions (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid not null references public.responses(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('brand', 'competitor')),
  position      int,
  created_at    timestamptz not null default now()
);

create index if not exists idx_mentions_response on public.mentions(response_id);
create index if not exists idx_mentions_org on public.mentions(org_id);

-- Citations (URLs extracted from responses)
create table if not exists public.citations (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid not null references public.responses(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  prompt_id     uuid not null references public.prompts(id) on delete cascade,
  url           text not null,
  domain        text not null,
  title         text,
  model         text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_citations_org on public.citations(org_id);
create index if not exists idx_citations_domain on public.citations(domain);

-- Visibility Daily (aggregated daily score per org)
create table if not exists public.visibility_daily (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  scan_id         uuid references public.scans(id) on delete set null,
  date            date not null,
  score           int not null default 0,
  total_responses int not null default 0,
  total_mentions  int not null default 0,
  total_citations int not null default 0,
  model_scores    jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (org_id, date)
);

create index if not exists idx_visibility_org_date on public.visibility_daily(org_id, date desc);

-- Prompt Visibility Daily (per-prompt daily score)
create table if not exists public.prompt_visibility_daily (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  prompt_id   uuid not null references public.prompts(id) on delete cascade,
  date        date not null,
  score       int not null default 0,
  mentions    int not null default 0,
  responses   int not null default 0,
  citations   int not null default 0,
  avg_position numeric(4,2),
  created_at  timestamptz not null default now(),
  unique (org_id, prompt_id, date)
);

create index if not exists idx_prompt_vis_org_prompt on public.prompt_visibility_daily(org_id, prompt_id, date desc);

-- Alert Rules (deferred — schema in place for future use)
create table if not exists public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  type        text not null
              check (type in ('visibility_drop', 'competitor_overtake', 'new_citation')),
  enabled     boolean not null default true,
  threshold   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Alert History (deferred — schema in place for future use)
create table if not exists public.alert_history (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  rule_id   uuid references public.alert_rules(id) on delete set null,
  type      text not null,
  message   text not null,
  read      boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_alert_history_org on public.alert_history(org_id, created_at desc);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
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

create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id);

create policy "orgs_own" on public.organizations
  for all using (auth.uid() = user_id);

create policy "prompts_own" on public.prompts
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "competitors_own" on public.competitors
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "scans_own" on public.scans
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "responses_own" on public.responses
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "mentions_own" on public.mentions
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "citations_own" on public.citations
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "visibility_daily_own" on public.visibility_daily
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "prompt_vis_daily_own" on public.prompt_visibility_daily
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "alert_rules_own" on public.alert_rules
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );

create policy "alert_history_own" on public.alert_history
  for all using (
    exists (select 1 from public.organizations o where o.id = org_id and o.user_id = auth.uid())
  );
