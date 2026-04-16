-- Bills are opened by slug/URL; invite codes are no longer used.

create or replace function public.join_bill_by_id(p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.bills b where b.id = p_bill_id and b.status <> 'closed'
  ) then
    raise exception 'invalid_or_closed_bill';
  end if;

  insert into public.participants (bill_id, user_id)
  values (p_bill_id, auth.uid())
  on conflict (bill_id, user_id) do nothing;

  return p_bill_id;
end;
$$;

grant execute on function public.join_bill_by_id(uuid) to authenticated;

drop function if exists public.join_bill(text);

drop index if exists public.bills_invite_code_idx;

alter table public.bills
  drop column if exists invite_code;

-- Recreate create_bill without invite_code (replaces 4-arg version from 0014).
drop function if exists public.create_bill(text, text, text, text);

create or replace function public.create_bill(
  p_title text default 'New bill',
  p_status text default 'open',
  p_currency text default 'IDR'
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
  slug_base text;
  slug_val text;
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
    cur := 'IDR';
  end if;

  bid := gen_random_uuid();
  slug_base := public.slugify_bill_title(coalesce(nullif(trim(p_title), ''), 'New bill'));
  slug_val := left(slug_base, 48) || '-' || substr(replace(bid::text, '-', ''), 1, 8);

  insert into public.bills (
    id,
    host_id,
    title,
    slug,
    status,
    discount_type,
    discount_value,
    service_charge_cents,
    tax_cents,
    currency
  )
  values (
    bid,
    auth.uid(),
    coalesce(nullif(trim(p_title), ''), 'New bill'),
    slug_val,
    st,
    'percent',
    0,
    0,
    0,
    cur
  );

  return bid;
end;
$$;

revoke all on function public.create_bill(text, text, text) from public;
grant execute on function public.create_bill(text, text, text) to authenticated;
