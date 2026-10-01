-- Query definitions (docs/design/data.md; the D2 plan, decision D2-A): an artifact kind of their own,
-- each in exactly one space and every version authored (DAT-009, VER-057), found by search (SCH-055);
-- the permission that saves or runs SQL against a connection, `write_sql` (DAT-101); and the tenant's
-- lowered limits, which a run takes the least of with its definition's (DAT-050).

-- The kind: in one space, and every version of it authored by a person.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains: a fresh environment's earlier migrations leave
-- deferred checks pending on the chain, and a table with pending trigger events cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition'));
set constraints artifact_version_component_type_recorded deferred;

-- The closed sets gain `write_sql` alone, now that the check that reads it is here (the D1 plan, D1-P).
-- A token may be scoped to it, as to every permission but `read`.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

alter table api_token drop constraint api_token_scopes_closed;
alter table api_token add constraint api_token_scopes_closed check (
  scopes <@ array[
    'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql'
  ]::text[]
  and (array_ndims(scopes) = 1 or scopes = '{}')
  and api_token_scopes_distinct(scopes)
);

-- Search finds a query definition by its title, its description, its columns' names and its
-- connection's name (SCH-055; D2-S).
alter table search_entry drop constraint search_entry_kind_check;
alter table search_entry add constraint search_entry_kind_check check (kind in
  ('component', 'document', 'section', 'publication', 'template', 'asset',
   'field', 'metadataSchema', 'componentType', 'queryDefinition'));

-- The tenant's lowered limits (D2-N): one row, as editing_policy is (0037), each limit null where the
-- tenant has not lowered it, and otherwise a whole number from 1 to the product's ceiling for it -
-- `limitCeilings` in packages/domain, which a test holds this to. A run takes the least of each of its
-- definition's and these.
create table data_policy (
  singleton boolean primary key default true check (singleton),
  rows integer constraint data_policy_rows check (rows between 1 and 100000),
  bytes integer constraint data_policy_bytes check (bytes between 1 and 26214400),
  seconds integer constraint data_policy_seconds check (seconds between 1 and 120)
);
insert into data_policy default values;

-- The row is always there to read, so the runtime role reads it and changes the three limits, and
-- nothing else.
do $$
begin
  execute format('revoke insert, update, delete, truncate on data_policy from %I', current_schema());
  execute format('grant update (rows, bytes, seconds) on data_policy to %I', current_schema());
  execute format('grant select on data_policy to %I', current_schema());
end
$$;
