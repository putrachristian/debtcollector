-- Let any bill participant (or host) set `share_among` from the order-pick UI (RLS still restricts direct `bill_items` updates to host).

create or replace function public.set_bill_item_share_among(p_bill_item_id uuid, p_share_among integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  me uuid := auth.uid();
  sum_c int;
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

  if exists (select 1 from public.bills b where b.id = bid and b.status = 'closed') then
    raise exception 'bill_closed';
  end if;

  select coalesce(sum(claimed_qty), 0) into sum_c
  from public.item_assignments
  where bill_item_id = p_bill_item_id;

  if p_share_among is null then
    if sum_c > 0 then
      raise exception 'cannot_clear_share_while_claimed';
    end if;
    update public.bill_items set share_among = null where id = p_bill_item_id;
    return;
  end if;

  if p_share_among < 2 then
    raise exception 'invalid_share_among';
  end if;

  if sum_c > p_share_among then
    raise exception 'share_too_low_for_claims';
  end if;

  update public.bill_items set share_among = p_share_among where id = p_bill_item_id;

  perform public.rebuild_item_assignment_modes(p_bill_item_id);
end;
$$;

grant execute on function public.set_bill_item_share_among(uuid, integer) to authenticated;
