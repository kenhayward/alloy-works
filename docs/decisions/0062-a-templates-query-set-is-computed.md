# 0062 - A template's query set is computed

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

[ADR-0043](0043-a-templates-bindings-query-set-and-variables-move-to-t4.md) left T4's design of
TPL-014 to decide whether a template's query set is declared or computed. With TPL-014, a template
places required components, and the only queries a document made from it runs at creation are their
bindings'. Each binding already names its query definition. A declared set beside them is a second
list that drifts from the first.

Ken answered on 2026-10-16: computed. He also answered TPL-Q04: the template chooses, for each
required component, the reference mode it is placed with.

## Decision

- **A template's query set is the query definitions its required components' bindings name**, at
  the versions the template resolves them to. It is computed when the template is resolved, never
  stored on the definition, and must resolve before a document is made (TPL-004).
- **TPL-060 is superseded by TPL-070**, which says so. **TPL-046 is superseded by TPL-071**, its
  prompt-library half alone (T5): a computed set needs no empty default.
- **A required component declares its reference mode**: following approved revisions, the default;
  the latest; or a pinned version. These are the reference modes a document already has (REU-050).

## What would change the answer

- **A template that runs a query no component places**, a document-level value with no component.
  Then a declared set returns for those, beside the computed one.

## Consequences

- Changing a component a template requires can change the template's query set without a new
  version of the template. Resolution reads it afresh each time, as it reads the theme.
