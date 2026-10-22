import { canonicalJson } from '../stored/canonical.js';

/** A version a baseline pins, by its id and its version digest (VER-042). */
export interface PinnedVersion {
  readonly version: string;
  readonly digest: string;
}

/** Everything a baseline pins (docs/design/baselines.md): what its digest is over. */
export interface BaselinePins {
  readonly document: PinnedVersion;
  readonly layout: PinnedVersion;
  readonly theme: PinnedVersion;
  readonly template: PinnedVersion | null;
  readonly occurrences: readonly (PinnedVersion & { readonly node: string })[];
  readonly assets: readonly PinnedVersion[];
  /**
   * The bibliography entry versions its citations read (CIc; LIB-047); absent where it cites none, so
   * a baseline made before them hashes as it did.
   */
  readonly entries?: readonly PinnedVersion[];
  /** The term versions its uses read (TMb; TM-G); absent where it uses none, for the same reason. */
  readonly terms?: readonly PinnedVersion[];
  readonly bindings: readonly {
    readonly node: string;
    readonly binding: string;
    /** The binding's own digest, as its resolution was taken under. */
    readonly digest: string;
    readonly datasetVersion: string;
    readonly datasetDigest: string;
    /**
     * The values revised by hand standing in front of it (the RV plan, RV-E), by identifier with the
     * value each holds, ascending; absent where none stood, so a baseline made before them hashes as it
     * did.
     */
    readonly revisions?: readonly { readonly id: string; readonly value: string | boolean }[];
  }[];
}

const byKey =
  <T>(key: (each: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/**
 * The canonical string a baseline's digest is SHA-256 over (VER-043): every pin, each list sorted, so
 * the one value is recomputable by anybody who may read every pin. Hashed in `packages/db`, which
 * owns hashing, as a version's digests are.
 */
export function baselineDigestInput(pins: BaselinePins): string {
  return canonicalJson({
    ...pins,
    occurrences: [...pins.occurrences].sort(byKey((each) => each.node)),
    assets: [...pins.assets].sort(byKey((each) => each.version)),
    bindings: [...pins.bindings].sort(byKey((each) => `${each.node} ${each.binding}`)),
    ...(pins.entries === undefined
      ? {}
      : { entries: [...pins.entries].sort(byKey((each) => each.version)) }),
    ...(pins.terms === undefined
      ? {}
      : { terms: [...pins.terms].sort(byKey((each) => each.version)) }),
  });
}

const CONTROL = /\p{Cc}/u;

/**
 * Why a baseline's name cannot be stored (VER-046), or null: 1 to 120 characters, nothing before or
 * after it, no control character. Its uniqueness is its document's, by `nameKey`.
 */
export function baselineNameProblem(name: string): string | null {
  const characters = [...name].length;
  if (characters < 1 || characters > 120) return 'A name is 1 to 120 characters';
  if (name !== name.trim()) return 'A name has no space before or after it';
  if (CONTROL.test(name)) return 'A name holds no control character';
  return null;
}
