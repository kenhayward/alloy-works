# Access

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

| ID          | How it is met                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-014** | A `space` is a row in a tenant's schema, so it belongs to that tenant by construction; a content artifact's `space_id` is not nullable, and grants at a space are the level below the tenant                                                                                                              |
| **IAM-018** | A grant's level is `tenant`, `space` or `artifact`, and an artifact is any kind - so a template, a document and a component are each a level of their own                                                                                                                                                 |
| **IAM-019** | `read`, `create`, `edit`, `comment`, `suggest`, `approve`, `publish` and `administer`, with `design` and `manage_definitions` beside them (below)                                                                                                                                                         |
| **IAM-021** | `role` is a tenant's row - a name and a set of permissions - created, changed and removed through the roles routes. The roles a tenant starts with are rows like any other                                                                                                                                |
| **IAM-022** | A grant's subject is exactly one of a principal or a group                                                                                                                                                                                                                                                |
| **IAM-009** | A group can stand for a value the organisation's provider asserts in a configured claim; membership of such a group is replaced from the claim at every sign-in, and granting the group a role maps it                                                                                                    |
| **IAM-062** | `access_grant` is the only table that confers a permission, and every row names a role, one subject and one level. There is no per-principal permission column anywhere                                                                                                                                   |
| **IAM-024** | The decision walks artifact, space, tenant, and a level with nothing to say passes the question up                                                                                                                                                                                                        |
| **IAM-025** | The nearest level that says anything about the permission decides, so an explicit grant or denial below overrides what that level would inherit                                                                                                                                                           |
| **IAM-026** | At the deciding level, any denial wins over any allow, whether each reached the principal directly or through a group                                                                                                                                                                                     |
| **IAM-027** | No effective permission is stored. Every decision reads the grants at the moment it is asked, so a change at the top applies below at once                                                                                                                                                                |
| **IAM-063** | Every decision takes a shared lock on the tenant's `access_epoch` row inside the transaction of the act; every change a decision reads - grants, roles, memberships, spaces, a principal's kind - takes it exclusively, so no change can land between a check and its act                                 |
| **IAM-029** | An administrator opens **Access** on any artifact, chooses a person, and sees every permission with its answer                                                                                                                                                                                            |
| **IAM-030** | Each answer names the level that decided it and every grant at that level that did - role, subject, and whether it reached the person through a group                                                                                                                                                     |
| **IAM-031** | A refusal names the denying grants, or says that no level grants the permission and lists the levels it looked at                                                                                                                                                                                         |
| **TPL-006** | Creating a template needs `design` at its space and `create` does not reach templates; changing one needs `design` on it, not `edit`; and a document never inherits from the template it was made from                                                                                                    |
| **MET-024** | Changing or creating a field, a metadata schema or a component type needs `manage_definitions`, a permission of its own that a role can hold without `administer` or `design`                                                                                                                             |
| **IAM-049** | A grant carries an optional expiry, and **for an external principal a grant without one confers nothing**. Granting to an external principal takes the tenant's default expiry when none is given and refuses one past the tenant's cap, so external access cannot be left unset whichever way it arrives |
| **IAM-071** | For an external principal, a grant at the tenant is refused where it is made and not read where it is decided, so external access is only ever against a named space or artifact - a publication included, since a publication is an artifact                                                             |
| **IAM-051** | `GET /v1/access/external` lists every external principal, each with every grant reaching them - directly or through a group, with its level and expiry - and the readable set those grants produce                                                                                                        |
| **API-053** | One refusal vocabulary for every route, below, and a contract test that fails when a route does not declare the permission it checks                                                                                                                                                                      |

## What this document does not own

| Left unclaimed            | Why                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-023, CNT-105, CNT-106 | `modesFor` derives read, review and author by the rule below; offering only those modes, dropping to a lesser one, and what each mode shows are the document view's, which is not designed                                                                                                                                                                     |
| IAM-013, IAM-037, IAM-060 | Every change to access, and every refusal, is an audit event; the audit log is LIF's and not designed. Until it is, nothing here claims to be audited                                                                                                                                                                                                          |
| IAM-057, IAM-047          | The decision caps an external principal whatever the grants say, which is IAM-057's "no effect", and a grant is refused where it would give one a capped permission. But a provider-asserted membership cannot be refused where it happens, and IAM-047's gates and signing are LIF's: signing is not a permission here, and nothing designs how it is refused |
| IAM-050                   | An extension is a new grant naming the one it extends, which is removed in the same change - a positive act by an administrator, with the cap applied afresh. Auditing it is LIF's, and the log is not designed                                                                                                                                                |
| IAM-036                   | Every route decides for the principal its session or token belongs to, and no route takes the acting principal from a parameter. That a model's tool call or an MCP caller has no other path into the service is API's and GEN's to show, and neither is designed                                                                                              |
| PUB-084                   | A publication share can be exactly the grant IAM-049 and IAM-071 describe, and it appears in IAM-051's listing. Proving identity before first access and recording every access are PUB's and not designed                                                                                                                                                     |
| IAM-056                   | Provider groups are re-read at sign-in and at no other time, so a removal at the provider takes effect at the next sign-in. That is not the stated, tested bound IAM-056 asks for                                                                                                                                                                              |
| IAM-015, IAM-028          | Moving an artifact is T2. Because nothing is copied down, a move is an update of `space_id` and the next decision is already right - but the act of moving is not designed                                                                                                                                                                                     |
| IAM-016, IAM-017          | Referencing across spaces, and re-checking at publish, are T4; `readableSet` below is what both will call                                                                                                                                                                                                                                                      |
| IAM-020, IAM-070          | A data connection's results and the named high-risk acts are T2. Each arrives as a new permission in the closed set, which is a code change with a migration of the check constraint and nothing more                                                                                                                                                          |
| IAM-032                   | Evaluating as another user is T2. `explain` already takes the principal as a parameter, so it is a route and a permission, not a new model                                                                                                                                                                                                                     |
| IAM-005, IAM-010, IAM-033 | Tenant-scoping of derived data is each derived store's; a disabled user losing access is the session check's; service identities are the token design's                                                                                                                                                                                                        |

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
| `create`             | Create a content artifact other than a template                                                | The space it is created in                  |
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

**A tenant cannot lock itself out.** Provisioning makes one grant of Administrator at the tenant
directly to the first administrator, so a tenant always starts with one. After that, **a change is
refused if it would leave no principal holding `administer` at the tenant through a direct grant with
no expiry** - removing that grant, taking `administer` out of its role, removing the role, or making that
principal external, since the cap would then refuse it. A change that does not reduce that number is
never refused by this rule, whatever the number is. A grant with an expiry does not count, because it
would end the tenant's administration on a date with nobody acting.

Only direct grants count, which is why removing somebody from a group, or removing a group, never trips
it: neither can change the count. Tenant-managed groups are left out as well as provider groups, because
a guard that counted them would need a second rule for what leaving one does, and a rule an
administrator can state in one sentence is worth more than the case it would save.

## Grants

| Member     | Holds                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| `role`     | The role granted                                                                             |
| `subject`  | Exactly one of a principal or a group                                                        |
| `level`    | `tenant`, a space, or an artifact                                                            |
| `effect`   | `allow` or `deny` - a denial denies every permission the role holds, at that level           |
| `expires`  | When it stops conferring anything, or none - which confers nothing for an external principal |
| `extends`  | The grant this one replaced by extending it, or none                                         |
| Provenance | Who made it, and when                                                                        |

A grant is created and removed, never changed: changing one is removing it and making another, so
the record of who granted what stays whole. **An expired grant is ignored by every decision**, compared
with the transaction's own clock, so a check and its act see the same answer. The same role, subject,
level and effect cannot be granted twice. Making or removing a grant needs `administer` at its level or above.

### External principals

An external principal is one whose `kind` is `external`. Nothing in T1 marks one on screen - that is
IAM-045, T4 - but the rules below are in the model from the first row, because each constrains grants,
and a grant made before its rule existed is a grant nobody re-checks.

**The cap.** An external principal is refused these permissions whatever the grants say:

| Capped                         | Why                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `edit`, `approve`, `publish`   | **IAM-047 and IAM-057**: never edit content, pass a gate or publish. Signing is the fourth, and LIF's                             |
| `create`                       | **This design's choice.** Creating a component is writing content, which IAM-047 withholds in intent though it names only editing |
| `design`, `manage_definitions` | **This design's choice.** Each changes what everybody inside the tenant must write                                                |
| `administer`                   | **This design's choice.** An external administrator could grant themselves past every other line here                             |

**Where a grant is made**, it is refused if it would give an external principal a capped permission, if
it is at the tenant (IAM-071), or if its expiry is past the tenant's cap; one given no expiry takes the
tenant's default (IAM-049). The same checks apply to a grant to a tenant-managed group with an external
member, and to adding an external principal to a group holding such a grant.

**Where a decision is taken**, an external principal's grants at the tenant and grants with no expiry
are ignored, and then the cap applies. That covers the membership no administrator made - a provider
asserting an external principal into a group - which cannot be refused where it happens.

**Extending external access** (IAM-050) is a new grant with its own expiry, naming the grant it
`extends`, which is removed in the same change: a positive act by an administrator, capped afresh, and
never a clock that renews itself. The tenant's default and cap are two settings in days; the cap can
be raised and never removed.

### Denials

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

`decide(question, facts)` is pure. The question is a principal, a permission and a target, and a
target is an artifact, a space or the tenant. The facts are what the service loads in one query: the
principal's kind, the groups they are in, the target's chain from itself upwards, and every unexpired
grant at those levels whose subject is the principal or one of their groups, with each role's
permissions.

1. **Where the walk starts.** Creating asks about the space the artifact will be created in - `design`
   for a template, `create` for any other kind. `manage_definitions` asks about the tenant. Every other
   permission, `administer` included, asks about the target itself: whether somebody may change grants
   at a space is `administer` asked of that space, whose chain is the space and the tenant.
2. From there upwards, take the grants whose role holds the permission - for an external principal,
   leaving out grants at the tenant and grants with no expiry.
3. At the first level with any: **a denial there refuses; otherwise an allow there allows.** Levels
   further up are not read.
4. No level with any: **refused, because nothing grants it**.
5. After that, **the external cap** from the table above, whatever step 3 found; the explanation says
   the cap refused it.

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
access** - a grant, a role's permissions, a group membership, a space, an artifact's space, a
principal's `kind` - updates it, which takes the row's exclusive lock. The rule is that anything
`decide` reads as a fact counts, and a test holds the facts and the writes that take the lock against
each other. Removing an unused role or an empty group does not take it, because no decision reads
either. **Every decision** reads it `FOR SHARE` in the transaction of the act it authorises. So a revocation that starts while a write is authorised waits for that write to commit,
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

### Modes

`modesFor(answers)` turns the caller's answers on a document into the modes CNT-104 names:

| Mode   | Offered when the caller may        |
| ------ | ---------------------------------- |
| Read   | `read`                             |
| Review | `read`, and `comment` or `suggest` |
| Author | `read` and `edit`                  |

Review with only one of `comment` and `suggest` is still review, and says which it offers. What each
mode shows is the document view's (CNT-106).

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

| Route                                                   | Needs                                       | Does                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                                         |
| `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                                                  |
| `GET`, `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}` | `administer`, tenant                        | Lists, creates, changes and removes roles, with the role and lock-out guards above                                          |
| `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                                             |
| `GET /v1/grants?level=`                                 | `administer` at the level or above          | The grants made at one level                                                                                                |
| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant                                                                                                    |
| `GET /v1/access/external`                               | `administer`, tenant                        | Every external principal, each grant reaching them with its level and expiry, and what those grants let them read (IAM-051) |
| `PUT /v1/principals/{id}/kind`                          | `administer`, tenant                        | Marks a principal external or not, under the lock-out guard. Nothing in T1 offers it on screen                              |
| `GET /v1/access?target=`                                | `read` on the target                        | The caller's own answer for every permission on it, and `modesFor` - what the renderer offers from                          |
| `GET /v1/access/explain?principal=&target=`             | `administer` at the target's level or above | Every permission for that principal on that target, each with its full explanation (IAM-029 to IAM-031)                     |

**Access** is a panel on any artifact, for an administrator: choose a person, and read a row per
permission - allowed or refused, the deciding level, the grants that decided it, and the cap where it
applied. It is read-only; grants are made from the same panel's second tab, one role, one subject and
one effect at a time.

## Stores

In each tenant's schema:

| Table          | One row per          | Carries                                                                                                                              |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `space`        | Space                | Name, created at                                                                                                                     |
| `role`         | Role                 | Name, permissions as an array checked against the closed set                                                                         |
| `access_group` | Group                | Name, source, the provider value where it has one                                                                                    |
| `group_member` | Principal in a group | The source of the membership, when it was last asserted                                                                              |
| `access_grant` | Grant                | Role, principal or group (a check allows exactly one), level and its target, effect, expiry, the grant it extends, granted by and at |
| `access_epoch` | Tenant - one row     | When access last changed                                                                                                             |

The tenant's settings gain the default and the cap on external expiry, in days. Two existing tables
change: `principal` gains `kind` - `user`, `service` or `external`, defaulting to
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
- **Lock-out**: a grant with an expiry never counts as the last administrator; removing the last direct
  tenant administrator's grant, their role's `administer`, the
  role itself, or making them external is refused; removing a group or a member never is.
- **The external rules**: a grant of a capped role to an external principal, at the tenant, past the
  cap, or to a tenant-managed group with an external member is refused, and so is adding an external
  principal to such a group. Where such grants exist anyway - inserted directly, as a provider
  membership would arrive - `decide` ignores the tenant grant and the grant with no expiry, and applies
  the cap. An expired grant confers nothing.
- **Immediacy** (IAM-027): changing a role's permissions changes `decide`'s answer for every holder at
  the next decision, with nothing run in between.
- **Facts and the lock**: a test lists every fact `decide` reads and every write that takes the epoch
  lock, and fails when a fact has no write taking it.

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

## Review

[The review](../reviews/design-reviews/access-review.md) read the draft against the corpus: every
claimed row, every unclaimed one, and the IAM area for anything touched but listed in neither. **Its
points were taken as inputs, not instructions**, and each was checked against the requirement text
before deciding. Ten points; eight accepted, one accepted after correcting its premise, and one claim
declined.

| Point                                                           | Decision                                        | Change and reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External access unlisted and mostly unmet                       | **Accepted, premise corrected**                 | The review read IAM-071 as met. It was not: the draft allowed a grant to an external principal at the tenant, which is exactly "a status that opens the tenant". Now refused where made and ignored where decided, and claimed. IAM-049 and IAM-051 are designed rather than deferred, because an expiry column and the rule that an external grant without one confers nothing are structural - adding them after grants exist means re-checking every grant. IAM-050's extension is designed and left unclaimed for its audit; PUB-084 is unclaimed with the grant side answered |
| A change of `kind` bypasses the lock                            | **Accepted**                                    | `kind` joins the changes that take the lock, the rule is stated as "anything `decide` reads", and a test holds the two lists against each other so the next fact cannot be forgotten the same way                                                                                                                                                                                                                                                                                                                                                                                  |
| The cap is stricter than IAM-057, and misses signing            | **Accepted**                                    | The cap is now a table saying which entries are IAM-047's and which are this design's, each with a reason. Signing is not mapped to `approve`, because IAM-047 names it separately; it stays LIF's, named as unmet in the unclaimed table                                                                                                                                                                                                                                                                                                                                          |
| The lock-out guard has a hole in tenant-managed groups          | **Premise corrected; the second half accepted** | The guard counts only direct grants, so removing a group or a member cannot change what it counts and cannot leave the tenant without one. The undefined case was real: now provisioning makes the first direct grant, and the guard refuses only a change that reduces the count. Following it found a case the draft missed - making the last administrator external - which the guard now covers                                                                                                                                                                                |
| `create` and template creation                                  | **Accepted**                                    | `create` excludes templates, and creating one asks `design` at the space. TPL-006's row now says both halves                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Listing grants narrower than making them                        | **Accepted**                                    | "At the level or above", like the rest. There was no reason for the difference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `administer` and targets that are a space or the tenant         | **Accepted**                                    | A target is an artifact, a space or the tenant, and the walk starts at the target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modesFor` has no rule                                          | **Accepted**                                    | A table of which answers yield read, review and author. CNT-106, what each mode shows, joins the unclaimed row                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Verification missing the external rules and IAM-027's immediacy | **Accepted**                                    | Tests for both, including grants inserted directly to stand for a provider membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| IAM-036 met by construction                                     | **Declined as a claim**                         | The route half is met: every route decides for the caller's principal. "No path to exceeding them" also covers an MCP caller and a model's tool call, whose paths API and GEN have not designed, so claiming it would claim their half. It is recorded as unclaimed with that reason                                                                                                                                                                                                                                                                                               |
| Removing an unused role or empty group                          | **Accepted**                                    | Stated: neither takes the lock, because no decision reads either                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
