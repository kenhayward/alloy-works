-- The threads panel (the TP plan; ADR-0078). A comment accepted from the assistant stays its person's and
-- names the proposal that drafted it (GEN-063): set as it is inserted, so 0076's revoke still holds.
-- A person's read mark on a thread (COL-070): theirs, moved on and never back, and removed as they are
-- erased (`erasePerson`).
alter table thread_comment add column drafted_by uuid references generation_proposal on delete restrict;

create table thread_read (
  thread_id uuid not null references thread on delete restrict,
  principal_id uuid not null references principal on delete restrict,
  read_to timestamptz not null,
  primary key (thread_id, principal_id)
);
create index thread_read_principal on thread_read (principal_id);

do $$
begin
  execute format('revoke truncate on thread_read from %I', current_schema());
end
$$;
