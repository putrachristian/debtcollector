-- Trip groups can be renamed or removed by the original creator or by any user
-- who hosts at least one bill in that group (multi-host trips).

revoke update on table public.bill_groups from authenticated;
grant update (title) on table public.bill_groups to authenticated;

drop policy if exists "bill_groups_update_own" on public.bill_groups;
drop policy if exists "bill_groups_delete_own" on public.bill_groups;

create policy "bill_groups_update_stakeholder"
  on public.bill_groups for update
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.bills b
      where b.group_id = bill_groups.id
        and b.host_id = auth.uid()
    )
  )
  with check (true);

create policy "bill_groups_delete_stakeholder"
  on public.bill_groups for delete
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.bills b
      where b.group_id = bill_groups.id
        and b.host_id = auth.uid()
    )
  );
