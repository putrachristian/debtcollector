-- Internal team: notify all profiles (except host) when a bill is created.
-- Participants claim lines via claim_bill_item(); host-only edits for bills/items/assignments from client.

-- --- bill_notifications ---
create table if not exists public.bill_notifications (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title_snapshot text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (bill_id, user_id)
);

create index if not exists bill_notifications_user_idx on public.bill_notifications (user_id);
create index if not exists bill_notifications_bill_idx on public.bill_notifications (bill_id);

alter table public.bill_notifications enable row level security;

create policy "bill_notifications_select_own"
  on public.bill_notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "bill_notifications_update_own"
  on public.bill_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "bill_notifications_delete_own"
  on public.bill_notifications for delete
  to authenticated
  using (user_id = auth.uid());

grant select, update, delete on table public.bill_notifications to authenticated;

create or replace function public.fn_notify_profiles_new_bill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bill_notifications (bill_id, user_id, title_snapshot)
  select NEW.id, p.id, coalesce(nullif(trim(NEW.title), ''), 'New bill')
  from public.profiles p
  where p.id is distinct from NEW.host_id
  on conflict (bill_id, user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_bills_notify_profiles on public.bills;
create trigger trg_bills_notify_profiles
  after insert on public.bills
  for each row execute function public.fn_notify_profiles_new_bill();

do $body$
begin
  begin
    execute 'alter publication supabase_realtime add table public.bill_notifications';
  exception when duplicate_object then null;
  end;
end
$body$;

-- --- claim line item (host or participant); SECURITY DEFINER bypasses RLS ---
create or replace function public.claim_bill_item(p_bill_item_id uuid, p_claim boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  me uuid := auth.uid();
  cur_users uuid[];
  v_user uuid;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select i.bill_id into bid from public.bill_items i where i.id = p_bill_item_id;
  if bid is null then
    raise exception 'item_not_found';
  end if;

  if not exists (
    select 1 from public.participants p where p.bill_id = bid and p.user_id = me
  ) and not exists (
    select 1 from public.bills b where b.id = bid and b.host_id = me
  ) then
    raise exception 'forbidden';
  end if;

  select coalesce(array_agg(a.user_id order by a.user_id), array[]::uuid[])
  into cur_users
  from public.item_assignments a
  where a.bill_item_id = p_bill_item_id;

  if p_claim then
    if not (me = any (cur_users)) then
      cur_users := array_append(cur_users, me);
    end if;
  else
    cur_users := array_remove(cur_users, me);
  end if;

  delete from public.item_assignments where bill_item_id = p_bill_item_id;

  if coalesce(array_length(cur_users, 1), 0) = 0 then
    return;
  end if;

  if array_length(cur_users, 1) = 1 then
    insert into public.item_assignments (bill_item_id, user_id, mode)
    values (p_bill_item_id, cur_users[1], 'individual');
  else
    foreach v_user in array cur_users
    loop
      insert into public.item_assignments (bill_item_id, user_id, mode)
      values (p_bill_item_id, v_user, 'shared_equal');
    end loop;
  end if;
end;
$$;

revoke all on function public.claim_bill_item(uuid, boolean) from public;
grant execute on function public.claim_bill_item(uuid, boolean) to authenticated;

-- --- bills: only host may update ---
drop policy if exists "bills_update_participant" on public.bills;
drop policy if exists "bills_update_host" on public.bills;

create policy "bills_update_host"
  on public.bills for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- --- bill_items: only host may insert/update/delete ---
drop policy if exists "bill_items_insert_participant" on public.bill_items;
drop policy if exists "bill_items_update_participant" on public.bill_items;
drop policy if exists "bill_items_delete_participant" on public.bill_items;
drop policy if exists "bill_items_insert_host" on public.bill_items;
drop policy if exists "bill_items_update_host" on public.bill_items;
drop policy if exists "bill_items_delete_host" on public.bill_items;

create policy "bill_items_insert_host"
  on public.bill_items for insert
  to authenticated
  with check (exists (select 1 from public.bills b where b.id = bill_id and b.host_id = auth.uid()));

create policy "bill_items_update_host"
  on public.bill_items for update
  to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id and b.host_id = auth.uid()))
  with check (exists (select 1 from public.bills b where b.id = bill_id and b.host_id = auth.uid()));

create policy "bill_items_delete_host"
  on public.bill_items for delete
  to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_id and b.host_id = auth.uid()));

-- --- item_assignments: only host may mutate rows (guests use claim_bill_item) ---
drop policy if exists "item_assignments_insert_participant" on public.item_assignments;
drop policy if exists "item_assignments_update_participant" on public.item_assignments;
drop policy if exists "item_assignments_delete_participant" on public.item_assignments;
drop policy if exists "item_assignments_insert_host" on public.item_assignments;
drop policy if exists "item_assignments_update_host" on public.item_assignments;
drop policy if exists "item_assignments_delete_host" on public.item_assignments;

create policy "item_assignments_insert_host"
  on public.item_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bill_items i
      join public.bills b on b.id = i.bill_id
      where i.id = bill_item_id and b.host_id = auth.uid()
    )
  );

create policy "item_assignments_update_host"
  on public.item_assignments for update
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      join public.bills b on b.id = i.bill_id
      where i.id = bill_item_id and b.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bill_items i
      join public.bills b on b.id = i.bill_id
      where i.id = bill_item_id and b.host_id = auth.uid()
    )
  );

create policy "item_assignments_delete_host"
  on public.item_assignments for delete
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      join public.bills b on b.id = i.bill_id
      where i.id = bill_item_id and b.host_id = auth.uid()
    )
  );
