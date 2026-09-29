-- OKB v139: scheduled branch Sticky Notes with Role/page-aligned branch access.
-- Requires the existing secure session migrations and migration 020.
-- This is additive only: it does not change orders, stock, commissions, or existing tables.

create table if not exists public.branch_sticky_notes (
  branch_name text primary key,
  display_text text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_sticky_notes_branch_check check (branch_name in ('مدينة نصر','اسكندرية','طنطا','المنصورة')),
  constraint branch_sticky_notes_text_check check (char_length(btrim(display_text)) between 1 and 300),
  constraint branch_sticky_notes_period_check check (ends_at > starts_at)
);

create or replace function public.okb_touch_branch_sticky_note()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  new.display_text:=btrim(new.display_text);
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  if tg_op='INSERT' then
    new.created_by:=coalesce(new.created_by,auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_okb_touch_branch_sticky_note on public.branch_sticky_notes;
create trigger trg_okb_touch_branch_sticky_note
before insert or update on public.branch_sticky_notes
for each row execute function public.okb_touch_branch_sticky_note();

alter table public.branch_sticky_notes enable row level security;

-- Match the database read boundary to the exact branch-page permission model:
-- Role permissions decide which page exists, while branch-scoped operational
-- roles remain limited to the branches assigned to their individual account.
create or replace function private.okb_can_read_branch_sticky_note(p_branch text)
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select coalesce((
    select
      private.okb_canonical_role(u.role)='admin'
      or (
        private.okb_role_has_feature('okb_stores')
        and private.okb_role_has_feature(
          case btrim(coalesce(p_branch,''))
            when 'مدينة نصر' then 'branch_nasr'
            when 'اسكندرية' then 'branch_alex'
            when 'طنطا' then 'branch_tanta'
            when 'المنصورة' then 'branch_mansoura'
            else '__invalid_branch__'
          end
        )
        and (
          private.okb_canonical_role(u.role) not in ('store_manager','cashier','account_supervisor')
          or private.okb_can_access_branch(p_branch)
        )
      )
    from public."user" u
    where u.id=auth.uid() and u.active is true
    limit 1
  ),false);
$$;

drop policy if exists okb_branch_sticky_notes_read on public.branch_sticky_notes;
drop policy if exists okb_branch_sticky_notes_admin_write on public.branch_sticky_notes;

create policy okb_branch_sticky_notes_read on public.branch_sticky_notes
for select to authenticated
using (
  private.okb_canonical_role(private.okb_current_user_role())='admin'
  or (
    active is true
    and now() between starts_at and ends_at
    and private.okb_can_read_branch_sticky_note(branch_name)
  )
);

create policy okb_branch_sticky_notes_admin_write on public.branch_sticky_notes
for all to authenticated
using (private.okb_canonical_role(private.okb_current_user_role())='admin')
with check (private.okb_canonical_role(private.okb_current_user_role())='admin');

revoke all on function private.okb_can_read_branch_sticky_note(text) from public,anon;
grant execute on function private.okb_can_read_branch_sticky_note(text) to authenticated;

revoke all on public.branch_sticky_notes from public,anon;
grant select,insert,update,delete on public.branch_sticky_notes to authenticated;

select '022_branch_sticky_notes installed successfully' as migration_status;
