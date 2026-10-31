# T6 - Audit against the code

**Date:** 2026-10-31, at 0.220.1 (after PR #835, the DR slice and the releases repository).
**Asked for by:** Ken, before closing T6: check every `Covered` row, not a sample, then close T6
through a slice of its own, as T3 did (the TC plan).
**Answered in:** the change history of each requirements document it changes, and the T6 close
slice's plan, once Ken has answered the decisions below.

Like every review in this folder, this is kept as written. Paths and lines point at the tree at
0.220.1 and will drift; the verdicts are the record.

## What was checked, and how

`pnpm trace tranche T6`, with `pnpm trace verify` over main's CI reports for 0.220.1, counted 109
rows: **102 `Covered` and passing**, 2 `Specified` (LIB-035, PUB-055) and 5 superseded. Every one of
the 102 was read against its statement: `pnpm trace show`, every citing test's whole body, and the
code under it. One verdict each:

- **Whole**: the citing tests' assertions together show every clause.
- **Untested**: a clause no citing test asserts, which the code does. Closed by citing a test that
  already asserts it, or by a new one.
- **Gap**: a clause the code does not do, or a design claiming more than it answers.
- **Split**: part is built in T6 and the rest depends on something a later tranche brings.

Strict and literal: every "and", condition and named case is a clause, and only assertions count.
Every gap below was confirmed by hand against the code before it was written down.

## The answer in numbers

| Verdict   |   Count |
| --------- | ------: |
| Whole     |      54 |
| Untested  |      35 |
| Gap       |      10 |
| Split     |       3 |
| **Total** | **102** |

Half the rows are not whole. T3's spot check found 1 in 15. **T6's citations were written more
loosely**: a title naming several IDs whose body asserts only some of them, and statements' later
clauses left to tests that cite another row. No cite is wrong in the sense of testing nothing, but
API-071's cites are all off-target.

## The two `Specified` rows

| ID      | Verdict | Why                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIB-035 | Build   | Re-checks find gone, changed, retracted and corrected. reference-sources.md leaves it unclaimed because "neither built-in source reports a supersession"; both do. Crossref has update types `new_version` and `new_edition` and the relation `is-replaced-by`; PubMed has "Update in". `REFERENCE_NOTICE_KINDS` (domain library/sources.ts:202) and `ENTRY_CHECK_OUTCOMES` (:560) hold no supersession |
| PUB-055 | Build   | PDF, Word and HTML report what they cannot carry (`OUTPUT_REPORT_KINDS`); the environment export's manifest names what it leaves out; the audit export is whole; XLIFF keeps everything as placeholders. The bibliography's BibTeX and RIS export (service bibliography/interchange.ts, `formatEntries`) drops the CSL variables those formats cannot hold, and says nothing                            |

## Gaps (10)

| ID               | What is missing                                                                                                                                                                                                                                                     | Recommendation                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-071          | A delivered version's note holds the file name, decomposer and user (db bridge-documents.ts:118, `deliveryNote`); the hash and delivery key are on the `bridge_delivery` row alone. No citing test exercises the note                                               | **Build**: the note names the hash and key; a test reads them back from a delivered version                                                                                |
| API-067          | A data delivery writes its tables in the delivered database (worker jobs/bridge-deliver.ts:567), then finishes in a tenant transaction (:584): a failure between leaves tables written. Documents are all or nothing                                                | **Build**: no transaction spans two databases, so the tables are written so that a retry of the same delivery replaces them, shown by a test failing the finish            |
| IMP-035          | Assets an import makes at acceptance (db imports.ts:1682, `recordAsset`) get no `import_made` row; versions and suggestions do (:1266, :1498, :1538)                                                                                                                | **Build**: record them, and test it                                                                                                                                        |
| IMP-013          | HTML and Markdown imports return `references: []` (readers import.ts:83), and no test shows a Markdown loss reported                                                                                                                                                | **Amend** to "where the format carries them" (an in-document link stays a hyperlink), and **test** a Markdown loss                                                         |
| SCH-015, LIB-026 | Search follows `narrower` alone (db search-terms.ts:59-66); never `broader` or `related`. terms.md scopes it to narrower and still claims both. Its test states both relations, hiding which is read                                                                | **Amend** to alternative labels and narrower terms: looking for a broad term finds its narrower ones. Following broader or related widens a search past what was asked for |
| PUB-097          | A citation in a heading or caption is set without a link (domain publishing/assemble.ts:1354, `!inParagraph.heading`), and its test asserts so; the statement has no exception                                                                                      | **Amend**: in running text. A heading's words are repeated in the contents and running heads, which a link would follow                                                    |
| LIB-046          | Keys are unique within a space (db bibliography.test.ts:205 gives `smith2020` in two); a document may place another space's components (IAM-016), so one document can hold two `smith2020`. citations.md's "unique in the space (so in any document)" does not hold | **Amend** to unique within a space, or **build** tenant-unique keys (a migration). Recommend amend: a key is BibTeX's, which the export makes per space                    |
| IMP-004          | "Derived from heading structure and content": splits come from headings alone, content only filling parts (domain import/proposal.ts:130-175)                                                                                                                       | **Amend** the wording to what is meant: split at headings, content placed in the parts, each split explained                                                               |
| LOC-045          | "Rather than text assembled around the value" is not refused; content-model.md names the gap and still claims the row                                                                                                                                               | **Amend**: a plural form must be available; nothing can tell a number before "items" from one before "kg"                                                                  |

## Splits (3): the vocabulary half to T7

Vocabularies, value lists for metadata fields, are T7's (terms.md; LIB-020, LIB-055). Each row's term
half is built and stays in T6.

| Was     | T6 half                                                   | T7 half                                      |
| ------- | --------------------------------------------------------- | -------------------------------------------- |
| LIB-028 | Terms exported and imported as SKOS, in a documented form | Vocabularies exported and imported           |
| IMP-015 | Terms importable                                          | Vocabularies importable                      |
| LIB-057 | A deprecated term flagged as it is chosen and where used  | A deprecated or retired vocabulary value, so |

## Untested (35)

Closed by citing a test that already asserts the clause (**Cite**), or by a new assertion (**Test**).

| ID      | Clause no citing test asserts                                                    | Close                                                                          |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ADM-051 | Changed later from the tray                                                      | Cite apps/desktop/src/shell.test.ts:324                                        |
| ADM-052 | Named by the release's version                                                   | Cite apps/desktop/src/version.test.ts:29                                       |
| ADM-053 | Downloaded only when the person agrees (`autoDownload` false, main.ts:345)       | Test: the built main's check, beside `autoInstallOnAppQuit`; then Ken's check  |
| API-069 | A lock refusal changes nothing beyond the locked component                       | Test                                                                           |
| API-070 | Ids stable across a real second delivery, assets too                             | Cite packages/db/src/bridge-documents.test.ts:553                              |
| API-072 | Readable by a query definition through the connection                            | Test                                                                           |
| API-073 | The receipt holds the report, and the delivery keeps it                          | Test; drop the off-target cite in markers.test.ts                              |
| API-075 | The steps and the token shown once; the key never shown                          | Cite apps/web/src/admin/CtStudio.test.tsx:231, ct-studio-routes.test.ts:53     |
| API-077 | What was delivered stays after disconnecting                                     | Test                                                                           |
| CNT-051 | Entries are managed artifacts; a cross-reference to one succeeds                 | Cite apps/service/src/bibliography-routes.test.ts:41, :76; test the success    |
| CNT-053 | The style is the one selected                                                    | Cite packages/db/src/publication-citations.test.ts:222                         |
| CNT-102 | Extendable without a code change                                                 | Cite apps/service/src/citation-style-routes.test.ts:61                         |
| CNT-168 | The heading stays a heading, the paste becomes sections and components           | Test, through the import the breakout makes                                    |
| IMP-008 | A reading import's file released; the worker's proposal dropped after abandoning | Test                                                                           |
| IMP-029 | At size; a proposal in progress creates no content                               | Test                                                                           |
| LIB-019 | Alternative labels offered as forms                                              | Test                                                                           |
| LIB-025 | A stated `narrower` held                                                         | Cite packages/db/src/terms.test.ts:428                                         |
| LIB-044 | The same detection as import, title and author included                          | Test the hand path by work                                                     |
| LOC-003 | The person's locale reaches the sort                                             | Cite apps/service/src/listing-language.test.ts:43                              |
| LOC-004 | `dir` follows the interface language                                             | Cite apps/web/src/words/language.test.tsx:64, tests/browser/src/pseudo.test.ts |
| LOC-005 | Independent of the content's language                                            | Test                                                                           |
| LOC-012 | A variant versioned like any other content                                       | Test                                                                           |
| LOC-013 | Status measured against the source version                                       | Cite packages/db/src/translation.test.ts:263                                   |
| LOC-015 | A typo fix is not a new translation job                                          | Test                                                                           |
| LOC-016 | Status where a document uses the component                                       | Test                                                                           |
| LOC-025 | A machine draft carries the space's terms                                        | Test                                                                           |
| LOC-029 | The expansion figures; eight exempt dialogs; text cut short by an ancestor       | Cite apps/web/src/words/locales.test.ts:27; test the rest                      |
| LOC-030 | The declared set, approval not among it                                          | Cite packages/domain/src/translation/status.test.ts:27                         |
| LOC-031 | Defaulting to yes when nothing is said                                           | Test                                                                           |
| LOC-033 | What was sent, to whom and when                                                  | Cite translation-routes.test.ts:465, translation-jobs.test.ts:257; test `at`   |
| LOC-036 | Audited; the defaults stated                                                     | Test                                                                           |
| LOC-040 | An out-of-date line opens from its earlier translation                           | Test                                                                           |
| LOC-042 | Expanded and accented                                                            | Cite apps/web/src/words/locales.test.ts:27                                     |
| PUB-040 | Formatted by the style selected                                                  | Test with a second style                                                       |
| STY-075 | Greek and Cyrillic in the one paragraph                                          | Test                                                                           |

## Whole (54)

API-032, API-065, API-066, API-068, API-074, API-076. CNT-054, CNT-165. IMP-005, IMP-006,
IMP-009, IMP-010, IMP-011, IMP-014, IMP-026, IMP-031, IMP-036. LIB-008, LIB-009, LIB-010, LIB-011,
LIB-012, LIB-013, LIB-014, LIB-016, LIB-017, LIB-018, LIB-029, LIB-031, LIB-032, LIB-036, LIB-040,
LIB-045, LIB-049, LIB-050. LOC-007, LOC-010, LOC-017, LOC-018, LOC-019, LOC-023, LOC-044. PUB-039,
PUB-041, PUB-056. SCH-056. STR-043, STR-050, STR-055, STR-069. STY-020, STY-021, STY-022, STY-023.

Off-target cites to drop as the slice passes them: API-065 (bridge secrets.test.ts:11), API-066
(bridge contract.test.ts:5), API-068 (bridge-migration.test.ts:73), API-069 (bridge-store.test.ts:235),
API-071 (bridge-store.test.ts:188, bridge-settings-routes.test.ts:151, webhooks.test.ts:249), API-072
(tables.test.ts:170), CNT-165 (TermDialog.test.tsx:68), IMP-008 (import-routes.test.ts:189), IMP-036
(import-routes.test.ts:441), LIB-016 (publication-terms.test.ts:283).

## Findings that are not about rows

- **Four designs claim more than they answer**: terms.md (SCH-015, LIB-026, LIB-028, IMP-015,
  LIB-057), citations.md (LIB-046), content-model.md (LOC-045), import.md (IMP-004). Each claim is
  dropped or narrowed with its row.
- **`pnpm trace show` lists one citing title a file**, so a reader of it misses a file's other
  cites. Worth listing every one.
- **ParametersPanel sorts names in byte order** (apps/web/src/structure/ParametersPanel.tsx:279):
  a LOC-003 bug, for the slice.
- **A bibliography failure names its entry by id**, not key or title (apps/web/src/publishing/
  failures.ts:720): LIB-012 holds, but the person cannot tell which entry.

## Decisions for Ken

| #   | Decision                                                 | Recommendation                     |
| --- | -------------------------------------------------------- | ---------------------------------- |
| K1  | LIB-035 supersession; PUB-055 the bibliography's report  | Build both                         |
| K2  | API-071, API-067, IMP-035                                | Build all three                    |
| K3  | SCH-015 and LIB-026 to narrower; PUB-097 to running text | Amend                              |
| K4  | LIB-046 unique within a space                            | Amend (else build tenant keys)     |
| K5  | IMP-004, IMP-013 and LOC-045 worded as built             | Amend, and test IMP-013's Markdown |
| K6  | LIB-028, IMP-015 and LIB-057 split, vocabularies to T7   | Split                              |
| K7  | The 35 untested rows closed by cites and tests           | All, in the slice                  |
