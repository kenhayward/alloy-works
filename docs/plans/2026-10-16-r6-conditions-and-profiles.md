# R6: Conditions and profiles

> T4's sixth slice, extending [definitions.md](../design/definitions.md) and
> [publishing.md](../design/publishing.md). **Full tier**: migration 0105 (a definition kind, a
> document's profile, a publication's), a stored mark made live end to end, a publish stage and a scan.
> Built inline, one final review at the slice's end. Decisions marked **(default)** are recommendations
> Ken may overturn.

**Goal:** an axis is declared with its values; an author marks text with conditions and sees what is
conditional; a document declares its profile; a publish keeps what the profile selects, excludes the
rest before anything is counted or referred to, records the profile, and fails where an excluded
passage reaches the output.

R5's query source and REU-037 wait for the template's query set (TPL-060, TPL-067, TPL-069; Ken,
2026-10-16).

| PR  | Holds                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- |
| R6a | This plan; axes and profiles (0105); conditions at publish, in their order; the profile recorded      |
| R6b | The scan of every output for excluded passages                                                        |
| R6c | Conditions in the editor, the profile and a preview in the page; the final review; the close, 0.177.0 |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6-A | **An axis is a definition** (REU-020; default): a fifth kind, `conditionAxis`, `{ id, name, key, values: [{ key, label }] }`, keys as a variable's, values closed and managed as the axis is. A condition mark's `axis` names its key and `values` its value keys. Drawing values from a LIB vocabulary (LIB-022) waits for vocabularies (T6), so REU-020's "controlled vocabulary" is the axis's own closed list; the design says so beside its claim. |
| R6-B | **A document declares one profile** (REU-022; default): on its version, `profile: { [axis]: value[] }`, written whole by `PUT /v1/documents/{id}/profile` as parameters are, one version with the outline and values unchanged. It may also record `excludeUnset: true`, the acceptance REU-053 asks for.                                                                                                                                               |
| R6-C | **Selection is set membership** (REU-021, REU-024; default): a run is kept where, for every condition mark on it, the profile's values on that axis meet the mark's. An axis the profile does not name keeps nothing marked on it. Several marks on one run must all select it, so ranges may overlap. No boolean logic (REU-Q04). A paragraph left with no content is removed.                                                                         |
| R6-D | **The order** (REU-028 to REU-030): in `conditionContent`, over each occurrence's content as the referring document places it - after transclusion and overrides, before variables, bindings, contributions, numbering and references - so a reference to excluded content fails. Conditions mark text alone, so nothing numbered can be excluded until a block can carry one (REU-Q02): REU-028 holds by the order but is not claimed.                 |
| R6-E | **Unset is refused** (REU-053): a publish whose content is conditioned on an axis the profile does not name fails `axis_unset`, naming the axis, unless the document records `excludeUnset`.                                                                                                                                                                                                                                                            |
| R6-F | **Once per profile** (REU-027; default): a publish request may name a `profile` in place of the document's; the publication records the profile it was made under, and listing a document's publications says it.                                                                                                                                                                                                                                       |
| R6-G | **The scan** (REU-048; R6b): after the engine, each output's text and metadata (PDF text and info, Word's document and core properties) are searched for every excluded passage of four or more words that the kept content does not also hold; a match fails the publish `condition_leaked` and nothing is stored.                                                                                                                                     |
| R6-H | **In the editor** (REU-021, REU-026, REU-047; R6c): the `condition` mark, held and drawn as a tinted underline with its axis and values said; **Condition** on the toolbar chooses an axis and values; **Add alternative** copies the selection beside itself under the axis's other values, so per-profile wording is one act. The page offers **Profile** and a preview of the text under any profile (REU-025).                                      |

## Task 1: Axes, profiles and the publish - R6a

- 0105: the kind; `artifact_version.profile`, `publication.profile`. Domain: the axis, `selects`,
  `conditionContent`'s evaluation and `axis_unset`. Db and service: the axis's checks, the profile
  routes, the publish reading and recording the profile.
- Tests: axis defined and refused; kept and excluded by profile, overlapping marks, unset excluding
  and refused unless accepted; an excluded table unnumbered and a reference to it failing.

## Task 2: The scan - R6b

- Text and metadata extracted from each output in the worker; a leak fails by name. Tests seed a leak
  past the condition stage and see it caught.

## Task 3: The editor and the page - R6c

- The mark both ways, **Condition** and **Add alternative**, the profile and preview in the page. The
  browser walks. The final review hunts excluded text reaching an output and a run kept that its
  marks do not select. The close: 0.177.0.

## Built

R6a #646, and R6b and R6c with the close (0.177.0) #647; #645 fixed R5's publish of a variable with no bound value on the way. The final review found a paste dropping every condition (the editor now holds the environment's declared axes), a condition settable over a footnote, reference, value, variable or image, which carry no mark and would have been published to every reader (now refused), Word's scan missing passages holding an entity, and an axis named `constructor` read from the profile's prototype; all fixed. Left: a condition on a block or a section (REU-Q02), so REU-028 is unclaimed; axis values from a vocabulary (LIB-022); publishing per profile from the page, where Publish uses the document's own.
