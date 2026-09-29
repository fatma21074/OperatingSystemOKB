-- OKB CRM: enable Realtime delivery for the live business datasets.
-- Safe/idempotent: no columns or business records are changed.

do $$
declare
  target_table text;
begin
  foreach target_table in array array['orders', 'items', 'user', 'role_permissions'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end $$;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('orders', 'items', 'user', 'role_permissions')
order by tablename;
