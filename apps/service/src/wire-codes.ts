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
  'grant.duplicate': 'grant_duplicate',
  'grant.allow_without_read': 'grant_allow_without_read',
  'grant.administer_denied_at_tenant': 'grant_administer_denied_at_tenant',
  'grant.role_missing': 'grant_role_missing',
  'grant.subject_missing': 'grant_subject_missing',
  'grant.external_at_tenant': 'grant_external_at_tenant',
  'grant.external_capped': 'grant_external_capped',
  'grant.external_past_cap': 'grant_external_past_cap',
  'grant.last_administrator': 'grant_last_administrator',
} as const satisfies Record<string, string>;

export type DottedCode = keyof typeof WIRE_CODES;

/** The wire's spelling of a store's dotted answer. */
export function wireCode(code: DottedCode): string {
  return WIRE_CODES[code];
}
