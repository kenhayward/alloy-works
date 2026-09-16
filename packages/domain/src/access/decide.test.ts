import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { permissions } from './permissions.js';

const ADA = '00000000-0000-4000-8000-00000000a0da';
const GRACE = '00000000-0000-4000-8000-0000000062ac';
const EDITORS = '00000000-0000-4000-8000-00000000ed17';
const OUTSIDERS = '00000000-0000-4000-8000-00000000057d';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };

const NOW = new Date('2026-09-16T12:00:00Z');

const roles = {
  reader: { id: 'role-reader', name: 'Reader', permissions: ['read'] },
  author: { id: 'role-author', name: 'Author', permissions: ['read', 'create', 'edit'] },
  administrator: { id: 'role-admin', name: 'Administrator', permissions: ['read', 'administer'] },
  designer: { id: 'role-designer', name: 'Designer', permissions: ['read', 'design'] },
  definitions: {
    id: 'role-definitions',
    name: 'Definitions manager',
    permissions: ['read', 'manage_definitions'],
  },
} satisfies Record<string, AccessGrant['role']>;

let sequence = 0;
function grant(
  role: AccessGrant['role'],
  level: Level,
  effect: 'allow' | 'deny' = 'allow',
  subject: AccessGrant['subject'] = { principal: ADA },
  expiresAt: Date | null = null,
): AccessGrant {
  sequence += 1;
  return { id: `grant-${sequence}`, role, subject, level, effect, expiresAt };
}

function facts(
  grants: readonly AccessGrant[],
  chain: readonly Level[] = [artifact, space, tenant],
) {
  return {
    principal: { id: ADA, kind: 'user' },
    groups: [EDITORS],
    chain,
    grants,
    now: NOW,
  } satisfies AccessFacts;
}

describe('deciding, level by level', () => {
  it('inherits a grant at the tenant down to a space and to an artifact in it', () => {
    const atTenant = [grant(roles.author, tenant)];
    for (const chain of [[tenant], [space, tenant], [artifact, space, tenant]]) {
      const decision = decide('edit', facts(atTenant, chain));
      expect(decision).toMatchObject({ allowed: true, reason: 'allowed', level: tenant });
      expect(decision.checked).toEqual(chain);
    }
  });

  it('leaves an author reading an artifact where a role without read is denied to them', () => {
    const editing = { id: 'role-editing', name: 'Editing', permissions: ['edit'] } as const;
    const readOnly = facts([grant(roles.author, space), grant(editing, artifact, 'deny')]);
    expect(decide('edit', readOnly)).toMatchObject({
      allowed: false,
      reason: 'denied',
      level: artifact,
    });
    expect(decide('read', readOnly)).toMatchObject({ allowed: true, level: space });
    expect(decide('create', readOnly)).toMatchObject({ allowed: true, level: space });
    expect(decide('edit', facts(readOnly.grants, [space, tenant])).allowed).toBe(true);
  });

  it('denies read too when the role denied holds it', () => {
    const denied = facts([grant(roles.author, space), grant(roles.author, artifact, 'deny')]);
    expect(decide('read', denied)).toMatchObject({
      allowed: false,
      reason: 'denied',
      level: artifact,
    });
  });

  it('IAM-025 lets an explicit grant or denial below override what that level inherits', () => {
    const denied = decide(
      'edit',
      facts([grant(roles.author, tenant), grant(roles.author, space, 'deny')]),
    );
    expect(denied).toMatchObject({ allowed: false, reason: 'denied', level: space });

    const opened = decide(
      'read',
      facts([grant(roles.reader, space, 'deny'), grant(roles.reader, artifact)]),
    );
    expect(opened).toMatchObject({ allowed: true, reason: 'allowed', level: artifact });
  });

  it('IAM-026 lets a denial win over an allow at the same level, directly or through a group', () => {
    for (const [allowTo, denyTo] of [
      [{ principal: ADA }, { principal: ADA }],
      [{ principal: ADA }, { group: EDITORS }],
      [{ group: EDITORS }, { principal: ADA }],
      [{ group: EDITORS }, { group: EDITORS }],
    ] as const) {
      const allow = grant(roles.author, space, 'allow', allowTo);
      const deny = grant(roles.author, space, 'deny', denyTo);
      const decision = decide('edit', facts([allow, deny], [space, tenant]));
      expect(decision).toMatchObject({ allowed: false, reason: 'denied', level: space });
      expect(decision.grants.map((reached) => reached.id)).toEqual([deny.id]);
    }
  });

  it('decides at the nearest level that says anything, for every combination at three levels', () => {
    const states = ['none', 'allow', 'deny', 'both'] as const;
    const levels = [artifact, space, tenant];
    for (const atArtifact of states) {
      for (const atSpace of states) {
        for (const atTenant of states) {
          const said = [atArtifact, atSpace, atTenant];
          const grants = said.flatMap((state, index) => {
            const level = levels[index]!;
            return [
              ...(state === 'allow' || state === 'both' ? [grant(roles.author, level)] : []),
              ...(state === 'deny' || state === 'both'
                ? [grant(roles.author, level, 'deny', { group: EDITORS })]
                : []),
            ];
          });
          const nearest = said.findIndex((state) => state !== 'none');
          const decision = decide('edit', facts(grants));
          const label = said.join(' ');
          if (nearest === -1) {
            expect(decision, label).toMatchObject({
              allowed: false,
              reason: 'not_granted',
              level: null,
            });
            expect(decision.grants, label).toEqual([]);
            continue;
          }
          const denies = said[nearest] === 'deny' || said[nearest] === 'both';
          expect(decision, label).toMatchObject({
            allowed: !denies,
            reason: denies ? 'denied' : 'allowed',
            level: levels[nearest],
          });
          expect(decision.grants.length, label).toBe(1);
          expect(
            decision.grants.every((reached) => reached.effect === (denies ? 'deny' : 'allow')),
            label,
          ).toBe(true);
        }
      }
    }
  });

  it('reads only grants whose role holds the permission asked about', () => {
    const decision = decide(
      'edit',
      facts([grant(roles.reader, artifact), grant(roles.author, space)]),
    );
    expect(decision).toMatchObject({ allowed: true, level: space });

    const denial = decide(
      'edit',
      facts([grant(roles.reader, artifact, 'deny'), grant(roles.author, space)]),
    );
    expect(denial).toMatchObject({ allowed: true, level: space });
  });

  it('names every grant that decided at the level, and whether it came through a group', () => {
    const direct = grant(roles.author, space);
    const throughGroup = grant(roles.author, space, 'allow', { group: EDITORS });
    const decision = decide('edit', facts([direct, throughGroup, grant(roles.author, tenant)]));
    expect(decision.grants).toEqual([
      { ...direct, through: null },
      { ...throughGroup, through: EDITORS },
    ]);
  });

  it('refuses when nothing grants it, naming every level it looked at', () => {
    const decision = decide('publish', facts([grant(roles.author, tenant)]));
    expect(decision).toEqual({
      permission: 'publish',
      allowed: false,
      reason: 'not_granted',
      level: null,
      grants: [],
      checked: [artifact, space, tenant],
    });
  });

  it("ignores another principal's grant, a group's the principal is not in, and an expired one", () => {
    const decision = decide(
      'edit',
      facts([
        grant(roles.author, artifact, 'allow', { principal: GRACE }),
        grant(roles.author, artifact, 'allow', { group: OUTSIDERS }),
        grant(roles.author, space, 'allow', { principal: ADA }, NOW),
        grant(roles.author, space, 'allow', { principal: ADA }, new Date(NOW.getTime() - 1)),
      ]),
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'not_granted' });

    const current = decide(
      'edit',
      facts([grant(roles.author, space, 'allow', { principal: ADA }, new Date(NOW.getTime() + 1))]),
    );
    expect(current).toMatchObject({ allowed: true, level: space });
  });

  it('never lets one permission imply another, administer included', () => {
    const administrator = facts([grant(roles.administrator, tenant)]);
    expect(permissions.filter((permission) => decide(permission, administrator).allowed)).toEqual([
      'read',
      'administer',
    ]);
  });
});

describe('where the walk starts', () => {
  it('MET-024 decides manage_definitions at the tenant, held without administer or design', () => {
    const managed = facts([grant(roles.definitions, tenant)]);
    const decision = decide('manage_definitions', managed);
    expect(decision).toMatchObject({ allowed: true, level: tenant, checked: [tenant] });
    expect(decide('administer', managed).allowed).toBe(false);
    expect(decide('design', managed).allowed).toBe(false);

    const belowTenant = facts([
      grant(roles.definitions, space),
      grant(roles.definitions, artifact),
    ]);
    expect(decide('manage_definitions', belowTenant)).toMatchObject({
      allowed: false,
      reason: 'not_granted',
      checked: [tenant],
    });
    expect(decide('manage_definitions', facts([grant(roles.administrator, tenant)])).allowed).toBe(
      false,
    );
    expect(decide('manage_definitions', facts([grant(roles.designer, tenant)])).allowed).toBe(
      false,
    );
  });

  it('decides create at the space, never at an artifact', () => {
    const decision = decide(
      'create',
      facts([grant(roles.author, artifact, 'deny'), grant(roles.author, space)]),
    );
    expect(decision).toMatchObject({ allowed: true, level: space, checked: [space, tenant] });

    const definition = decide('create', facts([grant(roles.author, tenant)], [artifact, tenant]));
    expect(definition).toMatchObject({ allowed: true, level: tenant, checked: [tenant] });
  });

  it('decides design and administer of the target itself', () => {
    const design = facts([grant(roles.designer, artifact, 'deny'), grant(roles.designer, space)]);
    expect(decide('design', design)).toMatchObject({ allowed: false, level: artifact });
    expect(decide('design', facts(design.grants, [space, tenant]))).toMatchObject({
      allowed: true,
      level: space,
    });

    const administer = facts([grant(roles.administrator, space)], [space, tenant]);
    expect(decide('administer', administer)).toMatchObject({ allowed: true, level: space });
    expect(decide('administer', facts(administer.grants, [tenant])).allowed).toBe(false);
  });

  it('refuses a chain that does not run from its target up to the tenant', () => {
    expect(() => decide('read', facts([], []))).toThrow(/ends at the tenant/);
    expect(() => decide('read', facts([], [space]))).toThrow(/ends at the tenant/);
    expect(() => decide('read', facts([], [space, artifact, tenant]))).toThrow(/nearest first/);
    expect(() => decide('read', facts([], [tenant, tenant]))).toThrow(/nearest first/);
  });
});
