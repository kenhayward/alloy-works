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
    ];
    for (const [dotted, code, rule] of ruled) {
      const { body } = toErrorBody(refused(409, dotted, 'Refused.'), 'trace-1');
      expect(body, dotted).toEqual({ code, message: 'Refused.', rule, traceId: 'trace-1' });
    }
    // And no rule where none refuses: a reference to nothing, a stale save, a design's own guard.
    // Every code is one or the other, so a code added later is decided rather than defaulted.
    const unruled: readonly DottedCode[] = [
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
