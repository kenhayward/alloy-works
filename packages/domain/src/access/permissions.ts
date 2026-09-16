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
] as const;

export type Permission = (typeof permissions)[number];

export function isPermission(value: string): value is Permission {
  return (permissions as readonly string[]).includes(value);
}

/**
 * What an external principal is refused whatever the grants say. `edit`, `approve` and `publish` are
 * IAM-047's; `create`, `design`, `manage_definitions` and `administer` are access.md's own choice.
 */
export const externalCap: readonly Permission[] = [
  'create',
  'edit',
  'approve',
  'publish',
  'design',
  'manage_definitions',
  'administer',
];

/** A principal's kind. Only `external` changes a decision. */
export const principalKinds = ['user', 'service', 'external'] as const;

export type PrincipalKind = (typeof principalKinds)[number];
