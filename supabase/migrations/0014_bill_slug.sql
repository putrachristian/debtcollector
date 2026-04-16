-- Human-readable bill URLs: unique `slug` (e.g. `dinner-meatsmith-a1b2c3d4`).

alter table public.bills
  add column if not exists slug text;

-- Readable base from title + short id fragment (always unique per bill).
update public.bills b
set slug =
  left(
    case
      when trim(both '-' from lower(regexp_replace(regexp_replace(coalesce(nullif(trim(b.title), ''), 'bill'), '[^a-zA-Z0-9]+', '-', 'g'), '-+', '-', 'g'))) in ('', 'new')
      then 'bill'
      else trim(both '-' from lower(regexp_replace(regexp_replace(coalesce(nullif(trim(b.title), ''), 'bill'), '[^a-zA-Z0-9]+', '-', 'g'), '-+', '-', 'g')))
    end,
    48
  )
  || '-'
  || substr(replace(b.id::text, '-', ''), 1, 8)
where b.slug is null;

alter table public.bills
  alter column slug set not null;

create unique index if not exists bills_slug_unique on public.bills (slug);

create or replace function public.slugify_bill_title(p_title text)
returns text
language sql
immutable
as $$
  select
    case
      when b = '' or b = 'new' then 'bill'
      else b
    end
  from (
    select trim(both '-' from lower(regexp_replace(regexp_replace(coalesce(nullif(trim(p_title), ''), 'bill'), '[^a-zA-Z0-9]+', '-', 'g'), '-+', '-', 'g'))) as b
  ) s;
$$;

create or replace function public.create_bill(
  p_invite_code text,
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
    invite_code,
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
    p_invite_code,
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

revoke all on function public.create_bill(text, text, text, text) from public;
grant execute on function public.create_bill(text, text, text, text) to authenticated;

revoke all on function public.slugify_bill_title(text) from public;
