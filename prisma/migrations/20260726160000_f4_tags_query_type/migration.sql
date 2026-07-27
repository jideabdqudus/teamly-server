-- F4: Prompt query-type classification + tags.

-- Query type: auto-classified on create (brand / competitor / generic), overridable.
alter table public.prompts
  add column if not exists query_type text not null default 'generic'
    check (query_type in ('brand', 'generic', 'competitor'));

-- Tags (brand-scoped) + prompt_tags join.
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);
create index if not exists idx_tags_brand on public.tags(brand_id);

create table if not exists public.prompt_tags (
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  primary key (prompt_id, tag_id)
);
create index if not exists idx_prompt_tags_tag on public.prompt_tags(tag_id);

-- RLS: owned via brand -> account -> user.
alter table public.tags enable row level security;
alter table public.prompt_tags enable row level security;

create policy "tags_own" on public.tags
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

create policy "prompt_tags_own" on public.prompt_tags
  for all using (
    exists (
      select 1 from public.prompts p
      join public.brands b on b.id = p.brand_id
      join public.accounts a on a.id = b.account_id
      where p.id = prompt_id and a.user_id = auth.uid()
    )
  );

grant all on public.tags to postgres, anon, authenticated, service_role;
grant all on public.prompt_tags to postgres, anon, authenticated, service_role;
