-- Datasets and resolutions (docs/design/data.md, "The dataset" and "The resolution, owned by the
-- document"; the D3 plan, decision D3-A): a stored result is a version of a dataset, an artifact kind
-- of its own in its definition's space, whose identity is the question it answers (DAT-092); a
-- dataset's name, the latest row of its names; and what each binding holds in each document, the
-- latest row of its resolutions (DAT-093, DAT-037). The result itself is an object in the tenant's
-- store, under the checksum its version's provenance records (DAT-085).

-- The kind: in one space, and every version of it authored by the person whose act recorded it.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition', 'dataset'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains: a fresh environment's earlier migrations leave
-- deferred checks pending on the chain, and a table with pending trigger events cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition',
                    'dataset'));
set constraints artifact_version_component_type_recorded deferred;

-- A dataset's identity: the definition, the SHA-256 of its canonical parameters, and the identity as
-- the source sees it - `service` for a service account's run, and the two end-user forms D7 writes.
-- Unique together, so two documents asking one question share one dataset (DAT-084).
create table dataset (
  artifact_id uuid primary key,
  artifact_kind text not null default 'dataset' check (artifact_kind = 'dataset'),
  query_definition uuid not null,
  query_definition_kind text not null default 'queryDefinition'
    check (query_definition_kind = 'queryDefinition'),
  parameters_digest text not null
    constraint dataset_parameters_digest check (parameters_digest ~ '^[0-9a-f]{64}$'),
  identity_key text not null
    constraint dataset_identity_key check (
      identity_key = 'service'
      or identity_key ~ '^asserted:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or identity_key ~ '^delegated:[^|]+[|].+$'
    ),
  unique (query_definition, parameters_digest, identity_key),
  foreign key (artifact_id, artifact_kind) references artifact (id, kind) on delete restrict,
  foreign key (query_definition, query_definition_kind) references artifact (id, kind)
    on delete restrict
);

-- A dataset's names (DAT-092): an artifact row takes no update, so each naming is a row, and the
-- latest is the name. `id` orders them, since two named in one transaction share a time.
create table dataset_name (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references dataset (artifact_id) on delete restrict,
  dataset_kind text not null default 'dataset' check (dataset_kind = 'dataset'),
  -- 1 to 200 characters, none a control character, nothing before or after, composed (NFC).
  name text not null
    constraint dataset_name_name check (
      char_length(name) between 1 and 200
      and name !~ '^[[:space:]]' and name !~ '[[:space:]]$'
      and name !~ '[\u0001-\u001f\u007f-\u009f]'
      and name is nfc normalized
    ),
  named_by uuid not null references principal on delete restrict,
  named_at timestamptz not null default now(),
  foreign key (dataset_id, dataset_kind) references artifact (id, kind) on delete restrict
);
create index dataset_name_latest on dataset_name (dataset_id, id desc);

-- What a binding holds in a document (DAT-093): the latest row for a document, a node and a binding.
-- Each row names the version it holds and the one it replaces, of the same dataset, so the rows are
-- the audit trail of every acceptance (DAT-037). Whether its node exists, and its binding, is the
-- act's to decide when it is recorded: an outline and a component are versioned, and a row outlives
-- the version it was resolved under, held only while its digest still matches (D3-R).
create table binding_resolution (
  id bigint generated always as identity primary key,
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  node_id text not null constraint binding_resolution_node check (node_id ~ '^[a-z2-7]{26}$'),
  binding_id text not null
    constraint binding_resolution_binding check (
      char_length(binding_id) >= 1 and binding_id is nfc normalized
    ),
  binding_digest text not null
    constraint binding_resolution_digest check (binding_digest ~ '^[0-9a-f]{64}$'),
  dataset_version uuid not null,
  dataset_id uuid not null references dataset (artifact_id) on delete restrict,
  dataset_kind text not null default 'dataset' check (dataset_kind = 'dataset'),
  replaces uuid,
  act text not null constraint binding_resolution_act check (act in ('resolve', 'accept')),
  resolved_by uuid not null references principal on delete restrict,
  resolved_at timestamptz not null default now(),
  -- An acceptance replaces what the binding held; a first resolve replaces nothing.
  constraint binding_resolution_accept_replaces check (act = 'resolve' or replaces is not null),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  constraint binding_resolution_version_fkey
    foreign key (dataset_version, dataset_id, dataset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  -- Of the same dataset as the version it holds; a binding asking another question holds a version of
  -- another dataset, and replaces nothing.
  constraint binding_resolution_replaces_fkey
    foreign key (replaces, dataset_id, dataset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index binding_resolution_latest
  on binding_resolution (document_id, node_id, binding_id, id desc);
-- Where used (DAT-016, DAT-064): the documents resolving a dataset.
create index binding_resolution_dataset on binding_resolution (dataset_id);

-- Select and insert, and the insert by what the row says alone: never the time, which is the
-- database's, and never the row's number, which is its own. Nothing changes or removes a row.
do $$
begin
  execute format('revoke insert, update, delete, truncate on dataset from %I', current_schema());
  execute format(
    'grant insert (artifact_id, artifact_kind, query_definition, query_definition_kind, '
    'parameters_digest, identity_key) on dataset to %I',
    current_schema()
  );
  execute format('grant select on dataset to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on dataset_name from %I', current_schema());
  execute format(
    'grant insert (dataset_id, dataset_kind, name, named_by) on dataset_name to %I',
    current_schema()
  );
  execute format('grant select on dataset_name to %I', current_schema());
  execute format(
    'revoke insert, update, delete, truncate on binding_resolution from %I',
    current_schema()
  );
  execute format(
    'grant insert (document_id, document_kind, node_id, binding_id, binding_digest, '
    'dataset_version, dataset_id, dataset_kind, replaces, act, resolved_by) '
    'on binding_resolution to %I',
    current_schema()
  );
  execute format('grant select on binding_resolution to %I', current_schema());
end
$$;
