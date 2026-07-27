-- F5: Prompt discovery / suggestions.
-- Suggested prompts a brand can one-click add. Unique per (brand, text) so a
-- dismissed suggestion never resurfaces on the next generate.

create table if not exists public.prompt_suggestions (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  text       text not null,
  query_type text not null default 'generic'
             check (query_type in ('brand', 'generic', 'competitor')),
  source     text not null default 'llm'
             check (source in ('llm', 'template', 'keyword_api')),
  status     text not null default 'suggested'
             check (status in ('suggested', 'added', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (brand_id, text)
);

create index if not exists idx_prompt_suggestions_brand_status
  on public.prompt_suggestions(brand_id, status);

alter table public.prompt_suggestions enable row level security;

create policy "prompt_suggestions_own" on public.prompt_suggestions
  for all using (
    exists (
      select 1 from public.brands b
      join public.accounts a on a.id = b.account_id
      where b.id = brand_id and a.user_id = auth.uid()
    )
  );

grant all on public.prompt_suggestions
  to postgres, anon, authenticated, service_role;
