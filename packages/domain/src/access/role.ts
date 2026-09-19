import { isPermission, type Permission } from './permissions.js';

/** Why a set of permissions is not a role. */
export type RoleProblem = 'role.unknown_permission' | 'role.repeated_permission' | 'role.empty';

/**
 * Whether a set of permissions may be a role (access.md, "Roles"): at least one, every one from the
 * closed set, none twice. A role need not hold `read`: a role holding only `edit` is what a denial
 * names to leave somebody reading an artifact they may no longer change.
 */
export function checkRole(held: readonly string[]): RoleProblem | undefined {
  if (held.length === 0) return 'role.empty';
  if (!held.every(isPermission)) return 'role.unknown_permission';
  if (new Set(held).size !== held.length) return 'role.repeated_permission';
  return undefined;
}

/**
 * Whether a role may be granted as an allow: only if it holds `read`. An allow of `edit` without
 * `read` describes nobody real, and refusing it where the grant is made is simpler than an
 * implication table every explanation would have to show. A denial may name any role.
 */
export function allowable(held: readonly Permission[]): boolean {
  return held.includes('read');
}

export interface StarterRole {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/**
 * The roles a tenant starts with. They are ordinary rows once written, which the tenant may rename,
 * change or remove; the tenant migrations write the same nine - 0009 the first eight, 0017 Publisher -
 * and a test holds the two together. Editing holds `edit` alone: it cannot be allowed, and denied on
 * one artifact to somebody who authors its space it leaves them reading, commenting and suggesting
 * there. Publisher is the only role holding `publish`, because publishing releases content to whoever
 * may read the publication (the first publishing plan, decision L).
 */
export const starterRoles: readonly StarterRole[] = [
  { name: 'Reader', permissions: ['read'] },
  { name: 'Reviewer', permissions: ['read', 'comment', 'suggest'] },
  { name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
  { name: 'Approver', permissions: ['read', 'comment', 'approve'] },
  { name: 'Designer', permissions: ['read', 'design'] },
  { name: 'Definitions manager', permissions: ['read', 'manage_definitions'] },
  { name: 'Administrator', permissions: ['read', 'administer'] },
  { name: 'Editing', permissions: ['edit'] },
  { name: 'Publisher', permissions: ['read', 'publish'] },
];
