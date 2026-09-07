-- OKB Branch Stock Control v101
-- Run once in Supabase SQL Editor after the previous migrations.

create table if not exists public.branch_inventory (
  id bigserial primary key,
  branch text not null,
  item_id text not null,
  item_name text not null,
  system_qty numeric not null default 0 check (system_qty >= 0),
  actual_qty numeric not null default 0 check (actual_qty >= 0),
  variance_reason text not null default '',
  notes text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (branch, item_id)
);

create table if not exists public.branch_stock_logs (
  id bigserial primary key,
  branch text not null,
  item_id text not null,
  item_name text not null,
  system_qty numeric not null default 0,
  actual_qty numeric not null default 0,
  variance_qty numeric not null default 0,
  variance_reason text not null default '',
  notes text not null default '',
  changed_by text,
  changed_role text,
  created_at timestamptz not null default now()
);

alter table public.branch_stock_logs add column if not exists action_type text;
alter table public.branch_stock_logs add column if not exists quantity_change numeric;
alter table public.branch_stock_logs add column if not exists balance_before numeric;
alter table public.branch_stock_logs add column if not exists balance_after numeric;
alter table public.branch_stock_logs add column if not exists order_ref text;
alter table public.branch_stock_logs add column if not exists ticket_id text;

create table if not exists public.branch_stock_receipts (
  id bigserial primary key,
  branch text not null,
  item_id text not null,
  item_name text not null,
  added_qty numeric not null check (added_qty > 0),
  received_qty numeric,
  damaged_qty numeric,
  actual_qty numeric,
  request_reason text not null,
  receipt_reason text,
  status text not null default 'pending' check (status in ('pending','accepted','discrepancy')),
  requested_by text not null,
  requested_by_user_id uuid,
  requested_at timestamptz not null default now(),
  received_by text,
  received_by_user_id uuid,
  received_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists branch_stock_one_pending_receipt_idx
  on public.branch_stock_receipts (branch, item_id)
  where status = 'pending';

create table if not exists public.branch_stock_order_postings (
  order_id text primary key,
  branch text not null,
  ticket_id text,
  posted_by text,
  posted_at timestamptz not null default now()
);

create index if not exists branch_inventory_low_stock_idx
  on public.branch_inventory (branch, system_qty);
create index if not exists branch_stock_receipts_pending_idx
  on public.branch_stock_receipts (branch, status, requested_at desc);
create index if not exists branch_stock_logs_branch_date_idx
  on public.branch_stock_logs (branch, created_at desc);

create or replace function private.okb_has_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select lower(replace(replace(trim(u.role), ' ', '_'), '-', '_')) = 'admin'
        or coalesce((u.system_permissions ->> p_feature)::boolean, false)
        or coalesce((rp.permissions ->> p_feature)::boolean, false)
      from public."user" u
      left join public.role_permissions rp
        on lower(replace(replace(trim(rp.role), ' ', '_'), '-', '_')) = lower(replace(replace(trim(u.role), ' ', '_'), '-', '_'))
      where u.id = auth.uid() and u.active is true
      limit 1
    ), false
  );
$$;

create or replace function private.okb_can_access_branch(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select lower(replace(replace(trim(u.role), ' ', '_'), '-', '_')) in ('admin','account_manager')
        or position(lower(trim(p_branch)) in lower(coalesce(u.managed_branches, ''))) > 0
      from public."user" u
      where u.id = auth.uid() and u.active is true
      limit 1
    ), false
  );
$$;

create or replace function public.okb_request_branch_stock_add(
  p_branch text,
  p_item_id text,
  p_qty numeric,
  p_reason text,
  p_actor text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item_name text;
  v_id bigint;
  v_actor text;
begin
  if not private.okb_has_feature('btn_branch_stock_add_balance') then
    raise exception 'غير مسموح لك بإضافة رصيد الجرد';
  end if;
  if not private.okb_can_access_branch(p_branch) then
    raise exception 'غير مسموح لك بالتعامل مع هذا الفرع';
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'كمية الإضافة يجب أن تكون أكبر من صفر'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإضافة مطلوب'; end if;

  select item_name into v_item_name from public.items where id::text = p_item_id limit 1;
  if v_item_name is null then raise exception 'المنتج غير موجود'; end if;
  v_actor := coalesce(nullif(btrim(p_actor), ''), (select name from public."user" where id = auth.uid()), 'User');

  insert into public.branch_stock_receipts(branch,item_id,item_name,added_qty,request_reason,requested_by,requested_by_user_id)
  values (p_branch,p_item_id,v_item_name,p_qty,btrim(p_reason),v_actor,auth.uid())
  returning id into v_id;

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_balance_add','إضافة رصيد الجرد',
         format('المنتج: %s | الكمية المضافة: %s | الحالة: في انتظار استلام مدير الفرع | السبب: %s',v_item_name,p_qty,btrim(p_reason)),
         null,null,null,p_branch,(now() at time zone 'Africa/Cairo')::date,now()
  from public."user" u where u.id = auth.uid();
  return v_id;
end;
$$;

create or replace function public.okb_receive_branch_stock(
  p_receipt_id bigint,
  p_decision text,
  p_received_qty numeric,
  p_damaged_qty numeric,
  p_reason text default null,
  p_actor text default null
)
returns numeric
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_receipt public.branch_stock_receipts%rowtype;
  v_actual numeric;
  v_before numeric;
  v_after numeric;
  v_actor text;
  v_status text;
begin
  if not private.okb_has_feature('btn_branch_stock_actions') then
    raise exception 'غير مسموح لك باستلام الجرد';
  end if;
  select * into v_receipt from public.branch_stock_receipts where id = p_receipt_id for update;
  if not found then raise exception 'طلب إضافة الرصيد غير موجود'; end if;
  if v_receipt.status <> 'pending' then raise exception 'تم استلام هذا الطلب من قبل'; end if;
  if p_decision not in ('accepted','discrepancy') then raise exception 'قرار الاستلام غير صحيح'; end if;
  if not private.okb_can_access_branch(v_receipt.branch) then raise exception 'غير مسموح لك بالتعامل مع هذا الفرع'; end if;
  if v_receipt.requested_by_user_id = auth.uid() and lower(replace(replace(trim(private.okb_current_user_role()),' ','_'),'-','_')) <> 'admin' then
    raise exception 'لا يمكن لنفس المستخدم إضافة الرصيد واستلامه';
  end if;
  if coalesce(p_received_qty, -1) < 0 or coalesce(p_damaged_qty, -1) < 0 then raise exception 'الكميات غير صحيحة'; end if;
  if p_damaged_qty > p_received_qty then raise exception 'الهالك لا يمكن أن يكون أكبر من المستلم'; end if;
  v_actual := p_received_qty - p_damaged_qty;
  v_status := case when p_decision = 'accepted' then 'accepted' else 'discrepancy' end;
  if v_status = 'accepted' and (p_received_qty <> v_receipt.added_qty or p_damaged_qty <> 0 or v_actual <> v_receipt.added_qty) then
    raise exception 'علامة الصح مخصصة للاستلام المطابق. استخدم علامة الخطأ لتسجيل الاختلاف';
  end if;
  if v_status = 'discrepancy' and btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الاختلاف أو الهالك مطلوب'; end if;
  v_actor := coalesce(nullif(btrim(p_actor), ''), (select name from public."user" where id = auth.uid()), 'User');

  select system_qty into v_before from public.branch_inventory
   where branch = v_receipt.branch and item_id = v_receipt.item_id for update;
  if not found then raise exception 'رصيد المنتج غير موجود في الفرع'; end if;
  v_after := v_before + v_actual;

  update public.branch_inventory
     set system_qty = v_after,
         actual_qty = greatest(0, coalesce(actual_qty,0) + v_actual),
         updated_by = v_actor,
         updated_at = now()
   where branch = v_receipt.branch and item_id = v_receipt.item_id;

  update public.branch_stock_receipts
     set received_qty=p_received_qty, damaged_qty=p_damaged_qty, actual_qty=v_actual,
         receipt_reason=nullif(btrim(coalesce(p_reason,'')),''), status=v_status,
         received_by=v_actor, received_by_user_id=auth.uid(), received_at=now(), updated_at=now()
   where id=p_receipt_id;

  insert into public.branch_stock_logs(branch,item_id,item_name,system_qty,actual_qty,variance_qty,variance_reason,notes,changed_by,changed_role,created_at,action_type,quantity_change,balance_before,balance_after)
  values(v_receipt.branch,v_receipt.item_id,v_receipt.item_name,v_after,v_actual,0,coalesce(p_reason,''),
         format('المضاف: %s | المستلم: %s | الهالك: %s | الفعلي: %s | الحالة: %s',v_receipt.added_qty,p_received_qty,p_damaged_qty,v_actual,v_status),
         v_actor,(select role from public."user" where id=auth.uid()),now(),'stock_receipt',v_actual,v_before,v_after);

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_receipt','استلام الجرد',
         format('المنتج: %s | المضاف: %s | المستلم: %s | الهالك: %s | الإجمالي الفعلي: %s | الحالة: %s%s',
                v_receipt.item_name,v_receipt.added_qty,p_received_qty,p_damaged_qty,v_actual,v_status,
                case when btrim(coalesce(p_reason,''))<>'' then ' | السبب: '||btrim(p_reason) else '' end),
         null,null,null,v_receipt.branch,(now() at time zone 'Africa/Cairo')::date,now()
  from public."user" u where u.id=auth.uid();
  return v_after;
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
begin
  if new.status is distinct from 'Signed' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'Signed' then return new; end if;
  if coalesce(btrim(new.branch),'') = '' then return new; end if;
  if btrim(coalesce(new.product_names,'')) = '' then raise exception 'لا يمكن تحويل أوردر بدون منتجات إلى Signed'; end if;
  v_actor := coalesce((select name from public."user" where id=auth.uid()),new.employee_name,'System');
  v_ticket := coalesce(nullif(to_jsonb(new)->>'ticket_id',''),nullif(to_jsonb(new)->>'order_number',''),new.id::text);

  insert into public.branch_stock_order_postings(order_id,branch,ticket_id,posted_by)
  values(new.id::text,new.branch,v_ticket,v_actor)
  on conflict (order_id) do nothing returning order_id into v_posted;
  if v_posted is null then return new; end if;

  for v_line in select * from regexp_split_to_table(coalesce(new.product_names,''), E'\\n+') loop
    v_name := btrim(regexp_replace(split_part(v_line,'|',1), E'^\\s*[0-9]+[\\)\\.\\-]?\\s*', ''));
    v_match := regexp_match(split_part(v_line,'|',2), E'[×xX*]\\s*([0-9]+)');
    if v_name = '' or v_match is null then raise exception 'تعذر قراءة منتجات الأوردر % لخصم المخزون',v_ticket; end if;
    v_qty := (v_match[1])::numeric;
    select id::text,item_name into v_item_id,v_item_name
      from public.items
     where lower(regexp_replace(btrim(item_name), E'\\s+', ' ', 'g')) = lower(regexp_replace(v_name,E'\\s+',' ','g'))
     limit 1;
    if v_item_id is null then raise exception 'المنتج "%" غير موجود في OKB Items — لم يتم تحويل الأوردر إلى Signed',v_name; end if;

    select system_qty into v_before from public.branch_inventory
     where branch=new.branch and item_id=v_item_id for update;
    if not found then raise exception 'المنتج "%" غير مضاف إلى مخزون فرع %',v_item_name,new.branch; end if;
    if v_before < v_qty then raise exception 'رصيد % غير كافٍ في فرع %: المتاح % والمطلوب %',v_item_name,new.branch,v_before,v_qty; end if;
    v_after := v_before-v_qty;
    update public.branch_inventory
       set system_qty=v_after, actual_qty=greatest(0,coalesce(actual_qty,0)-v_qty),updated_by=v_actor,updated_at=now()
     where branch=new.branch and item_id=v_item_id
     returning actual_qty into v_actual_after;
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

drop trigger if exists trg_okb_deduct_branch_stock_on_signed on public.orders;
create trigger trg_okb_deduct_branch_stock_on_signed
before insert or update of status on public.orders
for each row execute function public.okb_deduct_branch_stock_on_signed();

alter table public.branch_stock_receipts enable row level security;
alter table public.branch_stock_order_postings enable row level security;
drop policy if exists okb_branch_stock_receipts_read on public.branch_stock_receipts;
create policy okb_branch_stock_receipts_read on public.branch_stock_receipts for select to authenticated
using ((select private.okb_is_active_user()));
drop policy if exists okb_branch_stock_postings_read on public.branch_stock_order_postings;
create policy okb_branch_stock_postings_read on public.branch_stock_order_postings for select to authenticated
using ((select private.okb_is_active_user()));
revoke insert,update,delete on public.branch_stock_receipts from authenticated;
revoke insert,update,delete on public.branch_stock_order_postings from authenticated;
grant select on public.branch_stock_receipts,public.branch_stock_order_postings to authenticated;
revoke all on function public.okb_request_branch_stock_add(text,text,numeric,text,text) from public,anon;
revoke all on function public.okb_receive_branch_stock(bigint,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.okb_request_branch_stock_add(text,text,numeric,text,text) to authenticated;
grant execute on function public.okb_receive_branch_stock(bigint,text,numeric,numeric,text,text) to authenticated;

do $$
declare target_table text;
begin
  foreach target_table in array array['branch_inventory','branch_stock_receipts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',target_table);
    end if;
  end loop;
end $$;

-- Ensure the current catalog exists in every branch without changing any existing balance.
insert into public.branch_inventory(branch,item_id,item_name,system_qty,actual_qty,updated_by)
select b.branch,i.id::text,i.item_name,0,0,'Migration v101'
from (values ('مدينة نصر'),('اسكندرية'),('طنطا'),('المنصورة')) as b(branch)
cross join public.items i
on conflict (branch,item_id) do nothing;
