import { describe, expect, it } from 'vitest';

import {
  describeInvitation,
  explainAnswer,
  isExplainedPermission,
  isShownGrant,
  isShownGroup,
  isShownInvitation,
  isShownPerson,
  isShownRole,
  placesFor,
  refusalMessage,
  type ExplainedPermission,
  type Place,
  type ShownPerson,
} from './describe.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const GENERAL = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const GRACE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

const places: readonly Place[] = placesFor(
  { kind: 'component', id: COMPONENT },
  { id: GENERAL, name: 'General' },
);
const people = new Map<string, ShownPerson>([
  [GRACE, { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user', invited: false }],
]);

const validGrant = {
  id: 'g1',
  role: { id: 'r1', name: 'Author' },
  subject: { principal: { id: GRACE, name: 'Grace', email: 'grace@example.test' } },
  level: `artifact:${COMPONENT}`,
  effect: 'allow' as const,
  expiresAt: null,
};

const validPermission: ExplainedPermission = {
  permission: 'edit',
  allowed: true,
  reason: 'allowed',
  level: `artifact:${COMPONENT}`,
  checked: [`artifact:${COMPONENT}`],
  grants: [
    {
      role: 'Author',
      effect: 'allow',
      subject: { principal: GRACE },
      through: null,
      groupName: null,
    },
  ],
};

/** Every key but `key`, built from the entries rather than assigned onto a copy. */
const omit = (object: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(object).filter(([each]) => each !== key));

describe('isShownGrant', () => {
  it('accepts a grant shaped as the service sends one', () => {
    expect(isShownGrant(validGrant)).toBe(true);
  });

  it('refuses a grant with no role, rather than let describeGrant throw on it', () => {
    expect(isShownGrant(omit(validGrant, 'role'))).toBe(false);
  });

  it('refuses a grant whose expiresAt is missing rather than null', () => {
    expect(isShownGrant(omit(validGrant, 'expiresAt'))).toBe(false);
  });

  it('refuses anything that is not an object shaped like a grant', () => {
    expect(isShownGrant(null)).toBe(false);
    expect(isShownGrant('a grant')).toBe(false);
  });
});

describe('isShownPerson and isShownRole', () => {
  it('accepts a person with no name, addressed by email, invited and not yet signed in', () => {
    expect(
      isShownPerson({
        id: GRACE,
        name: null,
        email: 'grace@example.test',
        kind: 'user',
        invited: true,
      }),
    ).toBe(true);
  });

  it('refuses a person of a kind the service never documented, or not saying whether invited', () => {
    expect(
      isShownPerson({ id: GRACE, name: 'Grace', email: null, kind: 'robot', invited: false }),
    ).toBe(false);
    expect(isShownPerson({ id: GRACE, name: 'Grace', email: null, kind: 'user' })).toBe(false);
  });

  it('accepts a role with its permissions', () => {
    expect(isShownRole({ id: 'r1', name: 'Author', permissions: ['read', 'edit'] })).toBe(true);
  });

  it('refuses a role whose permissions are not all text', () => {
    expect(isShownRole({ id: 'r1', name: 'Author', permissions: ['read', 3] })).toBe(false);
  });
});

describe('isShownGroup', () => {
  const group = {
    id: 'e1',
    name: 'Authors',
    source: 'tenant',
    providerValue: null,
    members: [{ id: GRACE, name: 'Grace', email: null }],
  };

  it('accepts a group shaped as the service lists one, of either source', () => {
    expect(isShownGroup(group)).toBe(true);
    expect(isShownGroup({ ...group, source: 'provider', providerValue: 'authors' })).toBe(true);
  });

  it('refuses a group of a source the service never documented, or whose members are not people', () => {
    expect(isShownGroup({ ...group, source: 'directory' })).toBe(false);
    expect(isShownGroup({ ...group, members: [GRACE] })).toBe(false);
    expect(isShownGroup(omit(group, 'providerValue'))).toBe(false);
  });
});

describe('an invitation', () => {
  const waiting = {
    id: 'i1',
    email: 'ivy@example.test',
    person: GRACE,
    external: false,
    expiresAt: '2026-10-01T09:00:00.000Z',
    lapsed: false,
    acceptedAt: null,
  };

  it('is accepted only in the shape the service lists one', () => {
    expect(isShownInvitation(waiting)).toBe(true);
    expect(isShownInvitation({ ...waiting, lapsed: 'no' })).toBe(false);
    expect(isShownInvitation({ ...waiting, person: null })).toBe(false);
  });

  it('reads as its address, whether from outside the organisation, and until when', () => {
    expect(describeInvitation(waiting)).toBe('ivy@example.test, until 2026-10-01');
    expect(describeInvitation({ ...waiting, external: true, lapsed: true })).toBe(
      'ivy@example.test, from outside the organisation, lapsed: invite them again to renew it',
    );
    expect(describeInvitation({ ...waiting, expiresAt: null })).toBe('ivy@example.test');
  });
});

describe('isExplainedPermission', () => {
  it('accepts a permission shaped as the service answers one', () => {
    expect(isExplainedPermission(validPermission)).toBe(true);
  });

  it('accepts a permission refused to the token a request was made with, as the service documents it', () => {
    expect(isExplainedPermission({ ...validPermission, allowed: false, reason: 'scoped' })).toBe(
      true,
    );
  });

  it('refuses a permission whose reason the service never documented', () => {
    expect(isExplainedPermission({ ...validPermission, reason: 'mystery' })).toBe(false);
  });

  it('refuses a permission whose grants are missing, rather than let the page crash reading them', () => {
    expect(
      isExplainedPermission(omit(validPermission as unknown as Record<string, unknown>, 'grants')),
    ).toBe(false);
  });

  it('refuses a grant that does not say the name of the group it came through, or says it as other than text', () => {
    const grant = validPermission.grants[0]!;
    expect(
      isExplainedPermission({
        ...validPermission,
        grants: [omit(grant as unknown as Record<string, unknown>, 'groupName')],
      }),
    ).toBe(false);
    expect(
      isExplainedPermission({ ...validPermission, grants: [{ ...grant, groupName: 7 }] }),
    ).toBe(false);
  });
});

describe('placesFor', () => {
  const space = { id: GENERAL, name: 'General' };

  it('is the artifact, its space and the environment, for a component, a document and a template', () => {
    for (const kind of ['component', 'document', 'template'] as const) {
      expect(placesFor({ kind, id: COMPONENT }, space)).toEqual([
        { target: `artifact:${COMPONENT}`, label: `This ${kind}`, named: `this ${kind}` },
        { target: `space:${GENERAL}`, label: 'The space General', named: 'the space General' },
        { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
      ]);
    }
  });

  it('is the space and the environment for a space, and the environment alone for the environment', () => {
    expect(placesFor({ kind: 'space', id: GENERAL, name: 'General' })).toEqual([
      { target: `space:${GENERAL}`, label: 'The space General', named: 'the space General' },
      { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
    ]);
    expect(placesFor({ kind: 'tenant' })).toEqual([
      { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
    ]);
  });
});

describe('refusalMessage', () => {
  it("reads a refusal body's message when it is text", () => {
    expect(refusalMessage({ code: 'grant_duplicate', message: 'Already granted.' })).toBe(
      'Already granted.',
    );
  });

  it('answers null, not the wrong type, when the message is not text', () => {
    expect(refusalMessage({ code: 'grant_duplicate', message: 42 })).toBeNull();
    expect(refusalMessage(null)).toBeNull();
  });
});

describe('explainAnswer', () => {
  it('names a grant made to a group by the group, and one made to the person by the person', () => {
    const answer: ExplainedPermission = {
      ...validPermission,
      level: `space:${GENERAL}`,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { principal: GRACE },
          through: null,
          groupName: null,
        },
        {
          role: 'Author',
          effect: 'allow',
          subject: { group: 'e1' },
          through: 'e1',
          groupName: 'Authors',
        },
      ],
    };
    expect(explainAnswer(answer, places, people)).toBe(
      'Allowed at the space General, by Author allowed to Grace; Author allowed to the group Authors.',
    );
  });

  it('names the group a grant reached someone through, when the grant itself was made to that person', () => {
    const answer: ExplainedPermission = {
      ...validPermission,
      level: `space:${GENERAL}`,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { principal: GRACE },
          through: 'e1',
          groupName: 'Authors',
        },
      ],
    };
    expect(explainAnswer(answer, places, people)).toBe(
      'Allowed at the space General, by Author allowed to Grace through the group Authors.',
    );
  });

  it('says "a group" only where the service could not name it', () => {
    const answer: ExplainedPermission = {
      ...validPermission,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { group: 'e1' },
          through: 'e1',
          groupName: null,
        },
      ],
    };
    expect(explainAnswer(answer, places, people)).toBe(
      'Allowed at this component, by Author allowed to a group.',
    );
  });

  it('says a permission the grants allow was refused because the API token is not scoped to it', () => {
    const answer: ExplainedPermission = {
      ...validPermission,
      allowed: false,
      reason: 'scoped',
      level: `space:${GENERAL}`,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { principal: GRACE },
          through: null,
          groupName: null,
        },
      ],
    };
    expect(explainAnswer(answer, places, people)).toBe(
      'Not allowed by this token: its scopes leave it out, though Author allowed to Grace at the space General would allow it.',
    );
  });

  it('answers a fixed sentence for a reason the service never documented, rather than an empty Why', () => {
    const answer = { ...validPermission, reason: 'mystery' } as unknown as ExplainedPermission;
    expect(explainAnswer(answer, places, people)).toBe('This answer could not be explained.');
  });
});
