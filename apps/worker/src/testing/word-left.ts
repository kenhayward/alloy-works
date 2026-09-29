import type { Difference } from '@alloy-works/conformance';

/** A difference a run of Word's measurement found: of which theme, and the kind W15.2 left it as. */
export type Found = Difference & { readonly theme: string; readonly left: string | null };

/**
 * A kind of difference W15.2 measured and left (the plan's W15.2 as-built note; word-output.md, "Word
 * measured"): its name, where it goes by W15-I's rule, which differences are of it, and exactly what the
 * run that left it measured of it - how many, the largest of each length, and, where the kind is held
 * difference by difference, each by name.
 */
export interface Left<F = unknown> {
  /** Its name, as the plan's as-built note and word-output.md give it. */
  readonly kind: string;
  /** Where it goes (W15-I): Word's side in a slice of its own, W15.3's template, or Ken's. */
  readonly route: string;
  /** Whether a difference, of a token under a theme, is of this kind. */
  readonly holds: (difference: Difference, facts: F) => boolean;
  /** How many differences of it the run that left it measured: no more and no fewer may be found. */
  readonly count: number;
  /**
   * The largest of each length it holds, in points, as the run that left it measured: a length larger
   * fails, and so does a property not named here - a difference that is not a length among them.
   */
  readonly largest: Readonly<Record<string, number>>;
  /**
   * Where a kind is held difference by difference, each one it holds, by `nameOf`: one not named here
   * fails, and so does one named and not found. A difference that is not a length - a colour - is held
   * only so.
   */
  readonly named?: readonly string[];
}

/** A difference by its theme, its token and its property, as a kind names it. */
export const nameOf = (difference: Found) =>
  `${difference.theme}: ${difference.token} ${difference.property}`;

/** Whether a difference is a length, which a kind holds by its largest. */
export const isLength = (difference: Difference) =>
  typeof difference.editor === 'number' && typeof difference.pdf === 'number';

/** A difference's property, a step's without the token it is from. */
export const propertyOf = (difference: Difference) => difference.property.replace(/ from .*$/, '');

/**
 * Everything a run found that the kinds W15.2 left do not hold exactly: a difference of no kind, a kind
 * with more or fewer than it measured, a property it does not name, a length past its largest, and,
 * where a kind is held difference by difference, one it does not name or one it names not found.
 */
export function unheld<F>(found: readonly Found[], kinds: readonly Left<F>[]): string[] {
  const problems: string[] = [];
  for (const each of found) {
    if (each.left === null) problems.push(`of no kind: ${nameOf(each)}`);
  }
  for (const kind of kinds) {
    const of = found.filter((each) => each.left === kind.kind);
    if (of.length !== kind.count) {
      problems.push(`${kind.kind}: ${of.length} differences, where ${kind.count} were measured`);
    }
    for (const each of of) {
      const name = nameOf(each);
      if (kind.named !== undefined && !kind.named.includes(name)) {
        problems.push(`${kind.kind}: not named, ${name}`);
      }
      if (!isLength(each)) {
        if (kind.named === undefined) problems.push(`${kind.kind}: not a length, ${name}`);
        continue;
      }
      const property = propertyOf(each);
      const by = Math.round(Math.abs(Number(each.editor) - Number(each.pdf)) * 100) / 100;
      const most = kind.largest[property];
      if (most === undefined) problems.push(`${kind.kind}: a property it does not name, ${name}`);
      else if (by > most) problems.push(`${kind.kind}: ${name} by ${by}, past ${most}`);
    }
    const names = new Set(of.map(nameOf));
    for (const name of kind.named ?? []) {
      if (!names.has(name)) problems.push(`${kind.kind}: named and not found, ${name}`);
    }
  }
  return problems;
}
