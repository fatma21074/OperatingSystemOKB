-- OKB CRM secure-session compatibility
-- Run after 002_security_prepare.sql and before 003_security_lockdown.sql.
-- This keeps the current live policies intact while allowing the new authenticated JWT session.

do $$
declare t text;
begin
  foreach t in array array[
    'activity_logs',
    'branch_inventory',
    'branch_stock_logs',
    'chat_messages',
    'customers',
    'items',
    'role_permissions'
  ] loop
    execute format('drop policy if exists okb_secure_session_transition on public.%I', t);
    execute format(
      'create policy okb_secure_session_transition on public.%I for all to authenticated using (private.okb_is_active_user()) with check (private.okb_is_active_user())',
      t
    );
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and policyname = 'okb_secure_session_transition'
order by tablename;
