-- OKB per-branch Signed deduction control v111
-- Run once after 015_branch_stock_bulk_add.sql.
-- Keeps the trigger enabled globally and allows Admin to pause deduction per branch.

create table if not exists public.branch_stock_controls (
  branch text primary key,
  signed_deduction_enabled boolean not null default true,
  updated_by text,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.branch_stock_bypassed_orders (
  order_id text primary key,
  branch text not null,
  ticket_id text,
  product_names text,
  bypassed_by text,
  bypassed_at timestamptz not null default now(),
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending','reconciled','ignored'))
);

create index if not exists branch_stock_bypassed_orders_pending_idx
  on public.branch_stock_bypassed_orders(branch,reconciliation_status,bypassed_at desc);

create or replace function public.okb_set_branch_signed_deduction(
  p_branch text,
  p_enabled boolean,
  p_actor text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor text;
  v_role text;
begin
  v_role:=lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'));
  if v_role<>'admin' then raise exception 'التحكم في خصم Signed متاح للـAdmin فقط'; end if;
  if btrim(coalesce(p_branch,''))='' then raise exception 'اختر الفرع أولاً'; end if;
  v_actor:=coalesce(nullif(btrim(p_actor),''),(select name from public."user" where id=auth.uid()),'Admin');
  insert into public.branch_stock_controls(branch,signed_deduction_enabled,updated_by,updated_by_user_id,updated_at)
  values(btrim(p_branch),coalesce(p_enabled,true),v_actor,auth.uid(),now())
  on conflict(branch) do update set signed_deduction_enabled=excluded.signed_deduction_enabled,updated_by=excluded.updated_by,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at;
  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_signed_control','التحكم في خصم Signed',
         format('الفرع: %s | الحالة: %s',btrim(p_branch),case when p_enabled then 'تم تشغيل الخصم' else 'تم إيقاف الخصم مؤقتًا' end),
         null,null,null,btrim(p_branch),(now() at time zone 'Africa/Cairo')::date,now() from public."user" u where u.id=auth.uid();
  return coalesce(p_enabled,true);
end;
$$;

create or replace function public.okb_deduct_branch_stock_on_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line text;
  v_name text;
  v_qty numeric;
  v_match text[];
  v_item_id text;
  v_item_name text;
  v_before numeric;
  v_after numeric;
  v_actual_after numeric;
  v_actor text;
  v_ticket text;
  v_posted text;
  v_enabled boolean;
begin
  if new.status is distinct from 'Signed' then return new; end if;
  if tg_op='UPDATE' and old.status is not distinct from 'Signed' then return new; end if;
  if coalesce(btrim(new.branch),'')='' then return new; end if;
  v_actor:=coalesce((select name from public."user" where id=auth.uid()),new.employee_name,'System');
  v_ticket:=coalesce(nullif(to_jsonb(new)->>'ticket_id',''),nullif(to_jsonb(new)->>'order_number',''),new.id::text);
  select coalesce((select signed_deduction_enabled from public.branch_stock_controls where branch=new.branch),true) into v_enabled;

  if not v_enabled then
    insert into public.branch_stock_bypassed_orders(order_id,branch,ticket_id,product_names,bypassed_by)
    values(new.id::text,new.branch,v_ticket,coalesce(new.product_names,''),v_actor)
    on conflict(order_id) do nothing;
    insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
    select null,v_actor,u.username,coalesce(u.role,'System'),'stock_signed_bypass','Signed بدون خصم مخزون',
           format('Ticket: %s | تم تحويل الأوردر إلى Signed أثناء توقف خصم المخزون للفرع',v_ticket),
           null,v_ticket,new.customer_name,new.branch,(now() at time zone 'Africa/Cairo')::date,now()
    from (select 1) seed left join public."user" u on u.id=auth.uid();
    return new;
  end if;

  if btrim(coalesce(new.product_names,''))='' then raise exception 'لا يمكن تحويل أوردر بدون منتجات إلى Signed'; end if;
  insert into public.branch_stock_order_postings(order_id,branch,ticket_id,posted_by)
  values(new.id::text,new.branch,v_ticket,v_actor)
  on conflict(order_id) do nothing returning order_id into v_posted;
  if v_posted is null then return new; end if;

  for v_line in select * from regexp_split_to_table(coalesce(new.product_names,''),E'\\n+') loop
    v_name:=btrim(regexp_replace(split_part(v_line,'|',1),E'^\\s*[0-9]+[\\)\\.\\-]?\\s*',''));
    v_match:=regexp_match(split_part(v_line,'|',2),E'[×xX*]\\s*([0-9]+)');
    if v_name='' or v_match is null then raise exception 'تعذر قراءة منتجات الأوردر % لخصم المخزون',v_ticket; end if;
    v_qty:=(v_match[1])::numeric;
    select id::text,item_name into v_item_id,v_item_name
    from public.items
    where lower(regexp_replace(btrim(item_name),E'\\s+',' ','g'))=lower(regexp_replace(v_name,E'\\s+',' ','g'))
    limit 1;
    if v_item_id is null then raise exception 'المنتج "%" غير موجود في OKB Items — لم يتم تحويل الأوردر إلى Signed',v_name; end if;
    select system_qty into v_before from public.branch_inventory
    where branch=new.branch and item_id=v_item_id for update;
    if not found then raise exception 'رصيد المنتج "%" غير موجود في فرع %',v_item_name,new.branch; end if;
    if v_before<v_qty then raise exception 'رصيد المنتج "%" غير كافٍ: المتاح % والمطلوب %',v_item_name,v_before,v_qty; end if;
    v_after:=v_before-v_qty;
    update public.branch_inventory
    set system_qty=v_after,actual_qty=greatest(0,coalesce(actual_qty,0)-v_qty),updated_by=v_actor,updated_at=now()
    where branch=new.branch and item_id=v_item_id returning actual_qty into v_actual_after;
    insert into public.branch_stock_logs(branch,item_id,item_name,system_qty,actual_qty,variance_qty,variance_reason,notes,changed_by,changed_role,created_at,action_type,quantity_change,balance_before,balance_after,order_ref,ticket_id)
    values(new.branch,v_item_id,v_item_name,v_after,v_actual_after,0,'','خصم تلقائي عند Signed',v_actor,
           coalesce((select role from public."user" where id=auth.uid()),'System'),now(),'signed_deduction',-v_qty,v_before,v_after,new.id::text,v_ticket);
    insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
    select null,v_actor,u.username,coalesce(u.role,'System'),'stock_signed_deduction','خصم رصيد عند Signed',
           format('المنتج: %s | الكمية المخصومة: %s | الرصيد قبل: %s | الرصيد بعد: %s',v_item_name,v_qty,v_before,v_after),
           null,v_ticket,new.customer_name,new.branch,(now() at time zone 'Africa/Cairo')::date,now()
    from (select 1) seed left join public."user" u on u.id=auth.uid();
  end loop;
  return new;
end;
$$;

alter table public.branch_stock_controls enable row level security;
alter table public.branch_stock_bypassed_orders enable row level security;
drop policy if exists okb_branch_stock_controls_admin_read on public.branch_stock_controls;
create policy okb_branch_stock_controls_admin_read on public.branch_stock_controls for select to authenticated
using(lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'))='admin');
drop policy if exists okb_branch_stock_bypassed_orders_admin_read on public.branch_stock_bypassed_orders;
create policy okb_branch_stock_bypassed_orders_admin_read on public.branch_stock_bypassed_orders for select to authenticated
using(lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_'))='admin');

revoke insert,update,delete on public.branch_stock_controls,public.branch_stock_bypassed_orders from authenticated;
grant select on public.branch_stock_controls,public.branch_stock_bypassed_orders to authenticated;
revoke all on function public.okb_set_branch_signed_deduction(text,boolean,text) from public,anon;
grant execute on function public.okb_set_branch_signed_deduction(text,boolean,text) to authenticated;

alter table public.orders enable trigger trg_okb_deduct_branch_stock_on_signed;
