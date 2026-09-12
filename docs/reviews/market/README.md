# Market assessments

Two documents about where this product could sell, received as they are and kept that way.

| Document                                      | What it is                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Market Analysis.docx](<Market Analysis.docx>) | An assessment of the market the specification as written is aimed at                                              |
| [Market Expansion.md](<Market Expansion.md>)   | An assessment of capabilities that would extend market reach beyond it, with a suggested sequence and a list of what deliberately not to add first |

## These are not requirements, and not for the early tranches

**Nothing here has been written into the requirements, and nothing here is scheduled.** They are for
later consideration: input to a product decision somebody will take, not a decision already taken.
The five capabilities the expansion document proposes - residency and deployment flexibility,
federated cross-tenant workspaces, governed workbook integration, a controlled HTML reader, and a
legacy-estate migration bridge - are each substantial areas of work, and three of them would touch
boundaries the specification currently holds deliberately: the tenant boundary (**IAM-001**,
**IAM-N03**), what the product is not (**DAT-N04**, **PUB-N02**), and the attended-import rule
(**IMP-003**).

Several of them also bear on questions the specification has open rather than settled - **ADM-Q01**
on data residency, **ADM-Q02** on metering for pricing, **IMP-Q03** on which XML vocabularies are
worth importing, **PUB-056** and **AST-Q02** on whether HTML becomes a real reading format, and
**IAM-Q04** on cross-tenant collaboration. Those questions stay open. A market assessment is evidence
somebody may weigh when answering one; it is not an answer, and treating it as one is how a
specification acquires scope nobody decided on.

## Why they are not formatted

`docs/reviews/market/` is excluded from Prettier. One document is a Word file with no parser, and the
other uses attribute annotations that Prettier rewrites into table cells - which would change a
received document rather than tidy it. They are kept exactly as they arrived, for the same reason the
reviews beside them are: a document is evidence of what somebody said, and editing it afterwards
destroys that.
