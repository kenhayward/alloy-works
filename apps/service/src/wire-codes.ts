import { AppError } from './errors.js';

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
  'component_type.missing': 'component_type_missing',
  'outline.invalid': 'outline_invalid',
  'grant.duplicate': 'grant_duplicate',
  'grant.allow_without_read': 'grant_allow_without_read',
  'grant.administer_denied_at_tenant': 'grant_administer_denied_at_tenant',
  'grant.role_missing': 'grant_role_missing',
  'grant.subject_missing': 'grant_subject_missing',
  'grant.external_at_tenant': 'grant_external_at_tenant',
  'grant.external_capped': 'grant_external_capped',
  'grant.external_past_cap': 'grant_external_past_cap',
  'grant.last_administrator': 'grant_last_administrator',
  'invitation.signed_in': 'invitation_signed_in',
  'invitation.kind_differs': 'invitation_kind_differs',
  'invitation.accepted': 'invitation_accepted',
  'format.unsupported': 'format_unsupported',
  'page_reference.without_pdf': 'page_reference_without_pdf',
  'layout.language': 'layout_language',
  'template.unresolved': 'template_unresolved',
  'values.invalid': 'values_invalid',
  'values.unresolved': 'values_unresolved',
} as const satisfies Record<string, string>;

export type DottedCode = keyof typeof WIRE_CODES;

/** Every dotted code the table spells, for a test to hold each one to a decision about its rule. */
export const DOTTED_CODES = Object.keys(WIRE_CODES) as DottedCode[];

/**
 * The requirement each refusal enforces, where one is the rule that refuses (API-006): what the
 * error's `rule` names, so a caller can look up why as well as what. A code absent here refuses by no
 * requirement - a reference to nothing, a stale save, a guard of the design's own - and names none
 * rather than one that reads well - nor does the cap on what an external principal may be given,
 * which refuses more than IAM-057 names and which access.md leaves IAM-057 unclaimed for.
 * `refusals.test.ts` holds every code to one side or the other.
 */
const RULES: Partial<Record<DottedCode, string>> = {
  'lock.held': 'API-039',
  'lock.required': 'COL-005',
  'version.precondition': 'API-037',
  'format.unsupported': 'PUB-014',
  'page_reference.without_pdf': 'PUB-074',
  'layout.language': 'PUB-095',
  'grant.external_at_tenant': 'IAM-071',
  'grant.external_past_cap': 'IAM-049',
  // Refused when a template is made or changed as well as when a document is made from it: a template
  // naming what does not resolve could make no document (TPL-004, templates.md TE-L).
  'template.unresolved': 'TPL-004',
};

/** The wire's spelling of a store's dotted answer. */
export function wireCode(code: DottedCode): string {
  return WIRE_CODES[code];
}

/**
 * A refusal of the store's, as the wire carries it: its code spelled for the wire, and the rule that
 * refuses it where a requirement does. The one way a dotted answer becomes an error, so no refusal can
 * be sent without the rule its code carries.
 */
export function refused(
  status: number,
  code: DottedCode,
  message: string,
  members: Readonly<Record<string, unknown>> = {},
): AppError {
  return new AppError(status, WIRE_CODES[code], message, RULES[code], members);
}
