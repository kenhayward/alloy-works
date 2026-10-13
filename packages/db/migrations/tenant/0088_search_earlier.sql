-- Earlier versions searchable on request (SCH-003; the SV plan, SV-A, SV-B): when a component, a
-- document or an asset gains a version, `indexVersion` moves its rows out of `search_entry` into these
-- two, each keeping its id and its vector, never re-tokenised. `search_entry` stays the current set
-- alone, so the default search reads exactly what it read before. Derived, as 0031's are: the run
-- that applies this file writes every earlier version's rows (`reindexSearch`, 'earlier').

create table search_earlier (
  id uuid primary key,
  artifact_id uuid not null references artifact on delete restrict,
  kind text not null check (kind in ('component', 'document', 'section', 'asset')),
  node text check ((node is not null) = (kind = 'section')),
  version_id uuid not null references artifact_version on delete restrict,
  space_id uuid references space on delete restrict,
  title text not null,
  owner uuid references principal on delete restrict,
  changed_at timestamptz not null,
  component_type uuid references artifact on delete restrict,
  field_values jsonb not null default '{}',
  configuration regconfig not null,
  body text not null,
  -- Copied as it was made, so a moved row reads exactly as it read while current.
  vector tsvector not null,
  -- As the artifact's acts leave it, on every version alike (archival.ts, deletion.ts).
  archived boolean not null default false,
  deleted boolean not null default false,
  constraint search_earlier_once unique nulls not distinct (artifact_id, node, version_id)
);
create index search_earlier_vector on search_earlier using gin (vector);
create index search_earlier_body_trigrams on search_earlier
  using gin (body extensions.gin_trgm_ops);
create index search_earlier_version on search_earlier (artifact_id, version_id);

create table search_earlier_text (
  entry_id uuid not null references search_earlier on delete cascade,
  place text not null check (place <> ''),
  body text not null check (body <> ''),
  configuration regconfig not null,
  vector tsvector not null,
  primary key (entry_id, place)
);
create index search_earlier_text_vector on search_earlier_text using gin (vector);

-- Written and cleared, never rewritten: the acts change the two flags and nothing else.
do $$
begin
  execute format('revoke update on search_earlier from %I', current_schema());
  execute format('grant update (archived, deleted) on search_earlier to %I', current_schema());
  execute format('revoke update on search_earlier_text from %I', current_schema());
end
$$;
