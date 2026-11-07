import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { permissions } from './permissions.js';
import { readableSet } from './readable.js';
import { supportActive, supportReaches, type SupportGrant } from './support.js';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const QUALITY = '00000000-0000-4000-8000-00000000901a';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const NOW = new Date('2026-11-07T12:00:00Z');
const DAY = 86_400_000;

const support = (overrides: Partial<SupportGrant> = {}): SupportGrant => ({
  id: 'support-1',
  scope: 'metadata',
  spaces: [CLINICAL],
  purpose: 'Why the outline will not save',
  expiresAt: new Date(NOW.getTime() + 7 * DAY),
  revokedAt: null,
  ...overrides,
});

const inClinical: Level[] = [
  { kind: 'artifact', id: DOSING },
  { kind: 'space', id: CLINICAL },
  { kind: 'tenant' },
];
const inQuality: Level[] = [{ kind: 'space', id: QUALITY }, { kind: 'tenant' }];

const facts = (
  chain: readonly Level[],
  given: SupportGrant | undefined,
  grants: readonly AccessGrant[] = [],
): AccessFacts => ({
  principal: { id: ALICE, kind: 'external' },
  groups: [],
  chain,
  grants,
  now: NOW,
  externalCapDays: 90,
  ...(given === undefined ? {} : { support: given }),
});

describe('support, decided apart from grants', () => {
  it('ADM-023 is active only while unrevoked, unexpired and within the cap, so a lowered cap ends it', () => {
    expect(supportActive(support(), NOW, 90)).toBe(true);
    expect(supportActive(support({ revokedAt: NOW }), NOW, 90)).toBe(false);
    expect(supportActive(support({ expiresAt: NOW }), NOW, 90)).toBe(false);
    // Granted for a week; the tenant then caps outside access at five days.
    expect(supportActive(support(), NOW, 5)).toBe(false);
  });

  it('ADM-022 lets a metadata or content grant read its spaces alone, and a diagnostics grant none', () => {
    expect(decide('read', facts(inClinical, support()))).toMatchObject({
      allowed: true,
      reason: 'support',
      level: { kind: 'space', id: CLINICAL },
      grants: [],
    });
    expect(decide('read', facts(inQuality, support()))).toMatchObject({
      allowed: false,
      reason: 'support',
    });
    expect(decide('read', facts(inClinical, support({ scope: 'diagnostics' })))).toMatchObject({
      allowed: false,
      reason: 'support',
    });
    // Ended, it confers nothing: the ordinary grants decide, and an outsider holds none.
    expect(decide('read', facts(inClinical, support({ revokedAt: NOW })))).toMatchObject({
      allowed: false,
      reason: 'not_granted',
    });
  });

  it('reads diagnostics at the tenant in every scope, and is refused every other permission whatever the grants say', () => {
    for (const scope of ['diagnostics', 'metadata', 'content'] as const) {
      expect(
        decide('read_diagnostics', facts([{ kind: 'tenant' }], support({ scope }))),
      ).toMatchObject({ allowed: true, reason: 'support', level: { kind: 'tenant' } });
    }
    const commenter: AccessGrant = {
      id: 'grant-1',
      role: { id: 'role-reviewer', name: 'Reviewer', permissions: ['read', 'comment', 'suggest'] },
      subject: { principal: ALICE },
      level: { kind: 'space', id: CLINICAL },
      effect: 'allow',
      expiresAt: new Date(NOW.getTime() + DAY),
    };
    for (const permission of permissions.filter(
      (each) => each !== 'read' && each !== 'read_diagnostics',
    )) {
      expect(
        decide(permission, facts(inClinical, support({ scope: 'content' }), [commenter])).allowed,
        permission,
      ).toBe(false);
    }
  });

  it('keeps a denial on an artifact in a granted space, and lists only the granted spaces as readable', () => {
    const denied: AccessGrant = {
      id: 'grant-2',
      role: { id: 'role-reader', name: 'Reader', permissions: ['read'] },
      subject: { principal: ALICE },
      level: { kind: 'artifact', id: DOSING },
      effect: 'deny',
      expiresAt: null,
    };
    expect(decide('read', facts(inClinical, support(), [denied]))).toMatchObject({
      allowed: false,
      reason: 'denied',
    });
    expect(
      readableSet({
        principal: { id: ALICE, kind: 'external' },
        groups: [],
        spaces: [CLINICAL, QUALITY],
        artifacts: new Map([[DOSING, CLINICAL]]),
        grants: [denied],
        now: NOW,
        externalCapDays: 90,
        support: support(),
      }),
    ).toEqual({ tenant: false, spaces: [CLINICAL], excluded: [DOSING], included: [] });
  });

  it('ADM-022 reaches content only from a content grant, and metadata from a metadata or content one', () => {
    expect(supportReaches('diagnostics', 'none')).toBe(true);
    expect(supportReaches('diagnostics', 'metadata')).toBe(false);
    expect(supportReaches('metadata', 'metadata')).toBe(true);
    expect(supportReaches('metadata', 'content')).toBe(false);
    expect(supportReaches('content', 'content')).toBe(true);
  });
});
