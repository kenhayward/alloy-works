# Baselines

> **Status: v1.** One document per release, written by hand and committed alongside it.
> `packages/trace/src/parse/baseline.ts` reads it; nothing writes it. [`../requirements/README.md`](../requirements/README.md)
> is what a requirement is; this is what a release is answerable for.

## What a baseline is

A baseline is the set of requirements a release is answerable for. It is not the whole corpus, and
it is not a filter over the corpus computed from a tranche or a date - it is a **declaration**, made
by a person, of exactly which requirements this release can be checked against.

That declaration is what turns an incomplete matrix into evidence rather than an embarrassment.
`packages/trace` compiles 1,306 requirements; most releases answer for a fraction of them. Reported
against the whole corpus, that fraction reads as "13% covered", which is indistinguishable from a
project that has barely started. Reported against a baseline of the requirements this release
actually claims, the same numbers read as "complete, over a declared scope, with 620 requirements
explicitly deferred and named". The second sentence is what an auditor can act on; the first is not
even wrong, it is just the wrong question answered precisely.

## When one is declared

At every slice or tranche close ([ADR-0037](../../decisions/0037-change-fragments-and-versions-at-a-close.md)),
named by the version that close bumps to. The agent drafts it in the close PR; Ken declares it by
merging. It carries forward every row of the baseline before it - the gate reads only the newest -
and drops one only under `## Excluded`, with a reason. So the gate ratchets.

## Hand-written, committed, and never rewritten by a command

A baseline is authored the way a decision record is: a person writes it, reviews it in a pull
request, and it goes in with the release it describes. **No command in `packages/trace` may ever
generate or rewrite one.** `pnpm trace draft` allocates identifiers; nothing allocates exclusions or
declares what verified a constraint, because that is not a fact a tool can derive - it is a
commitment somebody has to make and sign.

This is not a missing feature to add later. A baseline a tool can edit is not a declaration, it is a
cache, and a cache invites the exact failure a baseline exists to prevent: a requirement quietly
dropping out of scope because something recomputed a set instead of a person deciding one. The
parser in this package only ever reads a baseline; every other operation on the corpus - compiling
requirements, scanning citations, computing state - is free to run automatically precisely because
none of them touch this file.

## The document

Three sections, each a markdown table, so the whole document is one reviewable diff:

```markdown
# <version>

> **Declared:** YYYY-MM-DD. What this release is answerable for.

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

The heading names the baseline - a version such as `0.13.0`, or a tranche such as `T1`, whatever the
release is called. The banner underneath it is the one line a reviewer reads first: the date the
baseline was declared, and a sentence of what it covers. Everything below is one of the three
tables, and the three are independent of each other - a baseline that excludes nothing still needs
no `## Excluded` section at all.

### Included

The requirements this release is answerable for, and why each one is - not why it exists (that is
the requirement's own document's job), but why it is _in force for this release specifically_. A
baseline that includes nothing is not a declaration of anything and is refused rather than accepted:
the whole point of the document is to say what a release covers, and an empty answer is not a
narrower answer, it is a missing one.

### Excluded

Reserved for a requirement somebody would reasonably expect to find in this baseline, and isn't.
**Every exclusion carries a reason, and the absence of one is an error, not a warning.** An exclusion
with no reason is exactly how a requirement gets quietly dropped: it looks deliberate because it is
named, but nobody can tell why, and "why" is the only thing that makes an exclusion different from a
requirement somebody forgot. Refusing the row outright, at parse time, is cheaper than trusting
review to catch a blank cell.

Not every requirement outside the baseline needs a row here - see below.

### Verification

How a requirement is shown to be met, for the requirements that need saying beyond "a test passed".

| Kind          | Meaning                                                                             | What it needs                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`        | The default. A test names the requirement and passes.                               | Nothing here - it needs no row at all.                                                                                                                                                   |
| `inherited`   | Satisfied by other requirements' verification.                                      | The covering identifier, or several separated by commas, each of which must be included and met, in the `By` column.                                                                     |
| `attestation` | A person checked it for this release.                                               | Who, and when, in the `By` column, and where it names its record under `docs/audits/`, a record that is there.                                                                           |
| `local-run`   | Tests naming it ran and passed on a particular machine - Word's - for this release. | Who ran it, when, and one record of this release, `docs/audits/<version>/<name>.md`, in the `By` column; beside it the run's report, `<name>.json`, which `pnpm trace record-run` wrote. |

A `local-run` row is for a requirement only a run where Word is can verify (the
[W15 plan](../../plans/2026-09-29-w15-word-measured.md), W15-D): CI runs Linux and has no Word, so the
tests naming it are skipped there, and a skip never verifies. The whole worker suite is run on the
reference machine with `ALLOY_WORD_CHECK=1`, and `pnpm trace record-run <version> <name>` reduces its
report, `.trace-results/worker.json`, to `docs/audits/<version>/<name>.json` - each test's full name and
status, the counts and the start time, stamped with `git rev-parse HEAD` and whether the working tree
was clean, and no path, no message and nothing of the machine. It refuses a failed run, a run of fewer
of the worker's test files than it has, a report more than four hours old, and a working tree with
uncommitted changes. The person writes the record beside it, `<name>.md`: who ran it, when, the
commit, Word's version and build, and what Word showed.

**The gate meets a `local-run` requirement** when it is eligible as any other is - in force and
touched by no corpus problem; the record and the report are there and of this release, and the record
is not empty; the report has the shape `record-run` writes - its commit, its tree's state and counts
that agree with its tests; it covers every one of the worker's test files; it was recorded from a
clean tree, at a commit in this branch's history where the clone holds the history to ask (CI's
shallow checkout does not, and the pack names the commit); the run did not fail; a test title under
`apps/worker/src/` cites the requirement; by that report it is Verified - every test naming it passed
and none was skipped; and in CI's own results no test naming it failed, a skip being expected there.
Where one of these does not hold it says which. `pnpm trace verify` is unchanged, and reads
`.trace-results` alone: in CI such a requirement reads Covered, and after a local run with Word,
Verified. The evidence pack names the record, the run's commit and tree, and the report's counts, and
lists the report's tests naming the requirement.

**What the gate cannot see.** The report is data somebody committed, and the gate takes it as written:
it holds the report to the shape and the counts `record-run` writes, but a report typed by hand to that
shape reads the same, and nothing in it proves that the tests it lists ran, where it says, or on Word.
**A reviewer trusts it as far as the person who committed it**, as with an attestation - which is why
the row names that person and the record says what they saw, and why the procedure holds the rest: the
run is made at the release's commit, from a clean tree, and recorded before its baseline cites it.

`test` is the default precisely so that the common case costs nothing: most requirements are
verified by a test naming them, and a table with 1,306 rows saying so would be the "new column in
1,306 rows" this document exists to avoid. `Verification` only needs an entry for a requirement whose
evidence is something other than its own passing test - most often a `Constraint`, which governs how
everything is built rather than naming one thing to build, and where "which test verifies it" is
often "all of them" or "a review, not a test". `inherited` and `attestation` exist for exactly that
case, and both are deliberately more work than writing nothing: `inherited` still names a real
covering identifier, and `attestation` still names a real person and a real date, because the honest
escape hatch for "no test reaches this" must never be as cheap as the thing it is an alternative to.

Two attestations are due in every release that claims them: the WCAG 2.2 AA audit of the editor
(CNT-177, with CNT-078 `inherited` from it and from CNT-176, the suite) and the Matterhorn review of the publishing regression
corpus (PUB-105). [The audit guide](../../guides/auditing-a-release.md) is the procedure for each,
where its record is committed, and the rows that cite it.

## Out of baseline is not the same as excluded

**A requirement absent from all three tables is simply out of baseline, and needs no entry
anywhere.** This is the distinction that matters most in the whole document, because it is the one
easiest to get backwards:

- **Out of baseline** means this release does not claim the requirement at all. Most of the corpus,
  for most releases, is out of baseline this way, silently, and that silence costs nothing - a
  baseline for a T1 release does not need 620 rows saying "not T1".
- **Excluded** means the opposite: this requirement is the kind somebody would reasonably expect to
  find included, and the baseline is saying, on the record, that it is not - and why.

An `IAM` requirement missing from a baseline that includes the rest of `IAM` is worth a reader's
attention; an `AST` requirement missing from a baseline that never touches assets is not. The
`Excluded` table exists for the first case. Reaching for it in the second would turn a document
meant to be read into a list nobody reads, which is the same failure an unreasoned exclusion is - a
place a requirement can go missing without anyone noticing, just achieved by drowning it in
irrelevant rows instead of by silence.

## Parsing

`packages/trace/src/parse/baseline.ts` reads exactly this format: the version from the heading, the
declared date from the banner, and the three tables, stopping each at the next heading the way
`parse/design.ts` stops a design document's `## Requirements owned` table. Every row is validated
the moment it is read, failing with the document and line the way a malformed requirement does - an
exclusion with no reason, a verification kind the format does not know, or a `By` cell left blank
are refused there, not caught later by something that has to remember to check.
