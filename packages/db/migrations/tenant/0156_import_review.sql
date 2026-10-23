-- Reviewing an import (docs/design/import.md; the IM plan, IM-E; IMb). The importer edits the edited set
-- alone, each edit against the import's `revision`, refused if another came first, and recorded; the
-- part they were last at is its `place`, kept across sessions (IMP-029); and what was accepted unchanged
-- is counted at acceptance (IMP-031).
alter table import
  add column revision integer not null default 0 check (revision >= 0),
  add column place uuid references import_part on delete set null,
  add column accepted jsonb check (accepted is null or jsonb_typeof(accepted) = 'object');

-- The parts as read an edited part came from, by their place: more than one once merged, and shared
-- by the halves of a split. A part as read came from itself.
alter table import_part add column origins integer[] not null default '{}';
-- Rows as read before this keep none: the trigger keeps them as they are.
update import_part set origins = array[ord] where proposal = 'edited';

-- Each edit as asked, by revision. Gone with the proposal: on abandoning, failing or proposing again.
create table import_edit (
  import_id uuid not null references import on delete cascade,
  revision integer not null check (revision >= 1),
  by_principal uuid not null references principal,
  at timestamptz not null default now(),
  edit jsonb not null check (jsonb_typeof(edit) = 'object'),
  primary key (import_id, revision)
);

do $$
begin
  execute format('grant update (revision, place, accepted) on import to %I', current_schema());
  execute format(
    'grant insert (origins), update (origins, source) on import_part to %I',
    current_schema()
  );
  execute format('revoke insert, update, delete, truncate on import_edit from %I', current_schema());
  execute format(
    'grant select, insert (import_id, revision, by_principal, edit), delete on import_edit to %I',
    current_schema()
  );
end
$$;
