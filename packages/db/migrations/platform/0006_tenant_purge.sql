-- Deleting a tenant (tenant-lifecycle.md, TL-I, TL-J): what remains is this row, its dates and a report
-- the steward wrote by checking. It may take a job, remove a tenant's addresses and its jobs, and write
-- that record, and nothing else here: `change_tenant_state` still decides every other change.
alter table tenant
  add column deletion_began_at timestamptz,
  add column deleted_at timestamptz,
  add column purge_report jsonb;

grant select, insert, update, delete on job to aw_steward;
create policy job_steward on job to aw_steward using (true) with check (true);
grant delete on tenant_hostname to aw_steward;

-- The last change a tenant has. A reason is somebody's words, so it goes with the rest.
create function tenant_deleted(target text, report jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = platform, pg_temp
as $$
begin
  if session_user <> 'aw_steward' then
    raise exception 'This login may not change a tenant''s state' using errcode = 'AW001';
  end if;
  update tenant set
    state = 'deleted',
    deletion_began_at = state_since,
    state_since = now(),
    deleted_at = now(),
    state_reason = null,
    purge_report = report
  where id = target and state = 'deleting';
  if not found then
    raise exception 'The tenant % is not being deleted', target using errcode = 'AW002';
  end if;
end
$$;

revoke all on function tenant_deleted(text, jsonb) from public;
grant execute on function tenant_deleted(text, jsonb) to aw_steward;
