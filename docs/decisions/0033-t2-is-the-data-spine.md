# 0033 - T2 is the data spine

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

[Project_Scope.md](../specification/Project_Scope.md) section 12 names T2 **the data**: connections,
query definitions, parameters, inline and block bindings, provenance, revising a bound value by hand,
and tabular presentation with field formatting. The rows filed under T2 had grown well past that. By
the time T1's last slices were landing, T2 held 195 requirements across sixteen areas, and only 88 of
them were **DAT**'s and **TAB**'s.

The rest arrived in three ways, none of them a decision that T2 should hold it:

- **Splitting a row by tranche.** The T1 audit (2026-09-25) and the designs after it split rows whose
  T1 half could be built now, and the other half, a row of its own, often landed in T2 as the next
  tranche: MET-039, a departed user's value kept readable, beside MET-038 in T1; TPL-063, bindings
  established at creation, beside TPL-062. IAM-010, a disablement learned from the provider, moved to
  T2 whole.
- **Each area's own breadth.** Read together, the rows each area placed in T2 besides the data are a
  tranche of their own: administration through the API, derived styles and admonitions, adding a
  style or a theme without a release, a catalogue's export and import, the assets library,
  vocabularies and reference libraries, SCIM and federation, moving content between spaces, and the
  product's export format restored into a tenant.
- **Deferring from T1.** [ADR-0032](0032-words-fidelity-to-the-pdf-leaves-t1.md) moved Word's fidelity
  to the PDF - STY-081, PUB-023 and PUB-107 - to T2 on 2026-09-29, because T2 was the next tranche, not
  because it belongs with the data. Closing it is two slices on Word's side, one that changes what the
  PDF prints, and decisions of Ken's, and none of it touches a binding.

One row pointed the other way. **GEN-012** asks for a thin drafting assistant "from T2", so that the
governance in scope section 7.6 meets real use before the rest of the assistant in T5. A thin slice
still needs what T5 builds first - model endpoints, AI governance and cost controls - and it opens a
second product surface, the assistant, in a tranche with no other reason to have one.

A tranche is designed from `pnpm trace tranche <Tn>`. At 195 rows, T2's design would have been the
data plus a hundred rows of unrelated breadth, and T2 would have shipped when the last of those did.

Ken decided on 2026-09-29, on the recommendation made as T2's planning began, to narrow T2 to the
spine.

## Decision

**T2 is the data spine**: connections, query definitions, parameters, bindings inline and in blocks,
provenance, revising a bound value by hand, tabular presentation and field formatting - and only what
the spine directly depends on. Every row keeps its identifier; only its tranche cell changes.

- **Kept in T2, 109 rows.** Every **DAT** row (54) and every **TAB** row (34, two superseded), and,
  because the spine needs each: **STY-014** and **STY-077**, field formatting and alignment by column
  type in a table style; **IAM-020**, seeing a connection's results separately grantable, DAT-025's
  other half; **SCH-055**, query definitions searchable; **VER-057**, query definitions versioned like
  content; **PUB-049**, the provenance of every bound value with its publication, and **PUB-099**, the
  resolution order's test placing the binding stage as it arrives; **CNT-039**, a footnote anchored
  into generated content by data; and thirteen **TPL** rows that wire a template's parameters to its
  bindings - TPL-017 to TPL-021, TPL-023, TPL-026, TPL-041, TPL-045, TPL-046, TPL-060 and TPL-063,
  with TPL-022, superseded, whose T2 half TPL-063 is. TPL-046 stays because TPL-060 asks every template
  for exactly one query set, and a template that runs no query - every T1 template - can hold only by
  binding the declared empty one.
- **A new tranche, T7 - the administration and the library**, takes the other 82: ADM-001, ADM-003
  and ADM-004; API-051, with API-009, which it supersedes; all sixteen of **AST**'s T2 rows, the
  assets library; CNT-058, CNT-100 and CNT-120, with CNT-020 and CNT-093, superseded; ten **IAM** rows,
  SCIM, federation, moving content between spaces, the high-risk administrative permissions,
  evaluating as another user and session lifetimes; five **IMP** rows, export and import; nine **LIB**
  rows, records and vocabularies, LIB-021 superseded among them; four **MET** rows, vocabulary-backed
  fields, a type's audited change, where-used and a departed user's value; four **SCH** rows, assets
  found and indexing's operation; nineteen **STY** rows, derived styles, admonition styles, a change of
  theme, adding a style or a theme without a release, a tenant's typefaces and a catalogue's export
  and import, STY-007 superseded among them; and TPL-005, TPL-032, TPL-048 and TPL-050, with TPL-008,
  superseded.
- **A last tranche, T8 - Word fidelity**, takes STY-081, PUB-023 and PUB-107: Word's rendering held
  to the PDF's by measurement, Word as a first-class output, and the keep rules shown in Word's own
  pages. ADR-0032's reasons for leaving T1 stand; this record only says where they wait.
- **GEN-012 moves to T5**, and its statement drops "from T2", which its tranche would contradict: the
  thin slice is the first of the assistant's capabilities built, so that the governance still meets a
  thin slice before the rest. Scope section 12's "a thin AI slice rides along from T2" is revised to
  say it lands with T5.
- **STR-072 is reworded**, a clarity edit on Ken's answer the same day: opening a document means
  opening it from within the application, not a cold page load. structure.md claims it, and the
  browser suite's two tests that time the open from the documents list and every act on the outline
  cite it.

## What would change the answer

- **A customer for T2 needs a T7 row to use the data at all** - SCIM for an enterprise pilot, say, or
  a vocabulary feeding a query's parameter. Then that row moves into T2 by name, with a change-history
  row saying why, and the rest of T7 stays where it is.
- **A design in T3 to T6 finds one of its rows resting on a T7 row.** Several already do: an asset's
  licence change reaching where it is used (AST-032, T3) rests on a reference floating or pinned
  (AST-017), and listing the assets nothing references (AST-050, T3) on where-used (AST-018); records
  changed since a
  document last published (LIB-048, T3) need a record's where-used (LIB-005); where-used across every
  artifact (REU-052, T4) names assets and templates; a deprecated vocabulary value flagged on insertion
  (LIB-057, T6) needs vocabularies; embedded metadata handled by policy (IMP-012, T6) needs AST-007.
  T7 is numbered after T6 and is not a promise to build it after T6: the design that finds such a row
  moves it into its own tranche, by name, rather than building it as an unnamed prerequisite.
- **Word becomes a customer's deliverable.** ADR-0032's first condition: then T8's two slices on
  Word's side come forward first, since they change nothing the PDF prints.
- **The governance cannot wait for T5.** If an AI capability ships before T5 for any reason, GEN-012
  comes with it, since exercising the governance early is the whole of its purpose.

## Consequences

- T2 holds 109 rows in nine areas: 54 DAT, 34 TAB, 13 TPL, 2 STY, 2 PUB, and one each of CNT, IAM,
  SCH and VER. T7 holds 82 and T8 three. The corpus's total, 1,479, is unchanged.
- `packages/trace` accepts `T7` and `T8`, and the requirement issue form offers them; a test in
  `intake.test.ts` fails when the form's tranches and the parser's disagree.
- Claims move with their rows and are not dropped. themes.md's claims on the catalogue's
  administration (STY-026, STY-029 to STY-034, STY-043, STY-044, STY-046, STY-056), search.md's on
  SCH-009 and assets.md's on AST-026, met early in T1, now answer T7 rows; a claim says a design
  answers a requirement, not when it is built.
- Three rows kept in T2 still name something later, as they did before: TPL-041's variables are
  **REU**'s, T4; TPL-046's empty prompt library answers TPL-061, T5; and DAT-066's report of a
  failing rotation cites ADM-047, T3. T2's design answers their data halves and names the rest, as
  a split row's design does.
- GEN-012's reason - governance exercised on a thin slice before the rest - now orders work within
  T5, not across tranches.
- STR-072 is claimed. A document loaded cold at its own address stays recorded, and is held by
  CNT-179's budget for opening the document view, which is the whole time a reader waits.
