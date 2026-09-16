/**
 * Where a grant is made and what a question is asked of (access.md, "Grants" and "Deciding"): the
 * tenant, a space, or a single artifact of any kind.
 */
export type Level =
  | { readonly kind: 'tenant' }
  | { readonly kind: 'space'; readonly id: string }
  | { readonly kind: 'artifact'; readonly id: string };

const NAMED = /^(space|artifact):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** `tenant`, `space:<id>` or `artifact:<id>`: how a route's `target` names a level. */
export function formatLevel(level: Level): string {
  return level.kind === 'tenant' ? 'tenant' : `${level.kind}:${level.id}`;
}

/** The level a target names, or undefined for anything that is not exactly one. */
export function parseLevel(text: string): Level | undefined {
  if (text === 'tenant') return { kind: 'tenant' };
  const match = NAMED.exec(text);
  if (!match) return undefined;
  return { kind: match[1] as 'space' | 'artifact', id: match[2]! };
}

export function sameLevel(a: Level, b: Level): boolean {
  if (a.kind === 'tenant' || b.kind === 'tenant') return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}
