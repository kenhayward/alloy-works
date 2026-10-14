import { describe, expect, it } from 'vitest';
import { REFUSED_AT_THE_DOOR } from './assets.js';
import { toErrorBody } from './errors.js';
import { DOTTED_CODES, refused, type DottedCode } from './wire-codes.js';

describe('the rule behind a refusal', () => {
  it('API-006 names what failed and the rule that refused it, for every refusal a rule makes', () => {
    // Each refusal a requirement makes, with the requirement that makes it: the code says what
    // failed, the rule why. The identifiers are the ones `pnpm trace show` gives for each.
    const ruled: readonly (readonly [DottedCode, string, string])[] = [
      ['lock.held', 'lock_held', 'API-039'],
      ['lock.required', 'lock_required', 'COL-005'],
      ['lock.taken', 'lock_taken', 'COL-045'],
      ['lock.active', 'lock_active', 'COL-046'],
      ['lock.taking', 'lock_taking', 'COL-047'],
      ['version.precondition', 'version_precondition', 'API-037'],
      ['format.unsupported', 'format_unsupported', 'PUB-014'],
      ['page_reference.without_pdf', 'page_reference_without_pdf', 'PUB-074'],
      ['layout.language', 'layout_language', 'PUB-095'],
      ['grant.external_at_tenant', 'grant_external_at_tenant', 'IAM-071'],
      ['grant.external_past_cap', 'grant_external_past_cap', 'IAM-049'],
      ['template.unresolved', 'template_unresolved', 'TPL-004'],
      ['section.required', 'section_required', 'TPL-013'],
      ['metadata.invalid', 'metadata_invalid', 'TPL-055'],
      ['definition.name_taken', 'definition_name_taken', 'MET-031'],
      ['assignment.conflict', 'assignment_conflict', 'MET-008'],
      ['schema.conflict', 'schema_conflict', 'MET-040'],
      ['field.breaks_default', 'field_breaks_default', 'MET-037'],
      ['identity.not_supported', 'identity_not_supported', 'DAT-078'],
      ['connection.in_use', 'connection_in_use', 'DAT-065'],
      ['sql.not_permitted', 'sql_not_permitted', 'DAT-103'],
      ['parameter.invalid', 'parameter_invalid', 'DAT-020'],
      ['parameter.unused', 'parameter_unused', 'TPL-068'],
      ['parameter.fixed', 'parameter_fixed', 'TPL-021'],
      ['acknowledgement.required', 'acknowledgement_required', 'DAT-091'],
      ['name.taken', 'name_taken', 'VER-046'],
      ['suggestion.stale', 'suggestion_stale', 'COL-052'],
      ['suggestion.not_yours', 'suggestion_not_yours', 'COL-048'],
      ['revision.decision_required', 'revision_decision_required', 'DAT-060'],
      ['round.closed', 'round_closed', 'COL-057'],
      ['deletion.refused', 'deletion_refused', 'LIF-023'],
      ['reference.deleted', 'reference_deleted', 'VER-044'],
      ['reason.required', 'reason_required', 'LIF-061'],
      ['approval.author', 'approval_author', 'LIF-010'],
    ];
    for (const [dotted, code, rule] of ruled) {
      const { body } = toErrorBody(refused(409, dotted, 'Refused.'), 'trace-1');
      expect(body, dotted).toEqual({ code, message: 'Refused.', rule, traceId: 'trace-1' });
    }
    // And no rule where none refuses: a reference to nothing, a stale save, a design's own guard.
    // Every code is one or the other, so a code added later is decided rather than defaulted.
    const unruled: readonly DottedCode[] = [
      // Nobody holds it, or the asker does: a state to act on, not a rule refusing (collaboration.md).
      'lock.free',
      'lock.own',
      'iteration.stale',
      'iteration.conflict',
      'version.unchanged',
      'content.invalid',
      'artifact.missing',
      'component_type.missing',
      'outline.invalid',
      'grant.duplicate',
      'grant.allow_without_read',
      'grant.administer_denied_at_tenant',
      'grant.role_missing',
      'grant.subject_missing',
      'grant.last_administrator',
      // Refuses more than IAM-057 names, which access.md therefore does not claim.
      'grant.external_capped',
      'invitation.signed_in',
      'invitation.kind_differs',
      'invitation.accepted',
      // A group's own guards: a name or value taken, a person not held, and a provider's group,
      // whose members are the sign-ins' (access.md, GP-C) - a design's decision, not IAM-009's.
      'group.name_taken',
      'group.value_taken',
      'group.from_provider',
      'group.member_missing',
      // A value written that does not fit, or that nothing can be checked against because the
      // document's template no longer resolves: the design's own guards (templates.md, "Values"). A
      // missing required value is TPL-055's, refused at publication and not here.
      'values.invalid',
      'values.unresolved',
      // A template parameter's seeded field that cannot take it, and a value for a parameter the
      // template does not declare: the design's own guards (templates.md, "Parameters").
      'parameter.field',
      'parameter.unknown',
      // What a definition names that is not there, and a schema's own invalid default: the
      // definition's own shape, which no requirement names (definitions.md, DE-E).
      'definition.unresolved',
      'definition.invalid',
      // A connection's settings past their shape, which the contract checks at the door: made retired,
      // which the design refuses (data.md, "The connection") and no requirement names.
      'connection.invalid',
      // A connection that cannot run: retired, or with nothing to sign in with. The design's own
      // guards (data.md, "Rotation, where used and retiring"), which no requirement names as such.
      'connection.retired',
      'credential.missing',
      // A credential set for where the connection no longer signs in (data.md, DA-AF).
      'credential.target_changed',
      // The D3 plan's refusals (D3-L): a binding a publish would meet before the publish's binding
      // stage exists (DAT-087's whole answer is bindings.md's), one the node's component does not
      // hold or a title holds, one changed or a permission lost while its source answered, a take or
      // a definition the run cannot honour, an acceptance from what the binding no longer holds, and
      // a dataset's name past its shape. Guards of the design's own, which no requirement names.
      'binding.unresolved',
      'binding.missing',
      'binding.in_title',
      'binding.changed',
      'access.changed',
      'take.invalid',
      'definition.retired',
      'resolution.precondition',
      'name.invalid',
      // B2's Keep, refused where the binding's question changed (B2-F).
      'confirm.not_possible',
      // Another person's own view, which only they may accept (the D7 plan, D7-H): the design's.
      'identity.differs',
      // A bound table's rows for the page (the TB2 plan, TB2-A): asked of a value's binding, of one
      // changed since, of a version not held, or of a result too long to print. The design's own.
      'binding.not_table',
      'binding.stale',
      'version.not_held',
      'table.too_long',
      // A column named by somebody who may not read its definition (the TB2 final review): a guard
      // of tables.md's own, which no requirement names.
      'definition.unreadable',
      // A space's own guards (the SP1 plan, SP-B to SP-D): a name past its shape or taken, the last
      // live space, and a creation in an archived one. ADM-049 asks that a space can be archived;
      // what archiving refuses is the design's.
      'space.archived',
      'space.name_invalid',
      'space.name_taken',
      'space.last',
      // A baseline's own guards (the BL plan): a place that does not resolve as its maker reads it,
      // and a supersession by anything but a later baseline of the document, or a second one.
      'baseline.unresolved',
      'baseline.unreadable',
      'superseder.invalid',
      'superseded.already',
      'anchor.invalid',
      // A person a grant still names, oneself, or a service: erasure's own guards (the ER plan, ER-C).
      'erasure.refused',
      // Nothing granted to or joined by somebody erased (the ER final review, M3): the design's own.
      'grant.subject_erased',
      'group.member_erased',
      'parts.invalid',
      'thread.resolved',
      'comment.not_yours',
      'suggestion.empty',
      'suggestion.limit',
      'suggestion.resolved',
      'suggestion.scope',
      'edits.pending',
      // The RV plan's (RV-C, RV-D): a revision from what the binding no longer holds, of what cannot
      // be revised, of a row the result lacks, a withdrawal of nothing, a value not of its column or
      // blank, and a cell's key naming other columns. Guards of the design's own.
      'revision.precondition',
      'revision.not_possible',
      'revision.not_standing',
      'revision.row_missing',
      'value.invalid',
      'value.empty',
      'key.required',
      // The RR plan's (RR-B, RR-F): a round opened due before now, on a baseline or a section the
      // document lacks, or naming one who may not review it; a completion twice, or a reopening of
      // none. Guards of the design's own.
      'round.due_invalid',
      'round.baseline_missing',
      'round.scope_invalid',
      'round.reviewers_invalid',
      'review.complete',
      'review.not_complete',
      // The RS plan's (RS-E): a restore that would change nothing, of a component somebody holds, or
      // of a version that no longer reads. Guards of the design's own; VER-044 is not claimed.
      'restore.unchanged',
      'restore.locked',
      'restore.unreadable',
      // The AH plan's (AH-F): a release of a hold released already. A guard of the design's own.
      'hold.released',
      // A deleted component or document, answered 410 (the DL plan, DL-B): a state, not a rule.
      'artifact.deleted',
      // The WF1 plan's (WF-F, WF-K): a body that does not validate, an artifact moved since it was
      // read, a transition not from its state, an archived one. Guards of the design's own.
      'workflow.invalid',
      'state.moved',
      'transition.unknown',
      'artifact.archived',
      // A reason too long, and a save begun from a version since replaced.
      'reason.invalid',
      'workflow.behind',
      // The WF2 plan's (WF2-C): a gate taken as a move, a version replaced, an approval given twice.
      'transition.gated',
      'version.moved',
      'approval.given',
    ];
    expect([...ruled.map(([dotted]) => dotted), ...unruled].sort()).toEqual(
      [...DOTTED_CODES].sort(),
    );
    for (const dotted of unruled) {
      expect(
        toErrorBody(refused(409, dotted, 'Refused.'), 'trace-1').body,
        dotted,
      ).not.toHaveProperty('rule');
    }
    // The refusals at an image's door, which are the asset rules' own.
    expect(
      Object.fromEntries(Object.values(REFUSED_AT_THE_DOOR).map((door) => [door.code, door.rule])),
    ).toEqual({
      asset_format_not_permitted: 'AST-001',
      asset_too_large: 'AST-040',
      asset_unreadable: 'AST-051',
    });
  });
});
