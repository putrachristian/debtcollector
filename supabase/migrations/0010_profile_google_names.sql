-- Prefer Google given_name + family_name for profiles.display_name; refresh on each sign-in.

create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  gn text;
  fn text;
  dn text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  em := coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email');
  gn := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'given_name', '')), '');
  fn := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'family_name', '')), '');

  dn := case
    when gn is not null and fn is not null then trim(gn || ' ' || fn)
    when gn is not null then gn
    when fn is not null then fn
    else null
  end;

  dn := coalesce(
    dn,
    nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', '')), ''),
    nullif(split_part(coalesce(em, ''), '@', 1), ''),
    'Member'
  );

  insert into public.profiles (id, display_name)
  values (auth.uid(), dn)
  on conflict (id) do update
    set display_name = excluded.display_name;
end;
$$;
