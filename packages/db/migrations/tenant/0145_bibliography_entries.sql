-- Bibliography entries (citations.md, "The entry"; the CI plan, CI-B): an artifact kind of their own,
-- each in exactly one space and every version authored, as a prompt is; archived as a component is.
-- Not searchable, so `search_entry` is left as it is. No citation names an entry before this, since
-- none exists, so the reference index needs no rows written here.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary', 'bibliographyEntry'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition', 'dataset', 'prompt', 'bibliographyEntry'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition',
                    'dataset', 'prompt', 'bibliographyEntry'));
set constraints artifact_version_component_type_recorded deferred;

alter table artifact_archival drop constraint artifact_archival_kind_check;
alter table artifact_archival add constraint artifact_archival_kind_check
  check (kind in ('component', 'document', 'bibliographyEntry'));

-- Each entry's key (LIB-046), fixed at its first version and unique in its space, so in any document
-- of it. Written with that version and never changed.
create table bibliography_key (
  entry_id uuid primary key,
  entry_kind text not null default 'bibliographyEntry' check (entry_kind = 'bibliographyEntry'),
  space_id uuid not null references space on delete cascade,
  key text not null check (key ~ '^[a-z0-9]{1,80}$'),
  foreign key (entry_id, entry_kind) references artifact (id, kind) on delete cascade,
  unique (space_id, key)
);

-- What a match is found by (LIB-045): each entry's identities in its latest version, normalised by
-- the domain's `entryIdentities`, replaced in the transaction that cuts a version, as the reference
-- index is. Derived: rebuilt from content if ever doubted.
create table bibliography_identity (
  entry_id uuid not null references bibliography_key on delete cascade,
  space_id uuid not null references space on delete cascade,
  by text not null check (by in ('doi', 'pmid', 'isbn', 'issn', 'work')),
  value text not null,
  primary key (entry_id, by, value)
);
create index bibliography_identity_match on bibliography_identity (space_id, by, value);

do $$
begin
  execute format('revoke insert, update, delete, truncate on bibliography_key from %I', current_schema());
  execute format('grant insert (entry_id, space_id, key) on bibliography_key to %I', current_schema());
  execute format('grant select on bibliography_key to %I', current_schema());
  execute format(
    'revoke insert, update, delete, truncate on bibliography_identity from %I', current_schema()
  );
  execute format(
    'grant insert (entry_id, space_id, by, value), delete on bibliography_identity to %I',
    current_schema()
  );
  execute format('grant select on bibliography_identity to %I', current_schema());
end
$$;

set constraints all deferred;
