-- Connections (docs/design/data.md; the D1 plan, decision D1-A): an artifact kind of their own, each
-- in exactly one space (DAT-001), versioned by the chain as everything is (DAT-007); the permission
-- that runs anything against one, `use_connection`; each connection's credential, sealed with a key
-- only the connector holds (DAT-003); and each test the connector answered (D1-N).

-- The kind: in one space, and every version of it authored by a person.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains: a fresh environment's earlier migrations leave
-- deferred checks pending on the chain, and a table with pending trigger events cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection'));
set constraints artifact_version_component_type_recorded deferred;

-- The closed set gains `use_connection` alone: `write_sql` joins with the check that reads it, in D2
-- (the D1 plan, D1-P). A token may be scoped to it, as to every permission but `read`.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

alter table api_token drop constraint api_token_scopes_closed;
alter table api_token add constraint api_token_scopes_closed check (
  scopes <@ array[
    'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection'
  ]::text[]
  and (array_ndims(scopes) = 1 or scopes = '{}')
  and api_token_scopes_distinct(scopes)
);

-- A connection's credential: the latest row is it. Sealed by the connector, with a key the service
-- never holds, bound to this tenant and to `source-credential`, so the service stores what it cannot
-- open and a row copied into another environment opens as nothing. Never read back by a route
-- (DAT-004), never changed and never removed: setting one adds a row naming who and when (DAT-007).
-- `id` orders the rows, since two set in one transaction share a time.
create table connection_credential (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  connection_kind text not null default 'connection' check (connection_kind = 'connection'),
  -- The sealing scheme's shape, as 0042 holds a sealed sign-in secret to it, and no longer than a
  -- secret of 4,096 bytes seals to.
  sealed text not null
    constraint connection_credential_sealed
      check (sealed ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
        and octet_length(sealed) <= 5600),
  set_by uuid not null references principal on delete restrict,
  set_at timestamptz not null default now(),
  foreign key (connection_id, connection_kind) references artifact (id, kind) on delete restrict
);
create index connection_credential_latest on connection_credential (connection_id, id desc);

-- Each finding once, with no null among them: a check may not hold a subquery, so this asks a
-- function that reads no table and so needs no schema, as api_token_scopes_distinct (0038) does.
create function connection_test_findings_distinct(findings text[]) returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select count(finding) = count(*) and count(distinct finding) = count(*)
  from unnest(findings) as finding
$$;

-- Each test the connector answered, ok or failed, naming the connection version tested, who asked and
-- when (D1-N). Insert-only; the latest is what a later refusal reads (DAT-103).
create table connection_test (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  connection_version_id uuid not null,
  connection_kind text not null default 'connection' check (connection_kind = 'connection'),
  outcome text not null constraint connection_test_outcome check (outcome in ('ok', 'failed')),
  -- What an authenticated account was found to be (D1-M); a finding added later widens the set.
  findings text[] not null default '{}'
    constraint connection_test_findings check (
      findings <@ array['account_not_read_only']::text[]
      and (array_ndims(findings) = 1 or findings = '{}')
      and connection_test_findings_distinct(findings)
    ),
  failure text
    constraint connection_test_failure check (
      failure in ('connection_failed', 'timeout', 'connector_error', 'source_unsupported')
    ),
  tested_by uuid not null references principal on delete restrict,
  tested_at timestamptz not null default now(),
  -- A failed test found nothing, and names its failure exactly when it failed.
  constraint connection_test_found_only_when_ok check (outcome = 'ok' or findings = '{}'),
  constraint connection_test_failure_when_failed check ((outcome = 'failed') = (failure is not null)),
  foreign key (connection_version_id, connection_id, connection_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index connection_test_latest on connection_test (connection_id, id desc);

-- Select and insert, and the insert by what the row says alone: never the time, which is the
-- database's, and never the row's number, which is its own. Nothing changes or removes a row.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on connection_credential from %I',
    current_schema()
  );
  execute format(
    'grant insert (connection_id, connection_kind, sealed, set_by) on connection_credential to %I',
    current_schema()
  );
  execute format('grant select on connection_credential to %I', current_schema());
  execute format(
    'revoke insert, update, delete, truncate on connection_test from %I',
    current_schema()
  );
  execute format(
    'grant insert (connection_id, connection_version_id, connection_kind, outcome, findings, '
    'failure, tested_by) on connection_test to %I',
    current_schema()
  );
  execute format('grant select on connection_test to %I', current_schema());
end
$$;
