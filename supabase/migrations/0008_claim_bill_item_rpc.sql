-- Ensures claim_bill_item exists for PostgREST (PGRST202 if migration 0007 was never applied).
-- Idempotent: safe if 0007 already created the function.

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
