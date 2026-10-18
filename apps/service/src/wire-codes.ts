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
  'lock.taken': 'lock_taken',
  'lock.free': 'lock_free',
  'lock.own': 'lock_own',
  'lock.active': 'lock_active',
  'lock.taking': 'lock_taking',
  'lock.required': 'lock_required',
  'iteration.stale': 'iteration_stale',
  'iteration.conflict': 'iteration_conflict',
  'version.precondition': 'version_precondition',
  // A range preview of a node its version places nothing at (the R22 plan, R22-B).
  'node.missing': 'node_missing',
  'version.unchanged': 'version_unchanged',
  'content.invalid': 'content_invalid',
  'artifact.missing': 'artifact_missing',
  'component_type.missing': 'component_type_missing',
  'outline.invalid': 'outline_invalid',
  'grant.duplicate': 'grant_duplicate',
  'grant.allow_without_read': 'grant_allow_without_read',
  'grant.administer_denied_at_tenant': 'grant_administer_denied_at_tenant',
  'grant.role_missing': 'grant_role_missing',
  'grant.role_fixed': 'grant_role_fixed',
  'grant.subject_missing': 'grant_subject_missing',
  'grant.subject_erased': 'grant_subject_erased',
  'grant.external_at_tenant': 'grant_external_at_tenant',
  'grant.external_capped': 'grant_external_capped',
  'grant.external_past_cap': 'grant_external_past_cap',
  'grant.not_external': 'grant_not_external',
  'grant.not_later': 'grant_not_later',
  'grant.expiry_past': 'grant_expiry_past',
  'grant.last_administrator': 'grant_last_administrator',
  'invitation.signed_in': 'invitation_signed_in',
  'invitation.kind_differs': 'invitation_kind_differs',
  'invitation.accepted': 'invitation_accepted',
  'group.name_taken': 'group_name_taken',
  'group.value_taken': 'group_value_taken',
  'group.from_provider': 'group_from_provider',
  'group.member_missing': 'group_member_missing',
  'group.member_erased': 'group_member_erased',
  'format.unsupported': 'format_unsupported',
  'page_reference.without_pdf': 'page_reference_without_pdf',
  'layout.language': 'layout_language',
  'template.unresolved': 'template_unresolved',
  'values.invalid': 'values_invalid',
  'values.unresolved': 'values_unresolved',
  'section.required': 'section_required',
  'component.required': 'component_required',
  'creation.failed': 'creation_failed',
  'cohort.bound': 'cohort_bound',
  'metadata.invalid': 'metadata_invalid',
  'definition.unresolved': 'definition_unresolved',
  'definition.invalid': 'definition_invalid',
  'prompt.invalid': 'prompt_invalid',
  'library.invalid': 'library_invalid',
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
  'parameter.unused': 'parameter_unused',
  'parameter.field': 'parameter_field',
  'parameter.variable': 'parameter_variable',
  'parameter.unknown': 'parameter_unknown',
  'parameter.fixed': 'parameter_fixed',
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
  'space.archived': 'space_archived',
  'space.name_invalid': 'space_name_invalid',
  'space.name_taken': 'space_name_taken',
  'space.last': 'space_last',
  'name.taken': 'name_taken',
  'baseline.unresolved': 'baseline_unresolved',
  'baseline.unreadable': 'baseline_unreadable',
  'superseder.invalid': 'superseder_invalid',
  'superseded.already': 'superseded_already',
  'anchor.invalid': 'anchor_invalid',
  'parts.invalid': 'parts_invalid',
  'thread.resolved': 'thread_resolved',
  'thread.internal_outside': 'thread_internal_outside',
  'comment.not_yours': 'comment_not_yours',
  'suggestion.empty': 'suggestion_empty',
  'suggestion.limit': 'suggestion_limit',
  'suggestion.resolved': 'suggestion_resolved',
  'suggestion.not_yours': 'suggestion_not_yours',
  'suggestion.stale': 'suggestion_stale',
  'suggestion.scope': 'suggestion_scope',
  'edits.pending': 'edits_pending',
  'revision.decision_required': 'revision_decision_required',
  'revision.precondition': 'revision_precondition',
  'revision.not_possible': 'revision_not_possible',
  'revision.not_standing': 'revision_not_standing',
  'revision.row_missing': 'revision_row_missing',
  'value.invalid': 'value_invalid',
  'value.empty': 'value_empty',
  'key.required': 'key_required',
  'round.closed': 'round_closed',
  'round.due_invalid': 'round_due_invalid',
  'round.baseline_missing': 'round_baseline_missing',
  'round.scope_invalid': 'round_scope_invalid',
  'round.reviewers_invalid': 'round_reviewers_invalid',
  'review.complete': 'review_complete',
  'review.not_complete': 'review_not_complete',
  'restore.unchanged': 'restore_unchanged',
  'restore.locked': 'restore_locked',
  'restore.unreadable': 'restore_unreadable',
  'hold.released': 'hold_released',
  'artifact.deleted': 'artifact_deleted',
  'deletion.refused': 'deletion_refused',
  'reference.deleted': 'reference_deleted',
  'erasure.refused': 'erasure_refused',
  // Workflow (the WF1 plan, WF-F, WF-J).
  'workflow.invalid': 'workflow_invalid',
  'state.moved': 'state_moved',
  'transition.unknown': 'transition_unknown',
  'artifact.archived': 'artifact_archived',
  'reason.required': 'reason_required',
  'reason.invalid': 'reason_invalid',
  'workflow.behind': 'workflow_behind',
  // Gates (the WF2 plan, WF2-C to WF2-E).
  'transition.gated': 'transition_gated',
  'version.moved': 'version_moved',
  'approval.given': 'approval_given',
  'approval.author': 'approval_author',
  'gate.baseline_refused': 'gate_baseline_refused',
  'conditions.unmet': 'conditions_unmet',
  'owner.invalid': 'owner_invalid',
  'dates.invalid': 'dates_invalid',
  'scope.invalid': 'scope_invalid',
  'scope.unknown': 'scope_unknown',
  'party.invalid': 'party_invalid',
  'acceptance.not_party': 'acceptance_not_party',
  'group.in_scope': 'group_in_scope',
  'line.name_taken': 'line_name_taken',
  'line.closed': 'line_closed',
  'carry.invalid': 'carry_invalid',
  'share.member': 'share_member',
  'share.invitation_waiting': 'share_invitation_waiting',
  'share.duplicate': 'share_duplicate',
  'share.erased': 'share_erased',
  'share.expiry_past': 'share_expiry_past',
  'share.past_cap': 'share_past_cap',
  'template.none': 'template_none',
  'template.current': 'template_current',
  'template.not_latest': 'template_not_latest',
  'source.moved': 'source_moved',
  'profile.invalid': 'profile_invalid',
  'profile.incomplete': 'profile_incomplete',
  'rows.invalid': 'rows_invalid',
  'cohort.complete': 'cohort_complete',
  'relationship.refused': 'relationship_refused',
  'relationship.cardinality': 'relationship_cardinality',
  'relationship.cycle': 'relationship_cycle',
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
  'lock.taken': 'COL-045',
  'lock.active': 'COL-046',
  'lock.taking': 'COL-047',
  'version.precondition': 'API-037',
  'format.unsupported': 'PUB-014',
  'page_reference.without_pdf': 'PUB-074',
  'layout.language': 'PUB-095',
  'grant.external_at_tenant': 'IAM-071',
  'grant.external_past_cap': 'IAM-049',
  'grant.not_external': 'IAM-050',
  'grant.not_later': 'IAM-050',
  'grant.expiry_past': 'IAM-049',
  // Refused when a template is made or changed as well as when a document is made from it: a template
  // naming what does not resolve could make no document (TPL-004, templates.md TE-L).
  'template.unresolved': 'TPL-004',
  // A publication's door, for a document made from a template (templates.md, TE-H).
  'section.required': 'TPL-013',
  'component.required': 'TPL-044',
  'creation.failed': 'TPL-024',
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
  // A value failing its declaration, before anything runs (data.md, "Parameters"). A template
  // parameter's value is refused under TPL-018 or TPL-045 instead, by `refused`'s own rule.
  'parameter.invalid': 'DAT-020',
  // A template's parameter feeding nothing, refused when it is saved (templates.md, "Parameters").
  'parameter.unused': 'TPL-068',
  'parameter.variable': 'TPL-069',
  'profile.incomplete': 'TPL-051',
  // A changed value of a parameter its template does not declare changeable (TP1-H).
  'parameter.fixed': 'TPL-021',
  // One's own view held without the warning that every reader of the document will see it (D7-H).
  'acknowledgement.required': 'DAT-091',
  'revision.decision_required': 'DAT-060',
  'round.closed': 'COL-057',
  // A baseline's name, unique in its document whatever its case (baselines.md).
  'name.taken': 'VER-046',
  // A suggestion that no longer fits the component, said with its places (collaboration.md).
  'suggestion.stale': 'COL-052',
  // The suggestion's author alone withdraws it.
  'suggestion.not_yours': 'COL-048',
  // A deletion something depends on (lifecycle.md, DL-C), and a restore naming what is deleted.
  'deletion.refused': 'LIF-023',
  'reference.deleted': 'VER-044',
  // A transition whose definition asks for a reason, taken without one (workflow.md).
  'reason.required': 'LIF-061',
  // An approval by one of its authors, at a gate that refuses them (workflow.md, WF2-D).
  'approval.author': 'LIF-010',
  // A transition taken, or a gate approved, while what it requires is unmet (workflow.md, WF3-B).
  'conditions.unmet': 'LIF-004',
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
  /** The rule where this refusal's is not its code's: a template's parameters are TPL's, not DAT-020's. */
  rule: string | undefined = RULES[code],
): AppError {
  return new AppError(status, WIRE_CODES[code], message, rule, members);
}
