# Component groups (CG)

Components that only make sense together, reused as one unit, approved as a shape, and changed once for every
document that places them: an SOP's references section, say, of boilerplate, a table bound to data and a
narrative, which next gains a warning in every SOP's next draft. Today live reuse is the component alone
(STR-004 keeps sections a document's own; Place from a document copies a section's shape once).

Pre-flight reviewed (2026-11-06); Ken chose the cheaper shape it offered.

## Calls

Ken's (2026-11-06):

- **CG-A** a **component group** is an artifact of its own: an ordered list of components, in a space, versioned,
  approved through the component workflow. Called "Component group" in the interface.
- **CG-B** a group version **pins each member's version**: approving it approves the shape and the text,
  members' own workflow states aside, so the group's approval shows each member's changes since its last.
- **CG-C** **one level**: a group holds components, never another group. A component **at most once**.
- **CG-D** listed and opened **in Components**, told apart by an icon and a Kind filter. No new rail entry.
- **CG-E** a document may **reword any member locally** (overrides, REU-011), caught at review if wrong. It may not
  add, remove or reorder members, which only taking a group version does.
- **CG-F** **a newer group version is offered, never followed**: placing a group writes ordinary references, one per
  member, pinned to the version the group pins and marked with the group. A newer approved group version is
  offered on each document holding it; taking it rewrites that run of references as the document's next version.
  An approved document never changes by itself.

Mine, after the pre-flight:

- **CG-G** the marker on each member's reference: `group: {id, version, placement}`, `placement` one id for the
  run. Members of one placement stay contiguous siblings in the group's order (checked on every outline write).
  Moving or removing one member alone, changing its mode, or inserting a node inside the run is refused; the run
  moves and is removed as one ("Remove group").
- **CG-H** no heading of its own: the members number inside the section holding them, as references do.
- **CG-I** **taking a version** keeps each kept member's node id and overrides (matched by component), adds new
  members with new ids, drops removed ones, and repins all; it says first what changes.
- **CG-J** **where-used, reach and impact**: the reference index gains document to group and group to member rows;
  where-used names a group's documents for each member; a component a group version pins is not deletable,
  nor movable away alone (`deletion.ts`, `moving.ts`).
- **CG-K** reading: Components lists groups (Kind filter); the group page shows its members with their versions,
  newer ones offered, and add, remove, reorder and "use version N", each cutting a group version. No overrides,
  conditions or threads on the group page.

Deferred, each its own PR when wanted, raised as REU-064 to REU-067: templates placing groups; making a placed group
the document's own; member conditions; search of a group as such.

## Stored shapes

- `artifact` kind `componentGroup`; its version content `{title, members: [{component, version}]}`, no
  component twice, members readable and not groups. Kind checks widened where an artifact kind is enumerated.
- `ReferenceNode` gains optional `group: {id, version, placement}`, additive at the outline's schema; every write
  path checked (operations, Place, Duplicate, import, restore, template materialise).
- The reference index rows above; no new table.

## Interfaces

- Domain: the group shape and its checks; `placeGroup`, `takeGroupVersion` (pure, over the outline); the run
  rule in the outline's checks; operations refusing what CG-G refuses.
- Db and service: `componentGroup` create, read, version, list; its workflow as a component's; the index rows;
  deletion and moving guards; where-used; `POST /v1/documents/{id}/groups` (place) and
  `POST /v1/documents/{id}/groups/{placement}/take` with a preview.
- Web: Components' Kind filter and New component group; the group page; Place a group in a section; a placed
  group shown as one run in the outline tree and Part panel, with its offer.

## PRs

One, as Ken asked, now that the shape needs no new outline node.

## Tests and docs

Requirements raised first (REU-060 to REU-063). An ADR for CG-B, CG-F and CG-G. `structure.md`, the reuse design,
`features.md`, `README.md`, the contract, one fragment, and the browser walks over the group page and a document
holding one.
