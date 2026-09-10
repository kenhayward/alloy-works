# Detailed requirements

> **Status: in progress.** One document per capability area in
> [`Project_Scope.md`](../Project_Scope.md) section 7. These say what the product must do, in enough
> detail to choose an architecture on. They do not say how to build it - that is the architecture,
> and it comes after.

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

| Code    | Area                                      | Scope § | Document                                                     |
| ------- | ----------------------------------------- | ------- | ------------------------------------------------------------ |
| **CNT** | Content and authoring                     | 7.1     | [CNT-content-and-authoring.md](CNT-content-and-authoring.md) |
| **STR** | Structure, numbering and cross-references | 7.2     | -                                                            |
| **REU** | Reuse, variants and conditional profiling | 7.3     | -                                                            |
| **DAT** | Data connectivity and bindings            | 7.4     | -                                                            |
| **TAB** | Tabular presentation                      | 7.5     | -                                                            |
| **GEN** | Generative AI                             | 7.6     | -                                                            |
| **COL** | Collaboration and review                  | 7.7     | -                                                            |
| **LIF** | Lifecycle, workflow and audit             | 7.8     | -                                                            |
| **VER** | Versioning, baselines and comparison      | 7.9     | -                                                            |
| **PUB** | Publishing and output                     | 7.10    | -                                                            |
| **SCH** | Search, navigation and discovery          | 7.11    | -                                                            |
| **REL** | Relationships and the graph               | 7.12    | -                                                            |
| **IMP** | Import, export and interchange            | 7.13    | -                                                            |
| **IAM** | Identity, tenancy and access control      | 7.14    | -                                                            |
| **API** | API, MCP and extensibility                | 7.15    | -                                                            |
| **LOC** | Localisation and translation              | 7.16    | -                                                            |
| **ADM** | Administration, cost and observability    | 7.17    | -                                                            |
| **STY** | Styles and presentation themes            | 7.18    | -                                                            |
| **TPL** | Templates and document instantiation      | 7.19    | -                                                            |

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
