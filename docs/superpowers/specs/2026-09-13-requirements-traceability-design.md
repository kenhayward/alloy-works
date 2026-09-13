# Requirements traceability

> **Status: stages 1 through 3 built; stage 4 remains.** Rests on
> [`docs/specification/requirements/README.md`](../../specification/requirements/README.md) for the
> identifier scheme, and on `packages/trace/src/requirements.test.ts` and
> `packages/trace/src/design.test.ts` for the checks that already exist. Nothing here changes a
> requirement, a design or an identifier.

## 1. Purpose

Turn 1,303 requirements from a corpus that has to be read into one that can be queried, and make the
chain from a requirement to the test that verifies it computable rather than remembered.

The driver is a supplier audit. A customer's quality function, or a regulator acting through one,
assesses how this product was built: which requirements were in force for a release, which design
answered each, which test demonstrated it, and that the test passed. That evidence has to be
reproducible from a release tag years later, which is the constraint that decides almost every choice
below.

## 2. Where the corpus stands

Measured at `e11aab3`, by parsing the documents rather than by counting by hand:

| Quantity                                  | Count     |
| ----------------------------------------- | --------- |
| Requirements across 21 area documents     | **1,303** |
| Of those, withdrawn or superseded         | 39        |
| Non-requirements                          | 112       |
| Open questions                            | 131       |
| Requirements claimed by a design document | **175**   |
| Requirements named by a test              | **8**     |
| Cited by a test but claimed by no design  | 1         |

By tranche, against the states defined in section 4:

| Tranche        | Total | Specified | Designed | Covered |
| -------------- | ----- | --------- | -------- | ------- |
| **T1**         | 322   | 258       | 59       | 5       |
| T2             | 181   | 168       | 13       | 0       |
| T3             | 201   | 182       | 19       | 0       |
| T4             | 92    | 74        | 18       | 0       |
| T5             | 60    | 56        | 4        | 0       |
| T6             | 86    | 85        | 1        | 0       |
| **Constraint** | 361   | 304       | 54       | 3       |

The `Designed` column sums to 168 rather than to the 175 reported above, because `Designed` in
section 4 means claimed by a design and not yet covered by a test. Seven of the eight covered
requirements are also claimed by a design; the eighth is the finding below.

The eight covered requirements are counted strictly: an identifier inside a `describe` or `it` title,
or in a `rule:` field of an error payload. An identifier mentioned in a comment is not counted,
because mentioning a requirement is not claiming to verify it. A looser count gives fifteen, and the
stricter number is the one worth reporting.

**`IAM-018` is cited by a test and claimed by no design.** That is the first finding this work
produces, before any of it is built, and it is exactly the class of gap nobody finds by reading.

## 3. What already exists, and is not being rebuilt

The identifier scheme is already audit-grade, and it is the reason no external tool is adopted below.
Allocated once and never reused; a withdrawn requirement keeps its row; a material change gets a new
identifier and the old one is marked superseded; numbering is contiguous as a set, which is what
catches a deletion disguised as an edit. `requirements.test.ts` enforces all of it.

The requirement-to-design edge also already exists. Each design document declares a
`## Requirements owned` table, and `design.test.ts` builds the reverse index, rejects an identifier
that does not exist, and rejects two designs claiming the same one. Nothing is hand-maintained inside
the requirements themselves, because a coverage column edited by a person is a coverage column that
drifts.

What does not exist is the design-to-test edge, the test-to-result edge, any way to query the corpus,
and any notion of which requirements a given release was answerable for.

## 4. Derived state, never declared

`docs/specification/requirements/README.md` already states the principle: progress is read off what
cites a requirement, not off a status column somebody has to remember to update. This work makes that
computable. Every requirement sits on a four-rung ladder, and each rung is computed from a different
artifact:

| State         | Computed from                                                         |
| ------------- | --------------------------------------------------------------------- |
| **Specified** | the row exists in an area document                                    |
| **Designed**  | a design document's `## Requirements owned` table claims it           |
| **Covered**   | a test names it, in a `describe` or `it` title or a `rule:` assertion |
| **Verified**  | that test passed in the run at this commit                            |

The `Status` column in the requirements tables is untouched and keeps its present meaning -
`Specified`, `Withdrawn`, `Superseded by XXX-NNN` - which is about whether the requirement is still
in force, not about build progress. Those are two different axes, and conflating them is how a
coverage column rots.

`Withdrawn` and `Superseded by` short-circuit the ladder. Such a requirement leaves it entirely
rather than counting as a gap, which is the whole point of keeping the row.

## 5. The trace chain, edge by edge

```
requirement row  ->  design claim  ->  test title  ->  test result at a commit
   VER-001           storage-and-      it('... (VER-001)')     passed
                     versioning.md
```

| Edge                   | Mechanism                                                            | State today                        |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| requirement -> design  | the `## Requirements owned` table                                    | enforced by `design.test.ts`       |
| design -> test         | the identifier in a `describe` or `it` title, or a `rule:` assertion | enforced by `pnpm trace check`     |
| test -> result         | the built-in JSON reporter records outcomes, identifiers extracted   | built, read by `pnpm trace verify` |
| requirement -> runtime | `rule: 'IAM-043'` in an error payload                                | exists, in the service             |

The test-title convention is not invented here. It is already how this repository writes them, as in
the service's cross-tenant suite, which names `IAM-004` in the `describe` title. Formalising an
existing habit costs nothing to adopt.

The runtime edge deserves saying out loud because it is unusually strong evidence: the product cites
the requirement it is enforcing in the response the user receives. An auditor can see the requirement
from outside the system.

New enforcement is symmetrical with what exists. Every identifier a test cites must exist, which
catches a renumbering. Every requirement **in the declared baseline** must be cited by at least one
test, which catches the gap. Requirements outside the baseline are exempt, which is what stops the
gate being unpassable at 8 of 1,303.

**A `rule:` citation reaches `Covered`, never `Verified`, and that is deliberate.** The `test -> result`
edge identifies a result by its test's name, because that is what the JSON reporter records; a
`rule:` assertion lives in a test's body, not its name, so no result ever carries it. Treating every
test in a `rule:` citation's file as verification, on the reasoning that the file passed, would be
weaker evidence wearing the same word as the title-based rung; stage 2 declines that for exactly the
reason section 6 exists to name - two different strengths of evidence sharing one name is the
dishonesty this design exists to prevent. A `rule:` citation earning its own, weaker, named rung is a
verification kind, and building that is stage 3's.

## 6. Constraints, and the three verification kinds

361 requirements carry the tranche `Constraint`. They govern how something is built rather than
naming a thing to build, so no single design document can own one, and "which test verifies it" is
often "all of them" or "a review, not a test". Treating them like ordinary requirements is precisely
how a traceability matrix becomes a lie that passes.

So a requirement has a verification kind. The default needs no declaration; the other two are
declared in the baseline manifest, **never as a new column in 1,303 rows**:

| Kind          | Meaning                                         | Evidence recorded                          |
| ------------- | ----------------------------------------------- | ------------------------------------------ |
| `test`        | default, a test names it and passes             | the run at that commit                     |
| `inherited`   | satisfied by another requirement's verification | the covering identifier, asserted to exist |
| `attestation` | a person checked it for this release            | who, when, and what they checked           |

`inherited` does the real work. "Must work on Windows, macOS and Linux" is verified by the CI matrix,
not by a test per requirement that says so. `attestation` is the honest escape hatch for a constraint
no test can reach, and it is deliberately expensive to use: it names a person and a date, and it
expires with the release it was made for.

## 7. Baselines

A baseline is the set of requirements a release is answerable for. It is the mechanism that makes an
incomplete corpus defensible: the first baseline, `0.13.0`, declares 7 of the corpus's 1,264
in-force requirements, excludes 4 more by name with a stated reason each, and leaves the rest simply
outside its scope - a clean statement to an auditor, and the opposite of an unexplained gap. A matrix
that is a few percent populated across the whole corpus is worse evidence than one that is complete
across a declared subset.

Built as `docs/specification/baselines/<version>.md`, a markdown document with three tables, not the
YAML this section originally proposed: there is no YAML parser anywhere in this repository's
dependency tree, so YAML would mean a new runtime dependency in a product whose whole point is
auditability, and `parse/table.ts` already reads a table row for every other document in the corpus.
A markdown table is reviewable as a diff in exactly the way `CLAUDE.md` asks of a requirement; a new
dependency is not.

```markdown
# 0.13.0

> **Declared:** 2026-09-13. What this release is answerable for.

## Included

| ID          | Why it is in force                   |
| ----------- | ------------------------------------ |
| **IAM-004** | Enforced by the environment boundary |

## Excluded

| ID          | Reason                                 |
| ----------- | -------------------------------------- |
| **IAM-018** | Cited only by a `rule:` field, and ... |

## Verification

| ID          | Kind        | By                          |
| ----------- | ----------- | --------------------------- |
| **ADM-031** | attestation | Ken Hayward, 2026-09-13 ... |
```

`packages/trace/src/parse/baseline.ts` reads this; nothing writes it -
[`docs/specification/baselines/README.md`](../../specification/baselines/README.md) is the fuller
account, including why the first baseline declares what the release implements rather than a
tranche.

Every exclusion carries a reason, and the absence of one is an error. An exclusion without a reason
is how a requirement gets quietly dropped, which is the failure this whole document exists to
prevent.

## 8. The compiled model, and the evidence pack

`trace.json` is generated, **committed, and drift-checked in CI** - the same pattern this repository
already runs for `packages/api-contract/openapi.json`. Committing a generated file earns its keep
twice over here: an auditor gets the model exactly as it stood at any tag without running anything,
and an assistant working on an implementation can read one index instead of twenty-one documents. A
1,303-requirement corpus does not fit in a context window; a queryable index does.

```jsonc
{
  "requirements": [
    {
      "id": "VER-001",
      "area": "VER",
      "statement": "An iteration must be an immutable, timestamped snapshot...",
      "tranche": "T1",
      "status": "Specified",
      "document": "VER-versioning-baselines-and-comparison.md",
      "line": 40,
    },
  ],
  "nonRequirements": [],
  "questions": [],
  "designs": [
    {
      "document": "storage-and-versioning.md",
      "owns": [{ "id": "VER-001", "howItIsMet": "An `iteration` row carries editor..." }],
    },
  ],
  "citations": [{ "id": "IAM-043", "file": "apps/service/src/...", "line": 139, "kind": "title" }],
}
```

The model deliberately carries no commit hash and no timestamp. The commit that holds the file is its
provenance, and a hash inside it would change on every commit, which would make the drift check
impossible to pass. The evidence pack in stage 3 records the tag and the commit it was built from.

The model carries no test results either, for the same reason it carries no commit hash: a result is
a function of a run, not of the documents, so committing one would churn on every run and make the
drift check impossible. Citations are committed because they are a function of the source. Results
are read at query time from the JSON report every suite already writes.

`pnpm trace pack <version>` writes the evidence pack: the trace matrix, the gap report, the raw test
results, and the commit they were computed from. It refuses to run on a dirty working tree, because
it stamps the pack with `git rev-parse HEAD` - the commit that will hold the pack's own inputs does
not exist yet while anything is uncommitted, so a pack built from a dirty tree is stamped with a
commit that cannot reproduce it. It is committed as `docs/trace/<version>/`, by hand, in the same pull
request as the release it describes - nothing ties this to a git tag. A few hundred kilobytes of text
per release is the cost; the alternative is audit evidence that cannot be reproduced, which is not an
alternative.

## 9. Intake

Requirements arrive from testers, from users, and from the author. They are captured as GitHub issues
and land as rows by pull request, so that the issue is the change-control record an audit asks for:
who proposed a change, against what reasoning, who approved it, when, at which commit.

`.github/ISSUE_TEMPLATE/requirement.yml` is an issue form with the area (a dropdown of the 21 codes),
the statement, the reasoning, a suggested tranche, and who asked. `pnpm trace draft <issue>` then
allocates the next free identifier in that area, inserts the row in the section named, and links the
issue. The pull request closes it.

**Known limitation.** Two concurrent branches can both claim the next free identifier. The contiguity
check catches the collision, and resolution is renumbering the later one before merge. Locking it
properly needs a server, and a server is not worth it for a collision that a test refuses to let
through.

## 10. The query interface

```bash
pnpm trace show CNT-014            # statement, tranche, owning design, citing tests, state
pnpm trace gaps --baseline T1      # in the baseline, not yet Verified
pnpm trace search 'footnote'       # full text over statements
pnpm trace area CNT --state Designed
pnpm trace next CNT                # the next free identifier
pnpm trace matrix --format md
```

This is the half of the work that pays off immediately and has nothing to do with audit: it is how a
person, or an assistant, finds the four requirements that govern the thing they are about to build,
out of 1,303.

## 11. Where it lives

A new workspace, `packages/trace`, published as `@alloy-works/trace` and private like the rest.

Two existing tests move into it and stop being regular expressions embedded in a test file. Both
already carry a comment saying so, that at three or four these checks want a workspace of their own
rather than a corner of the desktop app, and there are now four:

- `apps/desktop/src/requirements.test.ts` moves, rewritten against the real parser
- `apps/desktop/src/design.test.ts` moves, likewise

`version.test.ts`, `decisions.test.ts` and `icons.test.ts` stay where they are. They do not parse
requirements, and moving them is unrelated work.

```
packages/trace/src/
  parse/requirements.ts   area document text -> requirements, non-requirements, questions
  parse/design.ts         design document text -> claims
  parse/citations.ts      test file text -> cited identifiers
  model.ts                zod schemas for the compiled model
  state.ts                pure ladder: (identifier, model) -> state
  baseline.ts             the baseline manifest, and the verification kinds
  compile.ts              the only module that touches the filesystem
  cli.ts                  the query commands
  results.ts              parses the JSON reports the built-in reporter writes into a verification map
```

Every parser takes **text and returns a model**, never a path, so each parser test is an inline string
and touches no filesystem. `compile.ts` is the single thin layer that reads files, which is the same
division this repository already draws between `shell.ts` and `main.ts`.

This design document does not live in `docs/design/`. That folder is for product subsystems, and
`design.test.ts` requires every document in it to declare the product requirements it owns, which
this tooling, correctly, owns none of. The implementation plan goes to `docs/plans/` per the usual
convention. No decision record yet: a record waits until a choice has survived contact with
something, and this one is a day old. It gets written once stage 1 has shipped and been lived with.

## 12. Testing

Test-driven throughout, per the repository's standing rule. The parsers are the easy part, pure
functions over strings, so a fixture is a template literal. Fixtures use invented area codes and
invented statements rather than copies of the real corpus, so that a fixture never becomes a second
source of truth that drifts from the first.

Two traps this repository has already paid for, and this work must not walk back into:

- **The built-in `json` reporter is added alongside the explicitly pinned `default` reporter in each
  config, never instead of it - `'default'` must stay first in the `reporters` array.** The pinning
  exists because an implicit reporter prints nothing a test logged on Windows while the identical run
  on Linux prints all of it. Replacing it to add trace output would trade a real property for a
  convenience. Stage 2 declined a custom Vitest reporter for exactly this reason: the built-in `json`
  reporter, declared in each `vitest.config.ts`, already writes what `results.ts` needs.
- **Nothing in this pipeline writes through `console.error` or `console.warn`**, which `consoleGate`
  throws from by design.

## 13. Staging

Each stage is one pull request, with its own version bump and changelog entry. Each is useful alone,
and the work can stop after any of them.

| Stage | Delivers                                                                                                                                                                   | Bump  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **1** | the parsers, the model, a committed drift-checked `trace.json`, the query and search CLI, and the two tests moved                                                          | Minor |
| **2** | the citation scanner, the built-in JSON reporter wired into each `vitest.config.ts`, the `Covered` and `Verified` states, and the check that every cited identifier exists | Minor |
| **3** | baselines, the verification kinds, the CI gate over the baseline, and the evidence pack                                                                                    | Minor |
| **4** | the issue form and `trace draft`                                                                                                                                           | Minor |

Stage 1 alone solves query and search, which is the daily cost being paid today. Stage 3 is the one
the audit needs, and it is deliberately last of the three because a baseline declared before the trace
edges work would be a baseline nobody could satisfy.

## 14. What this does not do

**It measures citation, not correctness.** A test titled `(IAM-043)` that asserts nothing reads as
`Covered`. The matrix proves linkage, which is what a supplier audit asks for; the test-driven
discipline is what makes the linkage mean something. Every tool in this space has this property, and
the ones that imply otherwise are worse than this one. It is written here so that nobody later
mistakes a green matrix for a quality claim.

It does not track build progress beyond the four states, produce burndown, or estimate. It does not
validate that a requirement is a good requirement. It does not replace review: a design claiming a
requirement is a claim by an author, and the check is only that the claim is well-formed and unique.

## 15. What would change the answer

- **A second person writing requirements concurrently, routinely.** The identifier collision this
  design leaves to a failing test becomes a daily cost, and a server-side allocator starts to earn its
  complexity.
- **An auditor rejecting bespoke tooling on principle.** The answer then is OpenFastTrace, and the
  price is rewriting 1,303 identifiers into its naming convention and adding a JVM to CI. Worth
  knowing the price in advance rather than discovering it under audit.
- **The corpus growing past roughly 5,000 requirements**, where a JSON index stops being the right
  shape and SQLite starts being it. The parsers and the state model are unaffected by that change,
  which is why they are separate modules from `compile.ts`.

## 16. Alternatives considered

**OpenFastTrace as the trace engine.** The closest off-the-shelf fit, and an auditor may recognise it.
Rejected because it wants `req~name~1`-shaped identifiers, so the whole scheme - allocated once, never
reused, contiguous, already enforced - would be rewritten to suit a tool, and the scheme is worth more
than the tool. It also needs a JVM in a TypeScript CI and has no concept of tranches or baselines, so
both would be built anyway.

**StrictDoc or Sphinx-Needs as the source of truth.** Both add a runtime, Python and Sphinx on top of
it, and both store a requirement as a statement plus attributes, with the surrounding argument
becoming a description field. The narrative is the asset here: the requirements README says a
requirement without its reasoning gets re-litigated by the first person who disagrees with it, which
is why each table sits at the end of the section that argues for it.

**Polarion, Jama or codebeamer.** Each replicates, expensively, the change-control record that a pull
request history already is. Decisively ruled out on audit grounds rather than cost: the state of an
external database eighteen months ago is not recoverable from a release tag, and reproducibility from
the tag is the requirement this whole document is built around.

**One YAML file per requirement, Doorstop style.** The cleanest possible data model, and it separates
every statement from the reasoning that justifies it. A 1,303-file migration to make parsing easier
than it already is.
