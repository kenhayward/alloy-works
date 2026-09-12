# IAM - Identity, tenancy and access control

> **Status: v1, reviewed.**

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
| [`Project_Scope.md`](../Project_Scope.md) §9 decision 2  | The service is the system of record, so the renderer is never the enforcement point |

| Not here                                                      | There   |
| ------------------------------------------------------------- | ------- |
| Workflow gates and electronic signature                       | **LIF** |
| Which identity a query runs as, and connection secrets        | **DAT** |
| Creating and administering spaces, users and roles day to day | **ADM** |
| The token a machine presents, and how the API describes it    | **API** |
| What a mode of access looks like on screen                    | **CNT** |

### Terms this document uses normatively

Three words below carry weight and were not defined anywhere a reader of this document would find
them. Two are defined elsewhere and are cross-referenced; two are defined here because nothing else
defines them.

| Term                  | Meaning                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Artifact**          | Anything the product stores that has an identity, an owner and a permission of its own: a component, a document, an asset, a query definition, a template, a baseline, a publication. Used corpus-wide; defined here because nothing else does it |
| **Principal**         | Anything that can be authenticated and can hold permissions: a user, an external principal (section 11), or a service identity (section 9). Not a synonym for user - the difference is the point of sections 9 and 11                             |
| **Tenant**, **space** | As [`Project_Scope.md`](../Project_Scope.md) §6 defines them, under "The container hierarchy"                                                                                                                                                     |
| **Template**          | As [`Project_Scope.md`](../Project_Scope.md) §6 defines it, under "Definition artifacts": a binding artifact that composes the six definitions and owns none of them. **TPL** owns it                                                             |

## 3. Tenancy

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-001** | Every artifact must belong to exactly one tenant, and no artifact may be shared between tenants                                                                                                                                                                                                                                                                                                                                                          | Constraint | Specified |
| **IAM-002** | Tenant isolation must be enforced at the data layer, not by application code remembering to add a filter: a schema per tenant, and a database role assumed for the duration of one transaction ([ADR-0008](../../decisions/0008-schema-per-tenant-isolation.md), [ADR-0020](../../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md))                                                                                             | Constraint | Specified |
| **IAM-003** | The tenant a request acts within must be derived from the authenticated session, and never from a parameter the caller supplies                                                                                                                                                                                                                                                                                                                          | Constraint | Specified |
| **IAM-004** | Every read and write path must be covered by a test that attempts access from a second tenant and is refused                                                                                                                                                                                                                                                                                                                                             | T1         | Specified |
| **IAM-005** | Search indexes, caches, secrets, model endpoints, publications and the audit log must each be tenant-scoped, not only the content                                                                                                                                                                                                                                                                                                                        | T1         | Specified |
| **IAM-066** | IAM-005's list must be read as examples of one rule: every second copy, derived representation or outbound payload of tenant content must be tenant-scoped and permissioned like the content it derives from. That includes search indexes, caches, embeddings and vectors, asset derivatives, export artifacts, notification messages and digests, webhook payloads, audit exports and backups, and every path must be covered by a test like IAM-004's | Constraint | Specified |
| **IAM-006** | Deleting a tenant must render everything it owns unreadable on a stated timetable, and that timetable must be verifiable                                                                                                                                                                                                                                                                                                                                 | T3         | Specified |
| **IAM-052** | A customer must be able to hold several tenants - production, a sandbox, a validation environment - grouped by an organisation that shares billing, administration and identity provider configuration, and never content                                                                                                                                                                                                                                | T1         | Specified |
| **IAM-053** | Each tenant must be reachable at its own hostname, two-level names such as an environment under a customer's name included, and a customer's own domain must be addable without a code change                                                                                                                                                                                                                                                            | T1         | Specified |
| **IAM-058** | The timetable in IAM-006 must be a stated number of days from the deletion becoming irreversible to everything the tenant owns being unreadable, published to tenants in advance, and proven by a test rather than asserted. It is the same clock as the grace period in **ADM-030** (**IAM-Q08**)                                                                                                                                                       | T3         | Specified |

**IAM-066 generalises a list that was becoming a checklist of whatever anybody had thought of.**
IAM-005 names six stores; the product makes at least a dozen kinds of second copy, and each new one -
an embedding, a digest email, a webhook payload, a backup - would otherwise have needed its own
amendment here to be covered. The rule is the thing to state, and the list is what it applies to.

**IAM-002's backing existed and was not cited, which review was right to call out.**
[ADR-0008](../../decisions/0008-schema-per-tenant-isolation.md) chose a schema per tenant over a
shared table with a discriminator, and it names IAM-002 as the requirement it answers;
[ADR-0020](../../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) adds the
second half, that every database access assumes the tenant's role for one transaction. "Data layer"
was doing a lot of work in one sentence, and the two builds review distinguished - row-level security
in a shared database, or a schema each - were decided a year before this document was written. The
citation now says so.

**IAM-058 answers "which timetable" by finding it already exists elsewhere.** ADM-030 requires a
declared grace period before a closed tenant's data is deleted, and ADM-Q06 asks how long it runs.
That is this timetable seen from the administrative end; two numbers would be one too many, so
IAM-Q08 points at ADM-Q06 rather than opening a second question.

**IAM-002 and IAM-003 are written as enforcement rather than intent on purpose.** Multi-tenant
leakage is named in scope §13 as one of the two most likely sources of a serious breach, and it never
arrives as a decision to skip a check - it arrives as one query out of four hundred where the
`WHERE` clause was forgotten. A boundary that depends on remembering is not a boundary.

## 4. Identity

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-007** | A tenant must be able to federate authentication with its own identity provider over OIDC                                                                                                                                                                                                                                                                                                                                                    | T1         | Specified |
| **IAM-008** | Users should be provisioned and de-provisioned by SCIM where the customer supports it, with a documented manual path where they do not                                                                                                                                                                                                                                                                                                       | T2         | Specified |
| **IAM-009** | Group membership asserted by the identity provider must be mappable to roles, so that access follows the customer's own directory                                                                                                                                                                                                                                                                                                            | T1         | Specified |
| **IAM-010** | A user disabled at the identity provider must lose access without waiting for a token to expire                                                                                                                                                                                                                                                                                                                                              | T1         | Specified |
| **IAM-011** | A tenant must be able to federate with more than one identity provider, because contractors and acquisitions do not share a directory                                                                                                                                                                                                                                                                                                        | T2         | Specified |
| **IAM-012** | Authentication must be re-assertable within a session, so that a signing act can require it (**LIF** owns when)                                                                                                                                                                                                                                                                                                                              | T3         | Specified |
| **IAM-013** | Every authentication, and every authorisation that resulted in a refusal, must be recorded in the audit log (**LIF** owns the log)                                                                                                                                                                                                                                                                                                           | T1         | Specified |
| **IAM-041** | A tenant with no identity provider configured must be able to authenticate its users by Google account, so that an evaluation or a small deployment works before any federation exists                                                                                                                                                                                                                                                       | T1         | Specified |
| **IAM-042** | The product must never store, reset or transmit a password. There must be no local credential of any kind, for any user, including an administrator                                                                                                                                                                                                                                                                                          | Constraint | Specified |
| **IAM-043** | A tenant must declare which authentication routes it permits - its own provider, Google accounts, or both - and must be able to close a route once it no longer needs it                                                                                                                                                                                                                                                                     | T1         | Specified |
| **IAM-054** | A tenant accepting Google accounts must say who may enter by that route - the addresses it has invited, and any Google Workspace domains it names - because any Google account can authenticate, and authenticating must never be enough to enter                                                                                                                                                                                            | T1         | Specified |
| **IAM-044** | Only basic identity scopes may be requested from an account provider - `openid`, `email` and `profile` - and a scope that is sensitive or restricted must never be requested                                                                                                                                                                                                                                                                 | Constraint | Specified |
| **IAM-055** | A session or a token must be checkable against current state on every request, so that a disablement (IAM-010) or a revocation (IAM-035) takes effect at the next request rather than at the next expiry. A long-lived bearer token whose validity cannot be established without asking its issuer must not be the only credential a caller holds (**IAM-Q07**)                                                                              | Constraint | Specified |
| **IAM-056** | A change to a user's group membership at the identity provider must take effect within a stated bound: applied on receipt where the provider pushes it (IAM-008), and otherwise re-read at a declared interval and at every re-authentication. The bound must be stated and tested, not left to whenever a token happens to be renewed                                                                                                       | T2         | Specified |
| **IAM-064** | Where a tenant's identity provider is unreachable, or its signing keys cannot be fetched or verified, authentication must fail closed. A cached assertion must never outlive the session it authenticated, and no route may open because another is unavailable (**IAM-Q09**)                                                                                                                                                                | Constraint | Specified |
| **IAM-065** | Signing-key rotation at a provider must be picked up without a manual step, and a key that cannot be resolved must refuse the authentication rather than accept an assertion it cannot verify                                                                                                                                                                                                                                                | T2         | Specified |
| **IAM-067** | Signing out (IAM-039) or revoking a token (IAM-035) must stop further authorised data flowing on any connection already open, within a stated bound, and must not wait for that connection to end. A connection that cannot be terminated must stop delivering and must surface an authentication failure rather than continuing quietly                                                                                                     | Constraint | Specified |
| **IAM-068** | An organisation (IAM-052) must have administrators of its own, and organisation-level acts - creating a tenant, suspending one, changing the identity-provider configuration the organisation shares - must be permissioned through roles and audited into both the organisation's record and the affected tenant's own log                                                                                                                  | T3         | Specified |
| **IAM-069** | An organisation administrator must see only administrative metadata about its tenants - existence, state, configuration, usage and cost - and never their content. The tenant boundary (IAM-001) is not weakened by the grouping above it                                                                                                                                                                                                    | Constraint | Specified |
| **IAM-070** | The permission model must name high-risk administrative acts separately from `administer`, each grantable through a role and explainable in the effective-permission view (IAM-029 to IAM-031): whole-tenant export, audit-log export, applying and releasing a legal hold, initiating suspension or closure, granting support access, rotating a secret, configuring an external service, and configuring webhooks or notification channels | T2         | Specified |
| **IAM-059** | The first administrator of a new tenant must arrive by an invitation to a named address, authenticated by a route IAM-043 permits, and must never be created by a local credential (IAM-042) or by a vendor account that outlives the bootstrap (**ADM-Q04**)                                                                                                                                                                                | Constraint | Specified |
| **IAM-060** | Bootstrapping a tenant must be audited into that tenant's own log: who invited the first administrator, when, under what authority, and when the vendor's part in it ended                                                                                                                                                                                                                                                                   | T1         | Specified |
| **IAM-061** | No standing vendor access may remain after bootstrap. Any later vendor action inside a tenant must go through the support-access path that the tenant grants, bounds and can revoke (**ADM-022** to **ADM-025**)                                                                                                                                                                                                                             | Constraint | Specified |

**IAM-055 makes two requirements buildable that were otherwise only sincere.** "Loses access
without waiting for a token to expire" (IAM-010) and "revocable with immediate effect" (IAM-035) each
rule out a design rather than describing one: a long-lived signed token that any service can verify
alone is exactly the thing that cannot be withdrawn. Saying so is what stops the convenient
implementation being chosen and the requirement being marked met. What the check costs, and where it
lives, is **IAM-Q07** and owes an architecture decision.

**IAM-056 removes an asymmetry review spotted and nobody would have noticed in code.** A disabled
user loses access at once; a user moved out of a group kept it until something happened to renew a
token. Both are the customer's directory saying somebody may no longer do something, and a product
that honours one urgently and the other eventually has picked the easier half.

**IAM-059 to IAM-061 close the gap where backdoors get built.** Before a tenant has an
administrator, somebody has to make one, and the expedient answer - a vendor account, a seeded
password, a flag in a configuration file - is how a product acquires a credential IAM-042 says it
does not have. The route is an invitation to a named address, authenticated the way everybody else
authenticates, audited into the tenant's own log, and over when it is over. **ADM-Q04** asks who
performs that act; this area fixes what the act may consist of, which is the half that becomes a
breach.

**IAM-064 and IAM-065 state a posture rather than leaving it to a library's default.** An identity
provider that is down is a bad afternoon; an identity provider that is down and a product that
accepts a stale assertion to be helpful is an incident. Failing closed is the answer, and whether a
tenant may buy a grace window at their own risk is **IAM-Q09**.

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

| ID          | Requirement                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-018** | Permissions must be declarable at tenant, space, template, document and component level                                                                                                                                                       | T1         | Specified |
| **IAM-019** | The permission set must cover at least: read, create, edit, comment, suggest, approve, publish and administer                                                                                                                                 | T1         | Specified |
| **IAM-020** | The right to see a data connection's results must be separately grantable from the right to read the document containing them                                                                                                                 | T2         | Specified |
| **IAM-021** | A role must be a named bundle of permissions, definable by a tenant rather than fixed by the product                                                                                                                                          | T1         | Specified |
| **IAM-022** | A role must be assignable to a group as well as to an individual                                                                                                                                                                              | T1         | Specified |
| **IAM-023** | The modes of access in CNT-104 must derive from these permissions, so that a mode a user cannot have is a mode they are never offered                                                                                                         | T1         | Specified |
| **IAM-062** | Every permission must be held through a role. A grant binds a role to a principal or to a group at one level of IAM-018; no principal may hold a permission outside a role, so that IAM-030 can always name the grant that produced an answer | Constraint | Specified |

**IAM-070 stops `administer` becoming an unexamined superpower.** One permission covering
everything from adding a user to exporting the tenant and releasing a legal hold gives a regulated
customer no way to separate the compliance officer from the person who manages spaces - and those are
different people in every organisation that has both. Naming the high-risk acts does not fix a role
list; it makes one possible.

**IAM-062 settles a choice the model had left to whoever built it.** IAM-021 defined a role and
IAM-025 spoke of explicit grants, which between them admitted two different systems: one where every
permission arrives through a role, and one where a role is a convenience over per-user grants that
can also be made directly. Sections 7 and 8 only work in the first. "Name the grant that produced
each answer" (IAM-030) is answerable when a grant is always role-to-principal-at-a-level, and turns
into an archaeology exercise when a permission can also have been set on one person one afternoon.

**IAM-020 exists because a bound value can be more sensitive than the document around it.** A site
report may be widely readable while the figures behind one of its tables are not. Without a separate
right, the only way to protect the numbers is to protect the whole report, and people work around
that by copying numbers into a document that has no binding at all - which is the behaviour this
product exists to stop.

## 7. Inheritance

| ID          | Requirement                                                                                                                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-024** | Permissions must inherit down the hierarchy in section 6                                                                                                                                                                               | T1         | Specified |
| **IAM-025** | An explicit grant or denial at any level must override what that level inherits                                                                                                                                                        | T1         | Specified |
| **IAM-026** | Where a grant and a denial apply at the same level, the denial must win                                                                                                                                                                | Constraint | Specified |
| **IAM-027** | Inheritance must be computed at the point of the decision, never copied downwards when a permission is set                                                                                                                             | Constraint | Specified |
| **IAM-028** | Moving an artifact must recompute its effective permissions rather than carrying the ones it had                                                                                                                                       | T2         | Specified |
| **IAM-063** | A permission decision and the action it authorises must be taken as one unit, so that access cannot change between the check and the act. Where they cannot be atomic, the action must re-check at the point of effect and fail closed | Constraint | Specified |

**IAM-063 closes the window IAM-027 opens.** Computing at the point of decision is right, and it
leaves a gap between deciding and doing that a revocation can fall into - the smaller the window the
more convincing the argument for ignoring it, which is how it stays open. The mechanism belongs to
the service's architecture; that the window must be closed belongs here, because it is an access
guarantee rather than an implementation preference.

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

| ID          | Requirement                                                                                                                                                                                                                         | Tranche    | Status                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **IAM-045** | A principal must be markable as external to the tenant, and must be shown as external everywhere they appear - in presence, on a thread, on a suggestion and in an administrator's listings                                         | T4         | Specified             |
| **IAM-046** | An external principal must authenticate by the routes IAM-041 and IAM-043 already allow, and must never be issued a credential of any kind by the product                                                                           | Constraint | Specified             |
| **IAM-047** | An external principal must be able to read, comment and suggest, and must never be able to edit content, pass a lifecycle gate, sign, or publish                                                                                    | Constraint | Specified             |
| **IAM-048** | External access must be granted against named spaces or documents through the permission model in section 6, never by a status that opens the tenant                                                                                | Constraint | Superseded by IAM-071 |
| **IAM-049** | External access must carry an expiry, which a tenant policy defaults and caps, and which cannot be left unset                                                                                                                       | Constraint | Specified             |
| **IAM-050** | Extending external access must be a positive act by somebody inside the tenant, and must be audited                                                                                                                                 | T4         | Specified             |
| **IAM-051** | An administrator must be able to list every external principal in the tenant and everything each can reach, which is IAM-029 asked from the other end                                                                               | T4         | Specified             |
| **IAM-071** | External access must be granted against named artifacts - a space, a document, or a single publication (**PUB-084**) - through the permission model in section 6, never by a status that opens the tenant                           | Constraint | Specified             |
| **IAM-057** | The cap in IAM-047 must override the permission model: a role that would give an external principal edit, approve, sign or publish must be refused at the point of assignment, and must have no effect if such an assignment exists | Constraint | Specified             |

**IAM-049 is the requirement that earns its place from other people's mistakes.** Guest access leaks
the same way in every product that offers it: somebody left the client firm, nobody told the host,
and the account is still good two years later. An expiry that a tenant may leave empty is an expiry
that is empty, so the requirement is that it cannot be. See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md).

**IAM-057 says which rule wins, because two of them met and neither yielded.** IAM-047 caps an
external principal at read, comment and suggest; IAM-048 grants their access through the section 6
model, which contains edit. The intended reading was always that the cap wins, and an implementer
satisfying IAM-048 by handing a guest a role with edit would have been satisfying the document as
written. Refusing the assignment rather than only refusing the action matters: an administrator who
can create the state will believe it works.

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
| **IAM-N05** | **No permission outside a role** (IAM-062). A grant binds a role to a principal or a group at a level; there is no per-user permission set beside it, because section 8 could not explain one                                                                                                       |
| **IAM-N06** | **No vendor account inside a tenant** once it is bootstrapped (IAM-061). Support reaches a tenant through access that tenant granted, bounded and can revoke (**ADM-023**), and by no other route                                                                                                   |

## 13. Open questions

| ID          | Question                                                                                                                                                                                                                                                                                                                                | What would settle it                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-Q01** | **Pure federation, or a first-party identity provider with federation as an option?**                                                                                                                                                                                                                                                   | **Settled.** Federation, plus Google-authenticated accounts where a tenant has no provider yet, and never a local password. See [ADR-0009](../../decisions/0009-federation-and-google-accounts-no-local-passwords.md)                                 |
| **IAM-Q02** | **Is the component really the finest useful grain (IAM-N02)?** Section-level permission is asked for in regulated submissions, where one annex has a narrower readership than its report                                                                                                                                                | A customer requirement that cannot be met by putting the annex in its own space                                                                                                                                                                       |
| **IAM-Q03** | **Is there anonymous or link-based read for a published artifact?**                                                                                                                                                                                                                                                                     | **Settled.** Link-based, never anonymous: a publication is shared to a named recipient who proves who they are once (PUB-057 to PUB-060). See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md)                  |
| **IAM-Q04** | **How does cross-tenant collaboration work, if at all?**                                                                                                                                                                                                                                                                                | **Settled for now.** Guest principals inside the host tenant, and true cross-tenant sharing deferred until customers' clients become customers themselves. See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) |
| **IAM-Q05** | **What happens to a guest's attribution when their access is revoked?** Their comments and accepted suggestions are part of the audited record of how the document reached its wording, and a name that vanishes from a five-year-old baseline is the failure this specification keeps finding. An erasure request points the other way | Legal advice on where attribution in an audited record sits against a right to erasure, which is a question about the regime rather than about the product                                                                                            |
| **IAM-Q06** | **Is the same human guesting for three tenants three unrelated principals?** ADR-0008 implies yes, and a shared directory across tenants would be a convenience that quietly crosses the isolation boundary                                                                                                                             | Whether a guest ever needs to see their work across tenants in one place, which nobody has yet asked for                                                                                                                                              |
| **IAM-Q07** | **What makes IAM-010 and IAM-035 immediate, and what does the check cost?** Short-lived tokens with refresh, an introspection call per request, or a revocation list each buy immediacy at a different price, and the answer constrains every service the product ever has                                                              | An architecture decision, which this one owes and does not yet have. IAM-055 states the property the answer must have                                                                                                                                 |
| **IAM-Q08** | **How many days is the timetable in IAM-006 and IAM-058?**                                                                                                                                                                                                                                                                              | **ADM-Q06**, which asks the same question from the administrative end. One clock, one number, one answer                                                                                                                                              |
| **IAM-Q09** | **May a tenant buy a grace window for an identity provider outage (IAM-064)?** Failing closed is correct and means an outage at the provider is an outage of the product                                                                                                                                                                | A customer with an availability expectation that collides with failing closed, and a view on whether that risk is theirs to accept                                                                                                                    |

**IAM-Q03 and IAM-Q04 were the two most likely to force a change here, and they did.** Both came
from the same place: this market's documents are written by one organisation for another, and a model
assuming everyone who touches a document works for the tenant that owns it was never going to be the
one customers need. Section 11 is what replaced it. What is left open is smaller and sharper - what a
revoked guest leaves behind, and whether one person guesting in several places is one record or
several.

## 14. Traceability

| This document      | Rests on                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 3          | Scope §11 security; §13 names multi-tenant leakage as a top-two risk                                                                                                                                                  |
| IAM-020            | Scope §7.14, the separately grantable right to see a connection's results                                                                                                                                             |
| Section 8          | Scope §7.14, "why can this person do this"                                                                                                                                                                            |
| IAM-036            | Scope §7.6, tool use bound by the calling user's permissions                                                                                                                                                          |
| IAM-023            | CNT-104 to CNT-106, the three modes of access                                                                                                                                                                         |
| IAM-N04            | Scope §9 decision 2 and §11, the renderer is untrusted                                                                                                                                                                |
| Section 11         | [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) - IAM-001 holds, and an outsider is a principal rather than a bridge                                                           |
| IAM-002            | [ADR-0008](../../decisions/0008-schema-per-tenant-isolation.md), [ADR-0020](../../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) - a schema per tenant, and a role assumed per transaction |
| IAM-058            | ADM-030 and ADM-Q06 - the same clock, seen from the administrative end                                                                                                                                                |
| IAM-059 to IAM-061 | ADM-Q04 asks who bootstraps a tenant; ADM-022 to ADM-025 own support access                                                                                                                                           |
| IAM-055 to IAM-065 | [The v1 review](<../../reviews/IAM - Identity, tenancy and access control.md>); section 15                                                                                                                            |

## 15. Change history

One row per change, against
[the review](<../../reviews/IAM - Identity, tenancy and access control.md>) that prompted it. The
rules for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Ambiguities and defects

| Point                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normative terms are undefined locally     | A terms table in section 2. **Artifact** and **principal** are defined here because nothing else defines them; **tenant**, **space** and **template** are cross-referenced to the scope section that does                                                                                                                                                                                                                                         |
| IAM-002 cites no backing                  | **It had backing and did not cite it.** [ADR-0008](../../decisions/0008-schema-per-tenant-isolation.md) chose a schema per tenant - naming IAM-002 as the requirement it answers - and [ADR-0020](../../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) adds the role assumed per transaction. Both are now cited in the requirement. The two builds review distinguished were decided before this document was written |
| IAM-010 and IAM-035 cite no backing       | **This one is a real hole.** **IAM-055** states the property any answer must have - a session or token checkable against current state on every request, and no long-lived bearer token as the only credential - and **IAM-Q07** records that an architecture decision is owed, with what it will cost                                                                                                                                            |
| Asymmetric strictness on group changes    | **IAM-056**: a group change takes effect within a stated bound, applied on receipt where the provider pushes it and re-read at a declared interval where it does not. Not "whenever a token is renewed"                                                                                                                                                                                                                                           |
| Guest capability cap against §6 grants    | **IAM-057**: the cap wins, and an assignment that would breach it is refused at the point of assignment rather than only at the point of use. An administrator who can create the state will believe it works                                                                                                                                                                                                                                     |
| "Stated timetable" is never stated        | **IAM-058**, and the timetable turns out to exist at the other end of the product: **ADM-030** already requires a declared grace period and **ADM-Q06** asks how long. One clock, so **IAM-Q08** points at ADM-Q06 rather than opening a second question                                                                                                                                                                                          |
| IAM-Q04 ends with an unfilled placeholder | **Fixed**: it now links ADR-0011, like every other settled answer in that table                                                                                                                                                                                                                                                                                                                                                                   |
| Inconsistent reference style              | The second dependency row links `Project_Scope.md` like the first                                                                                                                                                                                                                                                                                                                                                                                 |

### In-scope gaps

| Gap                              | Change                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap and first-admin        | **IAM-059 to IAM-061**, and **IAM-N06**. An invitation to a named address, authenticated by a route the tenant permits, never a local credential or a vendor account that outlives the bootstrap; audited into the tenant's own log; and no standing vendor access afterwards. **ADM-Q04** asks who performs the act, and this area fixes what the act may consist of - which is the half that becomes a backdoor |
| Role against direct grant        | **IAM-062** and **IAM-N05**: every permission is held through a role, bound to a principal or group at a level. Sections 7 and 8 only work in that model - IAM-030's "name the grant" is answerable in it and archaeology without it                                                                                                                                                                              |
| Atomicity of check and act       | **IAM-063**: the decision and the action are one unit, and where they cannot be, the action re-checks at the point of effect and fails closed. It is an access guarantee, so it is stated here; the mechanism is the service architecture's                                                                                                                                                                       |
| Identity provider unavailability | **IAM-064** (fail closed; a cached assertion never outlives its session; no route opens because another is down) and **IAM-065** (key rotation picked up without a manual step, an unverifiable assertion refused). **IAM-Q09** asks whether a tenant may buy a grace window                                                                                                                                      |

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 54     | 65    |
| Non-requirements | 4      | 6     |
| Open questions   | 6      | 9     |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.6, 2.9, 2.11, 2.14, 2.17, 3.2.2, 3.2.5 | **IAM-066** generalises IAM-005's list into the rule behind it: every second copy, derived representation and outbound payload is tenant-scoped. **IAM-067** stops data flowing on an open connection after sign-out or revocation. **IAM-068** and **IAM-069** give an organisation administrators, audited acts and a metadata-only view. **IAM-070** names the high-risk administrative acts that `administer` had swallowed. **IAM-048 superseded by IAM-071**, which grants external access against named artifacts including a publication |
