# Detailed requirements

> **Status: v1, for review.** One document per capability area in
> [`Project_Scope.md`](../Project_Scope.md) section 7 - all twenty-one written. 893 requirements, 89
> non-requirements and 94 numbered questions, eighteen of which have since been settled. These say
> what the product must do. How it gets built is [`../../design/`](../../design/), one document per
> subsystem, each naming the requirements it answers - so a requirement no design claims is work not
> yet designed, and that gap is visible without anybody keeping a list of it.

## How a requirement is written

Every requirement has an **identifier**, so that it can be pointed at from a commit, a test, a pull
request or a conversation without quoting it. The identifier is the tracking handle: progress is
read off what cites it, not off a status column somebody has to remember to update.

```
CNT-014
^^^ ^^^
 |   |
 |   +-- three digits, allocated in order within the area, starting at 001
 +------ the three-letter area code, from the table below
```

**Rules, which exist so the identifier stays worth citing:**

- **An identifier is allocated once and never reused**, even if the requirement it named is
  withdrawn. A citation in an old commit must never come to mean something else.
- **A withdrawn requirement keeps its row**, marked `Withdrawn` with a one-line reason. It is not
  deleted, so the numbering has no gaps and the reasoning stays readable - the same principle as
  [the decision records](../../decisions/README.md).
- **A requirement that changes materially gets a new identifier**, and the old one is marked
  `Superseded by XXX-NNN`. Rewording for clarity is an edit; changing what the product must do is a
  new requirement.
- **Cite the identifier in whatever verifies it.** A test named for `CNT-014` is what makes that
  requirement demonstrably met, and it is how coverage will be reported later.

### Non-requirements and open questions are numbered too

A reviewer needs to cite "the third non-requirement" without quoting it, so those get identifiers as
well, in their own sequences and in a shape that cannot be confused with a requirement:

- **`CNT-N01`** - a non-requirement. Something this area deliberately does not do.
- **`CNT-Q01`** - an open question, with what would settle it. A question that gets settled **keeps
  its row**, with the answer and where it was recorded in place of what would settle it. Removing it
  would break a citation and leave a hole in the numbering.

`CNT-N02` and `CNT-Q05` cannot be misread as `CNT-002`, which is the point of the letter.

### Numbering runs out of order down the page, deliberately

Identifiers are contiguous **as a set**, not in document order. A requirement added later belongs
beside the ones it relates to and keeps the next free number when it goes there, so a section can
read `CNT-014 ... CNT-023, CNT-081, CNT-086`. Requiring document order would mean renumbering on
every insertion, which is exactly what the never-reuse rule forbids. The set has no holes, which is
what catches a requirement deleted instead of withdrawn.

`apps/desktop/src/requirements.test.ts` enforces the format, the uniqueness, the contiguous
numbering, the known vocabularies and this index, for all three identifier kinds.

### Columns

| Column          | Meaning                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**          | As above                                                                                                                                                                      |
| **Requirement** | One statement of what must be true. `must` is binding; `should` is a strong default that an implementer may argue against in a decision record                                |
| **Tranche**     | `T1`-`T6` from [`Project_Scope.md`](../Project_Scope.md) section 12, or `Constraint` where the requirement governs how something is built rather than naming a thing to build |
| **Status**      | `Specified`, `Withdrawn`, or `Superseded by XXX-NNN`. Nothing here tracks build progress - that is what citations are for                                                     |

## Areas

Each area is one document, and the code is permanent. Areas not yet written are listed anyway, so
that the codes are reserved and the shape of the whole is visible from the start.

| Code    | Area                                      | Scope § | Document                                                                                           |
| ------- | ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| **CNT** | Content and authoring                     | 7.1     | [CNT-content-and-authoring.md](CNT-content-and-authoring.md)                                       |
| **STR** | Structure, numbering and cross-references | 7.2     | [STR-structure-numbering-and-cross-references.md](STR-structure-numbering-and-cross-references.md) |
| **REU** | Reuse, variants and conditional profiling | 7.3     | [REU-reuse-variants-and-conditional-profiling.md](REU-reuse-variants-and-conditional-profiling.md) |
| **DAT** | Data connectivity and bindings            | 7.4     | [DAT-data-connectivity-and-bindings.md](DAT-data-connectivity-and-bindings.md)                     |
| **TAB** | Tabular presentation                      | 7.5     | [TAB-tabular-presentation.md](TAB-tabular-presentation.md)                                         |
| **GEN** | Generative AI                             | 7.6     | [GEN-generative-ai.md](GEN-generative-ai.md)                                                       |
| **COL** | Collaboration and review                  | 7.7     | [COL-collaboration-and-review.md](COL-collaboration-and-review.md)                                 |
| **LIF** | Lifecycle, workflow and audit             | 7.8     | [LIF-lifecycle-workflow-and-audit.md](LIF-lifecycle-workflow-and-audit.md)                         |
| **VER** | Versioning, baselines and comparison      | 7.9     | [VER-versioning-baselines-and-comparison.md](VER-versioning-baselines-and-comparison.md)           |
| **PUB** | Publishing and output                     | 7.10    | [PUB-publishing-and-output.md](PUB-publishing-and-output.md)                                       |
| **SCH** | Search, navigation and discovery          | 7.11    | [SCH-search-navigation-and-discovery.md](SCH-search-navigation-and-discovery.md)                   |
| **REL** | Relationships and the graph               | 7.12    | [REL-relationships-and-the-graph.md](REL-relationships-and-the-graph.md)                           |
| **IMP** | Import, export and interchange            | 7.13    | [IMP-import-export-and-interchange.md](IMP-import-export-and-interchange.md)                       |
| **IAM** | Identity, tenancy and access control      | 7.14    | [IAM-identity-tenancy-and-access-control.md](IAM-identity-tenancy-and-access-control.md)           |
| **API** | API, MCP and extensibility                | 7.15    | [API-api-mcp-and-extensibility.md](API-api-mcp-and-extensibility.md)                               |
| **LOC** | Localisation and translation              | 7.16    | [LOC-localisation-and-translation.md](LOC-localisation-and-translation.md)                         |
| **ADM** | Administration, cost and observability    | 7.17    | [ADM-administration-cost-and-observability.md](ADM-administration-cost-and-observability.md)       |
| **STY** | Styles and presentation themes            | 7.18    | [STY-styles-and-presentation-themes.md](STY-styles-and-presentation-themes.md)                     |
| **TPL** | Templates and document instantiation      | 7.19    | [TPL-templates-and-document-instantiation.md](TPL-templates-and-document-instantiation.md)         |
| **AST** | Assets and media                          | 7.20    | [AST-assets-and-media.md](AST-assets-and-media.md)                                                 |
| **LIB** | Reference libraries                       | 7.21    | [LIB-reference-libraries.md](LIB-reference-libraries.md)                                           |

## Who owns what

Every artifact the scope defines belongs to exactly one area, or is explicitly shared between named
ones, or is explicitly unowned. The third case is the reason this table exists: `STY` and `TPL` were
both found by somebody asking "is this covered elsewhere?" rather than by anyone looking, and an
artifact nobody owns is one that quietly fails to be specified.

`apps/desktop/src/requirements.test.ts` checks that every concept defined in
[`Project_Scope.md`](../Project_Scope.md) §6 appears below. A concept may be listed as unowned; it
may not be missing.

| Artifact (scope §6)                        | Owned by           | Note                                                                 |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------- |
| **Tenant**                                 | IAM                | Isolation boundary                                                   |
| **Space**                                  | IAM, ADM           | IAM the permission boundary, ADM creating and administering one      |
| **Component**                              | CNT                |                                                                      |
| **Node-and-mark model**                    | CNT                |                                                                      |
| **Iteration**                              | VER                | Retention window is VER's; the editing behaviour is CNT's            |
| **Component version**                      | VER                |                                                                      |
| **Component revision**                     | VER, LIF           | VER the designation, LIF the gate that creates it                    |
| **Asset**                                  | AST                | STY depends on its intrinsic dimensions                              |
| **Document**                               | TPL, STR, LIF, VER | Created by TPL, structured by STR, governed by LIF, versioned by VER |
| **Outline**                                | STR                | The live outline. A template's starting outline is TPL's             |
| **Baseline**                               | VER                |                                                                      |
| **Publication**                            | PUB                |                                                                      |
| **Parameter set**                          | TPL                |                                                                      |
| **Data connection**                        | DAT                |                                                                      |
| **Query definition**                       | DAT                |                                                                      |
| **Binding**                                | DAT                |                                                                      |
| **Binding mode**                           | DAT                | Live, pinned, refreshable - and what happens when a source moves     |
| **Provenance record**                      | DAT, LIF           | DAT writes it, LIF audits it                                         |
| **Relationship**                           | REL                |                                                                      |
| **Condition**                              | REU                | CNT owns the mark, REU the evaluation                                |
| **Review thread**                          | COL                | CNT owns the anchor mark                                             |
| **Suggestion**                             | COL                | CNT owns the mark                                                    |
| **Workflow state**                         | LIF                |                                                                      |
| **Metadata schema**                        | TPL                | Which vocabulary a field draws on is TPL's; the vocabulary is not    |
| **Structure outline**                      | TPL                | The definition, not a document's live outline                        |
| **Data connections and query definitions** | DAT                |                                                                      |
| **Presentation theme**                     | STY                |                                                                      |
| **Publishing layout**                      | PUB                |                                                                      |
| **Prompt library**                         | GEN                |                                                                      |
| **Bibliography entry**                     | LIB                | CNT owns the citation that references it                             |
| **Term**                                   | LIB                | CNT owns the reference mark, PUB the glossary, LOC the labels        |
| **Vocabulary**                             | LIB                | TPL declares which vocabulary a field uses; LIB holds the list       |

Artifacts the scope refers to without defining in §6:

| Artifact                     | Owned by | Note                                              |
| ---------------------------- | -------- | ------------------------------------------------- |
| User, role, service identity | IAM      |                                                   |
| Secret                       | DAT, ADM | DAT what a connection needs, ADM where it is kept |
| Model endpoint               | GEN, ADM | GEN the use, ADM the configuration                |
| Audit log                    | LIF      |                                                   |
| Notification                 | COL      |                                                   |
| Webhook                      | API      |                                                   |
| Search index                 | SCH      |                                                   |
| Retention policy             | LIF      |                                                   |
| Style catalogue              | STY      |                                                   |
| Template                     | TPL      |                                                   |

### What this pass found

Three artifacts had no owner: **assets**, **bibliography entries**, and **terminology**, which was
not in the scope at all. All three were the same shape - a managed thing a space holds that content
references by identity, needing versioning, permissions, where-used and import or export.

They became **two** areas rather than one. Assets are binaries and carry concerns nothing else here
does: upload and format validation, malware scanning, derivatives and thumbnails, intrinsic
dimensions that `STY` depends on for aspect ratio, alt text, rights, storage sizing. Bibliography
entries, terms and vocabularies are small structured records with none of that. What they genuinely
share - reference by identity and where-used - is an argument for a common mechanism rather than a
common area, in the same way that `CNT` and `DAT` both anchor footnotes without being one area.

Two of the twenty-one areas, `STY` and `TPL`, existed only because somebody happened to ask whether
something was covered elsewhere. Two more, `AST` and `LIB`, came from looking on purpose. The guard
above is what makes the difference repeatable.

## The shape of an area document

```
# XXX - Area name

> Status, and what the document depends on.

## 1. Purpose            what this area is for, and its boundary with neighbouring areas
## 2. Depends on         other areas, decision records and spike findings it rests on
## 3..n Narrative        the design thinking, section by section, each ending in a
                         requirements table. The prose is where the reasoning lives; the
                         table is where the commitments live
## Non-requirements      what this area deliberately does not do, each numbered XXX-Nnn
## Open questions        what is not settled and what would settle it, each numbered XXX-Qnn
## Traceability          scope sections, decision records and findings this rests on
```

The narrative matters as much as the table. A requirement without its reasoning gets
re-litigated by the first person who disagrees with it, and a table of `must` statements with no
argument behind them is indistinguishable from a wish list.
