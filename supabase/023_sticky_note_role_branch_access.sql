-- OKB v139: fix Sticky Note visibility for users whose branch page is granted by Role.
-- Safe after migration 022. This changes only Sticky Note read authorization.

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

revoke all on function private.okb_can_read_branch_sticky_note(text) from public,anon;
grant execute on function private.okb_can_read_branch_sticky_note(text) to authenticated;

select '023_sticky_note_role_branch_access installed successfully' as migration_status;
