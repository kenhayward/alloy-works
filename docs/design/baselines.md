# Baselines

A baseline is a named, immutable version of a whole document: everything a publish would read,
resolved once and pinned. [storage-and-versioning.md](storage-and-versioning.md) owns the shape it
rests on (VER-017 to VER-023); this document owns the acts - making one, superseding it, publishing
it and addressing it - and the rows those acts answer.

> **Built** by [the BL plan](../plans/2026-10-11-bl-baselines.md), T3's third phase
> ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)).

## The shape in one paragraph

**Making a baseline is requesting a publication without publishing.** The same resolution runs, as
the maker, at the document's latest version: every reference to its version, every image to its
asset version, every binding to its held dataset version, the layout and theme to the versions in
force, the template to the version recorded on the document. Anything a publish would refuse, or record as a
failure when asked, refuses the baseline, by name; what only the worker finds, with its fonts, can
still fail a baseline's publish. What resolved is inserted once, under a name unique in the document, with a
digest over all of it; nothing updates or deletes it, and every pin is a foreign key that refuses the
deletion of what it names. **Publishing a baseline** is the same request read from the pins instead of
resolved live, compiled at the baseline's own time, so it is the same publication today and in four years, on the same engine.

## Requirements owned

| ID          | How                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VER-046** | `baseline.name`, NFC, 1 to 120 characters, no surrounding space or control character, unique in its document by `name_key`, whatever its case; no route renames one, and the table takes no update                                                                                                       |
| **VER-049** | `baseline_supersession`, insert-only, one per baseline: what superseded it (a later baseline of the same document), who and when. A superseded baseline reads, lists and publishes as before; the list filters by `current` or `superseded`                                                              |
| **VER-043** | `baseline.digest`: SHA-256 over the canonical JSON of every pin - each version by id and version digest, with the node it serves - and every binding's dataset version and digest, sorted. `baselineDigestInput` in `packages/domain` is the canonical string, so a reader of every pin can recompute it |
| **DAT-038** | `baseline_binding`: every binding the pinned components hold, in either mode, by the dataset version its latest resolution holds, and the dataset's name then; one without a result refuses the baseline                                                                                                 |
| **PUB-045** | A publication of a baseline records the baseline beside what it already records: layout, theme (whose catalogues include the citation catalogue), template, engine, pipeline and fonts                                                                                                                   |
| **PUB-046** | `POST /v1/baselines/{id}/publications` reads the baseline's pins, never the live document, and compiles at `made_at`: the same bytes whatever has changed since, on the engine it records. Keeping an earlier engine runnable once the image's is replaced is VER-041's, not built                       |
| **STR-047** | `#/documents/{id}/baselines/{baseline}`, and `/nodes/{node}` beneath it: the document as that baseline holds it, read-only, from one pinned view: numbered as it was, each component's text at its pin, each value from its pinned dataset version, as the reader may read it                            |
| **PUB-075** | The regression guard (AU2) gains baselines: fixed cases stored as baselines in a test tenant and published through the worker, each output held to its recorded SHA-256, so a change to the pipeline, the engine or a library they depend on fails before release                                        |

VER-017, VER-021 and VER-023 stay storage-and-versioning.md's, STY-028 themes.md's and PUB-013
publishing.md's; this design builds them. `POST /v1/documents/{id}/baselines` is the explicit act
(`publish` on the document); the theme and layout versions in force are columns, foreign keys like
every pin. `baseline.gate` is held null by a `check` until LIF has gates to name: making one at a gate
is the lifecycle service's call, built with it.

**What the digest and the name do not say** (the BL final review):

- **The digest is of the pins, not of the bytes.** A publication also depends on the baseline's own
  time, compiled into the PDF, and on the engine; two baselines of one version have one digest and
  publish different bytes.
- **The name's rule is held in two spellings.** The table's check knows Postgres's `[[:space:]]`,
  which takes no no-break space, and `nameKey` folds case alone, so two names a reader takes for one
  - a full-width letter, a trailing zero-width space - are two. `baselineNameProblem` is the stricter
    for the first; NFKC and a case fold are the change if they bite.

**Not claimed:**

- **VER-055**: bibliography entries, terms and vocabulary values do not exist until T7 (LIB). What
  does exist is pinned: the template version, and the definition versions the document version records.
- **PUB-082**: moved to T5 (Ken, 2026-10-11), where generated content arrives. Its first half holds here:
  a baseline's publication reads its pins alone.
- **PUB-004**: nothing is approved until LIF designates it at a gate. A publication of a baseline
  records `approval = 'baseline'` and keeps the draft notice; designation will change the notice, not
  the pins.
- **VER-020**: conditions are T4; the baseline records the document version's parameters, which are
  what resolves today.

## Who may

| Act                       | Needs                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Make, supersede           | `publish` on the document, and `read` on every component it places: one the maker may not read refuses the baseline, as it fails a publish |
| List, read the record     | `read` on the document; a pin of a component they may not read answered as its node alone                                                  |
| Read the text at the pins | `read` on the document; each component's text by `read` on it, one not readable shown withheld, never named                                |
| Publish                   | `publish` on the document, and `read` on every pinned component, each not readable refusing by node                                        |

## Open questions

- **A baseline of a document mid-edit** pins versions, never iterations: work not yet cut is not in
  it. The page says so when a component in it is held.
