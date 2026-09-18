import { describe, expect, it } from 'vitest';
import { wireCode } from './wire-codes.js';

describe('wireCode', () => {
  it("spells every dotted store answer with an underscore, the one shape the wire uses (Ken's decision F)", () => {
    expect(wireCode('lock.held')).toBe('lock_held');
    expect(wireCode('lock.required')).toBe('lock_required');
    expect(wireCode('iteration.stale')).toBe('iteration_stale');
    expect(wireCode('iteration.conflict')).toBe('iteration_conflict');
    expect(wireCode('version.precondition')).toBe('version_precondition');
    expect(wireCode('version.unchanged')).toBe('version_unchanged');
    expect(wireCode('content.invalid')).toBe('content_invalid');
    expect(wireCode('artifact.missing')).toBe('artifact_missing');
    expect(wireCode('component_type.missing')).toBe('component_type_missing');
  });

  it('spells every refusal where a grant is made or removed with an underscore too', () => {
    expect(wireCode('grant.duplicate')).toBe('grant_duplicate');
    expect(wireCode('grant.allow_without_read')).toBe('grant_allow_without_read');
    expect(wireCode('grant.administer_denied_at_tenant')).toBe('grant_administer_denied_at_tenant');
    expect(wireCode('grant.role_missing')).toBe('grant_role_missing');
    expect(wireCode('grant.subject_missing')).toBe('grant_subject_missing');
    expect(wireCode('grant.external_at_tenant')).toBe('grant_external_at_tenant');
    expect(wireCode('grant.external_capped')).toBe('grant_external_capped');
    expect(wireCode('grant.external_past_cap')).toBe('grant_external_past_cap');
    expect(wireCode('grant.last_administrator')).toBe('grant_last_administrator');
  });

  it('spells every refusal where an invitation is made or withdrawn with an underscore too', () => {
    expect(wireCode('invitation.signed_in')).toBe('invitation_signed_in');
    expect(wireCode('invitation.kind_differs')).toBe('invitation_kind_differs');
    expect(wireCode('invitation.accepted')).toBe('invitation_accepted');
  });
});
