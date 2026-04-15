-- DebtCollector — profiles, bills, items, participants, assignments, payments
-- Apply in Supabase SQL editor or `supabase db push`

create extension if not exists "pgcrypto";

-- Profiles (id = auth.users.id)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bills
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  invite_code text not null unique,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  discount_type text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount_value numeric not null default 0,
  service_charge_cents integer not null default 0,
  tax_cents integer not null default 0,
  subtotal_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists bills_host_id_idx on public.bills (host_id);
create index if not exists bills_invite_code_idx on public.bills (invite_code);

-- Participants (before policies that reference it)
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (bill_id, user_id)
);

create index if not exists participants_bill_id_idx on public.participants (bill_id);

-- Bill items
create table if not exists public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  name text not null,
  unit_price_cents integer not null,
  qty integer not null default 1 check (qty > 0),
  line_subtotal_cents integer not null
);

create index if not exists bill_items_bill_id_idx on public.bill_items (bill_id);

-- Item assignments
create table if not exists public.item_assignments (
  id uuid primary key default gen_random_uuid(),
  bill_item_id uuid not null references public.bill_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('individual', 'shared_equal')),
  unique (bill_item_id, user_id)
);

create index if not exists item_assignments_item_idx on public.item_assignments (bill_item_id);

-- Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  bill_id uuid references public.bills (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  proof_path text,
  status text not null default 'pending_proof'
    check (status in ('pending_proof', 'awaiting_confirmation', 'settled', 'rejected')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists payments_from_idx on public.payments (from_user_id);
create index if not exists payments_to_idx on public.payments (to_user_id);

-- Helper: host or participant can see bill
create or replace function public.is_bill_participant(bill uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bills b
    where b.id = bill and b.host_id = auth.uid()
  )
  or exists (
    select 1 from public.participants p
    where p.bill_id = bill and p.user_id = auth.uid()
  );
$$;

grant execute on function public.is_bill_participant(uuid) to authenticated;

-- Join via invite (avoids exposing all open bills)
create or replace function public.join_bill(p_invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  select b.id into bid
  from public.bills b
  where b.invite_code = p_invite
    and b.status <> 'closed'
  limit 1;

  if bid is null then
    raise exception 'Invalid or closed invite';
  end if;

  insert into public.participants (bill_id, user_id)
  values (bid, auth.uid())
  on conflict (bill_id, user_id) do nothing;

  return bid;
end;
$$;

grant execute on function public.join_bill(text) to authenticated;

create or replace function public.add_host_as_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.participants (bill_id, user_id)
  values (new.id, new.host_id)
  on conflict (bill_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_bills_host_participant on public.bills;
create trigger trg_bills_host_participant
  after insert on public.bills
  for each row execute function public.add_host_as_participant();

-- Bills RLS
alter table public.bills enable row level security;

create policy "bills_select_participant"
  on public.bills for select
  to authenticated
  using (public.is_bill_participant(id));

create policy "bills_insert_host"
  on public.bills for insert
  to authenticated
  with check (host_id = auth.uid());

create policy "bills_update_participant"
  on public.bills for update
  to authenticated
  using (public.is_bill_participant(id))
  with check (public.is_bill_participant(id));

create policy "bills_delete_host"
  on public.bills for delete
  to authenticated
  using (host_id = auth.uid());

-- Participants RLS
alter table public.participants enable row level security;

create policy "participants_select_participant"
  on public.participants for select
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "participants_insert_join"
  on public.participants for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.bills b
      where b.id = bill_id and b.status <> 'closed'
    )
  );

create policy "participants_delete_self_or_host"
  on public.participants for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.bills b where b.id = bill_id and b.host_id = auth.uid())
  );

-- Bill items RLS
alter table public.bill_items enable row level security;

create policy "bill_items_select_participant"
  on public.bill_items for select
  to authenticated
  using (public.is_bill_participant(bill_id));

create policy "bill_items_insert_participant"
  on public.bill_items for insert
  to authenticated
  with check (public.is_bill_participant(bill_id));

create policy "bill_items_update_participant"
  on public.bill_items for update
  to authenticated
  using (public.is_bill_participant(bill_id))
  with check (public.is_bill_participant(bill_id));

create policy "bill_items_delete_participant"
  on public.bill_items for delete
  to authenticated
  using (public.is_bill_participant(bill_id));

-- Item assignments RLS
alter table public.item_assignments enable row level security;

create policy "item_assignments_select_participant"
  on public.item_assignments for select
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      where i.id = bill_item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "item_assignments_insert_participant"
  on public.item_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bill_items i
      where i.id = bill_item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "item_assignments_update_participant"
  on public.item_assignments for update
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      where i.id = bill_item_id and public.is_bill_participant(i.bill_id)
    )
  )
  with check (
    exists (
      select 1 from public.bill_items i
      where i.id = bill_item_id and public.is_bill_participant(i.bill_id)
    )
  );

create policy "item_assignments_delete_participant"
  on public.item_assignments for delete
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      where i.id = bill_item_id and public.is_bill_participant(i.bill_id)
    )
  );

-- Payments RLS
alter table public.payments enable row level security;

create policy "payments_select_party"
  on public.payments for select
  to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "payments_insert_payer"
  on public.payments for insert
  to authenticated
  with check (from_user_id = auth.uid());

create policy "payments_update_party"
  on public.payments for update
  to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid())
  with check (from_user_id = auth.uid() or to_user_id = auth.uid());

-- Realtime (ignore errors if already added)
do $body$
begin
  begin
    execute 'alter publication supabase_realtime add table public.bills';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.bill_items';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.participants';
  exception when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.item_assignments';
  exception when duplicate_object then null;
  end;
end
$body$;

-- Storage bucket for payment proofs
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy "payment_proofs_select_party"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.payments p
      where p.proof_path = storage.objects.name
        and (p.from_user_id = auth.uid() or p.to_user_id = auth.uid())
    )
  );

create policy "payment_proofs_insert_own_prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "payment_proofs_update_own_prefix"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'payment-proofs')
  with check (bucket_id = 'payment-proofs');
