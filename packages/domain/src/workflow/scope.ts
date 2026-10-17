import { z } from 'zod';

/**
 * **Scopes** (the R15 plan, R15-A to R15-E; LIF-042, LIF-043, LIF-047): a revision effective for some
 * condition axis values - a market, a site - each perhaps waiting on a named party's acceptance, and the
 * one rule saying which revision applies in a scope.
 */

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** Who must accept a revision before it takes effect in a scope: a person or a group (R15-E). */
export const scopePartySchema = z.strictObject({
  kind: z.enum(['principal', 'group']),
  id: uuid,
});
export type ScopeParty = z.infer<typeof scopePartySchema>;

/** One axis value a revision is effective for, and the party who must accept it there, if any. */
export const scopeEntrySchema = z.strictObject({
  axis: key,
  value: key,
  party: scopePartySchema.nullable(),
});
export type ScopeEntry = z.infer<typeof scopeEntrySchema>;

/** The values the next revision is effective for, each once; none is everywhere (R15-B). */
export const scopeSchema = z
  .array(scopeEntrySchema)
  .max(50)
  .refine(
    (entries) =>
      new Set(entries.map((each) => `${each.axis}:${each.value}`)).size === entries.length,
    'Each axis value once',
  );
export type Scope = z.infer<typeof scopeSchema>;

/** A designated revision in effect, and each value it is scoped to, pending where not yet accepted. */
export interface ScopedRevision {
  readonly number: number;
  readonly scopes: readonly {
    readonly axis: string;
    readonly value: string;
    readonly pending: boolean;
  }[];
}

/**
 * The one revision effective under `profile` (R15-C; LIF-043): the newest scoped to a value the
 * profile holds and not waiting on acceptance there; where none is, the newest unscoped; else none.
 */
export function effectiveRevision(
  revisions: readonly ScopedRevision[],
  profile: Readonly<Record<string, readonly string[]>>,
): number | null {
  const held = new Set(
    Object.entries(profile).flatMap(([axis, values]) => values.map((value) => `${axis}:${value}`)),
  );
  const newest = (candidates: readonly ScopedRevision[]) =>
    candidates.length === 0 ? null : Math.max(...candidates.map((each) => each.number));
  return (
    newest(
      revisions.filter((each) =>
        each.scopes.some((scope) => !scope.pending && held.has(`${scope.axis}:${scope.value}`)),
      ),
    ) ?? newest(revisions.filter((each) => each.scopes.length === 0))
  );
}
