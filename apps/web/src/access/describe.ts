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
      const through = reached.through === null ? '' : ' through a group';
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
  }
}
