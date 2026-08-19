-- OKB CRM security wall - phase 2 (lockdown)
-- Run ONLY after the Edge Function and secured frontend login have been tested.

do $$
declare t text;
begin
  foreach t in array array[
    'activity_logs','branch_inventory','branch_stock_logs','branchs',
    'chat_messages','customers','doctors','items','khazna_lock','orders',
    'role_permissions','shipping_system','user_permissions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists okb_authenticated_access on public.%I', t);
    execute format(
      'create policy okb_authenticated_access on public.%I for all to authenticated using (private.okb_is_active_user()) with check (private.okb_is_active_user())', t
    );
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

alter table public."user" enable row level security;
drop policy if exists okb_user_read on public."user";
drop policy if exists okb_user_write on public."user";
create policy okb_user_read on public."user"
for select to authenticated
using (
  id = auth.uid()
  or private.okb_current_user_role() in ('admin','executive_assistant')
);
create policy okb_user_write on public."user"
for all to authenticated
using (private.okb_current_user_role() in ('admin','executive_assistant'))
with check (private.okb_current_user_role() in ('admin','executive_assistant'));

revoke all on table public."user" from anon;
grant select (id,name,username,role,active,managed_branches,system_permissions) on public."user" to authenticated;
grant insert (name,username,password,role,active,managed_branches,system_permissions) on public."user" to authenticated;
grant update (name,username,role,active,managed_branches,system_permissions) on public."user" to authenticated;
grant delete on public."user" to authenticated;

-- Remove the recoverable plaintext after the secure login has been verified.
update public."user" set password = null where password_hash is not null;

-- Existing permissive policies must not remain alongside the secure policy.
-- The block below removes every other policy on the protected app tables.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'activity_logs','branch_inventory','branch_stock_logs','branchs',
        'chat_messages','customers','doctors','items','khazna_lock','orders',
        'role_permissions','shipping_system','user_permissions'
      )
      and policyname <> 'okb_authenticated_access'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
