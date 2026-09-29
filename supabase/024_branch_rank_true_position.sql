-- OKB v158: secure true Branch Rank for branch-scoped users.
--
-- The RPC calculates the four-branch leaderboard inside Supabase, then returns
-- only the rank row(s) the authenticated account may access. No order rows or
-- metrics belonging to another branch are exposed to the browser.
-- Requires the role/branch helpers installed by 020_commission_role_enforcement.sql.

create or replace function private.okb_rank_safe_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_value text := replace(btrim(coalesce(p_value, '')), ',', '');
begin
  if v_value = '' or v_value !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' then
    return 0;
  end if;
  return v_value::numeric;
exception when others then
  return 0;
end;
$$;

create or replace function private.okb_rank_effective_price(
  p_price text,
  p_deposit text,
  p_notes text
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_stored numeric := greatest(0, private.okb_rank_safe_numeric(p_price));
  v_deposit numeric := greatest(0, private.okb_rank_safe_numeric(p_deposit));
  v_effective numeric;
  v_best_original numeric := 0;
  v_collected numeric := 0;
  v_order_meta jsonb := '{}'::jsonb;
  v_collect_meta jsonb := '{}'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_match text[];
begin
  -- Metadata blocks are emitted by JSON.stringify on one physical line.
  v_match := regexp_match(coalesce(p_notes, ''), E'\\[ORDER_META:(\\{[^\\r\\n]*\\})\\]');
  if v_match is not null then
    begin
      v_order_meta := v_match[1]::jsonb;
    exception when others then
      v_order_meta := '{}'::jsonb;
    end;
  end if;

  -- Admin financial overrides deliberately disable historical price recovery.
  if lower(coalesce(v_order_meta ->> 'admin_financial_override', 'false')) in ('true', '1', 'yes', 'on') then
    v_effective := v_stored;
  else
    v_match := regexp_match(coalesce(p_notes, ''), E'\\[COLLECT_META:(\\{[^\\r\\n]*\\})\\]\\s*$');
    if v_match is not null then
      begin
        v_collect_meta := v_match[1]::jsonb;
      exception when others then
        v_collect_meta := '{}'::jsonb;
      end;
    end if;

    if jsonb_typeof(v_collect_meta -> 'history') = 'array' then
      v_history := v_collect_meta -> 'history';
      for v_entry in select value from jsonb_array_elements(v_history)
      loop
        v_best_original := greatest(
          v_best_original,
          greatest(0, private.okb_rank_safe_numeric(v_entry ->> 'original_price'))
        );
      end loop;

      if jsonb_array_length(v_history) > 0 then
        v_entry := v_history -> (jsonb_array_length(v_history) - 1);
        v_collected := greatest(0, private.okb_rank_safe_numeric(v_entry ->> 'sales'));
      end if;
    end if;

    if v_best_original > v_stored then
      v_effective := v_best_original;
    elsif v_deposit > 0 and v_collected > 0 and abs(v_stored - v_collected) < 0.01 then
      -- Same logical repair used by the central client-side financial engine.
      v_effective := v_stored + v_deposit;
    else
      v_effective := v_stored;
    end if;
  end if;

  -- Orders below the system's countable threshold are persisted/reported as 0.
  return case when v_effective < 40 then 0 else v_effective end;
end;
$$;

revoke all on function private.okb_rank_safe_numeric(text) from public, anon;
revoke all on function private.okb_rank_effective_price(text, text, text) from public, anon;

create or replace function public.okb_get_branch_performance_ranks(
  p_from date,
  p_to date
)
returns table(
  branch_key text,
  branch_name text,
  rank_position integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user public."user"%rowtype;
  v_role text;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'فترة ترتيب الفروع غير صحيحة';
  end if;

  select * into v_user
  from public."user"
  where id = auth.uid() and active is true
  limit 1;

  if not found then
    raise exception 'جلسة المستخدم غير صالحة';
  end if;

  v_role := private.okb_canonical_role(v_user.role);
  if v_role <> 'admin' and not private.okb_role_has_feature('shipping_rank') then
    raise exception 'لا توجد صلاحية لعرض Branch Rank';
  end if;

  return query
  with branch_map(branch_key, branch_name, sort_order) as (
    values
      ('nasr-city'::text, 'مدينة نصر'::text, 1),
      ('alexandria'::text, 'اسكندرية'::text, 2),
      ('tanta'::text, 'طنطا'::text, 3),
      ('mansoura'::text, 'المنصورة'::text, 4)
  ),
  normalized_orders as (
    select
      case
        when lower(btrim(coalesce(o.branch, ''))) in ('nasr city branch', 'nasr city')
          or btrim(coalesce(o.branch, '')) = 'مدينة نصر' then 'nasr-city'
        when lower(btrim(coalesce(o.branch, ''))) in ('alexandria branch', 'alexandria', 'alex branch')
          or btrim(coalesce(o.branch, '')) in ('اسكندرية', 'الإسكندرية') then 'alexandria'
        when lower(btrim(coalesce(o.branch, ''))) in ('tanta branch', 'tan ta branch', 'tanta')
          or btrim(coalesce(o.branch, '')) = 'طنطا' then 'tanta'
        when lower(btrim(coalesce(o.branch, ''))) in ('mansoura branch', 'mansoura')
          or btrim(coalesce(o.branch, '')) = 'المنصورة' then 'mansoura'
        when lower(btrim(coalesce(o.shipping_company, ''))) in ('nasr city branch', 'nasr city')
          or btrim(coalesce(o.shipping_company, '')) = 'مدينة نصر' then 'nasr-city'
        when lower(btrim(coalesce(o.shipping_company, ''))) in ('alexandria branch', 'alexandria', 'alex branch')
          or btrim(coalesce(o.shipping_company, '')) in ('اسكندرية', 'الإسكندرية') then 'alexandria'
        when lower(btrim(coalesce(o.shipping_company, ''))) in ('tanta branch', 'tan ta branch', 'tanta')
          or btrim(coalesce(o.shipping_company, '')) = 'طنطا' then 'tanta'
        when lower(btrim(coalesce(o.shipping_company, ''))) in ('mansoura branch', 'mansoura')
          or btrim(coalesce(o.shipping_company, '')) = 'المنصورة' then 'mansoura'
        else null
      end as branch_key,
      btrim(coalesce(o.status, '')) as order_status
    from public.orders o
    where o.created_at >= (p_from::timestamp at time zone 'Africa/Cairo')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
      -- Match the exact four-branch scope fetched by the existing Admin page.
      and o.branch in (
        'مدينة نصر', 'Nasr City Branch',
        'اسكندرية', 'Alexandria Branch',
        'طنطا', 'TanTa Branch',
        'المنصورة', 'Mansoura Branch'
      )
      and private.okb_rank_effective_price(o.price::text, o.deposit::text, o.notes) > 0
  ),
  branch_totals as (
    select
      bm.branch_key,
      bm.branch_name,
      bm.sort_order,
      count(no.branch_key)::numeric as raw_total,
      count(*) filter (where no.order_status = 'Signed')::numeric as signed_total,
      count(*) filter (where no.order_status = 'Returned')::numeric as returned_total,
      count(*) filter (where no.order_status = 'Cancel')::numeric as cancel_total
    from branch_map bm
    left join normalized_orders no on no.branch_key = bm.branch_key
    group by bm.branch_key, bm.branch_name, bm.sort_order
  ),
  scored as (
    select
      bt.*,
      greatest(0, bt.raw_total - bt.cancel_total) as operational_total,
      case when greatest(0, bt.raw_total - bt.cancel_total) > 0 then
        (bt.signed_total * 100.0 / greatest(0, bt.raw_total - bt.cancel_total))
        - ((bt.returned_total * 100.0 / greatest(0, bt.raw_total - bt.cancel_total)) * 1.5)
      else 0 end as performance_score
    from branch_totals bt
    where bt.raw_total > 0
  ),
  ranked as (
    select
      s.branch_key,
      s.branch_name,
      row_number() over (order by s.performance_score desc, s.sort_order asc)::integer as rank_position
    from scored s
  )
  select r.branch_key, r.branch_name, r.rank_position
  from ranked r
  where v_role in ('admin', 'manager', 'agent', 'account_manager')
    or private.okb_can_access_branch(r.branch_name)
  order by r.rank_position;
end;
$$;

revoke all on function public.okb_get_branch_performance_ranks(date, date) from public, anon;
grant execute on function public.okb_get_branch_performance_ranks(date, date) to authenticated;

notify pgrst, 'reload schema';

select '024_branch_rank_true_position installed successfully' as migration_status;
