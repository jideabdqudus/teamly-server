-- M2: BYOK — account-level API keys + account-level enabled_models.
-- Moves enabled_models from brands -> accounts and adds the encrypted provider_keys table.

-- ── Move enabled_models to accounts ───────────────────────────────────────────
alter table public.accounts
  add column if not exists enabled_models text[] not null default array['ChatGPT'];

-- Backfill each account from its earliest brand's model selection (best-effort).
update public.accounts a
set enabled_models = coalesce(
  (
    select b.enabled_models
    from public.brands b
    where b.account_id = a.id
    order by b.created_at asc
    limit 1
  ),
  array['ChatGPT']
);

alter table public.brands drop column if exists enabled_models;

-- ── Provider keys (account-scoped, AES-256-GCM encrypted) ─────────────────────
create table if not exists public.provider_keys (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  provider          text not null
                    check (provider in ('openai', 'anthropic', 'google', 'xai', 'perplexity')),
  ciphertext        text not null,
  iv                text not null,
  auth_tag          text not null,
  masked            text not null,
  last_validated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_id, provider)
);

create index if not exists idx_provider_keys_account on public.provider_keys(account_id);

-- RLS: owned via account -> user (service role bypasses; defense-in-depth).
alter table public.provider_keys enable row level security;

create policy "provider_keys_own" on public.provider_keys
  for all using (
    exists (select 1 from public.accounts a where a.id = account_id and a.user_id = auth.uid())
  );

-- Grants (Supabase API roles).
grant all on public.provider_keys to postgres, anon, authenticated, service_role;
