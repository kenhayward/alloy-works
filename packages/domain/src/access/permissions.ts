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
  // Running anything against a connection, decided at the connection (data.md, "Permissions"). No
  // starting role holds it, so using a connection is always granted on purpose.
  'use_connection',
  // Saving or running SQL against a connection, decided at the connection as using one is (data.md,
  // "Permissions"; DAT-101). No starting role holds it either.
  'write_sql',
] as const;

export type Permission = (typeof permissions)[number];

/**
 * What a personal token may be scoped to (service-foundations.md, TK-A and TK-B): every permission but
 * `read`. A token's scopes are a mask over its creator's grants, and reading is never masked - a token
 * reads what its creator reads, so the readable sets that search, listings and the outline filter by
 * need know nothing of tokens. A token with no scopes reads and does nothing else.
 */
export const tokenScopes: readonly Exclude<Permission, 'read'>[] = permissions.filter(
  (permission): permission is Exclude<Permission, 'read'> => permission !== 'read',
);

export function isPermission(value: string): value is Permission {
  return (permissions as readonly string[]).includes(value);
}

/**
 * What an external principal is refused whatever the grants say. `edit`, `approve` and `publish` are
 * IAM-047's; `create`, `design`, `manage_definitions` and `administer` are access.md's own choice, and
 * `use_connection` and `write_sql` data.md's.
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
];

/** A principal's kind. Only `external` changes a decision. */
export const principalKinds = ['user', 'service', 'external'] as const;

export type PrincipalKind = (typeof principalKinds)[number];
