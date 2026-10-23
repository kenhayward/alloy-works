-- Importing again (docs/design/import.md; the IM plan, IM-K; IMd): a file whose hash or name an
-- accepted import in the space holds is said so first; imported again, it updates what that import
-- made. Its parts are matched to that import's components, its changed parts suggested against each
-- one's current version, its new parts made and placed, and what no part matches flagged as gone.

-- The accepted import an `again` one updates, and, once accepted, what it did: each suggestion, each
-- new component and whether it was placed, what was gone, and what was skipped for want of `suggest`.
alter table import
  add column earlier uuid references import,
  add column outcome jsonb check (outcome is null or jsonb_typeof(outcome) = 'object'),
  add constraint import_earlier check ((kind = 'again') = (earlier is not null));

-- The component each edited part made or updated, recorded at acceptance: what a later import matches
-- against (its provenance). And the component an `again` part is matched to, and how.
alter table import_part
  add column made uuid references artifact,
  add column matched uuid references artifact,
  add column matched_by text check (
    matched_by is null or matched_by in ('provenance', 'heading', 'position', 'importer')
  ),
  add constraint import_part_matched check ((matched is null) = (matched_by is null));

-- What an import made (IMP-035) now holds the suggestions an `again` one makes, beside its versions.
alter table import_made drop constraint import_made_pkey;
alter table import_made
  alter column version_id drop not null,
  add column suggestion_id uuid references suggestion,
  add constraint import_made_one check (num_nonnulls(version_id, suggestion_id) = 1);
create unique index import_made_version on import_made (version_id) where version_id is not null;
create unique index import_made_suggestion on import_made (suggestion_id)
  where suggestion_id is not null;

do $$
begin
  execute format('grant insert (earlier), update (earlier, outcome) on import to %I', current_schema());
  execute format(
    'grant insert (made, matched, matched_by), update (made, matched, matched_by) on import_part to %I',
    current_schema()
  );
  execute format('grant insert (suggestion_id) on import_made to %I', current_schema());
end
$$;

-- A part's changes and threads with every Word author's name and initials blanked: what accepting
-- under `discard` leaves of them (IMP-010), in both sets.
create function import_part_unnamed(changes jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(each || '{"author": ""}' order by at), '[]')
    from jsonb_array_elements(changes) with ordinality as found(each, at)
$$;
create function import_part_unnamed_threads(threads jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(
           each || jsonb_build_object('author', '', 'initials', null,
             'replies', coalesce((select jsonb_agg(reply || '{"author": "", "initials": null}'
                                                   order by place)
                                    from jsonb_array_elements(each -> 'replies')
                                         with ordinality as replied(reply, place)), '[]'))
           order by at), '[]')
    from jsonb_array_elements(threads) with ordinality as found(each, at)
$$;

-- The read set is never changed but for that blanking: nothing else of the row may differ.
create or replace function import_part_read_kept() returns trigger language plpgsql as $$
declare
  unnamed import_part;
begin
  if old.proposal = 'read' then
    unnamed := old;
    unnamed.changes := import_part_unnamed(old.changes);
    unnamed.threads := import_part_unnamed_threads(old.threads);
    if new is distinct from unnamed then
      raise exception 'The proposal as read is never changed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
