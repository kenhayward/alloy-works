-- Publishing (docs/design/publishing.md). A publication is an artifact in its document's space, read
-- on its own grants; what made it is recorded beside it and never changed (PUB-050). A request is the
-- operational row a job works from, and is the only thing here that changes.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check
  check (kind in ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication')) = (space_id is not null));

-- Decision L: a ninth starter role. A tenant that already holds a role of this name keeps its own.
insert into role (name, permissions) values ('Publisher', array['read', 'publish'])
  on conflict (name) do nothing;

-- One publish asked for. The version is the document's by its key, not by a check that could be
-- skipped; the time is truncated to the second because it is compiled into the PDF.
create table publication_request (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  document_version_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  formats text[] not null check (formats = array['pdf']),
  requested_by uuid not null references principal on delete restrict,
  requested_at timestamptz not null default date_trunc('second', now()),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  failures jsonb not null default '[]' check (jsonb_typeof(failures) = 'array'),
  finished_at timestamptz,
  check ((state = 'queued') = (finished_at is null)),
  check (state <> 'failed' or jsonb_array_length(failures) > 0),
  foreign key (document_version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index publication_request_document on publication_request (document_id);

-- Which version each occurrence took, recorded as the publisher resolved it: a component's version, by
-- its key. An occurrence the publisher could not read has no row; the request's failures name it.
create table publication_request_occurrence (
  request_id uuid not null references publication_request on delete cascade,
  node text not null check (node ~ '^[a-z2-7]{26}$'),
  component_id uuid not null,
  version_id uuid not null,
  component_kind text not null default 'component' check (component_kind = 'component'),
  primary key (request_id, node),
  foreign key (version_id, component_id, component_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- A publication. Its id is its artifact's, of kind publication, by the key. It carries its request's
-- id without a key, so the request can be swept once finished; unique, so two workers racing one
-- request make one publication. Every closed column is closed at its first value: T3 widens a check.
create table publication (
  id uuid primary key,
  kind text not null default 'publication' check (kind = 'publication'),
  request_id uuid not null unique,
  document_id uuid not null,
  document_version_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  publisher uuid not null references principal on delete restrict,
  published_at timestamptz not null,
  approval text not null check (approval = 'none'),
  formats text[] not null check (formats = array['pdf']),
  engine text not null check (engine = 'typst'),
  engine_version text not null check (engine_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  template text not null check (template = 'publication'),
  template_version integer not null check (template_version > 0),
  pipeline_version text not null check (pipeline_version ~ '^[0-9]+$'),
  fonts jsonb not null check (jsonb_typeof(fonts) = 'array' and jsonb_array_length(fonts) > 0),
  data_sha256 text not null check (data_sha256 ~ '^[0-9a-f]{64}$'),
  numbering jsonb not null check (jsonb_typeof(numbering) = 'object'),
  foreign key (id, kind) references artifact (id, kind) on delete restrict,
  foreign key (document_version_id, document_id, document_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index publication_document on publication (document_id, published_at desc);

-- Every version a publication read: the document's (no node) and each occurrence's (its node). The
-- key refuses deleting anything a publication pinned, as a baseline's pin does.
create table publication_input (
  publication_id uuid not null references publication on delete restrict,
  version_id uuid not null references artifact_version on delete restrict,
  node text check (node ~ '^[a-z2-7]{26}$'),
  unique (publication_id, node)
);
create unique index publication_input_document on publication_input (publication_id) where node is null;

-- What a publication is, as bytes: one row per format, kept in the tenant's store by content hash. The
-- key names the digest it records, so no row can point at other bytes than it says.
create table publication_output (
  publication_id uuid not null references publication on delete restrict,
  format text not null check (format = 'pdf'),
  object_key text not null check (object_key like '%/sha256/' || sha256),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes > 0),
  standard text not null check (standard = 'ua-1'),
  primary key (publication_id, format)
);

-- PUB-050 as a grant: the runtime role inserts and reads what a publication is made of and nothing
-- else, and changes a request only by finishing it.
do $$
begin
  execute format(
    'revoke update, delete, truncate on publication, publication_input, publication_output, '
    'publication_request_occurrence from %I',
    current_schema()
  );
  execute format('revoke update, delete, truncate on publication_request from %I', current_schema());
  execute format(
    'grant update (state, failures, finished_at) on publication_request to %I',
    current_schema()
  );
end
$$;

-- A request is finished once: the only update it ever takes is the one move from queued to done or
-- failed, with what was asked, by whom and when untouched. The column grant above would otherwise be
-- enough, on its own, to move a finished request back to queued - so a job would publish it again - or
-- to rewrite the failures an author was told, so this holds whatever columns a role may write, as
-- first_administrator_claim_once (0011) does for a naming.
create function publication_request_finish_once() returns trigger
language plpgsql as $$
begin
  if not (
    old.state = 'queued'
    and new.state <> 'queued'
    and old.id is not distinct from new.id
    and old.document_id is not distinct from new.document_id
    and old.document_version_id is not distinct from new.document_version_id
    and old.formats is not distinct from new.formats
    and old.requested_by is not distinct from new.requested_by
    and old.requested_at is not distinct from new.requested_at
  ) then
    raise exception
      'publication_request: a request is finished once, from queued to done or failed, and nothing else of it changes';
  end if;
  return new;
end
$$;

create trigger publication_request_finish_once before update on publication_request
  for each row execute function publication_request_finish_once();
