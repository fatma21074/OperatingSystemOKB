-- OKB v125: Role-based Commission + Branch Stock branch isolation
-- Run once after the existing migrations. Safe whether 018 was run or skipped.

-- v124 individual Commission setter is no longer part of the approved design.
drop function if exists public.okb_set_user_commission_permission(uuid,boolean,text);

-- If 018 was previously run, restore the normal user-edit column grant.
grant update(system_permissions) on public."user" to authenticated;

-- Every non-admin account is limited to managed_branches, including Account Manager.
create or replace function private.okb_can_access_branch(p_branch text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((
    select
      lower(replace(replace(trim(u.role),' ','_'),'-','_'))='admin'
      or position(lower(trim(p_branch)) in lower(coalesce(u.managed_branches,'')))>0
    from public."user" u
    where u.id=auth.uid() and u.active is true
    limit 1
  ),false);
$$;

-- Commission report data: permission comes from the selected Role, never from an individual flag.
create or replace function public.okb_get_commission_orders(p_from date,p_to date)
returns setof public.orders
language plpgsql
stable
security definer
set search_path=public,private
as $$
declare
  v_user public."user"%rowtype;
  v_role text;
  v_role_allowed boolean;
begin
  if p_from is null or p_to is null or p_from>p_to then raise exception 'فترة التقرير غير صحيحة'; end if;
  select * into v_user from public."user" where id=auth.uid() and active is true limit 1;
  if not found then raise exception 'جلسة المستخدم غير صالحة'; end if;

  v_role:=lower(replace(replace(trim(v_user.role),' ','_'),'-','_'));
  if v_role in ('operation_manager','delivery_manager','operations_manager') then v_role:='manager'; end if;
  if v_role='receptionist' then v_role:='secretary'; end if;
  if v_role in ('accounts_manager','accounting_manager','finance_manager','مدير_الحسابات') then v_role:='account_manager'; end if;
  if v_role in ('accounts_supervisor','accounting_supervisor','finance_supervisor','مشرف_الحسابات') then v_role:='account_supervisor'; end if;
  if v_role in ('branch_cashier','كاشير') then v_role:='cashier'; end if;

  select coalesce((rp.permissions->>'commission')::boolean,false)
  into v_role_allowed
  from public.role_permissions rp
  where lower(replace(replace(trim(rp.role),' ','_'),'-','_'))=v_role
  limit 1;

  if v_role<>'admin' and not coalesce(v_role_allowed,false) then
    raise exception 'Commission غير مضافة لصلاحيات الـRole الخاصة بحسابك';
  end if;
  if v_role<>'admin' and btrim(coalesce(v_user.managed_branches,''))='' then
    raise exception 'لا يوجد فرع مسند إلى حسابك';
  end if;

  return query
  select o.* from public.orders o
  where (o.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    and (
      v_role='admin'
      or position(lower(
        case
          when btrim(coalesce(o.branch,'')) in ('مدينة نصر','اسكندرية','طنطا','المنصورة') then btrim(o.branch)
          when lower(btrim(coalesce(o.shipping_company,'')))='nasr city branch' then 'مدينة نصر'
          when lower(btrim(coalesce(o.shipping_company,'')))='alexandria branch' then 'اسكندرية'
          when lower(btrim(coalesce(o.shipping_company,''))) in ('tanta branch','tan ta branch') then 'طنطا'
          when lower(btrim(coalesce(o.shipping_company,'')))='mansoura branch' then 'المنصورة'
          else ''
        end
      ) in lower(coalesce(v_user.managed_branches,'')))>0
    )
  order by o.created_at desc;
end;
$$;

revoke all on function public.okb_get_commission_orders(date,date) from public,anon;
grant execute on function public.okb_get_commission_orders(date,date) to authenticated;

-- Role permissions can be read by active users, but only Admin can change them.
drop policy if exists okb_authenticated_access on public.role_permissions;
drop policy if exists okb_role_permissions_read on public.role_permissions;
drop policy if exists okb_role_permissions_admin_write on public.role_permissions;
create policy okb_role_permissions_read on public.role_permissions
for select to authenticated using(private.okb_is_active_user());
create policy okb_role_permissions_admin_write on public.role_permissions
for all to authenticated
using(lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'))='admin')
with check(lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'))='admin');

-- Branch assignments are security boundaries and may only be changed by Admin.
create or replace function public.okb_guard_user_branch_permissions()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
declare v_role text;
begin
  if auth.role()='service_role' then return new; end if;
  if new.managed_branches is distinct from old.managed_branches
     or new.system_permissions is distinct from old.system_permissions then
    v_role:=lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'));
    if v_role<>'admin' then raise exception 'تعديل الفروع والصلاحيات متاح للـAdmin فقط'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_okb_guard_user_branch_permissions on public."user";
create trigger trg_okb_guard_user_branch_permissions
before update of managed_branches,system_permissions on public."user"
for each row execute function public.okb_guard_user_branch_permissions();

-- Branch Stock table reads and direct edits are branch-scoped in Supabase.
drop policy if exists okb_authenticated_access on public.branch_inventory;
drop policy if exists okb_branch_inventory_scoped on public.branch_inventory;
create policy okb_branch_inventory_scoped on public.branch_inventory
for all to authenticated
using(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch))
with check(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch));

drop policy if exists okb_authenticated_access on public.branch_stock_logs;
drop policy if exists okb_branch_stock_logs_scoped on public.branch_stock_logs;
create policy okb_branch_stock_logs_scoped on public.branch_stock_logs
for all to authenticated
using(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch))
with check(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch));

drop policy if exists okb_branch_stock_receipts_read on public.branch_stock_receipts;
drop policy if exists okb_branch_stock_receipts_scoped on public.branch_stock_receipts;
create policy okb_branch_stock_receipts_scoped on public.branch_stock_receipts
for select to authenticated
using(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch));

drop policy if exists okb_branch_stock_postings_read on public.branch_stock_order_postings;
drop policy if exists okb_branch_stock_postings_scoped on public.branch_stock_order_postings;
create policy okb_branch_stock_postings_scoped on public.branch_stock_order_postings
for select to authenticated
using(private.okb_has_feature('branch_stock') and private.okb_can_access_branch(branch));

-- This guard also protects the older SECURITY DEFINER receipt actions by receipt id.
create or replace function public.okb_guard_branch_stock_receipt_write()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
declare v_branch text;
begin
  v_branch:=case when tg_op='DELETE' then old.branch else new.branch end;
  if not private.okb_can_access_branch(v_branch) then
    raise exception 'غير مسموح لك بالتعامل مع جرد هذا الفرع';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_okb_guard_branch_stock_receipt_write on public.branch_stock_receipts;
create trigger trg_okb_guard_branch_stock_receipt_write
before insert or update or delete on public.branch_stock_receipts
for each row execute function public.okb_guard_branch_stock_receipt_write();

revoke delete on public.branch_inventory,public.branch_stock_logs from authenticated;
