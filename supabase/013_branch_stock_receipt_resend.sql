-- OKB Branch Stock receipt resend v108
-- Run once after 012_branch_stock_settlement_confirmation.sql.
-- This migration does not modify the Signed stock deduction trigger.

create or replace function public.okb_resend_branch_stock_receipt(
  p_receipt_id bigint,
  p_actor text default null
)
returns numeric
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_receipt public.branch_stock_receipts%rowtype;
  v_before numeric;
  v_after numeric;
  v_actual_before numeric;
  v_actual_after numeric;
  v_actor text;
  v_role text;
begin
  v_role := lower(replace(replace(trim(private.okb_current_user_role()), ' ', '_'), '-', '_'));
  if v_role not in ('admin','account_manager') then
    raise exception 'إعادة الإرسال متاحة لمدير الحسابات أو Admin فقط';
  end if;

  select * into v_receipt
  from public.branch_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then raise exception 'استلام الجرد غير موجود'; end if;
  if v_receipt.status = 'pending' then raise exception 'الجرد مرسل بالفعل وينتظر استلام مدير الفرع'; end if;
  if v_receipt.settlement_confirmed_at is not null then raise exception 'تم اعتماد التسوية ولا يمكن إعادة إرسالها'; end if;
  if exists(select 1 from public.branch_stock_receipts r where r.branch=v_receipt.branch and r.item_id=v_receipt.item_id and r.status='pending' and r.id<>v_receipt.id) then
    raise exception 'يوجد طلب استلام معلق بالفعل لنفس المنتج';
  end if;

  select system_qty,actual_qty into v_before,v_actual_before
  from public.branch_inventory
  where branch=v_receipt.branch and item_id=v_receipt.item_id
  for update;

  if not found then raise exception 'رصيد المنتج غير موجود في الفرع'; end if;
  if v_before < coalesce(v_receipt.actual_qty,0) or v_actual_before < coalesce(v_receipt.actual_qty,0) then
    raise exception 'لا يمكن إلغاء الاستلام لأن الرصيد الحالي أقل من الكمية التي أضيفت. راجع الحركات التالية أولاً';
  end if;

  v_after := v_before - coalesce(v_receipt.actual_qty,0);
  v_actual_after := v_actual_before - coalesce(v_receipt.actual_qty,0);
  v_actor := coalesce(nullif(btrim(p_actor), ''), (select name from public."user" where id=auth.uid()), 'User');

  update public.branch_inventory
  set system_qty=v_after,actual_qty=v_actual_after,updated_by=v_actor,updated_at=now()
  where branch=v_receipt.branch and item_id=v_receipt.item_id;

  update public.branch_stock_receipts
  set received_qty=null,damaged_qty=null,actual_qty=null,receipt_reason=null,status='pending',
      received_by=null,received_by_user_id=null,received_at=null,
      settlement_confirmed_at=null,settlement_confirmed_by=null,settlement_confirmed_by_user_id=null,
      updated_at=now()
  where id=p_receipt_id;

  insert into public.branch_stock_logs(branch,item_id,item_name,system_qty,actual_qty,variance_qty,variance_reason,notes,changed_by,changed_role,created_at,action_type,quantity_change,balance_before,balance_after)
  values(v_receipt.branch,v_receipt.item_id,v_receipt.item_name,v_after,v_actual_after,v_actual_after-v_after,'','إلغاء أثر الاستلام السابق وإعادة إرساله لمدير الفرع',v_actor,(select role from public."user" where id=auth.uid()),now(),'stock_receipt_resend',-coalesce(v_receipt.actual_qty,0),v_before,v_after);

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_receipt_resend','إعادة إرسال الجرد',
         format('المنتج: %s | تم إلغاء أثر الاستلام السابق: %s | أعيد لمدير الفرع لإدخال الأعداد الصحيحة',v_receipt.item_name,coalesce(v_receipt.actual_qty,0)),
         null,null,null,v_receipt.branch,(now() at time zone 'Africa/Cairo')::date,now()
  from public."user" u where u.id=auth.uid();

  return v_after;
end;
$$;

revoke all on function public.okb_resend_branch_stock_receipt(bigint,text) from public,anon;
grant execute on function public.okb_resend_branch_stock_receipt(bigint,text) to authenticated;
