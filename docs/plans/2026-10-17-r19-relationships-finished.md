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
| R19-C | **Impact before Save version and approval** (Ken; REL-024, REU-008): the question Save version, Done and approving a component ask already lists the documents a new version reaches (REU-008); it now also reads the impact walk, depth 3, and says what reaches the component through relationships - hard and informational apart - and is asked wherever either reaches anything. Approving a component at its gate asks the same before deciding.                                                                                                                                           |
| R19-D | **Left**: REL-007 waits for configuration export (Ken; ADM-005).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Tasks

- The domain's `relatableKinds` and the type schema drawing on it; the editor's type form offering them.
- The far end read by inverse name, cited.
- `readImpact` in the reach question, and the gate's approve asking it first.
- Tests per place; the final review; the close (0.190.0).
