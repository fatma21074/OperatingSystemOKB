-- v266 Optional UI customization; run once in Supabase SQL Editor BEFORE saving settings.
-- Existing Supabase private.okb_current_user_role() and private.okb_is_active_user() are reused.
create table if not exists public.okb_ui_customization (
 id text primary key,
 config jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.okb_ui_customization enable row level security;
grant select, insert, update on public.okb_ui_customization to authenticated;
drop policy if exists okb_ui_config_active_read on public.okb_ui_customization;
create policy okb_ui_config_active_read on public.okb_ui_customization
for select to authenticated using (private.okb_is_active_user());
drop policy if exists okb_ui_config_admin_insert on public.okb_ui_customization;
create policy okb_ui_config_admin_insert on public.okb_ui_customization
for insert to authenticated with check (private.okb_current_user_role() = 'admin' and id = 'main');
drop policy if exists okb_ui_config_admin_update on public.okb_ui_customization;
create policy okb_ui_config_admin_update on public.okb_ui_customization
for update to authenticated using (private.okb_current_user_role() = 'admin' and id = 'main')
with check (private.okb_current_user_role() = 'admin' and id = 'main');
