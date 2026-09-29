-- OKB CRM - fast secure credential lookup
-- Keeps bcrypt and the same passwords, but guarantees one bcrypt check per login.

create index if not exists user_username_normalized_idx
  on public."user" (lower(btrim(username)))
  where active is true;

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
  with candidate as materialized (
    select u.id, u.name, u.username, u.role, u.active,
           u.managed_branches, u.system_permissions, u.password_hash
    from public."user" u
    where lower(btrim(u.username)) = lower(btrim(p_username))
      and u.active is true
    order by u.id
    limit 1
  )
  select c.id, c.name, c.username, c.role, c.active,
         c.managed_branches, c.system_permissions
  from candidate c
  where c.password_hash is not null
    and c.password_hash = crypt(p_password, c.password_hash);
$$;

revoke all on function public.verify_okb_credentials(text, text) from public, anon, authenticated;
grant execute on function public.verify_okb_credentials(text, text) to service_role;

notify pgrst, 'reload schema';

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'user'
  and indexname = 'user_username_normalized_idx';
