-- Allow bill host or any participant to set/clear bills.group_id (trip grouping),
-- without granting broad UPDATE on bills to non-hosts.

create or replace function public.set_bill_group_id(p_bill_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  st text;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select status into st from public.bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found';
  end if;
  if st = 'closed' then
    raise exception 'Bill is closed';
  end if;

  if not exists (
    select 1 from public.bills b where b.id = p_bill_id and b.host_id = me
  ) and not exists (
    select 1 from public.participants p where p.bill_id = p_bill_id and p.user_id = me
  ) then
    raise exception 'Not allowed';
  end if;

  if p_group_id is not null then
    if not exists (select 1 from public.bill_groups g where g.id = p_group_id) then
      raise exception 'Trip group not found';
    end if;
  end if;

  update public.bills set group_id = p_group_id where id = p_bill_id;
end;
$$;

revoke all on function public.set_bill_group_id(uuid, uuid) from public;
grant execute on function public.set_bill_group_id(uuid, uuid) to authenticated;
