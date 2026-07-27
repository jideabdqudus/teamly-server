-- M4: Account bootstrap trigger.
-- OAuth users never hit POST /auth/signup, so account creation can't live in that
-- route anymore. Move it into a trigger on auth.users: every new auth user (email
-- OR Google) atomically gets a profile + an empty account. The first brand is
-- created later, in onboarding, for both flows.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_full_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''
  );
  meta_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
  -- Accounts.name is NOT NULL; fall back to the email's local part.
  account_name text := coalesce(
    nullif(meta_full_name, ''),
    split_part(new.email, '@', 1),
    'My workspace'
  );
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, meta_full_name, meta_avatar)
  on conflict (id) do nothing;

  insert into public.accounts (user_id, name)
  values (new.id, account_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Recreate the trigger idempotently.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
