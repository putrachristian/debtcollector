-- Bills INSERT still 403/42501 for some JWT/role setups (e.g. publishable keys + PostgREST).
-- 1) RPC runs as SECURITY DEFINER → bypasses RLS on INSERT (still enforces auth.uid() = host).
-- 2) INSERT policy without TO → applies to all DB roles; WITH CHECK still requires auth.uid().

create or replace function public.create_bill(
  p_invite_code text,
  p_title text default 'New bill',
  p_status text default 'open'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  st text;
  em text;
  dn text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
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

  st := case
    when lower(trim(p_status)) in ('draft', 'open', 'closed') then lower(trim(p_status))
    else 'open'
  end;

  insert into public.bills (
    host_id,
    title,
    invite_code,
    status,
    discount_type,
    discount_value,
    service_charge_cents,
    tax_cents
  )
  values (
    auth.uid(),
    coalesce(nullif(trim(p_title), ''), 'New bill'),
    p_invite_code,
    st,
    'percent',
    0,
    0,
    0
  )
  returning id into bid;

  return bid;
end;
$$;

revoke all on function public.create_bill(text, text, text) from public;
grant execute on function public.create_bill(text, text, text) to authenticated;

-- Policy without TO clause = PUBLIC (all roles); WITH CHECK still binds to JWT via auth.uid()
drop policy if exists "bills_insert_host" on public.bills;
create policy "bills_insert_host"
  on public.bills for insert
  with check (
    auth.uid() is not null
    and host_id = auth.uid()
  );
