-- Suspending, from inside a tenant and from an organisation's (tenant-lifecycle.md, TL-D, TL-L). Nobody
-- loses the act on upgrade, as with IN-H's six; no token holds either, since stopping a tenant is a
-- person's act. An event the organisation caused names it, and no person in it (TL-L).
alter table role drop constraint role_permissions_closed;
alter table role add constraint role_permissions_closed check (
  permissions <@ array[
    'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
    'manage_definitions', 'administer', 'use_connection', 'write_sql', 'retire',
    'export_environment', 'export_audit', 'hold',
    'rotate_secrets', 'configure_services', 'configure_webhooks', 'import_environment',
    'close_environment', 'suspend_environment', 'suspend_tenant'
  ]::text[]
  and (array_ndims(permissions) = 1 or permissions = '{}')
);

update role set permissions = permissions || array['suspend_environment']
  where 'administer' = any(permissions);

alter table audit_event drop constraint audit_event_actor_kind_check;
alter table audit_event add constraint audit_event_actor_kind_check
  check (actor_kind in ('person', 'token', 'system', 'vendor', 'anonymous', 'organisation'));
