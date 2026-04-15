-- Any signed-in user can read non-closed bills and their split data (browse + home directory).
-- Mutations stay restricted (host / participant RPCs and existing write policies).

create policy "bills_select_open_authenticated"
  on public.bills for select
  to authenticated
  using (status <> 'closed');

create policy "bill_items_select_open_bill"
  on public.bill_items for select
  to authenticated
  using (
    exists (select 1 from public.bills b where b.id = bill_id and b.status <> 'closed')
  );

create policy "participants_select_open_bill"
  on public.participants for select
  to authenticated
  using (
    exists (select 1 from public.bills b where b.id = bill_id and b.status <> 'closed')
  );

create policy "item_assignments_select_open_bill"
  on public.item_assignments for select
  to authenticated
  using (
    exists (
      select 1 from public.bill_items i
      join public.bills b on b.id = i.bill_id
      where i.id = bill_item_id and b.status <> 'closed'
    )
  );
