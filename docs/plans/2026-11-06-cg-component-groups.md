# Component groups (CG)

Components that only make sense together, reused as one unit, approved as a shape, and changed once for every
document that places them: an SOP's references section, say, of boilerplate, a table bound to data and a
narrative, which next gains a warning in every SOP's next draft. Today live reuse is the component alone
(STR-004 keeps sections a document's own; Place from a document copies a section's shape once).

Built after the ND plan, which it extends: a template places a group as it places a component, copied or
referenced.

## Calls

Ken's (2026-11-06):

- **CG-A** a **component group** is an artifact of its own: an ordered list of components, in a space, versioned,
  approved through its workflow as a component is. Called "Component group" in the interface.
- **CG-B** a group version **pins each member's version**: approving it approves the shape and the text. A
  member's change reaches documents only through a new group version, so a baseline is reproducible exactly.
- **CG-C** **one level**: a group holds components, never another group.
- **CG-D** listed and opened **in Components**, told apart by an icon and a Kind filter, on the component page's
  shell. No new rail entry.
- **CG-E** a document may **reword any member locally** (overrides, REU-011), caught at review if wrong; no member
  is marked against it. It may not add, remove or reorder members, which only a new group version does.

Mine:

- **CG-F** a document places a group as a **group reference**, a third outline node beside section and
  reference, inside one of the document's own sections, never as a section: STR-004 holds. It follows the group
  **pinned, latest or approved** (REU-050), so a group's v2 reaches every SOP tracking approved when it is
  approved, and pinned ones are offered it as any newer version is.
- **CG-G** each member's **occurrence has an id of its own** in each document, derived from the group reference's
  node and the member's key, so bound tables resolve to each document's data, cross-references and overrides
  have a target, and search, comments and baselines key it as they key a node today.
- **CG-H** a group has **no heading of its own**: its members number inside the section holding it.
- **CG-I** **where-used, reach and impact** (REU-005, REL-024) count a group's documents for each member; approving
  a group asks first what it reaches, as a component's approval does.
- **CG-J** **conditions** apply to the group reference, and to a member through the group's version, not per
  document.
- **CG-K** a document may **make a group its own**: its members become references (or copies, with derived
  from), the shape no longer followed. One act, reported first, using Place and Duplicate's code.
- **CG-L** baselines pin the group's version; publishing, numbering, Duplicate, moving, export and import, the
  Part panel and the outline tree learn the group reference.

## Still to settle at the pre-flight

- Whether one component may appear twice in a group (proposed: no, as the outline already refuses).
- The group page's acts: add, remove and reorder members, with each member's version shown and a newer one
  offered.

## Stored shapes

- `artifact` kind `component_group`; its version content `{members: [{key, component, version}]}`.
- The outline's `groupReference` node `{id, group, mode, overrides by member key, conditions}`, additive at the
  outline's schema; every write path checked (operations, Place, Duplicate, import, restore).
- Migrations for the kind, its workflow, where-used rows and search.

## PRs

Its own PR, after ND's, as Ken chose.

## Tests and docs

Requirements raised first (REU: the group, its approval, its placement, its occurrences, making it one's own).
An ADR for CG-A, CG-B, CG-F and CG-G. `structure.md`, `reuse` design, `features.md`, `README.md`, the contract,
one fragment, and the browser walks over the group page and a document holding one.
