/**
 * The store's dotted refusal codes, as the wire spells them (Ken's decision F): every API error `code`
 * uses an underscore, never a dot. Mapped here, at the one place, so a handler never builds a wire
 * code by string replacement - the db layer's own answers (`lock.held` and the rest, like
 * `recordVersion`'s shipped `version.unchanged`) stay dotted, and only this table's values ever reach
 * a response body.
 */
const WIRE_CODES = {
  'lock.held': 'lock_held',
  'lock.required': 'lock_required',
  'iteration.stale': 'iteration_stale',
  'iteration.conflict': 'iteration_conflict',
  'version.precondition': 'version_precondition',
  'version.unchanged': 'version_unchanged',
  'content.invalid': 'content_invalid',
  'artifact.missing': 'artifact_missing',
} as const satisfies Record<string, string>;

export type DottedCode = keyof typeof WIRE_CODES;

/** The wire's spelling of a store's dotted answer. */
export function wireCode(code: DottedCode): string {
  return WIRE_CODES[code];
}
