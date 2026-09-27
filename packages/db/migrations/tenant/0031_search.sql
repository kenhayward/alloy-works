-- Search's projection (docs/design/search.md, "Searching words, in T1"; SCH-054, SCH-002, SCH-066).
-- Derived, never a record: every row here is rewritten from the version chain whenever a version or a
-- publication is written, in that write's transaction, and rebuilt whole by `reindexSearch`, which the
-- migration runner runs for a tenant in the run that applies this file.

-- One row per thing found: an artifact at its latest version, a publication, or a section of a
-- document, keyed by its document and its outline node. The columns are what the readable set, the
-- filters and the facets read, so a search is one statement over this table and the next.
create table search_entry (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifact on delete restrict,
  kind text not null check (kind in
    ('component', 'document', 'section', 'publication', 'template', 'asset',
     'field', 'metadataSchema', 'componentType')),
  -- A section's outline node, and nothing else's.
  node text check ((node is not null) = (kind = 'section')),
  -- The version it was read from: a publication's is the document version it published.
  version_id uuid not null references artifact_version on delete restrict,
  space_id uuid references space on delete restrict,
  title text not null,
  -- Who made it: the author of its first version, or a publication's publisher. Null for a
  -- definition the environment started with.
  owner uuid references principal on delete restrict,
  changed_at timestamptz not null,
  -- A component's type, by the type's artifact.
  component_type uuid references artifact on delete restrict,
  -- Its values as stored, keyed by field (a filter and a facet read them).
  field_values jsonb not null default '{}',
  constraint search_entry_once unique nulls not distinct (artifact_id, node)
);
create index search_entry_space on search_entry (space_id);
create index search_entry_kind on search_entry (kind);

-- One row per place in an entry, in the entry's language's text search configuration, so a result
-- names where it matched (SCH-017) and a passage is made from that place alone (SCH-016).
create table search_text (
  entry_id uuid not null references search_entry on delete cascade,
  place text not null check (place <> ''),
  body text not null check (body <> ''),
  configuration regconfig not null,
  vector tsvector generated always as (to_tsvector(configuration, body)) stored,
  primary key (entry_id, place)
);
create index search_text_vector on search_text using gin (vector);
