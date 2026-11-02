# Moving content between spaces

Moving an artifact from one space to another in a tenant: T7's MV slice. It answers what
[access.md](access.md) left open ("the act of moving is not designed") and what
[collaboration.md](collaboration.md) left unclaimed. [The MV plan](../plans/2026-11-02-mv-moving-between-spaces.md)
builds it. Marked **(Ken?)** are recommendations awaiting his answer; they change this design if refused.

## The shape in one paragraph

A person who administers an artifact, and may create or administer in another space, moves it there. In
one transaction: `artifact.space_id` changes, most grants made on the artifact itself end, its search
rows follow, its locks and presence go, and an event is written on each side of the audit log. No
version is cut: a move changes where it is, not what it says. Permissions are not recomputed because
none are stored: the chain is read live, so the next decision is already right. A document can take its
components and images with it. Before anything happens, a preview says what will come along, what
stays, and what will stop working.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-015** | `POST /v1/artifacts/{id}/move` moves a component, document, template or image within a tenant; the chain changes with `space_id`, and grants on the artifact itself end, so no old permission is carried (MV-B). |
| **IAM-028** | The next decision reads the new chain; a test holds a person's answer before and after, both ways, and a direct allow and a direct deny each ending.                                                             |

**COL-068 is not claimed yet** (MV-F): it asks for more than this design recommends. It joins the table
as amended, or as written, on Ken's answer.

## Decisions

**MV-A. What moves.** A component, document, template or image, by its own act. Not a publication alone:
it follows its document (`publication.document_id`). Not a bibliography entry or term: their keys are
unique per space, and LIB-030 (a library shared between spaces, T7) is the real answer. Connections, query
definitions, datasets and prompts are configuration, and EI's. A dataset-origin image never moves: it is
held per space by its binding, and the library excludes it.

**MV-B. Direct grants end (Ken?).** An allow on the artifact itself would otherwise open it inside a
space its holder cannot read (access.md, "The nearest level wins"), which is exactly the leak of moving
something confidential into a closed space. A direct deny ends too: IAM-015 says "rather than carrying the
old ones", and the space chosen for the content now says who reads it. The preview counts them; each ends
through `removeGrant`'s event, with the source space passed, since `access.revoked` at artifact level
otherwise has none and a space-filtered log would miss it. The lockout checks count tenant-level grants
only, so no ended grant can trip them.

**The exception: a publication's shares stay (Ken?).** A share is an artifact-level grant of a fixed role
(`shares.ts`, PUB-057, PUB-058): a named recipient handed one copy, not a route into a space. Ending them
would silently cut off outsiders. They stay and are counted apart in the preview, where the mover can go and
revoke them.

**MV-C. Who may move (Ken?).** `administer` on the artifact, read through its present chain, and `create`
or `administer` at the target. Not `retire`: a move changes who can read, which is what `administer` is
for. Either at the target, because no starter role holds both: an Administrator lacks `create`, and an Author
lacks `administer`. The dialog's targets follow that rule, not `useCreatableSpaces`. No new permission
(IAM-070 does not name this act). The route is `changesAccess`, as `artifact_space_changed` raises
`access_changed`; so the target is decided with `loadFacts` and `decide`, because `authoriseAt` declares the
transaction deciding-only and the trigger would then raise.

**MV-D. A document's dependants.** Its publications always follow, in the same transaction: left behind,
the old space's readers keep a copy of what was moved away. `recordPublication` reads the document's current
space, so a job running across a move lands correctly; it and the move both take `lockArtifact(document)`,
or a record committing as the move lists publications stays behind.

"Also move" offers its components and their images **(Ken?)**, as the language dialog offers components: a
document moved without them shows its new readers a page of withheld parts, since a component's chain never
includes the document. Each is decided for itself, and skipped with a reason rather than refusing the whole:
not permitted, held or kept, placed in a document that is not moving (it stays, and is listed), archived. An
image goes only when nothing staying uses it: no `reference`, `baseline_pin` or `publication_asset` outside
what moves. A component moved alone moves alone. `also` is capped at 500 artifacts, refused `move_too_large`
(see Risks in the plan).

**MV-E. Refused, nothing changing.** A hold keyed to the source space (`held`): it joins through the
space, so leaving would silently end it (ADR-0060). A hold on the artifact itself travels, and refuses nothing;
neither does a hold at the target. A keep keyed to the source space (`kept`), only where the target's keep
reaches less: `keptNow` also counts tenant-wide keeps, which a move cannot lose. A hold on a document does not
reach its components, as today, but a held publication refuses its document's move. `artifact.archived`,
`artifact.missing` for a deleted one, `space_archived` for the target; the same space answers `unchanged`.
`space_moved` (409) where the artifact is no longer in the `from` the caller read. `shareDeletion` is taken
before any artifact lock (`deletion.ts`), then `lockAll`, ordered, as the language route does.

**MV-F. Locks, presence and threads.** Locks and presence on what moves are deleted in the transaction, and
`access_changed` ends scoped streams, so every open client reconnects and is decided afresh. Unlike deletion
(`locked` refuses), a held lock does not refuse: COL-068 says degrade. Nothing is lost by it: no version is
cut, so a holder who may still edit gets `lock_required`, re-claims and saves on their `openedFrom`; one who
may not is refused, and the text stays on the page, as any lost permission does.

Threads, and **pushback (Ken?)**. COL-068 is COL-067's words reused, but a move is not a deletion: the anchor
still exists, so COL-017 ("no longer exists") does not apply, and orphaning every thread would break review
of a component everyone can still read. Recommended: **a thread stands for whoever can still read what it is
on. For one who cannot, a document that places the component shows on the withheld part one flag: it moved, and
threads exist on it.** No rows: a row would reveal how many and when (SCH-032), and its words are the moved
content. The flag says only that there are any, as `deletion.ts` does. It comes from an insert-only
`artifact_move` row, as `artifact_archival` records archival; that row cannot say who could read before, so
one who never could sees the flag too, and learns no more than that. COL-068 would be amended through the
issue form to say this.

**MV-G. What a move leaves behind, named in the preview, never refused.** Citations to the old space's
bibliography will fail at publish (`publishing.ts`, as `citing.ts` already anticipates); terms print as their
words; images staying may be `asset_unreadable` to the new readers; bound components, whose query definition
stays; documents and cohorts using a moved template; open review rounds; a document from CT Studio will refuse
redelivery with `document_in_another_space` (ct-studio-sink.md); a cohort's row stops linking, for it reads
through `cohort.space_id` (to fix: read the document's own space). Each is a count in the answer, and each
existing refusal names its cause at the moment it matters.

**MV-H. Search and audit.** `search_entry`, `search_earlier`, `search_history` and thread rows take the new
space under the lock, as archival's fan-out does: a search's filter on `space_id` would otherwise be wrong for
readers on both sides. `search_earlier` needs `update (space_id)` granted (0088 grants only two columns).
`artifact.moved` is written twice, with `space` the source and then the target, so each space's auditors see
it; its detail names both, and each artifact carried is its own pair. The place and labels are read before the
update, as `artifactPlace` would answer the target after it; a publication, which has no versions, takes its
labels as `heldPlace` does.

## Not designed

- A move across tenants (EI). Undo: moving back is a move, and ended grants are not restored.
- Telling people who lost access: the audit log and the preview only, until EM.
