-- OKB CRM — OCR payment-proof reviewer.
-- Safe/idempotent: stores review results only; it does not change order money.

create table if not exists public.payment_ocr_audits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  proof_type text not null check (proof_type in ('secretary','collection')),
  image_url text not null,
  expected_amount numeric(14,2) not null default 0,
  extracted_amount numeric(14,2),
  difference numeric(14,2),
  confidence numeric(5,4),
  status text not null default 'pending' check (status in ('pending','verified','mismatch','multiple','unreadable','service_not_configured','failed')),
  extracted_text text,
  candidates jsonb not null default '[]'::jsonb,
  error_message text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, proof_type)
);

create index if not exists payment_ocr_audits_order_idx on public.payment_ocr_audits(order_id);
create index if not exists payment_ocr_audits_status_updated_idx on public.payment_ocr_audits(status, updated_at desc);

alter table public.payment_ocr_audits enable row level security;
drop policy if exists okb_authenticated_access on public.payment_ocr_audits;
create policy okb_authenticated_access on public.payment_ocr_audits
for all to authenticated
using (private.okb_is_active_user())
with check (private.okb_is_active_user());

revoke all on table public.payment_ocr_audits from anon;
grant select, insert, update, delete on table public.payment_ocr_audits to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='payment_ocr_audits'
  ) then
    alter publication supabase_realtime add table public.payment_ocr_audits;
  end if;
end $$;

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='payment_ocr_audits'
order by ordinal_position;
