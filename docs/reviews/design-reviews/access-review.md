# Review of Access.md

Checked against FullTrace2.txt: every row of Requirements owned, every row of What this document does not own, and the IAM section as a whole for requirements the design touches but lists in neither table.

## Gaps

**External access is granted by this model, but its requirements are unlisted and mostly unmet.** IAM-071 (which supersedes IAM-048) says external access must be granted against named artifacts through the permission model in section 6, and PUB-084 requires a publication share to create "a named, time-bounded grant scoped to that publication alone" that appears in the external-access listing. The Grants section does exactly this granting - grants to an external principal at space or artifact level - so IAM-071 is met but absent from Requirements owned. Its companions are not met and appear nowhere:

| ID      | What it asks for                                                                                          | Where the design falls short                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-049 | External access carries an expiry, defaulted and capped by tenant policy, never left unset                | `access_grant` has no expiry; nothing defaults or caps one                                                                                                       |
| IAM-050 | Extending external access is a positive act inside the tenant, audited                                    | No route or rule for extension. A grant is "created and removed, never changed," so an extension would be a new grant with no stated link to the one it extends |
| IAM-051 | An administrator lists every external principal and everything each can reach - IAM-029 from the other end | No route enumerates one principal's grants across levels. `explain` answers per target, and needs `administer` at that target's level or above                |

Either add an expiry to `access_grant` (at least for external subjects), an extension act, and a listing route - or move all four IDs into What this document does not own with the tranche they land in. As it stands, PUB-084 cannot be met from this design.

**A change to `principal.kind` bypasses `access_epoch`.** The decision reads "the principal's kind" among its facts, and the external cap turns on it. But the list of what updates the epoch row - "a grant, a role's permissions, a group membership, a space" - omits changing a principal from `user` to `external`. That change alters every decision for that principal without taking the exclusive lock, so a check and its act can straddle it: precisely the window IAM-063 exists to close. Add kind changes - and any other decision-relevant attribute of a principal - to "every change to access."

**The cap is stricter than IAM-057 names, and misses what IAM-057 names.** The decision caps `create`, `edit`, `approve`, `publish`, `design`, `manage_definitions` and `administer`; IAM-057's list is edit, approve, sign, publish. Two mismatches:

- **`sign` is not in the closed set**, and nothing says how a signing act (LIF-011) is refused for an external principal. If signing passes through a lifecycle gate it is covered by `approve`, but that mapping is not stated, and IAM-047 names sign separately from passing a gate.
- Capping `create`, `design`, `manage_definitions` and `administer` goes beyond the requirement - IAM-047 forbids only edit, gates, signing and publish for an external principal. That may be deliberate: an external principal with `administer` could change grants, and `create` would let one add content IAM-047 never authorises. But the document presents the whole list as "(IAM-057)" without saying which entries are the requirement's and which are this design's own stricter choice.

**The lock-out guard has a hole in tenant-managed groups.** The invariant is stated only over direct grants: no principal holds `administer` at the tenant "through a grant made to them directly." Removing members from a tenant-managed group - or removing the group itself - can leave zero administrators, and nothing refuses it. The rationale given (a provider can empty a group without anybody in the tenant acting) does not apply to a tenant-managed group, where the removal is an administrator's own act; that makes the hole more surprising, not less. Also undefined: what the guard does when no direct grant currently exists. Read literally, every access change that does not add one is refused - which a bootstrap that granted through a group would walk into.

## Inconsistencies

**`create` and template creation.** The TPL-006 row claims creating a template needs `design`, "not `edit` or `create`." But Spaces lists templates among the content artifacts, the permissions table says `create` lets one "Create a content artifact," and step 1 of Deciding sends `create` to the space with no exclusion for the template kind. As written, an Author holding `create` on a space passes the check for creating a template there. The procedure needs a rule - creating a template is checked against `design`, or `create` excludes the template kind - before the TPL-006 row is true rather than asserted.

**`GET /v1/grants?level=` says "`administer` at that level"; `POST` and `DELETE` say "at the level or above."** Read literally, a tenant administrator cannot list grants made at a space they administer only from the top, while `explain` (IAM-029 to IAM-031) uses "at the target's level or above" for the same underlying capability. The read route should say "or above," or the document should state why listing is narrower than explaining.

**Step 1 of Deciding and the permissions table disagree on `administer`.** The table says administer is decided at "the level"; step 1 folds it into "the rest ask about the artifact." Neither states what happens when the target of a question is itself a space or the tenant - for example, asking whether a principal may change grants at a space. Presumably the walk starts at that level; that is not written down.

**`modesFor` is owned in code but unspecified.** Where the code live lists `modesFor` beside `decide` and `readableSet`, and two routes return it, but no sentence states which permission yields read, review or author (CNT-104, CNT-106). The What-this-document-does-not-own row defers *offering* modes to the document view; *deriving* them is left here without a rule.

## Verification missing from the list

- **The external cap**: no test that a grant of a forbidden role to an external principal - or to a tenant-managed group with an external member, or on adding an external member to such a group - is refused; and none that the decision-time cap applies to "the membership no administrator made," the provider-asserted case the Grants section singles out.
- **IAM-027's immediacy**: nothing asserts that changing a role's permissions changes the answer at once for every holder, which is the whole point of storing no effective permission.

## Minor

- IAM-036 (an API or MCP caller acts with the calling identity's permissions) is met by construction - the route helper decides inside `withTenant` for whoever called - but appears in neither table. A row in Requirements owned would close it.
- The epoch list omits deleting an empty group or an unused role. Neither changes any decision, so no bump is needed; saying so precludes the question.