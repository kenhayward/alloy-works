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

> **Part of this is built.** The permission set, `checkRole`, `decide` and `readableSet` are in
> `packages/domain/src/access/`; roles, groups, grants, the access epoch, the facts a decision reads,
> invitations and the first administrator are in `packages/db`; and the service checks what each route declares, through
> `GET /v1/access` and `GET /v1/access/explain`. [`../architecture.md`](../architecture.md) describes them
> as they stand, and [the plan that built them](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
> changed this document where planning the build found it wrong or unfinished - see
> [Changed while planning the build](#changed-while-planning-the-build). [The grants plan](../plans/2026-09-17-access-02-managing-grants.md)
> built listing, making and removing grants to principals, listing roles and people, the lock-out guard
> for removing a grant, and an access page on a component. [The invitations plan](../plans/2026-09-17-access-03-invitations.md)
> built invitations to an address, with the first administrator arriving by one. What is still design
> here: `modesFor`, managing roles and groups, a principal's kind, extending a grant, provider groups,
> the external listing, and Access on anything but a component.

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

| ID          | How it is met                                                                                                                                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-014** | A `space` is a row in a tenant's schema, so it belongs to that tenant by construction; a content artifact's `space_id` is not nullable, and grants at a space are the level below the tenant                                                                                                                                           |
| **IAM-018** | A grant's level is `tenant`, `space` or `artifact`, and an artifact is any kind - so a template, a document and a component are each a level of their own                                                                                                                                                                              |
| **IAM-019** | `read`, `create`, `edit`, `comment`, `suggest`, `approve`, `publish` and `administer`, with `design` and `manage_definitions` beside them (below)                                                                                                                                                                                      |
| **IAM-021** | `role` is a tenant's row - a name and a set of permissions - created, changed and removed through the roles routes. The roles a tenant starts with are rows like any other                                                                                                                                                             |
| **IAM-022** | A grant's subject is exactly one of a principal or a group                                                                                                                                                                                                                                                                             |
| **IAM-009** | A group can stand for a value the organisation's provider asserts in a configured claim; membership of such a group is replaced from the claim at every sign-in, and granting the group a role maps it                                                                                                                                 |
| **IAM-062** | `access_grant` is the only table that confers a permission, and every row names a role, one subject and one level. There is no per-principal permission column anywhere                                                                                                                                                                |
| **IAM-024** | The decision walks artifact, space, tenant, and a level with nothing to say passes the question up                                                                                                                                                                                                                                     |
| **IAM-025** | The nearest level that says anything about the permission decides, so an explicit grant or denial below overrides what that level would inherit                                                                                                                                                                                        |
| **IAM-026** | At the deciding level, any denial wins over any allow, whether each reached the principal directly or through a group                                                                                                                                                                                                                  |
| **IAM-027** | No effective permission is stored. Every decision reads the grants at the moment it is asked, so a change at the top applies below at once                                                                                                                                                                                             |
| **IAM-063** | Every decision takes a shared lock on the tenant's `access_epoch` row inside the transaction of the act; every change a decision reads - grants, roles, memberships, spaces, a principal's kind - takes it exclusively, so no change can land between a check and its act                                                              |
| **IAM-029** | An administrator opens **Access** on any artifact, chooses a person, and sees every permission with its answer                                                                                                                                                                                                                         |
| **IAM-030** | Each answer names the level that decided it and every grant at that level that did - role, subject, and whether it reached the person through a group                                                                                                                                                                                  |
| **IAM-031** | A refusal names the denying grants, or says that no level grants the permission and lists the levels it looked at                                                                                                                                                                                                                      |
| **TPL-006** | Creating a template needs `design` at its space and `create` does not reach templates; changing one needs `design` on it, not `edit`; and a document never inherits from the template it was made from                                                                                                                                 |
| **MET-024** | Changing or creating a field, a metadata schema or a component type needs `manage_definitions`, a permission of its own that a role can hold without `administer` or `design`                                                                                                                                                          |
| **IAM-049** | A grant carries an optional expiry, and **for an external principal a grant without one confers nothing**. Granting to an external principal takes the tenant's default expiry when none is given and refuses one past the tenant's cap, so external access cannot be left unset whichever way it arrives                              |
| **IAM-071** | For an external principal, a grant at the tenant is refused where it is made and not read where it is decided, so external access is only ever against a named space or artifact - a publication included, since a publication is an artifact                                                                                          |
| **IAM-059** | Whoever provisions a tenant invites its first administrator to a named address; the first sign-in through a permitted route whose provider verifies it is Administrator. There is no local credential (IAM-042) and no vendor account: the invitation is used once and lapses, which is shown only by absence ("Roles", "Invitations") |
| **IAM-072** | An administrator of the tenant invites an address, which makes a principal at once; every grant route names it before anybody has signed in, and what it is granted confers nothing until the first sign-in through a route the tenant permits whose provider asserts that address verified, which claims it ("Invitations")           |
| **IAM-051** | `GET /v1/access/external` lists every external principal, each with every grant reaching them - directly or through a group, with its level and expiry - and the readable set those grants produce                                                                                                                                     |
| **API-053** | One refusal vocabulary for every route, below, and a contract test that fails when a route does not declare the permission it checks                                                                                                                                                                                                   |

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
| IAM-016                   | Referencing across spaces is T4; `readableSet` below is what it will call. Re-checking at publish, IAM-017's, is now IAM-074, and [publishing.md](publishing.md) claims it: the publisher's permission is decided at the publication (decision C)                                                                                                              |
| IAM-020, IAM-070          | A data connection's results and the named high-risk acts are T2. Each arrives as a new permission in the closed set, which is a code change with a migration of the check constraint and nothing more                                                                                                                                                          |
| IAM-032                   | Evaluating as another user is T2. `explain` already takes the principal as a parameter, so it is a route and a permission, not a new model                                                                                                                                                                                                                     |
| IAM-005, IAM-010, IAM-033 | Tenant-scoping of derived data is each derived store's; a disabled user losing access is the session check's; service identities are the token design's                                                                                                                                                                                                        |

## Spaces

A **space** is `id`, `name` - unique within the tenant - and when it was created. Content artifacts
live in exactly one: a component, a document (which holds its own outline), a template, an asset, a query definition.
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

**Publishing releases content.** A publication is an artifact in its document's space, and who may
read it is decided on the publication, on its own grants - never on the document or on the components
it was made from ([publishing.md](publishing.md), decision D). So a reader of a publication reads every
component in it, including components they may not read in the editor, and a recipient outside the
tenant reads it without being able to read any component at all. That is what publishing is for, and
it is safe only because of what `publish` requires: **the publisher must be able to read every
component the published document contains**, decided at the publication rather than when each
reference was made, and a publish holding one they may not read is refused, naming the place in the
outline and never the component (publishing.md, decision C; IAM-074, and issue #143 for every
component in T1). A publication therefore never releases anything its publisher could not already
read. A grant on a document does not reach its publications, and a grant on a publication reaches
nothing else.

**`administer` confers no content permission.** An administrator who wants to edit a component grants
themselves a role that allows it, and that grant is visible in every explanation afterwards. It is
still a way to reach anything, and IAM-070 exists to split the riskiest parts of it out.

**No permission implies another in the decision.** Instead, **an allow of a role that does not hold
`read` is refused** where the grant is made: allowing `edit` without `read` describes nobody real, and
refusing it there is simpler than an implication table every explanation would have to show. **A
denial may name any role**, and that is what makes one artifact read-only for somebody who authors its
space: denying them a role holding `edit` alone, on that artifact, decides `edit` there and says nothing
about `read`, `comment` or `suggest`, which the space still decides. Denying a role that holds `read`
denies `read` too, as it denies everything the role holds.

## Roles

A **role** is `id`, a `name` unique in the tenant, and its permissions - at least one, each once. A
tenant starts with eight, which are ordinary rows it may rename, change or remove:

| Role                | Permissions                                    |
| ------------------- | ---------------------------------------------- |
| Reader              | `read`                                         |
| Reviewer            | `read`, `comment`, `suggest`                   |
| Author              | `read`, `create`, `edit`, `comment`, `suggest` |
| Approver            | `read`, `comment`, `approve`                   |
| Designer            | `read`, `design`                               |
| Definitions manager | `read`, `manage_definitions`                   |
| Administrator       | `read`, `administer`                           |
| Editing             | `edit` - for denials; it cannot be allowed     |

Editing is a starter role rather than one each tenant makes, because "read-only here" is the first
denial anybody reaches for, and a role a tenant must think to create before it can do that is a role
nobody finds.

Changing a role changes the access of everybody holding it, at once, which is what a bundle is for.
Removing a role that any grant names is refused; the grants go first, so nobody loses access as a
side effect of tidying. Taking `read` out of a role that any allow names is refused for the same reason
an allow of such a role is.

**A tenant cannot lock itself out.** A tenant's first administrator is **invited** by whoever provisions
it, to a named address, best before any sign-in route is permitted, and only an administrator of the
database can make that invitation: it records who provisioned in `named_by`, a column the runtime role is
not granted to write. It is an invitation like any other ("Invitations"), whose principal is granted
Administrator at the tenant when it is made, so the first sign-in through a permitted route whose provider
verifies the address is that administrator. It takes the access epoch exclusively first, since it makes a
grant. It is refused once somebody who has signed in administers the tenant, while another address's
invitation to administer waits unexpired, for an address somebody who has signed in already shows,
verified, and for an address whose waiting invitation is external (`first_administrator.external`) -
renewing it would make an external principal Administrator by a grant that never passed the external
rules, and would block every other address while it waited. Inviting the same address again renews it,
and one that lapsed for another address is withdrawn and replaced. After the epoch it takes the
address's advisory lock, as inviting and a first sign-in do ("Invitations"), so a sign-in with the
address has committed before it reads or waits until it commits. A claim of another address takes
neither, so it can commit while the invitation waits on an invitation's row; both refusals that a claim
can change are asked again after each such lock. The
`first_administrator` table of namings by issuer and subject is kept as the record of the tenants that
were bootstrapped that way, and nothing names or claims one any more.

**What IAM-059's last clause rests on.** "Never created by a local credential" is true by construction:
no credential exists (IAM-042). "Never by a vendor account that outlives the bootstrap" is answered by
there being no account at all - the invitation is a principal nobody can sign in as, claimed once and
lapsing in fourteen days - and **that is shown only by absence**: no test can demonstrate an account
that does not exist, and the test citing IAM-059 shows the invitation, the verified first sign-in through
each route, and nobody else administering.

After that, **a change is refused if it would leave no principal who has signed in holding `administer`
at the tenant through a direct grant with no expiry** - removing that grant, taking `administer` out of
its role, removing the role, or making that principal external, since the cap would then refuse it. A
change that does not reduce that number is never refused by this rule, whatever the number is. A grant
with an expiry does not count, because it would end the tenant's administration on a date with nobody
acting; nor does a grant to somebody invited who has not signed in, who may never.
**A denial of a role holding `administer` at the tenant is refused where it is made**: the count counts
allows, and a denial reaching the last administrator - directly or through a group - would leave the
count unchanged and nobody able to undo it.

Only direct grants count, which is why removing somebody from a group, or removing a group, never trips
it: neither can change the count, and no group can carry a denial of `administer` at the tenant.
Tenant-managed groups are left out as well as provider groups, because a guard that counted them would
need a second rule for what leaving one does, and a rule an administrator can state in one sentence is
worth more than the case it would save.

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
level and effect cannot be granted twice.

**Making or removing a grant needs `administer` at its level or above**, and "or above" is meant
literally: it is allowed when `administer`, asked of the grant's level or of any level above it on that
level's chain, is allowed - each asked as its own walk from that level. A tenant administrator therefore
manages every level below, even one where a denial of `administer` refuses them the nearer walk; a space
administrator manages that space and its artifacts. The nearest-level walk alone would let a denial at a
space stand against the tenant's own administrators, which nobody could then remove.

A route that changes access **takes the access epoch `FOR UPDATE` before it decides**. Deciding takes the
row `FOR SHARE`, and the change's own write takes it exclusively, so a change that decided first would
upgrade its lock - and two such changes at once would each wait for the other until Postgres aborted one.
**The known cost**: the lock is taken before `administer` is decided, not after, so any signed-in caller
of a change route holds the epoch exclusively for a moment before being refused, whatever they may do -
accepted so that no route can forget the ordering and deadlock another instead.

### Invitations

An administrator of the tenant **invites an address**, so the person can be granted access before they
first sign in. The invitation makes a **principal at once**, with no issuer and no subject, holding
nothing; every grant route names it like anybody else, so every rule a grant is made under - the
external rules included - applies where the grant is made, and `explain` answers for it. Nobody can sign
in as it, so what it is granted confers nothing until somebody does. An address is kept trimmed and in
lower case, and at most one invitation waits for an address.

**Claiming.** A sign-in that finds no principal by issuer and subject, through a route the tenant
permits, looks for a waiting, unexpired invitation to the address its provider asserts **as verified**.
If there is one, that principal takes the sign-in's issuer and subject, the invitation records that it
was accepted and through which route, and from then on the principal is found by issuer and subject
alone - a later change of address, or somebody else acquiring it, changes nothing. An address the
provider does not verify never claims, and a sign-in that finds its principal never looks. A claim
gives an identity only to a principal that has none, and accepts nothing where that update changes no
row. An invitation is accepted once: a second account presenting the address, through either route, is
a new principal holding nothing on the organisation's route, and refused on the Google route unless a
named domain admits it.

**Why an address is safe enough here, when "What was ruled out" once ruled a naming by address out.** An
address is a claim some providers let a user set, so it is trusted only where the provider asserts it
verified, only until the first such sign-in binds it to an identity, and, for every invitation made
through the service or for a first administrator, only for fourteen days; the administrator sees
who accepted it and through which route. The residual risk is a provider that asserts `email_verified`
for an address its user does not control - which is the tenant's own provider on the organisation's
route, and on the Google route an account whose mailbox was verified once and lost since. Both are
visible in the listing, and bounded only where the invitation has an expiry; neither is closed by this
design.

**Invitations with no expiry.** Two kinds never lapse: one an operator makes with `inviteToTenant`, as
whoever provisions the tenant, and one migrated by 0014 from 0004's shape. Either is claimable through
any route the tenant permits for as long as it waits, so the two risks above are not bounded for it;
renewing one through the service keeps it with no expiry, and withdrawing it is the only end short of a
claim.

**Changing no fact.** Making an invitation inserts a principal, which no trigger watches, and claiming
one gives a principal its issuer and subject, which no decision reads; so neither takes the access epoch,
and neither sign-in route takes it to claim. One check does read them: the lock-out guard
(`administeringGrants`, and `administeredQuery` for the first administrator) counts only principals whose
`issuer is not null`. Reading that without the epoch is safe because a claim only ever adds to the count -
it gives an identity and removes none - so a count read before a claim commits is lower than the truth,
and a stale read can only refuse more, never allow a change that leaves nobody administering. **Withdrawing** an invitation nobody has accepted removes its
principal with every grant and membership that named it, which changes access: the route declares
`changesAccess`, takes the epoch `FOR UPDATE` and then the invitation's row. A claim takes the
invitation's row and then the principal's, and never the epoch, so the two cannot wait on each other in
a cycle.

**Renewing and refusing.** Inviting an address that already waits renews it for fourteen days - or
leaves it with none, where it had none - and keeps its grants; one that says the other thing about being
external is refused, to be withdrawn and invited again. Inviting an address somebody who has signed in
shows, verified at their last sign-in, is refused: they are granted directly. An address shown
unverified refuses nothing, so an account cannot squat an address to keep its owner from being invited.
A principal from before 0014 has `email_verified` false until its next sign-in, so it refuses nothing
either; an invitation to its address is never claimed by it, because its sign-in finds it by issuer and
subject first. Two invitations of one address at once take turns on a transaction's advisory lock keyed
by the tenant's schema and the address, so the second renews what the first made. **A first sign-in
takes the same lock**: a claim, for an address the provider verifies, takes it before looking for the
invitation, and holds it to the end of the sign-in's transaction, through the principal that sign-in
makes when it claims nothing - so an invitation cannot find nobody signed in with the address while
that principal is still uncommitted, and make itself a waiting invitation beside them. And because a
claim can commit while an invitation waits on its row, whether somebody has signed in with the address
is asked again before a new principal is made.

The locks are taken in one order, so none waits on another in a cycle: a claim takes the address's
lock, the invitation's row, then the principal's; inviting, the epoch `FOR SHARE` as it decides, the
address's lock, then the invitation's row; inviting the first administrator, the epoch `FOR UPDATE`, the
address's lock, the invitation rows, then the principal; withdrawing, the epoch `FOR UPDATE`, the
invitation's row, then the principal, never the address's lock; and a grant, the epoch `FOR UPDATE`, then
the principal it names.

**Internal or external** is the administrator's to say when inviting, and the principal's `kind` from
the first; a sign-in never changes it.

**Delivering an invitation is not the product's.** Nothing sends mail. The administrator tells the person
where to sign in; the invitation waits for them to do it.

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

**Where a grant is made**, these refusals and the default expiry apply to an allow only: an allow to an
external principal is refused if it holds a capped permission, if it is at the tenant (IAM-071), or if its
expiry is past the tenant's cap, and one given no expiry takes the tenant's default (IAM-049). A denial is
never refused on any of those three counts and never defaulted - it can only remove access, so a denial at
the tenant stands, and a denial with no expiry denies for good, exactly as `decide` already counts it. A
grant to a tenant-managed group with an external member is held to the same three refusals when it is an
allow, but **is not given the default expiry**, because the group's other members would lose access on a
date nobody chose; for the external member, the decision ignores an allow with no expiry. Adding an
external principal to a group is refused where any allow the group holds would be refused to them
directly; a denial the group holds is never a reason to refuse the addition.

**Where a decision is taken**, an external principal's grants at the tenant and grants with no expiry
are ignored when they allow, every unexpired denial counts, and then the cap applies. That covers the membership no
administrator made - a provider asserting an external principal into a group - which cannot be refused
where it happens.

**Extending external access** (IAM-050) is a new grant with its own expiry, naming the grant it
`extends`, which is removed in the same change: a positive act by an administrator, capped afresh, and
never a clock that renews itself. The tenant's default and cap are two settings in days, 30 and 90 unless
the tenant changes them; the cap can be raised and never removed.

### Denials

**A denial is a role too** (IAM-062). "Deny Author on this component to Grace" names a bundle, so its
explanation reads the same way an allow does; so does "Deny Editing on this component to Grace", which
leaves her reading it.

**A denial does not reach past a nearer allow.** Because the nearest level decides, a denial at the
tenant does not bind inside a space where someone administers and allows it; a tenant-wide rule that
must hold everywhere is not expressible as a denial.

## Groups

A **group** is `id`, a `name`, and its source:

- **Tenant-managed**: members added and removed by an administrator.
- **From the organisation's provider**: the group names a value, and the tenant's provider
  configuration names the claim that carries values (`groups` by default). At every sign-in through
  that provider, the principal's memberships of provider groups are brought into line with the values
  in the claim - **only the memberships that differ are added or removed**, because each change takes
  the access epoch exclusively, and replacing them all would take it at every sign-in. A value with no
  group is ignored, so an administrator decides which of the directory's groups mean anything here
  (IAM-009).

**The Google route asserts no groups.** Reading a Workspace user's groups needs a directory scope,
which IAM-044 forbids requesting. A principal who signs in with Google is placed in groups by an
administrator or not at all, and a tenant that wants its directory to drive access is a tenant that
configures its own provider.

## Deciding

`decide(question, facts)` is pure. The question is a principal, a permission and a target, and a
target is an artifact, a space or the tenant. The facts are what the service loads in the transaction of
the act, under the access epoch's shared lock: the principal's kind, the groups they are in, the target's
chain from itself upwards, and every unexpired grant at those levels whose subject is the principal or one
of their groups, with each role's permissions.

1. **Where the walk starts.** Creating asks about the space the artifact will be created in - `design`
   for a template, `create` for any other kind; `create` asked of an artifact starts at its space, or at
   the tenant for an artifact in no space. `manage_definitions` asks about the tenant. Every other
   permission, `administer` included, asks about the target itself: whether somebody may change grants
   at a space is `administer` asked of that space, whose chain is the space and the tenant.
2. From there upwards, take the grants whose role holds the permission - for an external principal,
   leaving out grants at the tenant and grants with no expiry.
3. At the first level with any: **a denial there refuses; otherwise an allow there allows.** Levels
   further up are not read.
4. No level with any: **refused, because nothing grants it**.
5. After that, **the external cap** from the table above, whatever step 3 found; the explanation says
   the cap refused it.

The answer is `{ allowed, reason, level, grants, checked }`: whether it is allowed; `allowed`, `denied`,
`not_granted` or `capped`; the deciding level, or none; the grants that decided at it, each with the group
it came through; and every level checked. **Enforcement reads `allowed`; the Access view shows the rest.**
They are one call, which is what makes IAM-030 and IAM-031 true rather than hoped for.

**The nearest level wins, and that has a consequence worth stating.** IAM-025 lets an allow on one
artifact open it inside a space the person cannot otherwise read. That is what the requirement asks
for - it is how one component is shared out of a restricted space without moving it - and it is why
the grant shows in every explanation and in `readableSet`'s explicit list rather than being implied.

**A document's grants do not reach the components it references.** A component is reused by
documents in any space, so a permission that flowed from a document would make a component's access
depend on who happens to use it, and one grant on a report would open every component the report
quotes. A component's chain is the component, its space and the tenant, never a document. Seeing a
component inside a document therefore needs `read` on the component, which is the rule IAM-016 and
IAM-074 (IAM-017's replacement) already state for T4.

**A definition is read through what uses it.** A field, a metadata schema and a component type live in
no space, so an author granted only a space would otherwise be refused `read` on the very definitions
their component is written against. A route authorised on a component - reading it, editing it - loads
the definition versions that component records, and the fields they resolve to, without a second
decision: what the author sees of them is what the component needs. Reading a definition on its own -
listing fields, opening a component type - is `read` asked of the definition, whose chain is itself and
the tenant.

The same holds when a component is being created and does not exist yet: a route authorised by `create`
on a space - `GET /v1/spaces/{space}/component-types` - reads the component types a component made there
could take. Creating asks about the space (step 1), so the definitions it needs to offer are read by the
same decision, and an author granted only a space is never refused the choice MET-011 makes them make.

### Taking the decision with the act

IAM-063 is met with one row. Each tenant schema holds `access_epoch`, a single row. **Every change to a
fact a decision reads** - a grant made or removed, a role's permissions, a group membership, an
artifact's space, a principal's `kind` - updates it, which takes the row's exclusive lock. **A trigger on
each of those writes does the update**, rather than each write path, because the rule is "every write",
and a write path that forgot would be silent; a test holds the list of facts the loaders read against the
triggers, and fails for a fact no trigger locks. The triggers are per row, so a statement that changes
nothing - removing an empty group, whose cascade removes no member - takes no lock. Creating a role, a
group, a space or an artifact changes no decision anybody could already ask, and a role can be removed
only while no grant names it, so none of those takes it. **Every decision** reads the row `FOR SHARE` in
the transaction of the act it authorises, before any other fact. So a revocation that starts while a write
is authorised waits for that write to commit, and a write that starts after a revocation waits for the
revocation and then sees it.

The facts are several statements in that transaction rather than one query: under read committed each
statement has its own snapshot, but no change to access can commit while the shared lock is held, so they
agree.

Writes proceed together, because shared locks do not conflict with each other. Access changes queue
behind in-flight writes, which are short, and a change to access is an administrator's act measured in
seconds, not a hot path. A stream cannot hold a lock for its lifetime, which is why realtime.md ends a
stream on a permission change and authorises the reconnect afresh (API-016).

### The readable set

Search, traversal and the stream filter many artifacts at once, and do it inside a query rather than
by calling `decide` per row (SCH-005, REL-019). `readableSet(principal, facts)` returns what they need,
computed by `decide` itself so the two cannot disagree:

- **tenant**: whether `read` is allowed at the tenant, which is what an artifact in no space - a
  definition - inherits;
- **spaces**: every space where `read` is allowed at the space, or inherited from the tenant;
- **excluded**: artifacts in those spaces, or in no space when the tenant allows, where an
  artifact-level grant decides `read` as refused;
- **included**: artifacts anywhere else where an artifact-level grant decides `read` as allowed.

The predicate is `((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded))
or id = any(included)`. search.md and relationships.md described the set as the first half only; both now
say all of it.

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

These are the codes the service already returns; this design fixes when each applies. The tenant as a
target always exists, so asking of it is never 404.

**An artifact the caller may not read is indistinguishable from one that does not exist**, so an
identifier cannot be probed for existence - the rule relationships.md already applies to a walk. A
403 names the permission refused and nothing more: the grants behind it are an administrator's to see,
through Access, not a caller's to learn from an error.

**Every route declares its permission and target** in `packages/api-contract` beside its schema. The
service's route helper takes them from there, decides inside `withTenant`, and runs the handler only
on an allow, in the same transaction. A contract test fails for any route without a declaration, and
every route has the cross-tenant test IAM-004 already requires plus one as a principal holding nothing.

## Routes

| Route                                                   | Needs                                       | Does                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                                         |
| `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                                                  |
| `GET /v1/roles?level=`                                  | `administer` at the level or above          | The roles a grant can name, to anyone who may grant at that level                                                           |
| `GET /v1/principals?level=`                             | `administer` at the level or above          | Everybody who has signed in or been invited, to choose a subject or a person to explain                                     |
| `GET`, `POST /v1/invitations`                           | `administer`, tenant                        | Lists every invitation; invites an address or renews its invitation                                                         |
| `DELETE /v1/invitations/{id}`                           | `administer`, tenant                        | Withdraws an invitation nobody has accepted, with its principal and every grant to it                                       |
| `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}`        | `administer`, tenant                        | Creates, changes and removes roles, with the role and lock-out guards above                                                 |
| `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                                             |
| `GET /v1/grants?level=`                                 | `administer` at the level or above          | The grants made at one level                                                                                                |
| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant; a grant the caller may not manage answers as one that does not exist                              |
| `GET /v1/access/external`                               | `administer`, tenant                        | Every external principal, each grant reaching them with its level and expiry, and what those grants let them read (IAM-051) |
| `PUT /v1/principals/{id}/kind`                          | `administer`, tenant                        | Marks a principal external or not, under the lock-out guard. Nothing in T1 offers it on screen                              |
| `GET /v1/access?target=`                                | `read` on the target                        | The caller's own answer for every permission on it, and `modesFor` - what the renderer offers from                          |
| `GET /v1/access/explain?principal=&target=`             | `administer` at the target's level or above | Every permission for that principal on that target, each with its full explanation (IAM-029 to IAM-031)                     |

A target is spelled `tenant`, `space:<id>` or `artifact:<id>`.

The invitations routes' target is the tenant, so a caller who may not administer it is refused 403, never 404. Withdrawing names an invitation by a lowercase uuid: anything else is 400 `invalid_request`, and one that does not exist, or is another tenant's, is 404. A refusal of what was asked is a 409 - `invitation_signed_in`, `invitation_kind_differs` or `invitation_accepted`.

**Access** is a panel on any artifact, for an administrator: choose a person, and read a row per
permission - allowed or refused, the deciding level, the grants that decided it, and the cap where it
applied. It is read-only; grants are made from the same panel's second tab, one role, one subject and
one effect at a time.

## Stores

In each tenant's schema:

| Table                 | One row per                     | Carries                                                                                                                                                                       |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space`               | Space                           | Name, created at                                                                                                                                                              |
| `role`                | Role                            | Name, permissions as an array checked against the closed set                                                                                                                  |
| `access_group`        | Group                           | Name, source, the provider value where it has one                                                                                                                             |
| `group_member`        | Principal in a group            | When a provider last asserted it; its source is its group's                                                                                                                   |
| `access_grant`        | Grant                           | Role, principal or group (a check allows exactly one), level and its target, effect, expiry, the grant it extends, granted by and at                                          |
| `access_epoch`        | Tenant - one row                | When access last changed                                                                                                                                                      |
| `access_policy`       | Tenant - one row                | The default and the cap on external expiry, in days                                                                                                                           |
| `first_administrator` | Naming of a first administrator | Issuer, subject, the role, who named them and when; who claimed it, when, and whether it was granted. Kept as a record; nothing writes it                                     |
| `invitation`          | Invitation to an address        | The address, the principal it made, who invited - a principal, or `named_by` for whoever provisioned - and when, its expiry, and when and through which route it was accepted |

Two existing tables change: `principal` gains `kind` - `user`, `service` or `external`, defaulting to
`user` - so the cap has something to read, loses the requirement to have an issuer and subject, which an
invited principal has not yet, and gains whether its address was verified at its last sign-in;
`identity_provider` gains the name of its groups claim. The runtime role may insert and update only the
`invitation` columns the service writes, never `named_by`.
[storage-and-versioning.md](storage-and-versioning.md)'s `artifact` gains `space_id`.

## Where the code lives

`packages/domain/src/access/`: the permission set, role validation, `decide`, `readableSet` and
`modesFor`. No database: the service loads the facts for a question and passes them in. The route helper
and the stores are `apps/service` and `packages/db`.

## Verification

- **A decision table as tests**: for every permission, an allow and a denial at each of the three
  levels in every combination, direct and through a group, asserting the answer and the level and
  grants named - so IAM-024 to IAM-026 are exercised rather than argued.
- **Read-only on one artifact**: an author of a space denied Editing on one component reads it and does
  not edit it; a denial of a role holding `read` refuses `read`; an allow of a role without `read` is
  refused where it is made.
- **`decide` and `readableSet` agree**: a property test generating grants over a small tenant - with an
  artifact in no space - and asserting that an artifact is in the readable set exactly when `decide`
  allows `read` on it.
- **Explanations are the decision**: every refusal names grants or levels checked, and never an empty
  reason.
- **The lock**: two transactions - a write authorised and a revocation - interleaved at each point, in
  Postgres, asserting the write either commits before the revocation or is refused after it.
- **Every route**: the contract test for a declared permission, a principal holding nothing, and the
  second tenant.
- **404, not 403**, for an artifact the caller may not read, compared byte for byte with the answer for
  an identifier that does not exist.
- **Lock-out**: a grant with an expiry never counts as the last administrator; removing the last direct
  tenant administrator's grant, their role's `administer`, the role itself, or making them external is
  refused; removing a group or a member never is; a denial of `administer` at the tenant is refused.
- **The first administrator**: the first sign-in through a permitted route whose provider verifies the
  invited address is Administrator, and nobody else is; the invitation is refused once somebody
  administers, while another waits, and for an address somebody signed in shows, including when a claim
  commits while it waits; a route closed before the callback claims nothing; the runtime role cannot
  write `named_by`.
- **Invitations**: a grant names the invited principal before anybody signs in and holds from the first
  verified sign-in; an unverified or lapsed address never claims, nor a second account; withdrawing takes
  the grants with it and is refused once accepted; an invited administrator never keeps the tenant
  administered; two invitations of one address at once renew rather than duplicate; and a claim lands
  while a decision is in flight, beside a grant to the same principal and against a withdrawal, without
  a deadlock.
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
- **A denial naming permissions rather than a role.** It would make "read-only here" one grant, but an
  explanation would then name a list rather than a bundle, and IAM-062 holds every permission to a role.
  A role for denials does the same and reads the same way.
- **The first administrator made as the first to sign in, or granted by a command run after they sign
  in.** The first to sign in is whoever is quickest through a route the tenant permits; and a command
  after sign-in leaves the tenant unusable until an operator acts, and needs a principal id somebody has
  to find. **Named by issuer and subject** was built first and is retired: a tenant that signs in only
  through Google cannot know the subject before the first sign-in, and IAM-059 asks for an address. An
  address was first ruled out here as a claim a user can change; "Invitations" says why a verified one,
  bound at its first sign-in and lapsing, is safe enough.
- **Grants waiting on an invitation, applied when it is claimed.** A second grant store, checked by
  every rule again at the claim - when the role may have changed and the external cap may refuse it -
  and invisible to `explain` until then. A principal made at the invitation keeps one store and one
  set of rules.
- **An invitation claimed by a principal who already exists**, moving the invited principal's grants to
  them at their next sign-in. It would take the access epoch at a sign-in, re-check every grant, and
  decide what a duplicate or a different `kind` means; refusing to invite an address somebody signed in
  shows costs the administrator one choice instead.

## Open questions

| ID       | Question                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New      | How many artifact-level grants a principal can hold before `readableSet`'s explicit lists stop being a good predicate. Artifact grants are meant to be exceptions; a tenant that uses them as its main model would find out by load                                                                                                                                                              |
| Answered | Whether a tenant's first administrator should arrive through this design's grants at provisioning, or wait for IAM-059's bootstrap. First through a naming by issuer and subject, claimed at first sign-in; now through an invitation to an address, whose principal holds Administrator from the invitation ("Roles", "Invitations"), which a tenant signing in only through Google can use too |
| New      | Whether `comment` and `suggest` are worth separating in T1, when both are T3 capabilities. They are in the set because IAM-019 names them, and a role editor showing two permissions nothing checks yet should say so                                                                                                                                                                            |

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

## Changed while planning the build

[The access plan](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md) was written against
this document and proved in code before it was built. Planning found seven places where the document was
wrong or unfinished; Ken ruled on the two that needed a decision, and the rest are corrected here. No
requirement claim changed, because every one is still answered in full. IAM-063's row is read with
"Taking the decision with the act": of roles and spaces, what takes the lock is a change to a role's
permissions and to an artifact's space, since nothing else about either is a fact a decision reads.

| Found                                                                                                                                                              | Change                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nobody could be made read-only on one artifact inside a space they author**: every role held `read`, and a denial denies the whole role                          | **Ruled by Ken.** An allow must hold `read`; a denial may name any role; Editing, `edit` alone, is a starter role ("Permissions", "Roles")                                                                                                      |
| **A denial of `administer` could lock a tenant out**, unseen by a guard that counts allows                                                                         | A denial of a role holding `administer` at the tenant is refused where it is made ("Roles")                                                                                                                                                     |
| **No tenant could get its first administrator**: a grant needs a principal, and provisioning happens before anyone signs in                                        | **Ruled by Ken.** A naming by issuer and subject, claimed once at first sign-in under the access lock ("Roles"); IAM-059 joins the unclaimed table, because a naming is not an invitation to an address. Since replaced by an invitation, below |
| **The readable set left out every artifact in no space**, so it disagreed with `decide` for definitions                                                            | `tenant` joins the set and the predicate ("The readable set")                                                                                                                                                                                   |
| **An author granted only a space could not read the definitions their component uses**                                                                             | A definition is read through the component a route is authorised on ("Deciding")                                                                                                                                                                |
| **"`administer` at its level or above" disagreed with the nearest-level walk**, which lets a denial at a space stand against the tenant's administrators           | "Or above" means any level on the chain, each asked as its own walk ("Grants")                                                                                                                                                                  |
| **Two lock costs**: a change that decides first upgrades its lock and can deadlock another; replacing provider memberships at every sign-in locks at every sign-in | Changes take the epoch `FOR UPDATE` before deciding ("Grants"); provider memberships change only where they differ ("Groups"). The lock is taken by triggers, listed in "Taking the decision with the act"                                      |

[The grants plan](../plans/2026-09-17-access-02-managing-grants.md) was written against this document in
turn, and found six more. No requirement claim changed.

| Found                                                                                                                                 | Change                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A space administrator could grant nothing**: listing roles needed `administer` at the tenant                                        | Roles, and the people to choose from, are listed to whoever administers the level asked about ("Routes")                                                                                              |
| **Nothing listed a person**, though the Access panel chooses one and a grant names one                                                | `GET /v1/principals?level=`: everybody who has signed in. A person who has not cannot be granted anything until IAM-059's invitations are designed. Since built, below: anybody invited is listed too |
| **Removing a grant had no target to decide against**, and making one names its level in the body                                      | A route's target can be a body member or a grant, whose level is read under the lock; a grant the caller may not manage answers 404, since grants are an administrator's to see ("Routes")            |
| **"Takes the epoch `FOR UPDATE` before it decides" was a rule nothing checked**: a route that forgot passed every test that ran alone | A route declares `changesAccess`; every other permission-checked route decides only, and a change in its transaction is refused by the epoch's trigger and by `lockAccessForChange` ("Grants")        |
| **The lock-out guard named three changes, and one exists**                                                                            | Built for removing a grant, counting through `administeringGrants`; changing a role's permissions and a principal's kind call it when their routes are built ("Roles")                                |
| **An explanation names a group only by its id**, so a view cannot say which group a grant came through                                | Not changed: the access page says "through a group" until the groups routes give a group a name to show                                                                                               |

[The invitations plan](../plans/2026-09-17-access-03-invitations.md) was written against this document in
turn, and found five more; building it, and reviewing each task, found four. Two rows above are marked
as since replaced rather than rewritten, because each was true when it was written. IAM-059 joins
"Requirements owned", because an invitation to a named address now answers it; IAM-060, its audit, stays
unclaimed with LIF. IAM-072 joins it, filed as issue #113 when planning found that nothing asked for
inviting anybody but the first administrator.

| Found                                                                                                                                                                                         | Change                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nobody could be granted anything before signing in**, and access.md never said so                                                                                                           | Invitations make a principal at once, claimed at the first verified sign-in ("Invitations")                                                                                                             |
| **IAM-059's unclaimed row said it needed the bootstrap audited**, which is IAM-060's statement, not IAM-059's                                                                                 | IAM-059 is claimed; IAM-060 stays in the unclaimed row with IAM-013 and IAM-037                                                                                                                         |
| **A Google-only tenant could not get a first administrator**: nobody knows the subject Google assigns before the first sign-in                                                                | **Ruled by Ken (the plan's decision A).** The first administrator is invited to an address; the naming by issuer and subject is retired, and its table kept as a record ("Roles", "What was ruled out") |
| **The lock-out guard counted a grant to anybody**, which would let an administrator remove their own grant while only an unaccepted invitation held Administrator                             | The guard, and the first administrator's own count, count only principals who have signed in ("Roles")                                                                                                  |
| **A sign-in that locked an invitation's row and then the epoch would deadlock against a withdrawal**, which locks them the other way round                                                    | Claiming changes no fact and takes no epoch, in either sign-in route; withdrawing takes the epoch and then the row ("Invitations")                                                                      |
| **Built: the lock two invitations of one address take turns on was keyed by the address alone**, so two tenants inviting one address contended on one lock                                    | Keyed by the tenant's schema and the address ("Invitations")                                                                                                                                            |
| **Built: a claim committing while an invitation waited on its row went unseen**, so a second invitation, or a second Administrator, could be made                                             | Inviting, and inviting the first administrator after taking the epoch, ask again whether somebody signed in with the address or administers, after each lock a claim can hold ("Roles", "Invitations")  |
| **Built: a claim marked an invitation accepted without checking that it gave anybody an identity**                                                                                            | A claim accepts only where it gave an identity to exactly one principal that had none ("Invitations")                                                                                                   |
| **Built: "only an administrator of the database names the first administrator" was said and not enforced**: the runtime role could write `named_by`                                           | Migration 0014 takes insert and update on `invitation` away from the runtime role and grants back only the columns the service writes ("Stores")                                                        |
| **Built: a sign-in that claimed nothing could commit a verified principal while an invitation of its address was being made**, leaving a waiting invitation beside somebody signed in with it | A claim takes the address's advisory lock before looking, held through the principal its sign-in then makes; inviting the first administrator takes it after the epoch ("Invitations")                  |
| **Built: inviting the first administrator renewed an external invitation to the address**, and granted Administrator by a raw insert the external rules never saw                             | Refused as `first_administrator.external` ("Roles")                                                                                                                                                     |
| **Built: "no decision reads" a principal's issuer and subject** overlooked the lock-out guard, which counts only principals with an issuer                                                    | Said, with why reading it without the epoch is safe ("Invitations")                                                                                                                                     |
| **Built: a principal from before 0014 has `email_verified` false**, which was not said                                                                                                        | Said: it refuses no invitation to its address until its next sign-in, and never claims one ("Invitations")                                                                                              |

[The second editor plan](../plans/2026-09-17-editor-02-creating-a-component.md) was written against this
document in turn, and found one. No requirement claim changed.

| Found                                                                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A definition is read through what uses it, and creating uses one before it exists**: an author granted only a space could not read the component types MET-011 makes them choose between, because there was no component yet to read them through (editor 1's finding 4) | The rule is extended by one sentence ("Deciding"): a route authorised by `create` on a space reads the component types a component made there could take. `GET /v1/spaces/{space}/component-types` is that route, and `GET /v1/spaces`, which this document already designed, is built beside it |

[The first structure plan](../plans/2026-09-18-structure-01-the-document-and-its-outline.md) was written
against this document in turn, and found one; building it found a second. No requirement claim changed.

| Found                                                                                                                                                                               | Change                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **"Spaces" listed a document and an outline as two content kinds**, which [structure.md](structure.md) makes one                                                                    | One kind, a document, which holds its own outline ("Spaces")                                                                                                                                                                                                       |
| **Built: a second listing of content would have been a second copy of the readable-set predicate**, where a fix to how the set is applied could reach one listing and not the other | Not a change to this document: the predicate in "The readable set" is written once in `packages/db` and every listing of content - components and documents - filters through it. A listing of definitions, which live in no space, still needs its third disjunct |

[The publishing design](publishing.md) was written against this document, and Ken's answer to it
(2026-09-19) changed two things here. The one claim change is outside this document: IAM-017 was
superseded by IAM-074, which publishing.md claims.

| Found                                                                                                                                                                | Change                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **access.md never said publishing releases content** (publishing.md, finding 10): a publication is read on its own grants, so its readers read every component in it | Said, with what makes it safe - the publisher must read every component, decided at the publication ("Permissions") |
| **IAM-017 was listed here as T4 and unclaimed**, and ambiguous about whose permission is re-checked                                                                  | Its replacement, IAM-074, names the publisher's; the unclaimed row now says publishing.md claims it                 |
