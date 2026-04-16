-- Receipt image (storage path), bill date, and "share among N people" per line item.

alter table public.bills
  add column if not exists receipt_image_path text,
  add column if not exists bill_date date;

alter table public.bill_items
  add column if not exists share_among integer;

alter table public.bill_items
  drop constraint if exists bill_items_share_among_check;

alter table public.bill_items
  add constraint bill_items_share_among_check check (share_among is null or share_among >= 2);

-- Public bucket so <img src=".../object/public/..."> works for all signed-in app users.
insert into storage.buckets (id, name, public)
values ('bill-receipts', 'bill-receipts', true)
on conflict (id) do update set public = true;

create policy "bill_receipts_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'bill-receipts');

create policy "bill_receipts_insert_host"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'bill-receipts'
    and split_part(name, '/', 1)::uuid in (select id from public.bills where host_id = auth.uid())
  );

create policy "bill_receipts_update_host"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'bill-receipts'
    and split_part(name, '/', 1)::uuid in (select id from public.bills where host_id = auth.uid())
  )
  with check (
    bucket_id = 'bill-receipts'
    and split_part(name, '/', 1)::uuid in (select id from public.bills where host_id = auth.uid())
  );

create policy "bill_receipts_delete_host"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'bill-receipts'
    and split_part(name, '/', 1)::uuid in (select id from public.bills where host_id = auth.uid())
  );

create or replace function public.set_my_item_claim_qty(p_bill_item_id uuid, p_qty int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  me uuid := auth.uid();
  line_qty int;
  share_n int;
  cap int;
  other_sum int;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select i.bill_id, i.qty, coalesce(i.share_among, 0)
  into bid, line_qty, share_n
  from public.bill_items i
  where i.id = p_bill_item_id;

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

  cap := case when share_n >= 2 then share_n else line_qty end;

  if p_qty < 0 then
    raise exception 'invalid_qty';
  end if;

  if p_qty = 0 then
    delete from public.item_assignments
    where bill_item_id = p_bill_item_id and user_id = me;
  else
    if p_qty > cap then
      raise exception 'qty_exceeds_line';
    end if;

    select coalesce(sum(claimed_qty), 0) into other_sum
    from public.item_assignments
    where bill_item_id = p_bill_item_id and user_id is distinct from me;

    if other_sum + p_qty > cap then
      raise exception 'over_claim';
    end if;

    insert into public.item_assignments (bill_item_id, user_id, mode, claimed_qty)
    values (p_bill_item_id, me, 'shared_equal', p_qty)
    on conflict (bill_item_id, user_id) do update
      set claimed_qty = excluded.claimed_qty;
  end if;

  perform public.rebuild_item_assignment_modes(p_bill_item_id);
end;
$$;
