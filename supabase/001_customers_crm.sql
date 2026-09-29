-- OKB CRM - Customer profiles foundation
-- Safe/idempotent migration: it does not delete or rewrite existing orders.

begin;

create extension if not exists pgcrypto;

create or replace function public.normalize_customer_phone(phone_value text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g');
  if digits = '' then return null; end if;

  if digits like '0020%' then
    digits := '0' || substring(digits from 5);
  elsif digits like '20%' and length(digits) = 12 then
    digits := '0' || substring(digits from 3);
  elsif digits like '1%' and length(digits) = 10 then
    digits := '0' || digits;
  end if;

  return nullif(digits, '');
end;
$$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  phone_normalized text not null,
  phone2 text,
  area text,
  doctor_name text,
  last_branch text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_phone_normalized_unique
  on public.customers (phone_normalized);
create index if not exists customers_name_search_idx
  on public.customers (lower(customer_name));

alter table public.orders
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_customer_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on delete set null;
  end if;
end $$;

create index if not exists orders_customer_id_idx
  on public.orders (customer_id);
create index if not exists orders_customer_created_at_idx
  on public.orders (customer_id, created_at desc);

create or replace function public.set_customer_normalized_fields()
returns trigger
language plpgsql
as $$
begin
  new.phone_normalized := public.normalize_customer_phone(new.phone);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customers_normalize on public.customers;
create trigger trg_customers_normalize
before insert or update of phone, customer_name, phone2, area, doctor_name, last_branch, notes, is_active
on public.customers
for each row execute function public.set_customer_normalized_fields();

-- Create one customer profile per normalized phone from the most recent order.
with ranked_orders as (
  select
    nullif(trim(o.customer_name), '') as customer_name,
    nullif(trim(o.phone), '') as phone,
    public.normalize_customer_phone(o.phone) as phone_normalized,
    nullif(trim(o.phone2), '') as phone2,
    nullif(trim(o.area), '') as area,
    nullif(trim(o.doctor_name), '') as doctor_name,
    nullif(trim(o.branch), '') as last_branch,
    o.created_at,
    row_number() over (
      partition by public.normalize_customer_phone(o.phone)
      order by o.created_at desc nulls last, o.id desc
    ) as row_rank
  from public.orders o
  where public.normalize_customer_phone(o.phone) is not null
)
insert into public.customers (
  customer_name, phone, phone_normalized, phone2, area,
  doctor_name, last_branch, created_at, updated_at
)
select
  coalesce(customer_name, 'عميل بدون اسم'),
  phone,
  phone_normalized,
  phone2,
  area,
  doctor_name,
  last_branch,
  coalesce(created_at, now()),
  now()
from ranked_orders
where row_rank = 1
on conflict (phone_normalized) do nothing;

-- Link all historical orders without changing any existing order details.
update public.orders o
set customer_id = c.id
from public.customers c
where o.customer_id is null
  and c.phone_normalized = public.normalize_customer_phone(o.phone);

-- Automatically create/link/update the customer profile on future order saves.
create or replace function public.link_order_to_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
  linked_customer_id uuid;
begin
  normalized_phone := public.normalize_customer_phone(new.phone);
  if normalized_phone is null then
    return new;
  end if;

  insert into public.customers (
    customer_name, phone, phone_normalized, phone2, area,
    doctor_name, last_branch, updated_at
  ) values (
    coalesce(nullif(trim(new.customer_name), ''), 'عميل بدون اسم'),
    new.phone,
    normalized_phone,
    nullif(trim(new.phone2), ''),
    nullif(trim(new.area), ''),
    nullif(trim(new.doctor_name), ''),
    nullif(trim(new.branch), ''),
    now()
  )
  on conflict (phone_normalized) do update set
    customer_name = excluded.customer_name,
    phone = excluded.phone,
    phone2 = coalesce(excluded.phone2, customers.phone2),
    area = coalesce(excluded.area, customers.area),
    doctor_name = coalesce(excluded.doctor_name, customers.doctor_name),
    last_branch = coalesce(excluded.last_branch, customers.last_branch),
    updated_at = now()
  returning id into linked_customer_id;

  new.customer_id := linked_customer_id;
  return new;
end;
$$;

drop trigger if exists trg_orders_link_customer on public.orders;
create trigger trg_orders_link_customer
before insert or update of customer_name, phone, phone2, area, doctor_name, branch
on public.orders
for each row execute function public.link_order_to_customer();

alter table public.customers enable row level security;

drop policy if exists customers_read_current_system on public.customers;
drop policy if exists customers_insert_current_system on public.customers;
drop policy if exists customers_update_current_system on public.customers;

create policy customers_read_current_system
on public.customers for select
to anon, authenticated
using (true);

create policy customers_insert_current_system
on public.customers for insert
to anon, authenticated
with check (true);

create policy customers_update_current_system
on public.customers for update
to anon, authenticated
using (true)
with check (true);

grant select, insert, update on public.customers to anon, authenticated;
grant execute on function public.normalize_customer_phone(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;

-- Verification results (read-only):
select
  (select count(*) from public.customers) as customers_count,
  (select count(*) from public.orders where customer_id is not null) as linked_orders_count,
  (select count(*) from public.orders where customer_id is null) as unlinked_orders_count,
  (select count(*) from public.customers where phone_normalized is null) as invalid_customer_phones;

