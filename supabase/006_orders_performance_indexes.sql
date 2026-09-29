-- OKB CRM — read-performance indexes for dashboards and reports.
-- Safe to run once from Supabase SQL Editor. Existing data is not changed.

create index if not exists orders_branch_created_at_idx
  on public.orders (branch, created_at desc);

create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

create index if not exists orders_doctor_created_at_idx
  on public.orders (doctor_name, created_at desc);

create index if not exists orders_employee_created_at_idx
  on public.orders (employee_name, created_at desc);

create index if not exists orders_shipping_created_at_idx
  on public.orders (shipping_company, created_at desc);

analyze public.orders;
