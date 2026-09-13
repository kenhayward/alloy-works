# Baselines

> **Status: v1.** One document per release, written by hand and committed alongside it.
> `packages/trace/src/parse/baseline.ts` reads it; nothing writes it. [`../requirements/README.md`](../requirements/README.md)
> is what a requirement is; this is what a release is answerable for.

## What a baseline is

A baseline is the set of requirements a release is answerable for. It is not the whole corpus, and
it is not a filter over the corpus computed from a tranche or a date - it is a **declaration**, made
by a person, of exactly which requirements this release can be checked against.

That declaration is what turns an incomplete matrix into evidence rather than an embarrassment.
`packages/trace` compiles 1,303 requirements; most releases answer for a fraction of them. Reported
against the whole corpus, that fraction reads as "13% covered", which is indistinguishable from a
project that has barely started. Reported against a baseline of the requirements this release
actually claims, the same numbers read as "complete, over a declared scope, with 620 requirements
explicitly deferred and named". The second sentence is what an auditor can act on; the first is not
even wrong, it is just the wrong question answered precisely.

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

| Kind          | Meaning                                               | What it needs                                |
| ------------- | ----------------------------------------------------- | -------------------------------------------- |
| `test`        | The default. A test names the requirement and passes. | Nothing here - it needs no row at all.       |
| `inherited`   | Satisfied by another requirement's verification.      | The covering identifier, in the `By` column. |
| `attestation` | A person checked it for this release.                 | Who, and when, in the `By` column.           |

`test` is the default precisely so that the common case costs nothing: most requirements are
verified by a test naming them, and a table with 1,303 rows saying so would be the "new column in
1,303 rows" this document exists to avoid. `Verification` only needs an entry for a requirement whose
evidence is something other than its own passing test - most often a `Constraint`, which governs how
everything is built rather than naming one thing to build, and where "which test verifies it" is
often "all of them" or "a review, not a test". `inherited` and `attestation` exist for exactly that
case, and both are deliberately more work than writing nothing: `inherited` still names a real
covering identifier, and `attestation` still names a real person and a real date, because the honest
escape hatch for "no test reaches this" must never be as cheap as the thing it is an alternative to.

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
