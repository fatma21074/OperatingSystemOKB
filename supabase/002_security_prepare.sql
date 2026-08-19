-- OKB CRM security wall - phase 1 (safe preparation)
-- Run this file first. It does not enable RLS yet, so the live app is not interrupted.

create extension if not exists pgcrypto;

alter table public."user"
  add column if not exists password_hash text;

update public."user"
set password_hash = crypt(password, gen_salt('bf', 11))
where password is not null
  and btrim(password) <> ''
  and (password_hash is null or password_hash = '');

create or replace function public.okb_hash_user_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.password is not null and btrim(new.password) <> '' then
    if tg_op = 'INSERT' or old.password is distinct from new.password then
      new.password_hash := crypt(new.password, gen_salt('bf', 11));
      new.password := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_okb_hash_user_password on public."user";
create trigger trg_okb_hash_user_password
before insert or update of password on public."user"
for each row execute function public.okb_hash_user_password();

create or replace function public.verify_okb_credentials(p_username text, p_password text)
returns table (
  id uuid,
  name text,
  username text,
  role text,
  active boolean,
  managed_branches text,
  system_permissions jsonb
)
language sql
security definer
set search_path = public, extensions
as $$
  select u.id, u.name, u.username, u.role, u.active,
         u.managed_branches, u.system_permissions
  from public."user" u
  where lower(btrim(u.username)) = lower(btrim(p_username))
    and u.active is true
    and u.password_hash is not null
    and u.password_hash = crypt(p_password, u.password_hash)
  order by u.id
  limit 1;
$$;

revoke all on function public.verify_okb_credentials(text, text) from public, anon, authenticated;
grant execute on function public.verify_okb_credentials(text, text) to service_role;

create schema if not exists private;
revoke all on schema private from public, anon;

create or replace function private.okb_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role from public."user" u
  where u.id = auth.uid() and u.active is true
  limit 1;
$$;

create or replace function private.okb_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public."user" u
    where u.id = auth.uid() and u.active is true
  );
$$;

create or replace function public.okb_list_chat_users()
returns table (id uuid, name text, username text, role text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.name, u.username, u.role, u.active
  from public."user" u
  where private.okb_is_active_user() and u.active is true
  order by u.name;
$$;
revoke all on function public.okb_list_chat_users() from public, anon;
grant execute on function public.okb_list_chat_users() to authenticated;

create or replace function public.okb_change_my_password(p_current_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or coalesce(p_new_password, '') = '' then return false; end if;
  update public."user" u
  set password_hash = crypt(p_new_password, gen_salt('bf', 11)), password = null
  where u.id = auth.uid()
    and u.active is true
    and u.password_hash = crypt(p_current_password, u.password_hash);
  return found;
end;
$$;
revoke all on function public.okb_change_my_password(text, text) from public, anon;
grant execute on function public.okb_change_my_password(text, text) to authenticated;

select
  count(*) as total_users,
  count(*) filter (where password_hash is not null) as protected_passwords
from public."user";
