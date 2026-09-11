-- OKB v127: enforce Commission permission from Role permissions.
-- Safe after 018 and/or 019. Does not change orders, commission formulas, or stock.

create or replace function private.okb_canonical_role(p_role text)
returns text
language sql
immutable
as $$
  select case lower(replace(replace(btrim(coalesce(p_role,'')),' ','_'),'-','_'))
    when 'operation_manager' then 'manager'
    when 'delivery_manager' then 'manager'
    when 'operations_manager' then 'manager'
    when 'receptionist' then 'secretary'
    when 'accounts_manager' then 'account_manager'
    when 'accounting_manager' then 'account_manager'
    when 'finance_manager' then 'account_manager'
    when 'مدير_الحسابات' then 'account_manager'
    when 'accounts_supervisor' then 'account_supervisor'
    when 'accounting_supervisor' then 'account_supervisor'
    when 'finance_supervisor' then 'account_supervisor'
    when 'مشرف_الحسابات' then 'account_supervisor'
    when 'branch_cashier' then 'cashier'
    when 'كاشير' then 'cashier'
    else lower(replace(replace(btrim(coalesce(p_role,'')),' ','_'),'-','_'))
  end;
$$;

create or replace function private.okb_role_has_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select coalesce((
    select private.okb_canonical_role(u.role)='admin'
      or exists(
        select 1
        from public.role_permissions rp
        where private.okb_canonical_role(rp.role)=private.okb_canonical_role(u.role)
          and lower(coalesce(rp.permissions->>p_feature,'false')) in ('true','1','yes','on')
      )
    from public."user" u
    where u.id=auth.uid() and u.active is true
    limit 1
  ),false);
$$;

revoke all on function private.okb_role_has_feature(text) from public,anon;
grant execute on function private.okb_role_has_feature(text) to authenticated;

-- Keep every non-Admin user inside the branches assigned to the account.
create or replace function private.okb_can_access_branch(p_branch text)
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select coalesce((
    select private.okb_canonical_role(u.role)='admin'
      or (
        btrim(coalesce(p_branch,''))<>''
        and position(lower(btrim(p_branch)) in lower(coalesce(u.managed_branches,'')))>0
      )
    from public."user" u
    where u.id=auth.uid() and u.active is true
    limit 1
  ),false);
$$;

-- Replaces the old v124 individual-user checker if it is still installed.
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
begin
  if p_from is null or p_to is null or p_from>p_to then
    raise exception 'فترة التقرير غير صحيحة';
  end if;

  select * into v_user
  from public."user"
  where id=auth.uid() and active is true
  limit 1;

  if not found then raise exception 'جلسة المستخدم غير صالحة'; end if;
  v_role:=private.okb_canonical_role(v_user.role);

  if v_role<>'admin' and not private.okb_role_has_feature('commission') then
    raise exception 'Commission غير مضافة لصلاحيات الـRole الخاصة بحسابك';
  end if;

  if v_role<>'admin' and btrim(coalesce(v_user.managed_branches,''))='' then
    raise exception 'صلاحية Commission مفعلة، لكن لا يوجد فرع مسند إلى حسابك';
  end if;

  return query
  select o.*
  from public.orders o
  where (o.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    and (
      v_role='admin'
      or private.okb_can_access_branch(
        case
          when btrim(coalesce(o.branch,'')) in ('مدينة نصر','اسكندرية','طنطا','المنصورة') then btrim(o.branch)
          when lower(btrim(coalesce(o.shipping_company,'')))='nasr city branch' then 'مدينة نصر'
          when lower(btrim(coalesce(o.shipping_company,'')))='alexandria branch' then 'اسكندرية'
          when lower(btrim(coalesce(o.shipping_company,''))) in ('tanta branch','tan ta branch') then 'طنطا'
          when lower(btrim(coalesce(o.shipping_company,'')))='mansoura branch' then 'المنصورة'
          else ''
        end
      )
    )
  order by o.created_at desc;
end;
$$;

revoke all on function public.okb_get_commission_orders(date,date) from public,anon;
grant execute on function public.okb_get_commission_orders(date,date) to authenticated;

select '020_commission_role_enforcement installed successfully' as migration_status;
