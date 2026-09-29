-- OKB CRM - accurate user Last Seen (independent from Activity Log)
-- Run once in Supabase SQL Editor before deploying the matching frontend.

alter table public."user"
  add column if not exists last_seen_at timestamptz;

comment on column public."user".last_seen_at is
  'Last authenticated heartbeat. Used only for Online/Last Seen/Offline display.';

create or replace function public.okb_touch_last_seen()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seen_at timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  update public."user"
     set last_seen_at = v_seen_at
   where id = (select auth.uid())
     and active is true;

  if not found then
    return null;
  end if;

  return v_seen_at;
end;
$$;

revoke all on function public.okb_touch_last_seen() from public, anon;
grant execute on function public.okb_touch_last_seen() to authenticated;

-- The existing user RLS policy still controls which user rows may be read.
grant select (last_seen_at) on public."user" to authenticated;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user'
  and column_name = 'last_seen_at';
