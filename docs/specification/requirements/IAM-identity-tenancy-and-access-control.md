# IAM - Identity, tenancy and access control

> **Status: v1, for review.**

## 1. Purpose

Who somebody is, which customer they belong to, and what they are allowed to do. This area owns the
tenant boundary, federation with a customer's identity provider, the permission model and its
inheritance, and the service identities that API and MCP callers use.

It is the area where a defect is a breach rather than a bug, and it is written accordingly: several
requirements below say how something must be enforced rather than only what must be true, because
"the application checks" is the failure mode this area exists to prevent.

## 2. Depends on

| Rests on                                                 | What it fixes                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.14, §11 | Tenant and space; the permission levels; the security posture                       |
| Scope §9 decision 2                                      | The service is the system of record, so the renderer is never the enforcement point |

| Not here                                                      | There   |
| ------------------------------------------------------------- | ------- |
| Workflow gates and electronic signature                       | **LIF** |
| Which identity a query runs as, and connection secrets        | **DAT** |
| Creating and administering spaces, users and roles day to day | **ADM** |
| The token a machine presents, and how the API describes it    | **API** |
| What a mode of access looks like on screen                    | **CNT** |

## 3. Tenancy

| ID          | Requirement                                                                                                                                                                                                               | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-001** | Every artifact must belong to exactly one tenant, and no artifact may be shared between tenants                                                                                                                           | Constraint | Specified |
| **IAM-002** | Tenant isolation must be enforced at the data layer, not by application code remembering to add a filter                                                                                                                  | Constraint | Specified |
| **IAM-003** | The tenant a request acts within must be derived from the authenticated session, and never from a parameter the caller supplies                                                                                           | Constraint | Specified |
| **IAM-004** | Every read and write path must be covered by a test that attempts access from a second tenant and is refused                                                                                                              | T1         | Specified |
| **IAM-005** | Search indexes, caches, secrets, model endpoints, publications and the audit log must each be tenant-scoped, not only the content                                                                                         | T1         | Specified |
| **IAM-006** | Deleting a tenant must render everything it owns unreadable on a stated timetable, and that timetable must be verifiable                                                                                                  | T3         | Specified |
| **IAM-052** | A customer must be able to hold several tenants - production, a sandbox, a validation environment - grouped by an organisation that shares billing, administration and identity provider configuration, and never content | T1         | Specified |
| **IAM-053** | Each tenant must be reachable at its own hostname, two-level names such as an environment under a customer's name included, and a customer's own domain must be addable without a code change                             | T1         | Specified |

**IAM-002 and IAM-003 are written as enforcement rather than intent on purpose.** Multi-tenant
leakage is named in scope §13 as one of the two most likely sources of a serious breach, and it never
arrives as a decision to skip a check - it arrives as one query out of four hundred where the
`WHERE` clause was forgotten. A boundary that depends on remembering is not a boundary.

## 4. Identity

| ID          | Requirement                                                                                                                                                                                                                                       | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-007** | A tenant must be able to federate authentication with its own identity provider over OIDC                                                                                                                                                         | T1         | Specified |
| **IAM-008** | Users should be provisioned and de-provisioned by SCIM where the customer supports it, with a documented manual path where they do not                                                                                                            | T2         | Specified |
| **IAM-009** | Group membership asserted by the identity provider must be mappable to roles, so that access follows the customer's own directory                                                                                                                 | T1         | Specified |
| **IAM-010** | A user disabled at the identity provider must lose access without waiting for a token to expire                                                                                                                                                   | T1         | Specified |
| **IAM-011** | A tenant must be able to federate with more than one identity provider, because contractors and acquisitions do not share a directory                                                                                                             | T2         | Specified |
| **IAM-012** | Authentication must be re-assertable within a session, so that a signing act can require it (**LIF** owns when)                                                                                                                                   | T3         | Specified |
| **IAM-013** | Every authentication, and every authorisation that resulted in a refusal, must be recorded in the audit log (**LIF** owns the log)                                                                                                                | T1         | Specified |
| **IAM-041** | A tenant with no identity provider configured must be able to authenticate its users by Google account, so that an evaluation or a small deployment works before any federation exists                                                            | T1         | Specified |
| **IAM-042** | The product must never store, reset or transmit a password. There must be no local credential of any kind, for any user, including an administrator                                                                                               | Constraint | Specified |
| **IAM-043** | A tenant must declare which authentication routes it permits - its own provider, Google accounts, or both - and must be able to close a route once it no longer needs it                                                                          | T1         | Specified |
| **IAM-054** | A tenant accepting Google accounts must say who may enter by that route - the addresses it has invited, and any Google Workspace domains it names - because any Google account can authenticate, and authenticating must never be enough to enter | T1         | Specified |
| **IAM-044** | Only basic identity scopes may be requested from an account provider - `openid`, `email` and `profile` - and a scope that is sensitive or restricted must never be requested                                                                      | Constraint | Specified |

**IAM-042 is the requirement that must not erode.** A single "temporary" local password, added once
for an administrator who could not wait for federation, brings back a password store, reset flows,
multi-factor enrolment, a breach surface and an assessor's questions - none of which this product
otherwise has to answer for. IAM-041 exists so that nobody ever has a reason to ask, and IAM-044
keeps the Google route inside the basic identity scopes, which is what keeps the product out of app
verification. See [ADR-0009](../../decisions/0009-federation-and-google-accounts-no-local-passwords.md).

## 5. Spaces

| ID          | Requirement                                                                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **IAM-014** | A space must belong to exactly one tenant, and must be the primary unit of access control below it                                                                 | T1      | Specified |
| **IAM-015** | Content must be movable between spaces within a tenant, and moving it must re-evaluate its permissions rather than carrying the old ones                           | T2      | Specified |
| **IAM-016** | A component in one space must be referenceable from a document in another only where the referring user may read it                                                | T4      | Specified |
| **IAM-017** | That permission must be re-checked when the document is published, not only when the reference was created, because access changes and publication is what escapes | T4      | Specified |

**IAM-017 is the quiet one.** A reference created while somebody had access outlives their access. If
permission is checked only at insert, a document silently keeps publishing content its readers were
later forbidden - and nothing in the interface would ever say so.

## 6. Permissions

| ID          | Requirement                                                                                                                           | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **IAM-018** | Permissions must be declarable at tenant, space, template, document and component level                                               | T1      | Specified |
| **IAM-019** | The permission set must cover at least: read, create, edit, comment, suggest, approve, publish and administer                         | T1      | Specified |
| **IAM-020** | The right to see a data connection's results must be separately grantable from the right to read the document containing them         | T2      | Specified |
| **IAM-021** | A role must be a named bundle of permissions, definable by a tenant rather than fixed by the product                                  | T1      | Specified |
| **IAM-022** | A role must be assignable to a group as well as to an individual                                                                      | T1      | Specified |
| **IAM-023** | The modes of access in CNT-104 must derive from these permissions, so that a mode a user cannot have is a mode they are never offered | T1      | Specified |

**IAM-020 exists because a bound value can be more sensitive than the document around it.** A site
report may be widely readable while the figures behind one of its tables are not. Without a separate
right, the only way to protect the numbers is to protect the whole report, and people work around
that by copying numbers into a document that has no binding at all - which is the behaviour this
product exists to stop.

## 7. Inheritance

| ID          | Requirement                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-024** | Permissions must inherit down the hierarchy in section 6                                                   | T1         | Specified |
| **IAM-025** | An explicit grant or denial at any level must override what that level inherits                            | T1         | Specified |
| **IAM-026** | Where a grant and a denial apply at the same level, the denial must win                                    | Constraint | Specified |
| **IAM-027** | Inheritance must be computed at the point of the decision, never copied downwards when a permission is set | Constraint | Specified |
| **IAM-028** | Moving an artifact must recompute its effective permissions rather than carrying the ones it had           | T2         | Specified |

**IAM-027 is the difference between a permission model and a permission incident.** Copying
inherited permissions downwards makes every later change at the top a migration, and the failure is
silent: a space is locked down and the documents inside it keep the access they were granted a year
ago.

## 8. Effective permissions

| ID          | Requirement                                                                                                     | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **IAM-029** | An administrator must be able to see, for any user and any artifact, exactly what that user may do              | T1      | Specified |
| **IAM-030** | That view must name the grant that produced each answer and the level it came from, rather than only the answer | T1      | Specified |
| **IAM-031** | The same must be true of a refusal: why a user may **not** do something must be as answerable as why they may   | T1      | Specified |
| **IAM-032** | An administrator must be able to evaluate permissions as another user without assuming their identity           | T2      | Specified |

**Section 8 is a requirement of the model, not a convenience.** Scope §7.14 says an inherited
permission system without this is unusable in practice and unauditable in principle, and both halves
are true: support cannot answer "why can they see this" by reading a table, and an auditor will not
accept "the system computed it".

## 9. Machine identity

| ID          | Requirement                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-033** | Service identities must be distinct from user identities, and must not be created by impersonating a person                            | T1         | Specified |
| **IAM-034** | A token must carry explicit scopes and an expiry, and must be issuable with less than the full authority of whoever created it         | T1         | Specified |
| **IAM-035** | A token must be revocable with immediate effect                                                                                        | T1         | Specified |
| **IAM-036** | An API or MCP caller must act with the permissions of the calling identity, and must have no path to exceeding them (**API**, **GEN**) | Constraint | Specified |
| **IAM-037** | Token issue, use and revocation must be recorded in the audit log                                                                      | T1         | Specified |

**IAM-036 is where this area meets the AI one.** Scope §7.6 says the assistant's tool use is
constrained by the calling user's permissions and never by anything the content asks for. That
guarantee is enforced here or nowhere: a model that can be talked into calling a tool must still be
calling it as somebody, and that somebody's permissions are what stop the conversation mattering.

## 10. Sessions

| ID          | Requirement                                                                                         | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------- | ------- | --------- |
| **IAM-038** | Session lifetime and idle timeout must be configurable per tenant                                   | T2      | Specified |
| **IAM-039** | Signing out must invalidate the session everywhere it is active, not only in the browser that asked | T1      | Specified |
| **IAM-040** | A user must be able to see their own active sessions and end any of them                            | T3      | Specified |

## 11. External participation

| ID          | Requirement                                                                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-045** | A principal must be markable as external to the tenant, and must be shown as external everywhere they appear - in presence, on a thread, on a suggestion and in an administrator's listings | T4         | Specified |
| **IAM-046** | An external principal must authenticate by the routes IAM-041 and IAM-043 already allow, and must never be issued a credential of any kind by the product                                   | Constraint | Specified |
| **IAM-047** | An external principal must be able to read, comment and suggest, and must never be able to edit content, pass a lifecycle gate, sign, or publish                                            | Constraint | Specified |
| **IAM-048** | External access must be granted against named spaces or documents through the permission model in section 6, never by a status that opens the tenant                                        | Constraint | Specified |
| **IAM-049** | External access must carry an expiry, which a tenant policy defaults and caps, and which cannot be left unset                                                                               | Constraint | Specified |
| **IAM-050** | Extending external access must be a positive act by somebody inside the tenant, and must be audited                                                                                         | T4         | Specified |
| **IAM-051** | An administrator must be able to list every external principal in the tenant and everything each can reach, which is IAM-029 asked from the other end                                       | T4         | Specified |

**IAM-049 is the requirement that earns its place from other people's mistakes.** Guest access leaks
the same way in every product that offers it: somebody left the client firm, nobody told the host,
and the account is still good two years later. An expiry that a tenant may leave empty is an expiry
that is empty, so the requirement is that it cannot be. See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md).

**IAM-047 draws the line at authority rather than at usefulness.** A suggestion is inert until an
author inside the tenant accepts it, which is exactly what makes it safe to give away. Signing is
not, because LIF's signing acts assume a signer whom the asserting organisation has identity-proofed,
and a guest is somebody the tenant has invited rather than somebody it can vouch for.

## 12. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-N01** | **Not an identity provider.** Authentication federates to the customer's provider, or to a Google account where the tenant has none. The product holds no password (IAM-042)                                                                                                                        |
| **IAM-N02** | **No permission finer than a component.** A component is the unit of reuse and of review; permissions inside one would have to travel with it into every document that uses it                                                                                                                      |
| **IAM-N03** | **No sharing between tenants.** An outsider participates as a guest principal inside the host tenant (section 11), never as a bridge between two. Cross-tenant sharing is deferred rather than refused - see [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) |
| **IAM-N04** | **No enforcement in the renderer.** The renderer is untrusted in both deliveries; what it hides is presentation, and the service refuses regardless                                                                                                                                                 |

## 13. Open questions

| ID          | Question                                                                                                                                                                                                                                                                                                                                | What would settle it                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IAM-Q01** | **Pure federation, or a first-party identity provider with federation as an option?**                                                                                                                                                                                                                                                   | **Settled.** Federation, plus Google-authenticated accounts where a tenant has no provider yet, and never a local password. See [ADR-0009](../../decisions/0009-federation-and-google-accounts-no-local-passwords.md)                |
| **IAM-Q02** | **Is the component really the finest useful grain (IAM-N02)?** Section-level permission is asked for in regulated submissions, where one annex has a narrower readership than its report                                                                                                                                                | A customer requirement that cannot be met by putting the annex in its own space                                                                                                                                                      |
| **IAM-Q03** | **Is there anonymous or link-based read for a published artifact?**                                                                                                                                                                                                                                                                     | **Settled.** Link-based, never anonymous: a publication is shared to a named recipient who proves who they are once (PUB-057 to PUB-060). See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) |
| **IAM-Q04** | **How does cross-tenant collaboration work, if at all?**                                                                                                                                                                                                                                                                                | **Settled for now.** Guest principals inside the host tenant, and true cross-tenant sharing deferred until customers' clients become customers themselves. See %s                                                                    |
| **IAM-Q05** | **What happens to a guest's attribution when their access is revoked?** Their comments and accepted suggestions are part of the audited record of how the document reached its wording, and a name that vanishes from a five-year-old baseline is the failure this specification keeps finding. An erasure request points the other way | Legal advice on where attribution in an audited record sits against a right to erasure, which is a question about the regime rather than about the product                                                                           |
| **IAM-Q06** | **Is the same human guesting for three tenants three unrelated principals?** ADR-0008 implies yes, and a shared directory across tenants would be a convenience that quietly crosses the isolation boundary                                                                                                                             | Whether a guest ever needs to see their work across tenants in one place, which nobody has yet asked for                                                                                                                             |

**IAM-Q03 and IAM-Q04 were the two most likely to force a change here, and they did.** Both came
from the same place: this market's documents are written by one organisation for another, and a model
assuming everyone who touches a document works for the tenant that owns it was never going to be the
one customers need. Section 11 is what replaced it. What is left open is smaller and sharper - what a
revoked guest leaves behind, and whether one person guesting in several places is one record or
several.

## 14. Traceability

| This document | Rests on                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 3     | Scope §11 security; §13 names multi-tenant leakage as a top-two risk                                                                                        |
| IAM-020       | Scope §7.14, the separately grantable right to see a connection's results                                                                                   |
| Section 8     | Scope §7.14, "why can this person do this"                                                                                                                  |
| IAM-036       | Scope §7.6, tool use bound by the calling user's permissions                                                                                                |
| IAM-023       | CNT-104 to CNT-106, the three modes of access                                                                                                               |
| IAM-N04       | Scope §9 decision 2 and §11, the renderer is untrusted                                                                                                      |
| Section 11    | [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) - IAM-001 holds, and an outsider is a principal rather than a bridge |
