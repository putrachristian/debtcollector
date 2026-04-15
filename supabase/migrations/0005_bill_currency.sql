-- ISO 4217 code for display (e.g. IDR vs USD minor-unit interpretation).

alter table public.bills
  add column if not exists currency text not null default 'USD';

drop function if exists public.create_bill(text, text, text);

create or replace function public.create_bill(
  p_invite_code text,
  p_title text default 'New bill',
  p_status text default 'open',
  p_currency text default 'USD'
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
  cur text;
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

  cur := upper(nullif(trim(p_currency), ''));
  if cur is null or length(cur) <> 3 then
    cur := 'USD';
  end if;

  insert into public.bills (
    host_id,
    title,
    invite_code,
    status,
    discount_type,
    discount_value,
    service_charge_cents,
    tax_cents,
    currency
  )
  values (
    auth.uid(),
    coalesce(nullif(trim(p_title), ''), 'New bill'),
    p_invite_code,
    st,
    'percent',
    0,
    0,
    0,
    cur
  )
  returning id into bid;

  return bid;
end;
$$;

revoke all on function public.create_bill(text, text, text, text) from public;
grant execute on function public.create_bill(text, text, text, text) to authenticated;
