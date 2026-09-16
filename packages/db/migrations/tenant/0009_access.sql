-- Who may do what to which artifact (access.md). Roles are bundles of a closed set of permissions; a
-- grant binds one role to one principal or one group at one level, and is the only thing that confers a
-- permission (IAM-062). Nothing here stores an answer: every decision reads these rows when it is asked.

-- Only `external` changes a decision, by the cap and by which grants are read.
alter table principal
  add column kind text not null default 'user' check (kind in ('user', 'service', 'external'));

-- The tenant's policy on external access, in days: the expiry a grant takes when given none, and the
-- furthest one may reach. The cap can be raised and never removed, so neither is nullable.
create table access_policy (
  singleton boolean primary key default true check (singleton),
  external_default_days integer not null default 30 check (external_default_days > 0),
  external_cap_days integer not null default 90 check (external_cap_days > 0),
  constraint access_policy_default_within_cap check (external_default_days <= external_cap_days)
);
insert into access_policy default values;

-- The closed set is the check. That a role holds at least one permission, each once, is checkRole's,
-- and that only a role holding read may be allowed is grant's: changing either is a code change.
create table role (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  permissions text[] not null,
  created_at timestamptz not null default now(),
  constraint role_permissions_closed check (
    permissions <@ array[
      'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
      'manage_definitions', 'administer'
    ]::text[]
  )
);

-- The eight a tenant starts with, the same as the domain's starterRoles: ordinary rows from here on.
insert into role (name, permissions) values
  ('Reader', array['read']),
  ('Reviewer', array['read', 'comment', 'suggest']),
  ('Author', array['read', 'create', 'edit', 'comment', 'suggest']),
  ('Approver', array['read', 'comment', 'approve']),
  ('Designer', array['read', 'design']),
  ('Definitions manager', array['read', 'manage_definitions']),
  ('Administrator', array['read', 'administer']),
  ('Editing', array['edit']);

-- A tenant starts with one space, which an administrator may rename.
insert into space (name) values ('General') on conflict (name) do nothing;

-- A group is tenant-managed, or stands for a value the organisation's provider asserts.
create table access_group (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  source text not null check (source in ('tenant', 'provider')),
  provider_value text unique,
  created_at timestamptz not null default now(),
  constraint access_group_provider_value check ((source = 'provider') = (provider_value is not null))
);

-- A membership's source is its group's; `asserted_at` is when a provider last asserted it.
create table group_member (
  group_id uuid not null references access_group on delete cascade,
  principal_id uuid not null references principal on delete cascade,
  asserted_at timestamptz,
  primary key (group_id, principal_id)
);
create index group_member_principal on group_member (principal_id);

create table access_grant (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references role on delete restrict,
  principal_id uuid references principal on delete cascade,
  group_id uuid references access_group on delete restrict,
  level text not null check (level in ('tenant', 'space', 'artifact')),
  space_id uuid references space on delete restrict,
  artifact_id uuid references artifact on delete restrict,
  effect text not null check (effect in ('allow', 'deny')),
  expires_at timestamptz,
  -- The grant this one replaced by extending it (IAM-050). No key: that grant is removed in the same
  -- change, and this names what it was.
  extends uuid,
  granted_by uuid not null references principal on delete restrict,
  granted_at timestamptz not null default now(),
  constraint access_grant_one_subject check (num_nonnulls(principal_id, group_id) = 1),
  constraint access_grant_level_target check (
    (level = 'tenant' and space_id is null and artifact_id is null)
    or (level = 'space' and space_id is not null and artifact_id is null)
    or (level = 'artifact' and artifact_id is not null and space_id is null)
  ),
  constraint access_grant_once unique nulls not distinct
    (role_id, principal_id, group_id, level, space_id, artifact_id, effect)
);
create index access_grant_principal on access_grant (principal_id);
create index access_grant_group on access_grant (group_id);
create index access_grant_space on access_grant (space_id);
create index access_grant_artifact on access_grant (artifact_id);

-- A grant is made and removed, never changed, so the record of who granted what stays whole.
do $$
begin
  execute format('revoke update on access_grant from %I', current_schema());
end
$$;
