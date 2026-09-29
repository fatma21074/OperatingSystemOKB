-- تاريخ التحصيل المحاسبي المستقل للخزنة.
-- شغّل الملف مرة واحدة من Supabase SQL Editor قبل نشر النسخة الجديدة.

begin;

alter table public.orders
  add column if not exists collected_at timestamptz;

-- ترحيل الأوردرات القديمة من آخر سجل تحصيل محفوظ داخل COLLECT_META.
do $$
declare
  row_item record;
  meta_text text;
  meta_json jsonb;
  last_at text;
begin
  for row_item in
    select id, notes, created_at
    from public.orders
    where status = 'Signed' and collected_at is null
  loop
    begin
      meta_text := substring(row_item.notes from '\[COLLECT_META:(\{.*\})\]\s*$');
      if meta_text is not null then
        meta_json := meta_text::jsonb;
        last_at := meta_json -> 'history' -> -1 ->> 'at';
      else
        last_at := null;
      end if;

      update public.orders
      set collected_at = coalesce(nullif(last_at, '')::timestamptz, row_item.created_at)
      where id = row_item.id;
    exception when others then
      update public.orders set collected_at = row_item.created_at where id = row_item.id;
    end;
  end loop;
end $$;

create index if not exists orders_branch_status_collected_at_idx
  on public.orders (branch, status, collected_at desc);

grant select, update (collected_at) on public.orders to authenticated;

commit;

select
  count(*) filter (where status = 'Signed') as signed_orders,
  count(*) filter (where status = 'Signed' and collected_at is not null) as signed_with_accounting_date
from public.orders;
