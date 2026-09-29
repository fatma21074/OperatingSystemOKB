-- OKB Branch Stock pending quantity edit v109
-- Run once after 013_branch_stock_receipt_resend.sql.
-- Pending requests do not affect inventory, so this function never changes stock balances.

create or replace function public.okb_edit_pending_branch_stock_receipt(
  p_receipt_id bigint,
  p_new_qty numeric,
  p_reason text,
  p_actor text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_receipt public.branch_stock_receipts%rowtype;
  v_actor text;
  v_role text;
begin
  v_role := lower(replace(replace(trim(private.okb_current_user_role()), ' ', '_'), '-', '_'));
  if v_role not in ('admin','account_manager') then
    raise exception 'تعديل الكمية المرسلة متاح لمدير الحسابات أو Admin فقط';
  end if;
  if coalesce(p_new_qty,0) <= 0 then raise exception 'الكمية الجديدة يجب أن تكون أكبر من صفر'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'سبب التعديل مطلوب'; end if;

  select * into v_receipt from public.branch_stock_receipts where id=p_receipt_id for update;
  if not found then raise exception 'طلب إضافة الرصيد غير موجود'; end if;
  if v_receipt.status <> 'pending' then raise exception 'لا يمكن تعديل الطلب بعد استلامه. استخدم إرسال مرة أخرى أولاً'; end if;
  if v_receipt.added_qty = p_new_qty then raise exception 'الكمية الجديدة مطابقة للكمية الحالية'; end if;

  v_actor := coalesce(nullif(btrim(p_actor),''),(select name from public."user" where id=auth.uid()),'User');

  update public.branch_stock_receipts
  set added_qty=p_new_qty,request_reason=btrim(p_reason),updated_at=now()
  where id=p_receipt_id;

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_balance_edit','تعديل رصيد مرسل',
         format('المنتج: %s | الكمية قبل: %s | الكمية بعد: %s | السبب: %s',v_receipt.item_name,v_receipt.added_qty,p_new_qty,btrim(p_reason)),
         null,null,null,v_receipt.branch,(now() at time zone 'Africa/Cairo')::date,now()
  from public."user" u where u.id=auth.uid();

  return true;
end;
$$;

revoke all on function public.okb_edit_pending_branch_stock_receipt(bigint,numeric,text,text) from public,anon;
grant execute on function public.okb_edit_pending_branch_stock_receipt(bigint,numeric,text,text) to authenticated;
