/**
 * The permissions, closed and defined by the product (access.md, "Permissions"). A tenant cannot add
 * one, because the service's checks are code: a permission no check reads would be a promise with
 * nothing behind it. Adding one is a code change and a migration of `role`'s check constraint.
 */
export const permissions = [
  'read',
  'create',
  'edit',
  'comment',
  'suggest',
  'approve',
  'publish',
  'design',
  'manage_definitions',
  'administer',
  // Running anything against a connection, decided at the connection (data.md, "Permissions"). Only
  // Query builder and Query writer hold it, and no default grant names them, so using a connection is
  // always granted on purpose.
  'use_connection',
  // Saving or running SQL against a connection, decided at the connection as using one is (data.md,
  // "Permissions"; DAT-101). Query writer alone holds it.
  'write_sql',
  // Archiving a component or a document, decided at the artifact (ADR-0060; lifecycle.md).
  // Administrator holds it.
  'retire',
  // The high-risk acts, granted apart from `administer` (IAM-070; identity.md, IN-H). The Administrator
  // role, every role holding `administer` and every token scoped to it gained all six by migration.
  'export_environment',
  'export_audit',
  'hold',
  'rotate_secrets',
  'configure_services',
  'configure_webhooks',
  // Restoring an archive (IMP-048; EI-J): held by a person alone, so never a token's scope.
  'import_environment',
  // Closing the environment (ADM-030; tenant-lifecycle.md, TL-E): a person's act as well.
  'close_environment',
  'suspend_environment',
  'suspend_tenant',
] as const;

export type Permission = (typeof permissions)[number];

/**
 * What a personal token may be scoped to (service-foundations.md, TK-A and TK-B): every permission but
 * `read`. A token's scopes are a mask over its creator's grants, and reading is never masked - a token
 * reads what its creator reads, so the readable sets that search, listings and the outline filter by
 * need know nothing of tokens. A token with no scopes reads and does nothing else.
 */
const PERSONS_ACTS = [
  'read',
  'import_environment',
  'close_environment',
  'suspend_environment',
  'suspend_tenant',
] as const;

export const tokenScopes: readonly Exclude<Permission, (typeof PERSONS_ACTS)[number]>[] =
  permissions.filter(
    (permission): permission is Exclude<Permission, (typeof PERSONS_ACTS)[number]> =>
      !(PERSONS_ACTS as readonly string[]).includes(permission),
  );

export function isPermission(value: string): value is Permission {
  return (permissions as readonly string[]).includes(value);
}

/**
 * What an external principal is refused whatever the grants say. `edit`, `approve` and `publish` are
 * IAM-047's; `create`, `design`, `manage_definitions` and `administer` are access.md's own choice,
 * `use_connection` and `write_sql` data.md's, `retire` lifecycle.md's, and the six identity.md's.
 */
export const externalCap: readonly Permission[] = [
  'create',
  'edit',
  'approve',
  'publish',
  'design',
  'manage_definitions',
  'administer',
  'use_connection',
  'write_sql',
  'retire',
  'export_environment',
  'export_audit',
  'hold',
  'rotate_secrets',
  'configure_services',
  'configure_webhooks',
  'import_environment',
  'close_environment',
  'suspend_environment',
  'suspend_tenant',
];

/**
 * What is decided "at the target's level or above" (access.md, "Routes"), so a denial below does not
 * stand against somebody holding it above: `administer`, and the six split out of it, which keep its rule.
 */
export const administrativePermissions: readonly Permission[] = [
  'administer',
  'export_environment',
  'export_audit',
  'hold',
  'rotate_secrets',
  'configure_services',
  'configure_webhooks',
  'import_environment',
  'close_environment',
  'suspend_environment',
  'suspend_tenant',
];

/** A principal's kind. Only `external` changes a decision. */
export const principalKinds = ['user', 'service', 'external'] as const;

export type PrincipalKind = (typeof principalKinds)[number];
