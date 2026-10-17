# R19: Relationships finished

> T4's nineteenth slice, extending [relationships.md](../design/relationships.md). **Light tier**: one
> PR, no migration, no new route; a stored shape narrowed (a type's kinds) and the impact walk offered
> before a change. Decisions marked **(default)** are recommendations Ken may overturn; the rest are his
> answers of 2026-10-17.

**Goal:** a relationship type names only the kinds people relate, a relationship reads by the type's
inverse name from its far end, and a change to a component says what it reaches through relationships
before it is made.

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R19-A | **Content kinds only** (Ken; REL-052, REL-008): a type's `from` and `to` kinds are drawn from the domain's `relatableKinds` - component, document, publication, asset, template, query definition, dataset - never a list of their own; a type naming another kind is refused where it is written. REL-052 asks for every kind IAM section 2 names, a baseline among them, which is no artifact here; and its "anything with an identity" reaches definitions, themes, layouts and connections, which Ken's answer leaves out. So the design keeps the rule and drops the claim, naming the gap. |
| R19-B | **REL-004 shown** (default): built in R8; a test now reads a relationship from its far end by the type's inverse name, citing it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R19-C | **Impact before Save version and approval** (Ken; REL-024, REU-008): the question Save version, Done and approving a component ask already lists the documents a new version reaches (REU-008); it now also reads the impact walk, depth 3, and says what reaches the component through relationships, the document it is open in left out, and is asked wherever either reaches anything. A reference's reach past the documents placing it is not listed: those documents are what a version changes. Approving a component at its gate asks the same before deciding.                         |
| R19-D | **Left**: REL-007 waits for configuration export (Ken; ADM-005).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Tasks

- The domain's `relatableKinds` and the type schema drawing on it; the editor's type form offering them.
- The far end read by inverse name, cited.
- `readImpact` in the reach question, and the gate's approve asking it first.
- Tests per place; the final review; the close (0.190.0).

## Built

R19 with the close (0.190.0) #699. Departures: REL-052 stays unclaimed, as R19-A said. The final review
found a failed where-used read hiding what is related, a slow impact walk leaving Save version silent,
the document a component is open in listed as related to it, and Approve and publish asked as Approve;
all fixed - the question waits three seconds for the walk at most. Left: a stored type naming another
kind cannot be renamed until its kinds are; the related list names each artifact without a link; a
reference's reach past the documents placing it is not listed.
