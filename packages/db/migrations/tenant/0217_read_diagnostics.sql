-- Reading Diagnostics apart from administering (the SA plan, SA-F; docs/design/support.md): the six
-- diagnostics reads take `read_diagnostics`, which support's narrowest scope names. Nobody and no
-- automation loses Diagnostics on upgrade: every role and token holding `administer` gains it.
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'import_environment',
    'close_environment', 'suspend_environment', 'suspend_tenant', 'create_tenant', 'share_provider',
    'read_diagnostics'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

alter table api_token drop constraint api_token_scopes_closed;
alter table api_token add constraint api_token_scopes_closed check (
  scopes <@ array[
    'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'read_diagnostics'
  ]::text[]
  and (array_ndims(scopes) = 1 or scopes = '{}')
  and api_token_scopes_distinct(scopes)
);

update role set permissions = permissions || array['read_diagnostics']
  where 'administer' = any(permissions);

update api_token set scopes = scopes || array['read_diagnostics']
  where 'administer' = any(scopes);
