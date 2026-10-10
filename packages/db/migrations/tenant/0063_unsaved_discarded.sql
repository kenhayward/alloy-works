-- Discard (the R2 plan): a person's saved work on a component that was never made a version, set
-- aside up to a time, so the editor stops offering it as Recover. Nothing is deleted: the iterations
-- stay for Saved text until the sweep removes them (VER-001, VER-003), and work saved after the time is
-- offered again. One row per person and component, the latest time kept.
create table unsaved_discarded (
  artifact_id uuid not null,
  kind text not null default 'component' check (kind = 'component'),
  principal_id uuid not null references principal on delete restrict,
  up_to timestamptz not null,
  primary key (artifact_id, principal_id),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict
);
