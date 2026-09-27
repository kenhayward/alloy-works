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
      // A value written that does not fit, or that nothing can be checked against because the
      // document's template no longer resolves: the design's own guards (templates.md, "Values"). A
      // missing required value is TPL-055's, refused at publication and not here.
      'values.invalid',
      'values.unresolved',
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
