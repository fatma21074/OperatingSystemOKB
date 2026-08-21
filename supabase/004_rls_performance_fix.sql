-- OKB CRM - RLS performance optimization
-- Keeps the same security. It only evaluates the active session once per SQL statement.

do $$
declare t text;
begin
  foreach t in array array[
    'activity_logs','branch_inventory','branch_stock_logs','branchs',
    'chat_messages','customers','doctors','items','khazna_lock','orders',
    'role_permissions','shipping_system','user_permissions'
  ] loop
    execute format('drop policy if exists okb_authenticated_access on public.%I', t);
    execute format(
      'create policy okb_authenticated_access on public.%I for all to authenticated using ((select private.okb_is_active_user())) with check ((select private.okb_is_active_user()))',
      t
    );
  end loop;
end $$;

drop policy if exists okb_user_read on public."user";
drop policy if exists okb_user_write on public."user";

create policy okb_user_read on public."user"
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.okb_current_user_role()) in ('admin','executive_assistant')
);

create policy okb_user_write on public."user"
for all to authenticated
using ((select private.okb_current_user_role()) in ('admin','executive_assistant'))
with check ((select private.okb_current_user_role()) in ('admin','executive_assistant'));

create index if not exists activity_logs_action_date_id_idx
  on public.activity_logs (action_date, id desc);

create index if not exists activity_logs_username_id_idx
  on public.activity_logs (username, id desc);

analyze public.activity_logs;
analyze public.orders;

select tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
  and policyname in ('okb_authenticated_access','okb_user_read','okb_user_write')
order by tablename, policyname;
