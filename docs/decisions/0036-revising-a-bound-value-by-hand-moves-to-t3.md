# 0036 - Revising a bound value by hand moves to T3

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

[ADR-0033](0033-t2-is-the-data-spine.md) narrowed T2 to the data spine and listed, among what T2
keeps, **revising a bound value by hand**: an author correcting a number a query returned, in place,
without editing the query or the binding. Scope section 12 names it with the rest of the data, and
DAT's section 8 states it - revisable in place (DAT-057), the queried value never overwritten
(DAT-058), marked as a person's value (DAT-059), still taking revisions from its source (DAT-060),
surfaced to reviewers and gateable before issue (DAT-061), both halves in provenance (DAT-062), and a
bound table's cell anchored by key (DAT-063).

Designing [bindings.md](../design/bindings.md) found that the section is a review feature placed in a
data tranche. A revision needs a stored row per document, a three-way decision when a source revision
meets one, a mark wherever it is shown and two halves of provenance - and **DAT-061, the reason a
revision is allowed at all**, is a reviewer's queue and a lifecycle gate, which are COL's and LIF's,
both T3. Built in T2, a revision would be a person's number standing in front of a query's with
nobody asked to review it, which is exactly the cost DAT's section 8 exists to prevent.

The design kept the feature whole rather than cutting it: "A value revised by hand" in bindings.md,
decision BI-O - a revision is the document's, insert-only, standing in front of a resolution and
bound to its digest and dataset version, and an accept over one must say withdraw or keep - with its
own slice, B5, last in the build order. It asked Ken, as its question 1, whether to move the section
to T3.

Ken answered on 2026-10-04: yes, as recommended.

## Decision

**Revising a bound value by hand is T3's.** DAT-057, DAT-058, DAT-060, DAT-061, DAT-062 and DAT-063
move to T3 whole, each keeping its identifier, DAT-058 and DAT-062 from Constraint. DAT-059 is
superseded by **DAT-115**, in T3, which marks a revised value wherever the product shows it and in
the provenance accompanying a publication, and does not require the printed output to mark it (Ken's
answer to bindings.md's question 2, the same day).

- **The design is kept whole.** bindings.md's "A value revised by hand" and BI-O stand as approved;
  nothing in them is redesigned for the move.
- **It is built in slice B5, and only after T3 begins.** B1 to B4 and B6 are T2's and carry no part of
  it: no `binding_revision` table, no revise route, no Revised by hand state.
- **This record does not supersede ADR-0033.** Narrowing T2 to the spine holds, and so does every
  other row it kept there; this record moves one item of its list, revising a bound value by hand, out
  of T2, as its "What would change the answer" anticipated a design moving a row by name. ADR-0033's
  status line stays Accepted.

## What would change the answer

- **A customer for T2 needs to correct a value before T3's review exists.** Then B5 comes forward
  into T2 by name, with DAT-061's queue and gate still T3's, and the change history says that a
  revision ships unreviewed until then.
- **T3's review is designed so that it cannot read bindings.md's revision.** Then BI-O is revisited
  in T3's design, not here; the move does not freeze it.
- **The correction moves out of the product.** If authors are found correcting values in Word after
  publication, which section 8 was written to prevent, the case for building it earlier is stronger
  than the case for waiting for review.

## Consequences

- T2 ships every value a source supplies, its provenance and the publish's binding stage, and no
  value a person entered by hand. A value a query got wrong is corrected at the source, or waits for
  T3.
- bindings.md's claims on DAT-058, DAT-060, DAT-062 and DAT-115 stand: a claim says a design answers a
  requirement, not when it is built. Their tests arrive with B5.
- The accept route built in D3 is unchanged in T2. Its `revision: 'withdraw' | 'keep'` member, which
  only means something over a standing revision, arrives with B5.
- DAT-N05 and DAT-N06 - no revising the source, no unmarked revision - still bind whatever T3 builds.
