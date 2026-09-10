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

| ID          | Requirement                                                                                                                       | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **IAM-001** | Every artifact must belong to exactly one tenant, and no artifact may be shared between tenants                                   | Constraint | Specified |
| **IAM-002** | Tenant isolation must be enforced at the data layer, not by application code remembering to add a filter                          | Constraint | Specified |
| **IAM-003** | The tenant a request acts within must be derived from the authenticated session, and never from a parameter the caller supplies   | Constraint | Specified |
| **IAM-004** | Every read and write path must be covered by a test that attempts access from a second tenant and is refused                      | T1         | Specified |
| **IAM-005** | Search indexes, caches, secrets, model endpoints, publications and the audit log must each be tenant-scoped, not only the content | T1         | Specified |
| **IAM-006** | Deleting a tenant must render everything it owns unreadable on a stated timetable, and that timetable must be verifiable          | T3         | Specified |

**IAM-002 and IAM-003 are written as enforcement rather than intent on purpose.** Multi-tenant
leakage is named in scope §13 as one of the two most likely sources of a serious breach, and it never
arrives as a decision to skip a check - it arrives as one query out of four hundred where the
`WHERE` clause was forgotten. A boundary that depends on remembering is not a boundary.

## 4. Identity

| ID          | Requirement                                                                                                                            | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **IAM-007** | A tenant must be able to federate authentication with its own identity provider over OIDC                                              | T1      | Specified |
| **IAM-008** | Users should be provisioned and de-provisioned by SCIM where the customer supports it, with a documented manual path where they do not | T2      | Specified |
| **IAM-009** | Group membership asserted by the identity provider must be mappable to roles, so that access follows the customer's own directory      | T1      | Specified |
| **IAM-010** | A user disabled at the identity provider must lose access without waiting for a token to expire                                        | T1      | Specified |
| **IAM-011** | A tenant must be able to federate with more than one identity provider, because contractors and acquisitions do not share a directory  | T2      | Specified |
| **IAM-012** | Authentication must be re-assertable within a session, so that a signing act can require it (**LIF** owns when)                        | T3      | Specified |
| **IAM-013** | Every authentication, and every authorisation that resulted in a refusal, must be recorded in the audit log (**LIF** owns the log)     | T1      | Specified |

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

## 11. Non-requirements

| ID          | Not this                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IAM-N01** | **Not an identity provider.** Authentication federates to the customer's. Whether a first-party option is ever offered is **IAM-Q01**                                          |
| **IAM-N02** | **No permission finer than a component.** A component is the unit of reuse and of review; permissions inside one would have to travel with it into every document that uses it |
| **IAM-N03** | **No sharing between tenants.** Whether cross-tenant collaboration is served some other way is **IAM-Q04**                                                                     |
| **IAM-N04** | **No enforcement in the renderer.** The renderer is untrusted in both deliveries; what it hides is presentation, and the service refuses regardless                            |

## 12. Open questions

| ID          | Question                                                                                                                                                                                               | What would settle it                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **IAM-Q01** | **Pure federation, or a first-party identity provider with federation as an option?** This is open decision 9 in scope §10                                                                             | The first customer without a usable identity provider - small consultancies frequently have none                   |
| **IAM-Q02** | **Is the component really the finest useful grain (IAM-N02)?** Section-level permission is asked for in regulated submissions, where one annex has a narrower readership than its report               | A customer requirement that cannot be met by putting the annex in its own space                                    |
| **IAM-Q03** | **Is there anonymous or link-based read for a published artifact?** Sending a client a report is the commonest thing a consultancy does, and requiring them to have an account may not survive contact | Whether early customers publish outward. It interacts with audit: a reader with no identity leaves a thinner trail |
| **IAM-Q04** | **How does cross-tenant collaboration work, if at all?** A client reviewing a report inside their consultant's tenant is ordinary in this market, and IAM-001 forbids it outright                      | A decision on whether to serve it by guest identities inside one tenant, or by a sharing mechanism between two     |

**IAM-Q03 and IAM-Q04 are the two most likely to force a change here**, and both come from the same
place: this market's documents are written by one organisation for another. A model that assumes
everyone who touches a document works for the tenant that owns it is a clean model, and it may not
be the one customers need.

## 13. Traceability

| This document | Rests on                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| Section 3     | Scope §11 security; §13 names multi-tenant leakage as a top-two risk      |
| IAM-020       | Scope §7.14, the separately grantable right to see a connection's results |
| Section 8     | Scope §7.14, "why can this person do this"                                |
| IAM-036       | Scope §7.6, tool use bound by the calling user's permissions              |
| IAM-023       | CNT-104 to CNT-106, the three modes of access                             |
| IAM-N04       | Scope §9 decision 2 and §11, the renderer is untrusted                    |
