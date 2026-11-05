# 0091 - Nobody gives an administrative permission they do not hold

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

A narrower role keeping `administer` was no boundary: whoever held it could grant themselves Administrator,
so the high-risk permissions split out of `administer` (IAM-070) bound nobody who could grant. TL raised the
stakes, since closing a tenant now ends in deleting it. Ken chose to limit grants to what their maker holds on
5 November 2026, leaving removing a grant open. [The plan](../plans/2026-11-05-grant-limits.md) has the detail.

## Decision

1. **The limit covers `administrativePermissions` alone.** Administrator holds no `edit`, `publish` or
   `write_sql`, by design, and must still give them. So somebody with `administer` can still give themselves
   Author: content is not what this protects.
2. **"Holds" is `administerOrAbove`,** the rule those permissions are decided by, token scopes included.
3. **Adding is limited, allow or deny:** a grant, a role made, a service identity's token scopes.
4. **A group holding more than its maker is not theirs to change,** in any way: joining, leaving or deleting it.
5. **Removing a direct allow stays open.** Removing a denial gives back what it denied, so it is limited.
6. **Enabling a person, and erasing one, are limited** by the allows they hold, directly or through a group.
   Disabling stays open, so that a narrower administrator can stop a compromised account.
7. **The last holder of an administrative permission stays:** with giving limited, nobody could ever give it
   again, and the operator's way back refuses while anybody administers. `grant_last_holder` and
   `principal_last_holder` count direct and group holders who can sign in, with no expiry.
8. **A token cannot grant Administrator,** since three permissions it holds are never token scopes. That takes a
   session.

Existing grants are not touched. Provider groups and SCIM stay out, trusted as the provider is
([identity.md](../design/identity.md)).

## What would change the answer

A role that must hand out a permission without being able to use it. A real need for a token to grant
Administrator. A way for the operator to give a stranded permission back, which would let the last-holder guard go.

## Consequences

A narrower administrator can be told apart from an Administrator, and Administration can offer a People manager.
They can still remove an Administrator's direct grant while somebody else holds it, as Ken chose. The role list
still offers roles the caller cannot give, and the service refuses them. No requirement says any of this yet.
