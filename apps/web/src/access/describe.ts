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
  readonly reason: 'allowed' | 'denied' | 'not_granted' | 'capped';
  readonly level: string | null;
  readonly checked: readonly string[];
  readonly grants: readonly {
    readonly role: string;
    readonly effect: 'allow' | 'deny';
    readonly subject: { readonly principal: string } | { readonly group: string };
    readonly through: string | null;
  }[];
}

/** A level access is managed at, for one component: how a target is spelled, and how it is said. */
export interface Place {
  readonly target: string;
  /** As a heading: "This component". */
  readonly label: string;
  /** Inside a sentence: "this component". */
  readonly named: string;
}

/** The component, its space and the environment: every level a grant reaching it can be made at. */
export function placesFor(component: {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
}): Place[] {
  return [
    { target: `artifact:${component.id}`, label: 'This component', named: 'this component' },
    {
      target: `space:${component.space.id}`,
      label: `The space ${component.space.name}`,
      named: `the space ${component.space.name}`,
    },
    { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
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
    (value.kind === 'user' || value.kind === 'service' || value.kind === 'external')
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
    value.reason !== 'capped'
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
    return true;
  });
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
      const person = 'principal' in reached.subject ? people.get(reached.subject.principal) : null;
      const who = 'group' in reached.subject ? 'a group' : person ? personName(person) : 'a person';
      // Naming who it reached "through a group" only makes sense when the grant is to a person: a
      // grant already made to a group is not reached "through" anything, whatever `through` holds.
      const through =
        'principal' in reached.subject && reached.through !== null ? ' through a group' : '';
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
    default:
      // Only reachable from a body this page did not validate as an ExplainedPermission: a defensive
      // fallback, not a state the service is expected to send.
      return 'This answer could not be explained.';
  }
}
