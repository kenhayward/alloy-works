/**
 * The shapes below are the service's, written out rather than taken from `@alloy-works/api-client`:
 * that package's built declarations do not carry its generated types, so a type named from them is
 * `any` in the renderer and would check nothing here.
 */

/** A grant as `GET /v1/grants` lists it. */
export interface ShownGrant {
  readonly id: string;
  readonly role: { readonly id: string; readonly name: string };
  readonly subject:
    | {
        readonly principal: {
          readonly id: string;
          readonly name: string | null;
          readonly email: string | null;
        };
      }
    | { readonly group: { readonly id: string; readonly name: string } };
  readonly level: string;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: string | null;
}

/** A person as `GET /v1/principals` lists one. */
export interface ShownPerson {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly kind: 'user' | 'service' | 'external';
  /** Invited by address, and not yet signed in. */
  readonly invited: boolean;
}

/** An invitation as `GET /v1/invitations` lists it, with the members this page reads. */
export interface ShownInvitation {
  readonly id: string;
  readonly email: string;
  readonly person: string;
  readonly external: boolean;
  readonly expiresAt: string | null;
  readonly lapsed: boolean;
  readonly acceptedAt: string | null;
}

/** A group as `GET /v1/groups` lists one. */
export interface ShownGroup {
  readonly id: string;
  readonly name: string;
  /** `tenant`: the environment's own, its members named here. `provider`: the sign-in's to fill. */
  readonly source: 'tenant' | 'provider';
  /** The value of the organisation's sign-in claim it stands for; null for the environment's own. */
  readonly providerValue: string | null;
  readonly members: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  }[];
}

/** A role as `GET /v1/roles` lists one. */
export interface ShownRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** One permission as `GET /v1/access/explain` answers it. */
export interface ExplainedPermission {
  readonly permission: string;
  readonly allowed: boolean;
  readonly reason: 'allowed' | 'denied' | 'not_granted' | 'capped' | 'scoped';
  readonly level: string | null;
  readonly checked: readonly string[];
  readonly grants: readonly {
    readonly role: string;
    readonly effect: 'allow' | 'deny';
    readonly subject: { readonly principal: string } | { readonly group: string };
    readonly through: string | null;
    /** The name of the group it came through; null for a grant made to the person. */
    readonly groupName: string | null;
  }[];
}

/**
 * What the Access panel is opened on (access.md, GP-E): an artifact of any kind, a space, or the
 * whole environment. A space is named by whoever opens it, since it is chosen from a list of them.
 */
export type AccessAt =
  | { readonly kind: 'component' | 'document' | 'template' | 'connection'; readonly id: string }
  | { readonly kind: 'space'; readonly id: string; readonly name: string }
  | { readonly kind: 'tenant' };

/** How an access target is spelled to the service: `artifact:<id>`, `space:<id>` or `tenant`. */
export function targetOf(at: AccessAt): string {
  if (at.kind === 'tenant') return 'tenant';
  if (at.kind === 'space') return `space:${at.id}`;
  return `artifact:${at.id}`;
}

/** A level access is managed at: how a target is spelled, and how it is said. */
export interface Place {
  readonly target: string;
  /** As a heading: "This component". */
  readonly label: string;
  /** Inside a sentence: "this component". */
  readonly named: string;
}

const spacePlace = (space: { readonly id: string; readonly name: string }): Place => ({
  target: `space:${space.id}`,
  label: `The space ${space.name}`,
  named: `the space ${space.name}`,
});

const TENANT: Place = {
  target: 'tenant',
  label: 'The whole environment',
  named: 'the whole environment',
};

/**
 * Every level a grant reaching what the panel is opened on can be made at, nearest first: an
 * artifact, the space it is in, and the environment; a space and the environment; or the environment.
 */
export function placesFor(
  at: AccessAt,
  space?: { readonly id: string; readonly name: string },
): Place[] {
  if (at.kind === 'tenant') return [TENANT];
  if (at.kind === 'space') return [spacePlace(at), TENANT];
  if (space === undefined) throw new Error('An artifact is placed in its space');
  return [
    { target: `artifact:${at.id}`, label: `This ${at.kind}`, named: `this ${at.kind}` },
    spacePlace(space),
    TENANT,
  ];
}

/** A person by name, by address when they have no name, and never as a bare identifier. */
export function personName(person: {
  readonly name: string | null;
  readonly email: string | null;
}): string {
  return person.name ?? person.email ?? 'Someone with no name or address';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A grant exactly as the service sends one, checked rather than assumed: the client's response body
 * is `any` in the renderer (see the note above), so a page that read it as a `ShownGrant` without
 * checking would crash on the first field the service left out or spelled differently.
 */
export function isShownGrant(value: unknown): value is ShownGrant {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  const role = value.role;
  if (!isRecord(role) || typeof role.id !== 'string' || typeof role.name !== 'string') return false;
  const subject = value.subject;
  if (!isRecord(subject)) return false;
  const principal = subject.principal;
  const group = subject.group;
  const principalOk =
    isRecord(principal) &&
    typeof principal.id === 'string' &&
    (principal.name === null || typeof principal.name === 'string') &&
    (principal.email === null || typeof principal.email === 'string');
  const groupOk = isRecord(group) && typeof group.id === 'string' && typeof group.name === 'string';
  if (!principalOk && !groupOk) return false;
  if (typeof value.level !== 'string') return false;
  if (value.effect !== 'allow' && value.effect !== 'deny') return false;
  if (value.expiresAt !== null && typeof value.expiresAt !== 'string') return false;
  return true;
}

/** A person exactly as `GET /v1/principals` lists one, checked rather than assumed. */
export function isShownPerson(value: unknown): value is ShownPerson {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.name === null || typeof value.name === 'string') &&
    (value.email === null || typeof value.email === 'string') &&
    (value.kind === 'user' || value.kind === 'service' || value.kind === 'external') &&
    typeof value.invited === 'boolean'
  );
}

/** An invitation exactly as `GET /v1/invitations` lists one, checked rather than assumed. */
export function isShownInvitation(value: unknown): value is ShownInvitation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.person === 'string' &&
    typeof value.external === 'boolean' &&
    (value.expiresAt === null || typeof value.expiresAt === 'string') &&
    typeof value.lapsed === 'boolean' &&
    (value.acceptedAt === null || typeof value.acceptedAt === 'string')
  );
}

/**
 * A waiting invitation as a line: "ivy@example.com, until 2026-10-01", saying when it is from outside
 * the organisation, and "lapsed" rather than a date nobody can still accept it by.
 */
export function describeInvitation(invitation: ShownInvitation): string {
  const outside = invitation.external ? ', from outside the organisation' : '';
  const until = invitation.lapsed
    ? ', lapsed: invite them again to renew it'
    : invitation.expiresAt === null
      ? ''
      : `, until ${invitation.expiresAt.slice(0, 10)}`;
  return `${invitation.email}${outside}${until}`;
}

/** A group exactly as `GET /v1/groups` lists one, checked rather than assumed. */
export function isShownGroup(value: unknown): value is ShownGroup {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.source === 'tenant' || value.source === 'provider') &&
    (value.providerValue === null || typeof value.providerValue === 'string') &&
    Array.isArray(value.members) &&
    value.members.every(
      (member) =>
        isRecord(member) &&
        typeof member.id === 'string' &&
        (member.name === null || typeof member.name === 'string') &&
        (member.email === null || typeof member.email === 'string'),
    )
  );
}

/** A role exactly as `GET /v1/roles` lists one, checked rather than assumed. */
export function isShownRole(value: unknown): value is ShownRole {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.permissions) &&
    value.permissions.every((each) => typeof each === 'string')
  );
}

/** One permission exactly as `GET /v1/access/explain` answers it, checked rather than assumed. */
export function isExplainedPermission(value: unknown): value is ExplainedPermission {
  if (!isRecord(value)) return false;
  if (typeof value.permission !== 'string') return false;
  if (typeof value.allowed !== 'boolean') return false;
  if (
    value.reason !== 'allowed' &&
    value.reason !== 'denied' &&
    value.reason !== 'not_granted' &&
    value.reason !== 'capped' &&
    value.reason !== 'scoped'
  ) {
    return false;
  }
  if (value.level !== null && typeof value.level !== 'string') return false;
  if (!Array.isArray(value.checked) || !value.checked.every((each) => typeof each === 'string')) {
    return false;
  }
  if (!Array.isArray(value.grants)) return false;
  return value.grants.every((grant) => {
    if (!isRecord(grant)) return false;
    if (typeof grant.role !== 'string') return false;
    if (grant.effect !== 'allow' && grant.effect !== 'deny') return false;
    if (!isRecord(grant.subject)) return false;
    if (typeof grant.subject.principal !== 'string' && typeof grant.subject.group !== 'string') {
      return false;
    }
    if (grant.through !== null && typeof grant.through !== 'string') return false;
    if (grant.groupName !== null && typeof grant.groupName !== 'string') return false;
    return true;
  });
}

/** The caller's own answer for every permission on a target, as `GET /v1/access` sends it. */
export interface AccessAnswers {
  readonly target: string;
  readonly permissions: readonly { readonly permission: string; readonly allowed: boolean }[];
}

/** `GET /v1/access`'s body exactly as the service sends it, checked rather than assumed. */
export function isAccessAnswers(value: unknown): value is AccessAnswers {
  if (!isRecord(value) || typeof value.target !== 'string') return false;
  if (!Array.isArray(value.permissions)) return false;
  return value.permissions.every(
    (each) =>
      isRecord(each) && typeof each.permission === 'string' && typeof each.allowed === 'boolean',
  );
}

/** A refusal body's message, when the service sent readable text and not some other shape. */
export function refusalMessage(error: unknown): string | null {
  return isRecord(error) && typeof error.message === 'string' ? error.message : null;
}

/** One grant as a line in a listing: "Allowed Author to Grace", and when it ends if it does. */
export function describeGrant(grant: ShownGrant): string {
  const who =
    'principal' in grant.subject
      ? personName(grant.subject.principal)
      : `the group ${grant.subject.group.name}`;
  const until = grant.expiresAt === null ? '' : ` until ${grant.expiresAt.slice(0, 10)}`;
  return `${grant.effect === 'allow' ? 'Allowed' : 'Denied'} ${grant.role.name} to ${who}${until}`;
}

/** A permission as a person reads it: `manage_definitions` is "manage definitions". */
export function permissionName(permission: string): string {
  return permission.replaceAll('_', ' ');
}

/**
 * Why a permission was answered as it was, in one sentence (access.md, "Deciding"): the level that
 * decided and every grant that did - role, effect, who it names and whether it reached them through a
 * group - or, where nothing granted it, every level that was looked at.
 */
export function explainAnswer(
  answer: ExplainedPermission,
  places: readonly Place[],
  people: ReadonlyMap<string, ShownPerson>,
): string {
  const where = (target: string) =>
    places.find((place) => place.target === target)?.named ?? target;
  const grants = answer.grants
    .map((reached) => {
      // A group by its name (IAM-030), and "a group" only where the service could not name it.
      const group = reached.groupName === null ? 'a group' : `the group ${reached.groupName}`;
      const person = 'principal' in reached.subject ? people.get(reached.subject.principal) : null;
      const who = 'group' in reached.subject ? group : person ? personName(person) : 'a person';
      // Naming the group it reached them "through" only makes sense when the grant is to a person: a
      // grant already made to a group names that group, whatever `through` holds.
      const through =
        'principal' in reached.subject && reached.through !== null ? ` through ${group}` : '';
      const effect = reached.effect === 'allow' ? 'allowed' : 'denied';
      return `${reached.role} ${effect} to ${who}${through}`;
    })
    .join('; ');
  switch (answer.reason) {
    case 'allowed':
      return `Allowed at ${where(answer.level!)}, by ${grants}.`;
    case 'denied':
      return `Refused at ${where(answer.level!)}, by ${grants}.`;
    case 'not_granted':
      return `Refused: nothing grants it at ${answer.checked.map(where).join(', ')}.`;
    case 'capped':
      return 'Refused: someone from outside the organisation may never have it, whatever is granted.';
    case 'scoped':
      return `Not allowed by this token: its scopes leave it out, though ${grants} at ${where(answer.level!)} would allow it.`;
    default:
      // Only reachable from a body this page did not validate as an ExplainedPermission: a defensive
      // fallback, not a state the service is expected to send.
      return 'This answer could not be explained.';
  }
}
