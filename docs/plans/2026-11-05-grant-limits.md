# Grant limits

One PR. Closes the hole [identity.md](../design/identity.md) names: a narrower role that keeps `administer` can
grant itself anything, so the high-risk permissions (IAM-070) are no boundary for whoever holds it.

## Calls

As [ADR-0091](../decisions/0091-nobody-gives-an-administrative-permission-they-do-not-hold.md) has them, which the pre-flight changed:

- **GL-A** the limit covers `administrativePermissions` alone, since Administrator holds no content permission.
- **GL-B** "holds" is `administerOrAbove`, at the level the change stands at, scopes included.
- **GL-C** adding is limited, allow or deny: a grant, a role, a service identity's token scopes.
- **GL-D** a group holding more than its maker is not theirs to change at all. Removing a direct allow stays open; removing a denial is limited.
- **GL-E** extending is not limited: only an external allow is extended, and `externalCap` holds every administrative permission.
- **GL-F** out: provider groups and SCIM, a share's fixed role and CT Studio's Author (neither holds one), restoring (`import_environment`'s own).
- **GL-G** 403 `grant_beyond_held`, naming the permissions in the message, the first recorded as the refusal.
- **GL-H** the last holder stays: `grant_last_holder`, `group_last_holder`, `principal_last_holder`. With giving limited, a stranded permission could never come back.
- **GL-I** enabling and erasing are limited by what the person holds. Disabling stays open.
- **GL-J** a token cannot grant Administrator, since three of its permissions are never token scopes.

## Interfaces

- `packages/domain/src/access/decide.ts`: `beyondHolding(permissions, facts): readonly Decision[]`, the refusal of
  each administrative permission in `permissions` not held. Pure.
- `packages/db/src/grant-limits.ts`: `groupGrantsInForce`, `principalAllowsInForce`, `grantInForce`, `lastHolderRemains`.
- `apps/service/src/grant-limits.ts`: `refuseBeyondHolding(permissions, facts, target)`, and
  `refuseBeyondHoldingAt(trx, authorised, grants)`, loading facts at each grant's level.
- Called first in `makeGrant`, `createRole`, `removeGrant`, `setGroupMembers`, `deleteGroup`, `enablePerson`,
  `erasePrincipal` and `issueServiceIdentityToken`.

## Tests

Domain: `beyondHolding` ignores a content permission; answers an administrative one not held; honours a holder
above a denial; a token's scope masks it.

Routes, a role of `read`, `administer` as Bob, with no ID in a title since no requirement says this:

- refuses granting Administrator to himself, directly, and at a space; refuses granting it to a group
- refuses a deny of a role he could not allow
- lets him grant Author, and a role of `read`, `administer`
- refuses making a role holding `close_environment`; lets him make one holding `edit`
- refuses joining a group holding Administrator, at the tenant or a space; lets him join one holding Author
- lets him remove an allow of Administrator; refuses removing a deny of it
- refuses a member leaving, or deleting, a group holding it; lets him set one of content
- refuses enabling or erasing somebody holding it; refuses a service identity a token for it
- refuses removing or disabling the last holder
- ignores a group's expired grant
- an Administrator does all of it; a token scoped `administer` alone is refused Administrator
- the refusal reaches the audit log; the code is `grant_beyond_held`

## Docs

`identity.md`'s paragraph; the Keycloak guide's warning; `features.md` and `README.md`; an ADR for GL-A and GL-D,
with its index row; regenerate `openapi.json` and the client; one fragment. No requirement says this today: raise
one with Ken rather than citing around it.
