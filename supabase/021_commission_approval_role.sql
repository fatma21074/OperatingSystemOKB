-- OKB v129: delegate monthly Commission approval by Role permission.
-- Requires migrations 017 and 020. Unlocking an approval remains Admin-only.

create or replace function private.okb_can_approve_commission()
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select private.okb_canonical_role(private.okb_current_user_role())='admin'
    or (
      private.okb_role_has_feature('btn_commission_approve')
      and private.okb_can_access_branch('مدينة نصر')
      and private.okb_can_access_branch('اسكندرية')
      and private.okb_can_access_branch('طنطا')
      and private.okb_can_access_branch('المنصورة')
    );
$$;

revoke all on function private.okb_can_approve_commission() from public,anon;
grant execute on function private.okb_can_approve_commission() to authenticated;

drop policy if exists okb_commission_approvals_admin_read on public.commission_approvals;
drop policy if exists okb_commission_approvals_authorized_read on public.commission_approvals;
create policy okb_commission_approvals_authorized_read on public.commission_approvals
for select to authenticated
using(private.okb_can_approve_commission());

create or replace function public.okb_approve_commission(
  p_period_from date,
  p_period_to date,
  p_comparison_from date,
  p_comparison_to date,
  p_snapshot jsonb,
  p_total_net numeric,
  p_total_base numeric,
  p_total_rewards numeric,
  p_total_penalties numeric,
  p_total_orders integer,
  p_signed_count integer,
  p_rtd_count integer,
  p_pending_count integer,
  p_note text default null,
  p_override_reason text default null,
  p_actor text default null
)
returns bigint
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_actor text;
  v_id bigint;
  v_branch_count integer;
begin
  if not private.okb_can_approve_commission() then
    raise exception 'اعتماد العمولة غير مضاف لصلاحيات الـRole أو الحساب غير مرتبط بكل الفروع';
  end if;
  if p_period_from>p_period_to or p_comparison_from>p_comparison_to then raise exception 'فترة العمولة غير صحيحة'; end if;
  if p_period_from<>date_trunc('month',p_period_from)::date or p_period_to<>(date_trunc('month',p_period_from)+interval '1 month - 1 day')::date then raise exception 'اعتماد العمولة يحتاج شهرًا ميلاديًا كاملًا'; end if;
  if p_period_to >= date_trunc('month',now() at time zone 'Africa/Cairo')::date then raise exception 'لا يمكن اعتماد العمولة قبل انتهاء الشهر'; end if;
  if p_snapshot is null or coalesce(p_snapshot->>'scope','')<>'all' then raise exception 'Snapshot الاعتماد الشامل غير مكتملة'; end if;

  select count(distinct item->>'branch') into v_branch_count
  from jsonb_array_elements(coalesce(p_snapshot->'rows','[]'::jsonb)) item
  where item->>'branch' in ('مدينة نصر','اسكندرية','طنطا','المنصورة');
  if v_branch_count<>4 or coalesce(p_snapshot->'manager'->>'branch','')<>'مدير الفروع' then
    raise exception 'لا يمكن اعتماد Snapshot ناقصة للفروع أو مدير الفروع';
  end if;

  if coalesce(p_pending_count,0)>0 and length(btrim(coalesce(p_override_reason,'')))<3 then raise exception 'سبب الاعتماد الاستثنائي إجباري عند وجود Pending'; end if;
  perform pg_advisory_xact_lock(hashtext(concat(p_period_from,'|',p_period_to,'|',p_comparison_from,'|',p_comparison_to,'|all')));
  if exists(select 1 from public.commission_approvals where period_from=p_period_from and period_to=p_period_to and comparison_from=p_comparison_from and comparison_to=p_comparison_to and branch_scope='all' and status='approved') then
    raise exception 'هذه الفترة معتمدة بالفعل';
  end if;

  v_actor:=coalesce(nullif(btrim(p_actor),''),(select name from public."user" where id=auth.uid()),'Authorized Approver');
  insert into public.commission_approvals(period_from,period_to,comparison_from,comparison_to,branch_scope,snapshot,total_net,total_base,total_rewards,total_penalties,total_orders,signed_count,rtd_count,pending_count,note,override_reason,approved_by,approved_by_user_id)
  values(p_period_from,p_period_to,p_comparison_from,p_comparison_to,'all',p_snapshot,coalesce(p_total_net,0),coalesce(p_total_base,0),coalesce(p_total_rewards,0),coalesce(p_total_penalties,0),coalesce(p_total_orders,0),coalesce(p_signed_count,0),coalesce(p_rtd_count,0),coalesce(p_pending_count,0),nullif(btrim(p_note),''),nullif(btrim(p_override_reason),''),v_actor,auth.uid()::text)
  returning id into v_id;

  insert into public.activity_logs(user_id,user_name,username,user_role,action_type,action_title,action_details,branch_name,action_date,created_at)
  select null,v_actor,u.username,u.role,'commission_approved','اعتماد العمولة',format('الفترة: %s → %s | صافي الاستحقاق: %s | Pending: %s',p_period_from,p_period_to,p_total_net,p_pending_count),'Commission',(now() at time zone 'Africa/Cairo')::date,now()
  from (select 1) seed left join public."user" u on u.id=auth.uid();
  return v_id;
end;
$$;

revoke all on function public.okb_approve_commission(date,date,date,date,jsonb,numeric,numeric,numeric,numeric,integer,integer,integer,integer,text,text,text) from public,anon;
grant execute on function public.okb_approve_commission(date,date,date,date,jsonb,numeric,numeric,numeric,numeric,integer,integer,integer,integer,text,text,text) to authenticated;

select '021_commission_approval_role installed successfully' as migration_status;
