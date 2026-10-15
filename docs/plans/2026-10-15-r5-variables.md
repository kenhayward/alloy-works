# R5: Variables

> T4's fifth slice, extending [definitions.md](../design/definitions.md) and
> [publishing.md](../design/publishing.md). **Full tier**: migration 0104 (a definition kind), an inline
> node made live end to end, publish resolution and its record. Built inline, one final review at the
> slice's end (Ken, 2026-10-14). Decisions marked **(default)** are recommendations Ken may overturn.

**Goal:** an author places a declared variable in a component's text, chosen rather than typed; a
publish resolves it from the referring document, prints it in the form its context declares, records
where its value came from, and fails by name where it cannot resolve (REU-017, REU-018, REU-019, and
REU-016 and REU-038 for the two sources this slice holds).

| PR  | Holds                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- |
| R5a | This plan; variable definitions (0104); resolution at publish and its record (Task 1)          |
| R5b | Variables in the editor and the document's page; the final review; the close, 0.176.0 (Task 2) |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R5-A | **A variable is a definition** (REU-018; default): a fourth definition kind, `variable`, the environment's, made and changed by whoever manages definitions, as fields are: `{ id, name, key, type, sources, forms }`. `key` is what the content's existing `variable` node names; `type` a value type (not an image). Declared once and chosen from a list; a node naming no declared key fails to publish. |
| R5-B | **Sources, in a declared order** (REU-016, REU-038): `sources` names where a value may come from - `{ parameter?: name, field?: field id }` - and precedence is fixed and said: the document's parameter set first, then its metadata, then (R5c) a query result. The first that holds a value supplies it, and the publish records which.                                                                   |
| R5-C | **Forms by context** (REU-019): `forms: { title?, text? }`, each a partial of the value catalogue's formats - a date's order, separator and padding, a number's grouping - laid over the document's formats, `title` in a section's title, `text` in a component's text.                                                                                                                                     |
| R5-D | **Never its name, never blank** (REU-017): a variable that resolves to nothing, names an undeclared key, or a value its type refuses fails the publish `variable_unresolved`, naming the node, the block and the key. In the editor and the read view a variable shows as its key, marked as a variable, never as a value it does not have; the key is fixed once made, since text names it by that key.     |
| R5-E | **The record** (REU-038): each printed variable is recorded beside the values bindings print, in `provenance.json`: its node, block, key, the source that supplied it and the value.                                                                                                                                                                                                                         |
| R5-F | **Left for R5c** (default): a query result as a source, and REU-037, where a chain of references crosses document contexts, which nothing yet makes: documents place components alone.                                                                                                                                                                                                                       |

## Task 1: Definitions and the publish - R5a

- 0104: the kind. Domain: the definition, its checks, `resolveVariable`, printing by form; assemble's
  variable stage, titles included. Db: the definitions, their reads for a publish, the record.
- Tests: defined, refused each way; resolved from a parameter over a field, each recorded; printed by
  form in a title and in text; unresolved failing by name.

## Task 2: The editor and the page - R5b

- The editor's `variable` node both ways, **Variable** on the toolbar choosing from the declared
  ones; the read view's chip. The browser walks. The final review hunts a variable printed as its name
  or blank, and a source used out of its order. The close: 0.176.0.

## Built

R5a #641, and R5b with the close (0.176.0) #643. R5a's openapi.json was regenerated after CI caught the drift. The final review found the pipeline version unbumped for provenance schema 5 (now 26), a variable's key changeable by its next version, which would have left every node naming it unresolved (now refused), and a variable refused in a footnote's paste and taking marks beside it; all fixed. Left for R5c: a query result as a source, REU-037, and a page declaring variables; a section title holding a variable is not edited in the outline.
