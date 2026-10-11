-- How long a lock lasts, and how long before it may be taken (collaboration.md; the PL plan, PL-F):
-- tenant settings on the editing policy, an administrator's to change. A lock is free once its holder
-- has done nothing for the release period - 15 minutes unless changed (COL-008) - and may be asked of an
-- idle holder after the take period - 5 unless changed - always shorter (COL-046), which the table
-- itself holds.
alter table editing_policy
  add column lock_release_minutes integer not null default 15
    check (lock_release_minutes between 5 and 240),
  add column lock_take_minutes integer not null default 5
    check (lock_take_minutes between 1 and 239),
  add constraint editing_policy_take_before_release check (lock_take_minutes < lock_release_minutes);

do $$
begin
  execute format(
    'grant update (lock_release_minutes, lock_take_minutes) on editing_policy to %I',
    current_schema()
  );
end
$$;

-- When the holder last did something - claimed, from any of their sessions' windows, or saved an
-- iteration not seen before (collaboration.md, CL-A) - from which both periods are counted.
alter table component_lock add column active_at timestamptz;
update component_lock set active_at = claimed_at;
alter table component_lock alter column active_at set not null,
  alter column active_at set default now();
