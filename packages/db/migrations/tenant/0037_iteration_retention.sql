-- Retention (storage-and-versioning.md, VER-003 and VER-004; component-editor.md, RC-B to RC-D): an
-- iteration is kept until the next version after the one it was opened from is cut, and for the
-- tenant's window after that cut, and then deleted by the worker's sweep. The window is decided when
-- the sweep runs, never at insert, when the cut has not happened: the T1 audit found `expires_at`, set
-- at insert, gave an iteration written long before the cut no window after it at all.

-- The tenant's window, in days: one row, as access_policy is (0009), read by the sweep and set by an
-- administrator. A longer window keeps longer what has not been swept, and nothing swept comes back.
create table editing_policy (
  singleton boolean primary key default true check (singleton),
  iteration_retention_days integer not null default 30
    check (iteration_retention_days between 1 and 365)
);
insert into editing_policy default values;

-- The row must always be there for the sweep to read, so the runtime role reads it and changes the
-- window, and nothing else.
do $$
begin
  execute format('revoke insert, update, delete, truncate on editing_policy from %I', current_schema());
  execute format('grant update (iteration_retention_days) on editing_policy to %I', current_schema());
end
$$;

-- Nothing is decided at insert any more, so nothing reads this.
alter table iteration drop constraint iteration_expires_after_creation;
alter table iteration drop column expires_at;

-- VER-001 still holds: an iteration is never updated, by any role. The runtime role may now delete
-- one, and nothing else of what 0012 revoked: never update it, never truncate the table.
do $$
begin
  execute format('grant delete on iteration to %I', current_schema());
end
$$;

-- Whatever role deletes it, an iteration is deleted only as the sweep deletes one: its component has a
-- version after the one it was opened from, and the first such version, the next cut, was made the
-- tenant's window ago or more, by the database's clock, which is the clock that made it. So an
-- iteration nothing has been cut after is never deleted, however old, since it may be the only copy of
-- work its writer has not made a version of. `sweepIterations` (packages/db/src/retention.ts) finds
-- what it deletes by the same condition; this is the guard.
create function iteration_swept_only() returns trigger
language plpgsql as $$
declare
  cut timestamptz;
  window_days integer;
begin
  -- Both read by the table's own schema, never the search path: a session's temporary tables are
  -- searched first, and one named for either would decide the guard (W11.1's final review).
  execute format(
    'select later.created_at
       from %1$I.artifact_version opened
       join %1$I.artifact_version later
         on later.artifact_id = opened.artifact_id
        and (later.revision_no, later.version_no) > (opened.revision_no, opened.version_no)
      where opened.id = $1
      order by later.revision_no, later.version_no
      limit 1',
    tg_table_schema
  ) into cut using old.opened_from;
  execute format('select iteration_retention_days from %I.editing_policy', tg_table_schema)
    into window_days;
  if cut is null or window_days is null or cut + make_interval(days => window_days) > now() then
    raise exception
      'iteration: kept until the next version is cut, and for the window after it';
  end if;
  return old;
end
$$;

create trigger iteration_swept_only before delete on iteration
  for each row execute function iteration_swept_only();

-- The sweep and the Recovery listing find iterations by their component and the version each was
-- opened from; the version chain's own key finds the next cut.
create index iteration_opened_from on iteration (artifact_id, opened_from);
