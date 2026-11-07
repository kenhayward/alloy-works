-- Support access (docs/design/support.md; the SA plan, SA-D, SA-G): granting it is `grant_support`, the
-- last of IAM-070's acts named apart from `administer`, given here to every role holding `administer`.
-- A person's act alone, so no token's scope: api_token's check already leaves it out.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'import_environment',
    'close_environment', 'suspend_environment', 'suspend_tenant', 'create_tenant', 'share_provider',
    'read_diagnostics', 'grant_support'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

update role set permissions = permissions || array['grant_support']
  where 'administer' = any(permissions);

-- A support grant, decided apart from access_grant (IAM-071 stands): somebody from outside, invited by
-- address, let read diagnostics, or metadata or content in the spaces named, for a purpose, until a
-- required expiry the tenant's cap on outside access bounds. Kept once ended: a revocation stamps it,
-- and an expiry changes nothing. Its principal's removal - an invitation withdrawn - takes it too.
create table support_grant (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principal (id) on delete cascade,
  scope text not null check (scope in ('diagnostics', 'metadata', 'content')),
  spaces uuid[] not null default '{}'
    check (array_ndims(spaces) = 1 or spaces = '{}'),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  expires_at timestamptz not null,
  granted_by uuid not null references principal (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references principal (id),
  -- The last UTC day its use was recorded (support.used, once a person a day a scope).
  used_on date,
  check (expires_at > granted_at),
  check (scope = 'diagnostics' or cardinality(spaces) > 0),
  check ((revoked_at is null) = (revoked_by is null))
);
create index support_grant_principal on support_grant (principal_id) where revoked_at is null;

-- Written once, then only stamped revoked or used: never edited, never removed by the service.
do $$
begin
  execute format('revoke update, delete, truncate on support_grant from %I', current_schema());
  execute format('grant update (revoked_at, revoked_by, used_on) on support_grant to %I',
    current_schema());
end
$$;

-- A fact a decision reads, so a grant and a revocation take the access epoch and tell the stream
-- (0010, 0067); recording its use does not.
create trigger support_grant_changed after insert or delete or update of revoked_at
  on support_grant for each row execute function access_changed();
