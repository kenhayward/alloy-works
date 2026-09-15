# Access

> **Status: DRAFT for review.** Committed as it stood when handed over, so `git diff` shows exactly
> what changed. Edit anything directly; where you want to say something rather than change it, add a
> line starting `> **Ken:**` under the paragraph or table it is about.

What a principal may do to an artifact, how the service decides it, and how anybody can find out why.

This realises the permission model of [IAM](../specification/requirements/IAM-identity-tenancy-and-access-control.md)
sections 5 to 8. It sits inside each tenant's schema beside
[storage-and-versioning.md](storage-and-versioning.md), and is reached through
[service-foundations.md](service-foundations.md)'s `withTenant`: the tenant boundary is already
enforced below the application (ADR-0008, ADR-0020), and nothing here weakens or restates it. This is
the boundary **inside** a tenant. Signing in, sessions and tokens stay where they are designed.

It is written now, before the component tables are built, for one reason: an artifact's space is a
column on the artifact, and adding it after content exists is a migration of everything written.

## The shape in one paragraph

A tenant holds **spaces**, and every artifact that is content lives in exactly one. The product
defines a closed set of **permissions**; a tenant defines **roles**, each a named bundle of them. A
**grant** binds one role to one principal or one group at one **level** - the tenant, a space, or a
single artifact - and allows or denies what the role holds. Nothing else confers a permission. To
decide, the service walks from the artifact to its space to the tenant, and **the nearest level that
says anything about that permission decides**, a denial winning at its own level; nothing said
anywhere is a refusal. The decision is computed when it is asked, never copied down, and taken in the
same transaction as the act it authorises. It is one pure function in `packages/domain` that returns
not just the answer but the grants that produced it, so the view explaining a decision and the check
enforcing it cannot disagree.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-014** | A `space` is a row in a tenant's schema, so it belongs to that tenant by construction; a content artifact's `space_id` is not nullable, and grants at a space are the level below the tenant            |
| **IAM-018** | A grant's level is `tenant`, `space` or `artifact`, and an artifact is any kind - so a template, a document and a component are each a level of their own                                               |
| **IAM-019** | `read`, `create`, `edit`, `comment`, `suggest`, `approve`, `publish` and `administer`, with `design` and `manage_definitions` beside them (below)                                                       |
| **IAM-021** | `role` is a tenant's row - a name and a set of permissions - created, changed and removed through the roles routes. The roles a tenant starts with are rows like any other                              |
| **IAM-022** | A grant's subject is exactly one of a principal or a group                                                                                                                                              |
| **IAM-009** | A group can stand for a value the organisation's provider asserts in a configured claim; membership of such a group is replaced from the claim at every sign-in, and granting the group a role maps it  |
| **IAM-062** | `access_grant` is the only table that confers a permission, and every row names a role, one subject and one level. There is no per-principal permission column anywhere                                 |
| **IAM-024** | The decision walks artifact, space, tenant, and a level with nothing to say passes the question up                                                                                                      |
| **IAM-025** | The nearest level that says anything about the permission decides, so an explicit grant or denial below overrides what that level would inherit                                                         |
| **IAM-026** | At the deciding level, any denial wins over any allow, whether each reached the principal directly or through a group                                                                                   |
| **IAM-027** | No effective permission is stored. Every decision reads the grants at the moment it is asked, so a change at the top applies below at once                                                              |
| **IAM-063** | Every decision takes a shared lock on the tenant's `access_epoch` row inside the transaction of the act; every change to access takes it exclusively, so no change can land between a check and its act |
| **IAM-029** | An administrator opens **Access** on any artifact, chooses a person, and sees every permission with its answer                                                                                          |
| **IAM-030** | Each answer names the level that decided it and every grant at that level that did - role, subject, and whether it reached the person through a group                                                   |
| **IAM-031** | A refusal names the denying grants, or says that no level grants the permission and lists the levels it looked at                                                                                       |
| **TPL-006** | Changing or creating a template needs `design`, not `edit` or `create`, and a document never inherits from the template it was made from                                                                |
| **MET-024** | Changing or creating a field, a metadata schema or a component type needs `manage_definitions`, a permission of its own that a role can hold without `administer` or `design`                           |
| **API-053** | One refusal vocabulary for every route, below, and a contract test that fails when a route does not declare the permission it checks                                                                    |

## What this document does not own

| Left unclaimed            | Why                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-023, CNT-105          | `modesFor` derives read, review and author from the permissions here; offering only those modes, and dropping to a lesser one, is the document view's, which is not designed                                                                                                 |
| IAM-013, IAM-037, IAM-060 | Every change to access, and every refusal, is an audit event; the audit log is LIF's and not designed. Until it is, nothing here claims to be audited                                                                                                                        |
| IAM-057, IAM-047          | The decision caps an external principal whatever the grants say, which is IAM-057's "no effect". Refusing the assignment is designed for a grant and a tenant-managed group, but a provider-asserted membership cannot be refused, and IAM-047's gates and signing are LIF's |
| IAM-056                   | Provider groups are re-read at sign-in and at no other time, so a removal at the provider takes effect at the next sign-in. That is not the stated, tested bound IAM-056 asks for                                                                                            |
| IAM-015, IAM-028          | Moving an artifact is T2. Because nothing is copied down, a move is an update of `space_id` and the next decision is already right - but the act of moving is not designed                                                                                                   |
| IAM-016, IAM-017          | Referencing across spaces, and re-checking at publish, are T4; `readableSet` below is what both will call                                                                                                                                                                    |
| IAM-020, IAM-070          | A data connection's results and the named high-risk acts are T2. Each arrives as a new permission in the closed set, which is a code change with a migration of the check constraint and nothing more                                                                        |
| IAM-032                   | Evaluating as another user is T2. `explain` already takes the principal as a parameter, so it is a route and a permission, not a new model                                                                                                                                   |
| IAM-005, IAM-010, IAM-033 | Tenant-scoping of derived data is each derived store's; a disabled user losing access is the session check's; service identities are the token design's                                                                                                                      |

## Spaces

A **space** is `id`, `name` - unique within the tenant - and when it was created. Content artifacts
live in exactly one: a component, a document, an outline, a template, an asset, a query definition.
**Definitions live in no space**: a field, a metadata schema and a component type are tenant-wide
(MET-001, MET-005, MET-010), and so is a style catalogue (STY-002), because MET and STY both decided a
definition is shared across spaces. `artifact.space_id` is required for a content kind and forbidden
for a tenant-wide kind, by a check constraint over `kind` rather than a convention.

A new tenant starts with one space, named _General_, which an administrator can rename. Creating a
space needs `administer` at the tenant.

## Permissions

The set is **closed, and defined by the product**. A tenant cannot invent a permission, because the
service's checks are code and a permission no check reads would be a promise with nothing behind it.

| Permission           | Lets the principal                                                                             | Decided at                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `read`               | See the artifact and its versions                                                              | The artifact                                |
| `create`             | Create a content artifact                                                                      | The space it is created in                  |
| `edit`               | Change a content artifact other than a template: take its lock, write iterations, cut versions | The artifact                                |
| `comment`            | Comment on it                                                                                  | The artifact                                |
| `suggest`            | Suggest a change to it                                                                         | The artifact                                |
| `approve`            | Pass it through a lifecycle gate                                                               | The artifact                                |
| `publish`            | Publish it                                                                                     | The artifact                                |
| `design`             | Create or change a template                                                                    | The template, or the space for creating one |
| `manage_definitions` | Create or change a field, a metadata schema or a component type                                | The tenant                                  |
| `administer`         | Change grants at this level and below; at the tenant, also spaces, roles and groups            | The level                                   |

**`design` is `edit` for templates, and separate from it on purpose.** TPL-006 says designing a
template and writing a document are different jobs, and MET-024 names designing templates as
something managing definitions must be separate from. Had a template been edited with `edit`, an
author with that permission on a space could change every template in it, and "permissioned
separately" would mean only that somebody could add a denial.

**`administer` confers no content permission.** An administrator who wants to edit a component grants
themselves a role that allows it, and that grant is visible in every explanation afterwards. It is
still a way to reach anything, and IAM-070 exists to split the riskiest parts of it out.

**No permission implies another in the decision.** Instead, a role is refused if it holds anything
without `read`: a role with `edit` and no `read` describes nobody real, and refusing it where it is
made is simpler than an implication table every explanation would have to show.

## Roles

A **role** is `id`, a `name` unique in the tenant, and its permissions. A tenant starts with seven,
which are ordinary rows it may rename, change or remove:

| Role                | Permissions                                    |
| ------------------- | ---------------------------------------------- |
| Reader              | `read`                                         |
| Reviewer            | `read`, `comment`, `suggest`                   |
| Author              | `read`, `create`, `edit`, `comment`, `suggest` |
| Approver            | `read`, `comment`, `approve`                   |
| Designer            | `read`, `design`                               |
| Definitions manager | `read`, `manage_definitions`                   |
| Administrator       | `read`, `administer`                           |

Changing a role changes the access of everybody holding it, at once, which is what a bundle is for.
Removing a role that any grant names is refused; the grants go first, so nobody loses access as a
side effect of tidying.

**A tenant cannot lock itself out.** A change is refused if afterwards no principal holds
`administer` at the tenant through a grant made to them directly. A group does not count, because a
provider can empty a group at the next sign-in without anybody in the tenant acting.

## Grants

| Member     | Holds                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| `role`     | The role granted                                                                   |
| `subject`  | Exactly one of a principal or a group                                              |
| `level`    | `tenant`, a space, or an artifact                                                  |
| `effect`   | `allow` or `deny` - a denial denies every permission the role holds, at that level |
| Provenance | Who made it, and when                                                              |

A grant is created and removed, never changed: changing one is removing it and making another, so
the record of who granted what stays whole. The same role, subject, level and effect cannot be
granted twice. Making or removing a grant needs `administer` at its level or above.

**An external principal cannot be given what the cap forbids** (IAM-057). A grant to an external
principal of a role holding `create`, `edit`, `approve`, `publish`, `design`, `manage_definitions` or
`administer` is refused, and so is the same grant to a tenant-managed group with an external member, and
adding an external principal to such a group. The cap in the decision still applies, for the membership
no administrator made.

**A denial is a role too** (IAM-062). "Deny Author on this component to Grace" names a bundle, so its
explanation reads the same way an allow does.

## Groups

A **group** is `id`, a `name`, and its source:

- **Tenant-managed**: members added and removed by an administrator.
- **From the organisation's provider**: the group names a value, and the tenant's provider
  configuration names the claim that carries values (`groups` by default). At every sign-in through
  that provider, the principal's memberships of provider groups are replaced by the values in the
  claim. A value with no group is ignored, so an administrator decides which of the directory's
  groups mean anything here (IAM-009).

**The Google route asserts no groups.** Reading a Workspace user's groups needs a directory scope,
which IAM-044 forbids requesting. A principal who signs in with Google is placed in groups by an
administrator or not at all, and a tenant that wants its directory to drive access is a tenant that
configures its own provider.

## Deciding

`decide(question, facts)` is pure. The question is a principal, a permission and a target. The facts
are what the service loads in one query: the principal's kind, the groups they are in, the target's
chain - artifact, its space, the tenant - and every grant at those levels whose subject is the
principal or one of their groups, with each role's permissions.

1. The level the permission is decided at comes from the table above: `create` and creating a
   template ask about the space, `manage_definitions` asks about the tenant, the rest ask about the
   artifact.
2. From that level upwards, take the grants whose role holds the permission.
3. At the first level with any: **a denial there refuses; otherwise an allow there allows.** Levels
   further up are not read.
4. No level with any: **refused, because nothing grants it**.
5. After that, **the external cap** (IAM-057): an external principal is refused `create`, `edit`,
   `approve`, `publish`, `design`, `manage_definitions` and `administer` whatever step 3 found, and the
   explanation says the cap refused it.

The answer is `{ allowed, level, grants, cap }`: the deciding level, the grants that decided at it, or
none with the levels checked. **Enforcement reads `allowed`; the Access view shows the rest.** They are
one call, which is what makes IAM-030 and IAM-031 true rather than hoped for.

**The nearest level wins, and that has a consequence worth stating.** IAM-025 lets an allow on one
artifact open it inside a space the person cannot otherwise read. That is what the requirement asks
for - it is how one component is shared out of a restricted space without moving it - and it is why
the grant shows in every explanation and in `readableSet`'s explicit list rather than being implied.

**A document's grants do not reach the components it references.** A component is reused by
documents in any space, so a permission that flowed from a document would make a component's access
depend on who happens to use it, and one grant on a report would open every component the report
quotes. A component's chain is the component, its space and the tenant, never a document. Seeing a
component inside a document therefore needs `read` on the component, which is the rule IAM-016 and
IAM-017 already state for T4.

### Taking the decision with the act

IAM-063 is met with one row. Each tenant schema holds `access_epoch`, a single row. **Every change to
access** - a grant, a role's permissions, a group membership, a space - updates it, which takes the
row's exclusive lock. **Every decision** reads it `FOR SHARE` in the transaction of the act it
authorises. So a revocation that starts while a write is authorised waits for that write to commit,
and a write that starts after a revocation waits for the revocation and then sees it.

Writes proceed together, because shared locks do not conflict with each other. Access changes queue
behind in-flight writes, which are short, and a change to access is an administrator's act measured in
seconds, not a hot path. A stream cannot hold a lock for its lifetime, which is why realtime.md ends a
stream on a permission change and authorises the reconnect afresh (API-016).

### The readable set

Search, traversal and the stream filter many artifacts at once, and do it inside a query rather than
by calling `decide` per row (SCH-005, REL-019). `readableSet(principal, facts)` returns what they need,
from the same grants and the same rules:

- **spaces**: every space where `read` is allowed at the space, or inherited from the tenant;
- **excluded**: artifacts in those spaces where an artifact-level grant decides `read` as refused;
- **included**: artifacts in any other space where an artifact-level grant decides `read` as allowed.

The predicate is `(space_id = any(spaces) and id <> all(excluded)) or id = any(included)`.
search.md and relationships.md described the set as the first half only; both now say all of it.

## Refusing

| Situation                                                    | Status | `code`            |
| ------------------------------------------------------------ | ------ | ----------------- |
| No session, or one that has ended                            | 401    | `unauthenticated` |
| The target does not exist, **or** the caller may not read it | 404    | `not_found`       |
| The caller may read it and is refused what they asked        | 403    | `forbidden`       |

These are the codes the service already returns; this design fixes when each applies.

**An artifact the caller may not read is indistinguishable from one that does not exist**, so an
identifier cannot be probed for existence - the rule relationships.md already applies to a walk. A
403 names the permission refused and nothing more: the grants behind it are an administrator's to see,
through Access, not a caller's to learn from an error.

**Every route declares its permission and target** in `packages/api-contract` beside its schema. The
service's route helper takes them from there, decides inside `withTenant`, and runs the handler only
on an allow. A contract test fails for any route without a declaration, and every route has the
cross-tenant test IAM-004 already requires plus one as a principal holding nothing.

## Routes

| Route                                                   | Needs                                       | Does                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                     |
| `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                              |
| `GET`, `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}` | `administer`, tenant                        | Lists, creates, changes and removes roles, with the role and lock-out guards above                      |
| `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                         |
| `GET /v1/grants?level=`                                 | `administer` at that level                  | The grants made at one level                                                                            |
| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant                                                                                |
| `GET /v1/access?target=`                                | `read` on the target                        | The caller's own answer for every permission on it, and `modesFor` - what the renderer offers from      |
| `GET /v1/access/explain?principal=&target=`             | `administer` at the target's level or above | Every permission for that principal on that target, each with its full explanation (IAM-029 to IAM-031) |

**Access** is a panel on any artifact, for an administrator: choose a person, and read a row per
permission - allowed or refused, the deciding level, the grants that decided it, and the cap where it
applied. It is read-only; grants are made from the same panel's second tab, one role, one subject and
one effect at a time.

## Stores

In each tenant's schema:

| Table          | One row per          | Carries                                                                                                |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `space`        | Space                | Name, created at                                                                                       |
| `role`         | Role                 | Name, permissions as an array checked against the closed set                                           |
| `access_group` | Group                | Name, source, the provider value where it has one                                                      |
| `group_member` | Principal in a group | The source of the membership, when it was last asserted                                                |
| `access_grant` | Grant                | Role, principal or group (a check allows exactly one), level and its target, effect, granted by and at |
| `access_epoch` | Tenant - one row     | When access last changed                                                                               |

Two existing tables change: `principal` gains `kind` - `user`, `service` or `external`, defaulting to
`user` - so the cap has something to read; `identity_provider` gains the name of its groups claim.
[storage-and-versioning.md](storage-and-versioning.md)'s `artifact` gains `space_id`.

## Where the code lives

`packages/domain/src/access/`: the permission set, role validation, `decide`, `readableSet` and
`modesFor`. No database: the service loads the facts for a question in one query and passes them in.
The route helper and the stores are `apps/service` and `packages/db`.

## Verification

- **A decision table as tests**: for every permission, an allow and a denial at each of the three
  levels in every combination, direct and through a group, asserting the answer and the level and
  grants named - so IAM-024 to IAM-026 are exercised rather than argued.
- **`decide` and `readableSet` agree**: a property test generating grants over a small tenant and
  asserting that an artifact is in the readable set exactly when `decide` allows `read` on it.
- **Explanations are the decision**: every refusal names grants or levels checked, and never an empty
  reason.
- **The lock**: two transactions - a write authorised and a revocation - interleaved at each point, in
  Postgres, asserting the write either commits before the revocation or is refused after it.
- **Every route**: the contract test for a declared permission, a principal holding nothing, and the
  second tenant.
- **404, not 403**, for an artifact the caller may not read, compared byte for byte with the answer for
  an identifier that does not exist.
- **Lock-out**: removing the last direct tenant administrator's grant, their role's `administer`, or
  the role itself is refused.

## What was ruled out

- **Permissions flowing from a document to the components it references.** Above: a component's access
  would depend on who uses it.
- **Effective permissions materialised per artifact.** It makes search's predicate trivial and every
  grant at the top a rewrite of everything below it, which is the failure IAM-027 names.
- **An access-control library or policy language** (a Zanzibar-style store, OPA, Cedar). The model is
  three levels and ten permissions, the explanation must name our grants in our words, and the check
  must run inside our transaction; a second system would do all three less directly than one function.
- **Row-level security as the permission check.** It enforces the tenant already. Encoding inheritance
  and denial precedence in policies would put the one rule every explanation depends on where no test
  of `decide` can see it.
- **Group over individual, or individual over group, at the same level.** IAM-026 says denial wins at a
  level, and a precedence between subjects would be a second rule an administrator has to learn.

## Open questions

| ID  | Question                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | How many artifact-level grants a principal can hold before `readableSet`'s explicit lists stop being a good predicate. Artifact grants are meant to be exceptions; a tenant that uses them as its main model would find out by load     |
| New | Whether a tenant's first administrator should arrive through this design's grants at provisioning, or wait for IAM-059's bootstrap. Provisioning grants Administrator at the tenant to the first invited address until that is designed |
| New | Whether `comment` and `suggest` are worth separating in T1, when both are T3 capabilities. They are in the set because IAM-019 names them, and a role editor showing two permissions nothing checks yet should say so                   |
