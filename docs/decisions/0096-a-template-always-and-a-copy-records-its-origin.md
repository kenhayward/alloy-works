# 0096 - A template always, and a copy records its origin

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

A document made from no template was an empty outline: nothing to type in. Ken chose a template always, a default for
each space, and components a template copies as well as shares, each copy keeping a link back to its original
(TPL-074 to TPL-077, REU-059; [the ND plan](../plans/2026-11-06-nd-new-document.md), pre-flight reviewed). The New
document dialog was redrawn as a gallery beside the details
([the handoff](../interface/handoffs/new-document/README.md)).

## Decision

1. **Each space has a default template, Blank until its administrator chooses another.** A create naming no template
   takes it, at the service route; the db's `createDocument` still makes an empty outline for imports and reference
   documents. An empty document is still valid (STR-054), from a template with no sections.
2. **Blank is a stored template, made when first needed**, as the person who needs it: by making a space, or by a
   create in a space with none. A version needs an author, so no migration makes one. A default archived, deleted or
   moved away counts as none, so nothing guards it.
3. **A template component is referenced or copied**, chosen as the template is designed and referenced unless declared;
   a starting section may set the default under it. It names a component, or holds its words inline (always copied), so
   no hidden component is owned by a template and Components, search and where-used are untouched.
4. **A copy records its origin in a table of its own**, insert-only: the component and version, or the template, it was
   made from. It is shown as "Copied from X at v" and whether X has changed since. Not a relationship type: those are
   each tenant's, and a built-in one would be a seeded definition a tenant could edit or clash with.
5. **A template move never adds a copy**: a copied component new to the version is reported missing.
6. **New document is a modal of its own size**, 920 by 684 at most: a listbox of templates by space beside what is
   chosen, its values in a region that alone scrolls with the list. A required value is edged only once Create or the
   count asks.

## What would change the answer

- Tenants wanting to trace copies in the relationship graph, which would make the origin a relationship after all.
- A system principal able to author versions, which would let a migration make every space's Blank.

## Consequences

- Duplicate writes the same origin record, and may copy a component its template placed as a copy.
- `GET /v1/templates` carries each template's summary, so the gallery reads no template until one is chosen.
