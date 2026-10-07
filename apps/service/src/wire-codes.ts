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
  'group.name_taken': 'group_name_taken',
  'group.value_taken': 'group_value_taken',
  'group.from_provider': 'group_from_provider',
  'group.member_missing': 'group_member_missing',
  'format.unsupported': 'format_unsupported',
  'page_reference.without_pdf': 'page_reference_without_pdf',
  'layout.language': 'layout_language',
  'template.unresolved': 'template_unresolved',
  'values.invalid': 'values_invalid',
  'values.unresolved': 'values_unresolved',
  'section.required': 'section_required',
  'metadata.invalid': 'metadata_invalid',
  'definition.unresolved': 'definition_unresolved',
  'definition.invalid': 'definition_invalid',
  'definition.name_taken': 'definition_name_taken',
  'assignment.conflict': 'assignment_conflict',
  'schema.conflict': 'schema_conflict',
  'field.breaks_default': 'field_breaks_default',
  'connection.invalid': 'connection_invalid',
  'identity.not_supported': 'identity_not_supported',
  'connection.retired': 'connection_retired',
  'connection.in_use': 'connection_in_use',
  'credential.missing': 'credential_missing',
  'credential.target_changed': 'credential_target_changed',
  'sql.not_permitted': 'sql_not_permitted',
  'parameter.invalid': 'parameter_invalid',
  'binding.unresolved': 'binding_unresolved',
  'binding.missing': 'binding_missing',
  'binding.in_title': 'binding_in_title',
  'binding.changed': 'binding_changed',
  'access.changed': 'access_changed',
  'take.invalid': 'take_invalid',
  'definition.retired': 'definition_retired',
  'resolution.precondition': 'resolution_precondition',
  'confirm.not_possible': 'confirm_not_possible',
  'name.invalid': 'name_invalid',
  'identity.differs': 'identity_differs',
  'acknowledgement.required': 'acknowledgement_required',
  'binding.not_table': 'binding_not_table',
  'binding.stale': 'binding_stale',
  'version.not_held': 'version_not_held',
  'table.too_long': 'table_too_long',
  'definition.unreadable': 'definition_unreadable',
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
  // A publication's door, for a document made from a template (templates.md, TE-H).
  'section.required': 'TPL-013',
  'metadata.invalid': 'TPL-055',
  // A definition checked against what uses it before it is written (definitions.md, DE-E).
  'definition.name_taken': 'MET-031',
  'assignment.conflict': 'MET-008',
  'schema.conflict': 'MET-040',
  'field.breaks_default': 'MET-037',
  // An identity a connection's type's connector does not declare (data.md, "The connection").
  'identity.not_supported': 'DAT-078',
  // A connection a query definition in service still names is not retired (data.md, "Rotation, where
  // used and retiring").
  'connection.in_use': 'DAT-065',
  // SQL on a connection whose latest test did not find its account read-only (data.md, "The fetch").
  'sql.not_permitted': 'DAT-103',
  // A value failing its declaration, before anything runs (data.md, "Parameters").
  'parameter.invalid': 'DAT-020',
  // One's own view held without the warning that every reader of the document will see it (D7-H).
  'acknowledgement.required': 'DAT-091',
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
