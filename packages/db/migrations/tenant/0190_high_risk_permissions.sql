-- The high-risk permissions (IAM-070; the ID plan, IDd; docs/design/identity.md, IN-H): six acts granted
-- apart from `administer`.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

alter table api_token drop constraint api_token_scopes_closed;
alter table api_token add constraint api_token_scopes_closed check (
  scopes <@ array[
    'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks'
  ]::text[]
  and (array_ndims(scopes) = 1 or scopes = '{}')
  and api_token_scopes_distinct(scopes)
);

-- Nobody and no automation loses an act on upgrade: a tenant then makes a narrower role.
update role set permissions = permissions || array[
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks'
  ]
  where 'administer' = any(permissions);

update api_token set scopes = scopes || array[
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks'
  ]
  where 'administer' = any(scopes);
