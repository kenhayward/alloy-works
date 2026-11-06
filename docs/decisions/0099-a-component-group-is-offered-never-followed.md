# 0099 - A component group is offered, never followed

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Components that only make sense together (an SOP's references: boilerplate, a bound table, a narrative) were reused
one by one, and a change to the set reached each document by hand. Ken asked for a group reused, approved and changed
as one (REU-060 to REU-063; [the CG plan](../plans/2026-11-06-cg-component-groups.md), pre-flight reviewed). The
pre-flight found that a new outline node would reach about 45 consumers of the outline that would each ignore it.

## Decision

1. **A component group is an artifact of its own**, kind `componentGroup`, on the component workflow. Its version
   pins each member's version, so approving it approves the set's shape and text, whatever the members' own states.
   One level, each component at most once.
2. **Placing a group writes ordinary references**, one per member, pinned to the version the group pins, each marked
   `group: {id, version, placement}`. No new outline node: everything that reads references reads a placed group.
3. **A newer group version is offered, never followed.** Taking it rewrites the run as the document's next version,
   keeping each kept member's node id and rewordings, after a preview of what it adds, removes and drops. An approved
   document never changes by itself.
4. **A run holds together.** Members of one placement are contiguous siblings in the group's order, pinned, checked
   on every outline write. Moving or removing one alone, changing its mode or inserting inside the run is refused; the
   run is removed as one.

## What would change the answer

- Documents wanting a group followed live, as a `latest` reference is, which would need the run rewritten on every
  approval rather than when an author takes it.
- Groups inside groups, which the run rule would have to nest.

## Consequences

- Templates placing groups, making a placed group the document's own, and member conditions are each a later PR.
- Where-used, reach and the deletion and moving guards see a group's members through the reference index, which gains
  document-to-group and group-to-member rows.
