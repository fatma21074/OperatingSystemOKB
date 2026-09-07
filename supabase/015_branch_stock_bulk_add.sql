-- OKB Branch Stock bulk add + optional add reason v110
-- Run once after 014_branch_stock_pending_edit.sql.
-- This migration does not modify the Signed stock deduction trigger.

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
  v_reason text;
begin
  if not private.okb_has_feature('btn_branch_stock_add_balance') then raise exception 'غير مسموح لك بإضافة رصيد الجرد'; end if;
  if not private.okb_can_access_branch(p_branch) then raise exception 'غير مسموح لك بالتعامل مع هذا الفرع'; end if;
  if coalesce(p_qty,0)<=0 then raise exception 'كمية الإضافة يجب أن تكون أكبر من صفر'; end if;
  select item_name into v_item_name from public.items where id::text=p_item_id limit 1;
  if v_item_name is null then raise exception 'المنتج غير موجود'; end if;
  v_actor:=coalesce(nullif(btrim(p_actor),''),(select name from public."user" where id=auth.uid()),'User');
  v_reason:=btrim(coalesce(p_reason,''));
  insert into public.branch_stock_receipts(branch,item_id,item_name,added_qty,request_reason,requested_by,requested_by_user_id)
  values(p_branch,p_item_id,v_item_name,p_qty,v_reason,v_actor,auth.uid()) returning id into v_id;
  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_balance_add','إضافة رصيد الجرد',
         format('المنتج: %s | الكمية المضافة: %s | الحالة: في انتظار استلام مدير الفرع%s',v_item_name,p_qty,case when v_reason<>'' then ' | الملاحظة: '||v_reason else '' end),
         null,null,null,p_branch,(now() at time zone 'Africa/Cairo')::date,now() from public."user" u where u.id=auth.uid();
  return v_id;
end;
$$;

create or replace function public.okb_request_branch_stock_add_bulk(
  p_branch text,
  p_items jsonb,
  p_reason text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_entry jsonb;
  v_item_id text;
  v_qty numeric;
  v_item_name text;
  v_id bigint;
  v_actor text;
  v_reason text;
  v_result jsonb:='[]'::jsonb;
begin
  if not private.okb_has_feature('btn_branch_stock_add_balance') then raise exception 'غير مسموح لك بإضافة رصيد الجرد'; end if;
  if not private.okb_can_access_branch(p_branch) then raise exception 'غير مسموح لك بالتعامل مع هذا الفرع'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'اختر منتجًا واحدًا على الأقل'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'الحد الأقصى 100 منتج في العملية الواحدة'; end if;
  v_actor:=coalesce(nullif(btrim(p_actor),''),(select name from public."user" where id=auth.uid()),'User');
  v_reason:=btrim(coalesce(p_reason,''));
  for v_entry in select value from jsonb_array_elements(p_items) loop
    v_item_id:=nullif(btrim(v_entry->>'item_id'),'');v_qty:=coalesce((v_entry->>'qty')::numeric,0);
    if v_item_id is null or v_qty<=0 then raise exception 'راجع بيانات وكميات المنتجات المحددة'; end if;
    select item_name into v_item_name from public.items where id::text=v_item_id limit 1;
    if v_item_name is null then raise exception 'أحد المنتجات المحددة غير موجود'; end if;
    insert into public.branch_stock_receipts(branch,item_id,item_name,added_qty,request_reason,requested_by,requested_by_user_id)
    values(p_branch,v_item_id,v_item_name,v_qty,v_reason,v_actor,auth.uid()) returning id into v_id;
    insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
    select null,v_actor,u.username,u.role,'stock_balance_add','إضافة رصيد الجرد',
           format('إضافة جماعية | المنتج: %s | الكمية: %s | في انتظار استلام مدير الفرع%s',v_item_name,v_qty,case when v_reason<>'' then ' | الملاحظة: '||v_reason else '' end),
           null,null,null,p_branch,(now() at time zone 'Africa/Cairo')::date,now() from public."user" u where u.id=auth.uid();
    v_result:=v_result||jsonb_build_array(jsonb_build_object('item_id',v_item_id,'receipt_id',v_id));
  end loop;
  return v_result;
end;
$$;

revoke all on function public.okb_request_branch_stock_add_bulk(text,jsonb,text,text) from public,anon;
grant execute on function public.okb_request_branch_stock_add_bulk(text,jsonb,text,text) to authenticated;
