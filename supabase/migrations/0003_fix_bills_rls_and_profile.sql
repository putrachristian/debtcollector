-- Fix 42501 on bills insert: ensure JWT-backed auth.uid(), profile row (FK), grants, and participant trigger path.

-- 1) Profile row required by bills.host_id → profiles(id)
create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  dn text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  em := coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email');
  dn := coalesce(
    nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', '')), ''),
    nullif(split_part(coalesce(em, ''), '@', 1), ''),
    'Member'
  );

  insert into public.profiles (id, display_name)
  values (auth.uid(), dn)
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.ensure_my_profile() to authenticated;

-- 2) Explicit table grants (some projects revoke defaults)
grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.bills to authenticated;
grant select, insert, update, delete on table public.participants to authenticated;
grant select, insert, update, delete on table public.bill_items to authenticated;
grant select, insert, update, delete on table public.item_assignments to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.payments to authenticated;

-- 3) Re-create bills insert policy (explicit null check)
drop policy if exists "bills_insert_host" on public.bills;
create policy "bills_insert_host"
  on public.bills for insert
  to authenticated
  with check (
    auth.uid() is not null
    and host_id = auth.uid()
  );

-- 4) Host adding themselves as participant (AFTER INSERT trigger) — ORs with existing join policy
drop policy if exists "participants_insert_host_self" on public.participants;
create policy "participants_insert_host_self"
  on public.participants for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.bills b
      where b.id = bill_id
        and b.host_id = auth.uid()
    )
  );
