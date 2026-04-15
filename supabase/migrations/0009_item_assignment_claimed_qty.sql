-- Per-user quantity claimed on a line (must sum to bill_items.qty for weighted split).
-- Legacy rows: multiple people on qty=1 line still use equal money split in calculateBill.

alter table public.item_assignments
  add column if not exists claimed_qty integer not null default 1
  constraint item_assignments_claimed_qty_pos check (claimed_qty > 0);

-- Backfill integer split of line qty across assignees (equal + remainder to lowest user_ids first).
with per as (
  select
    ia.id,
    ia.bill_item_id,
    bi.qty,
    count(*) over (partition by ia.bill_item_id)::int as n,
    row_number() over (partition by ia.bill_item_id order by ia.user_id)::int as rn
  from public.item_assignments ia
  join public.bill_items bi on bi.id = ia.bill_item_id
),
calc as (
  select
    id,
    case
      when qty >= n then (qty / n) + case when (rn - 1) < (qty % n) then 1 else 0 end
      else 1
    end as cq
  from per
)
update public.item_assignments ia
set claimed_qty = calc.cq
from calc
where calc.id = ia.id;

create or replace function public.rebuild_item_assignment_modes(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  line_qty int;
begin
  select bi.qty into line_qty from public.bill_items bi where bi.id = p_item;
  if line_qty is null then
    return;
  end if;

  select count(*)::int into n from public.item_assignments where bill_item_id = p_item;
  if n = 0 then
    return;
  end if;

  if n = 1 then
    update public.item_assignments
    set mode = case when claimed_qty >= line_qty then 'individual' else 'shared_equal' end
    where bill_item_id = p_item;
    return;
  end if;

  update public.item_assignments set mode = 'shared_equal' where bill_item_id = p_item;
end;
$$;

revoke all on function public.rebuild_item_assignment_modes(uuid) from public;

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
  other_sum int;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select i.bill_id, i.qty into bid, line_qty
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

  if p_qty < 0 then
    raise exception 'invalid_qty';
  end if;

  if p_qty = 0 then
    delete from public.item_assignments
    where bill_item_id = p_bill_item_id and user_id = me;
  else
    if p_qty > line_qty then
      raise exception 'qty_exceeds_line';
    end if;

    select coalesce(sum(claimed_qty), 0) into other_sum
    from public.item_assignments
    where bill_item_id = p_bill_item_id and user_id is distinct from me;

    if other_sum + p_qty > line_qty then
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

revoke all on function public.set_my_item_claim_qty(uuid, int) from public;
grant execute on function public.set_my_item_claim_qty(uuid, int) to authenticated;

-- Boolean claim RPC: keep for compatibility; set claimed_qty (full line for sole claimant, else 1 each = legacy multi on dish).
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
  line_qty int;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select i.bill_id, i.qty into bid, line_qty from public.bill_items i where i.id = p_bill_item_id;
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
    insert into public.item_assignments (bill_item_id, user_id, mode, claimed_qty)
    values (p_bill_item_id, cur_users[1], 'individual', line_qty);
  else
    foreach v_user in array cur_users
    loop
      insert into public.item_assignments (bill_item_id, user_id, mode, claimed_qty)
      values (p_bill_item_id, v_user, 'shared_equal', 1);
    end loop;
  end if;

  perform public.rebuild_item_assignment_modes(p_bill_item_id);
end;
$$;

revoke all on function public.claim_bill_item(uuid, boolean) from public;
grant execute on function public.claim_bill_item(uuid, boolean) to authenticated;
