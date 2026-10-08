import { describe, expect, it } from 'vitest';
import { AuditContext } from './context.js';
import { auditKinds, auditKindSpecs, isAuditKind, parseAuditDetail } from './kinds.js';
import { labelFor } from './labels.js';

const ID = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const OTHER = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';

describe('the audit kinds', () => {
  it('holds every kind audit.md lists, each naming the requirement it answers', () => {
    // audit.md's "Event types", emitted from AU1 and declared for later designs.
    const listed = [
      'authentication.signed_in',
      'authentication.sign_in_failed',
      'authentication.signed_out',
      'access.refused',
      'access.granted',
      'access.revoked',
      'group.member_added',
      'group.member_removed',
      'invitation.sent',
      'invitation.accepted',
      'invitation.withdrawn',
      'tenant.administrator_named',
      'tenant.administrator_claimed',
      'token.issued',
      'token.used',
      'token.revoked',
      'space.made',
      'space.renamed',
      'space.archived',
      'space.restored',
      'content.version_cut',
      'connection.made',
      'connection.changed',
      'connection.credential_set',
      'connection.tested',
      'connection.retired',
      'binding.resolved',
      'binding.checked',
      'binding.accepted',
      'binding.confirmed',
      'dataset.named',
      'publication.requested',
      'publication.produced',
      'publication.failed',
      'export.produced',
      'export.downloaded',
      'audit.label_erased',
      'workflow.transitioned',
      'approval.given',
      'approval.rejected',
      'gate.rejected',
      'hold.applied',
      'hold.removed',
      'artifact.archived',
      'artifact.deleted',
      'revision.designated',
      'baseline.made',
      'baseline.superseded',
      'content.restored',
      'reference.repointed',
      'lock.taken',
      'suggestion.accepted',
      'suggestion.rejected',
      'template.moved',
      'binding.revised',
      'publication.shared_accessed',
      'channel.changed',
      'tool.used',
      // The AU1 plan's additions (AU1-A).
      'group.made',
      'group.deleted',
      'settings.changed',
      'sign_in_route.configured',
      'sign_in_route.closed',
      'tenant.invited',
      'relationship.made',
      'relationship.changed',
      'relationship.removed',
      'asset.ingested',
      'asset.replaced',
      'asset.relicensed',
      'asset.refused',
      'generation.run',
      'generation.accepted',
      'generation.discarded',
      'support.granted',
      'support.used',
      'support.revoked',
    ];
    expect([...auditKinds].sort()).toEqual([...listed].sort());
    for (const kind of auditKinds) {
      const spec = auditKindSpecs[kind];
      expect(spec.requirements.length, kind).toBeGreaterThan(0);
      for (const requirement of spec.requirements) expect(requirement).toMatch(/^[A-Z]{3}-\d{3}$/);
      expect(kind).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
    expect(isAuditKind('access.refused')).toBe(true);
    expect(isAuditKind('access.*')).toBe(false);
    expect(isAuditKind('toString')).toBe(false);
  });

  it('takes the detail each kind emitted now describes', () => {
    const examples: Partial<Record<(typeof auditKinds)[number], unknown>> = {
      'authentication.signed_in': { route: 'organisation' },
      'authentication.sign_in_failed': { route: 'google', failure: 'handoff_expired' },
      'authentication.signed_out': { ended: 'expired', expiredAt: '2026-10-08T09:00:00.000Z' },
      'access.refused': {
        permission: 'edit',
        target: `artifact:${ID}`,
        reason: 'denied',
        level: `space:${OTHER}`,
        hidden: false,
        code: 'forbidden',
      },
      'access.granted': {
        role: ID,
        level: 'tenant',
        effect: 'allow',
        grantee: OTHER,
        granteeKind: 'group',
      },
      'group.member_added': { group: ID, principal: OTHER, through: 'provider' },
      'token.issued': { scopes: ['edit', 'publish'] },
      'settings.changed': { settings: ['maxRows', 'editing.lockMinutes'] },
      'content.version_cut': { kind: 'component', parent: null },
      'connection.changed': { settings: ['host', 'database'] },
      'connection.tested': { outcome: 'ok', findings: ['account_not_read_only'] },
      'binding.resolved': { document: ID, node: 'n-1', binding: 'b_2', dataset: OTHER },
      'publication.requested': { document: ID, format: 'pdf' },
      'audit.label_erased': { labels: 3 },
    };
    for (const [kind, detail] of Object.entries(examples)) {
      expect(parseAuditDetail(kind as (typeof auditKinds)[number], detail), kind).toEqual(detail);
    }
  });

  it('refuses a member no kind names, of every kind', () => {
    for (const kind of auditKinds) {
      expect(() => parseAuditDetail(kind, { note: 'anything' }), kind).toThrow(kind);
    }
  });

  it('LIF-030 refuses a detail holding a value where a name belongs', () => {
    // A connection's changed settings are named, never given: a host, a credential, a sentence.
    for (const value of [
      'host=db.example.com',
      'postgres://reader:hunter2@db.example.com/sales',
      'The password is swordfish',
      'x'.repeat(65),
    ]) {
      expect(() => parseAuditDetail('connection.changed', { settings: [value] })).toThrow(
        /connection\.changed/,
      );
    }
    // Nor beside the names, under a member of its own.
    expect(() =>
      parseAuditDetail('connection.credential_set', { password: 'swordfish' }),
    ).toThrow();
    // A refusal's code is a code, and its target an identifier.
    const refusal = {
      permission: 'read',
      target: `artifact:${ID}`,
      reason: 'not_granted',
      level: null,
      hidden: true,
      code: 'not_found',
    };
    expect(parseAuditDetail('access.refused', refusal)).toEqual(refusal);
    expect(() =>
      parseAuditDetail('access.refused', { ...refusal, code: 'There is nothing at this address.' }),
    ).toThrow();
    expect(() =>
      parseAuditDetail('access.refused', { ...refusal, target: 'Quarterly report' }),
    ).toThrow();
    // And the thrown words name where it failed, never what it held.
    expect(() => parseAuditDetail('settings.changed', { settings: ['secret=swordfish'] })).toThrow(
      /^(?!.*swordfish).*settings\.0/,
    );
  });
});

describe('the audit context', () => {
  it('names who acts, by kind, and nothing a kind does not have', () => {
    expect(AuditContext.parse({ actorKind: 'person', actor: ID, traceId: 'req-1' })).toEqual({
      actorKind: 'person',
      actor: ID,
      traceId: 'req-1',
    });
    expect(AuditContext.parse({ actorKind: 'system', requestedBy: ID }).actorKind).toBe('system');
    expect(() => AuditContext.parse({ actorKind: 'token', actor: ID })).toThrow();
    expect(() => AuditContext.parse({ actorKind: 'vendor', actor: ID })).toThrow();
    expect(() => AuditContext.parse({ actorKind: 'person', actor: ID, traceId: 'a b' })).toThrow();
  });
});

describe('labelFor', () => {
  it("reads a subject's title or name by its kind", () => {
    expect(labelFor('document', { title: 'Field guide', name: 'ignored' })).toBe('Field guide');
    expect(labelFor('connection', { name: 'Sales warehouse' })).toBe('Sales warehouse');
    expect(labelFor('space', { name: 'General' })).toBe('General');
    expect(labelFor('principal', { display_name: 'Ada' })).toBe('Ada');
    expect(labelFor('dataset', {})).toBeUndefined();
    expect(labelFor('component', { title: '  ' })).toBeUndefined();
  });
});
