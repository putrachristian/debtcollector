-- Optional trip/day grouping + payee (transfer) details on bills.

create table if not exists public.bill_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists bill_groups_created_by_idx on public.bill_groups (created_by);

alter table public.bills
  add column if not exists payer_name text,
  add column if not exists payer_account_number text,
  add column if not exists group_id uuid references public.bill_groups (id) on delete set null;

create index if not exists bills_group_id_idx on public.bills (group_id);

alter table public.bill_groups enable row level security;

grant select, insert, update, delete on table public.bill_groups to authenticated;

create policy "bill_groups_select_authenticated"
  on public.bill_groups for select
  to authenticated
  using (true);

create policy "bill_groups_insert_own"
  on public.bill_groups for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "bill_groups_update_own"
  on public.bill_groups for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "bill_groups_delete_own"
  on public.bill_groups for delete
  to authenticated
  using (created_by = auth.uid());
