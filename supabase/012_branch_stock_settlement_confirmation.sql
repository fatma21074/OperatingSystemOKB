-- OKB Branch Stock settlement confirmation v104
-- Run once after 011_branch_stock_control.sql.
-- This migration does not modify the Signed stock deduction trigger.

alter table public.branch_stock_receipts
  add column if not exists settlement_confirmed_at timestamptz,
  add column if not exists settlement_confirmed_by text,
  add column if not exists settlement_confirmed_by_user_id uuid;

create or replace function public.okb_confirm_branch_stock_settlement(
  p_receipt_id bigint,
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
    raise exception 'التأكيد متاح لمدير الحسابات أو Admin فقط';
  end if;

  select * into v_receipt
  from public.branch_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then raise exception 'استلام الجرد غير موجود'; end if;
  if v_receipt.status = 'pending' then raise exception 'لا يمكن تأكيد جرد لم يتم استلامه'; end if;
  if v_receipt.settlement_confirmed_at is not null then return true; end if;

  v_actor := coalesce(nullif(btrim(p_actor), ''), (select name from public."user" where id = auth.uid()), 'User');

  update public.branch_stock_receipts
  set settlement_confirmed_at = now(),
      settlement_confirmed_by = v_actor,
      settlement_confirmed_by_user_id = auth.uid(),
      updated_at = now()
  where id = p_receipt_id;

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,order_id,ticket_id,customer_name,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'stock_receipt_confirm','تأكيد تسوية الاستلام',
         format('المنتج: %s | الحالة: %s | تم اعتماد مراجعة تفاصيل الاستلام',v_receipt.item_name,v_receipt.status),
         null,null,null,v_receipt.branch,(now() at time zone 'Africa/Cairo')::date,now()
  from public."user" u where u.id=auth.uid();

  return true;
end;
$$;

revoke all on function public.okb_confirm_branch_stock_settlement(bigint,text) from public,anon;
grant execute on function public.okb_confirm_branch_stock_settlement(bigint,text) to authenticated;
