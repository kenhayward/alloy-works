# MC: Match case in a built filter

> **A sketch**, one pull request, test-first, with a pre-flight review (it widens a stored shape) and
> one final review. It answers **DAT-119** on what [D4](2026-10-03-d4-the-builder.md) and
> [D6](2026-10-06-d6-http-s3-and-files.md) built. Decisions MC-A to MC-F were approved by Ken on 2026-10-09, every one as
> recommended.

**Goal:** a "contains" or "starts with" filter on text in a built query or a file's filters carries a
**Match case** checkbox, off for a new filter. Off, `pfizer` finds `Pfizer Inc`; on, it does not,
as every filter does today. Every stored definition keeps its results.

| PR   | Holds                                                                  | Version |
| ---- | ---------------------------------------------------------------------- | ------- |
| MC.1 | This plan, DAT-119, the shape, both generators, the checkbox, the docs | Minor   |

## What was checked first

On 2026-10-09, against the existing `aw-browser-source-postgres-1` (PostgreSQL 18.6) and Node:

| Expression                                    | `ÉCOLE Straße İ ΣΑΣ` became |
| --------------------------------------------- | --------------------------- |
| `lower(x COLLATE "C")`, D4-G's key lowered    | `École straße İ ΣΑΣ`        |
| `lower(x COLLATE "und-x-icu")`                | `école straße i̇ σας`        |
| JavaScript `toLowerCase()`, the file filter's | `école straße i̇ σας`        |

So `COLLATE "C"` lowers ASCII alone, and ICU's root locale and JavaScript agree, final sigma
included: a database filter and a file filter fold one way. A source without ICU is a database whose
`und-x-icu` a superuser dropped, which task 4 makes for real. Not run: PostgreSQL 14, the oldest
source (`OLDEST_SERVER_VERSION`); `lower` and `und-x-icu` are both older than it.

## Decisions

- **MC-A. Stored as `ignoreCase: true` on the comparison; absent means match case.** The default in
  the page is off, but the default in storage must be today's meaning, or every stored definition's
  results and checksums move on its next run (DAT-119's second clause). `false` is refused, so each
  meaning has one spelling; so is `ignoreCase` on any comparison but `contains` and `startsWith`, or
  against an operand that is not text. Added as a member, never changing one (DAT-100), in both
  `builder.ts`'s and `file-filter.ts`'s strict schemas, checked on every write path a tree reaches (a
  write, a sample, a describe, a run's request).
- **MC-B. Fold with Unicode's default lower-casing, both sides.** PostgreSQL:
  `pg_catalog.lower((x)::pg_catalog.text COLLATE pg_catalog."und-x-icu") COLLATE pg_catalog."C"` for
  the column, the same over the bound value, then D4's `strpos` or `starts_with`. Files:
  `toLowerCase()` on both. Lower-casing is not full case folding: `Straße` does not find `STRASSE`.
  `casefold()` would, but is PostgreSQL 18 alone and generation does not know the server's version.
  Accepted.
- **MC-C. The checkbox shows only where it applies:** beside Comparison, while the comparison is
  "contains" or "starts with". A new filter starts unticked. A stored filter opens ticked unless it
  carries `ignoreCase`. Switching to a comparison without the choice drops it from the tree. A filter
  switched back takes the unticked default. Labelled "Match case", as editors label it.
- **MC-D. Not `equal`, `notEqual` or `in`.** These match keys and codes, where case is meaning.
  `in` would also need every list item folded. Each can be widened later by the same member.
  Approved.
- **MC-E. SQL Server (D5, deferred by ADR-0038) inherits the member.** data.md says its generator
  must honour `ignoreCase`. Nothing is built for it here.
- **MC-F. A source without ICU is refused by name.** When a tree uses `ignoreCase`, the connector
  checks `pg_collation` for `und-x-icu` after connecting. Where it is missing, it answers
  `source_unsupported`, naming the collation, never a bare `connector_error`. Official PostgreSQL
  images and PostgreSQL 16's default build include ICU, so this is rare. Approved.

## Tasks

Each test first, cited in a literal title.

1. **Domain shape** (`builder.ts`, `file-filter.ts`). `DAT-119 accepts ignoreCase on contains and
startsWith over text`; `DAT-119 refuses ignoreCase false, on equal, and over a number`;
   `DAT-119 leaves a stored tree without ignoreCase unchanged` (a D4 fixture parses and generates
   byte for byte as before).
2. **PostgreSQL's text** (`generate.ts`). The generated text for both comparisons, with a parameter,
   a literal and a column as the operand; the parameter still bound once.
3. **The file filter** (`file-filter.ts`). `DAT-119 a file filter matches pfizer in Pfizer Inc, and
école in ÉCOLE`, and the same filter without `ignoreCase` does not.
4. **The connector, on a real source** (`apps/connector/src/builder.test.ts`). `DAT-119 a built
contains finds a name whatever its capitals` (ASCII, `É`, `Σ`); the stored-without case still
   matches case; MC-F's refusal by a source the test drops `und-x-icu` from, if a test source can
   lack it, else a fake.
5. **Contract.** `api-contract generate`, then `api-client generate`; the `exampleFor` output covers
   the member.
6. **The page** (`definitionDraft.ts`, `BuilderFields.tsx`, `FileFields.tsx`). Draft round trip and
   MC-C's rules in `definitionDraft` tests; in `query-definitions.test.tsx`: the checkbox appears for
   "contains" and "starts with" alone, unticked on a new filter, ticked on a stored one, and the saved
   tree carries `ignoreCase` exactly when unticked.
7. **Docs.** data.md: the `Condition` shape, D4-G's paragraph (a folded key beside the code-point
   one), a `## Requirements owned` row for DAT-119, and MC-E's note; `docs/features.md` and
   `README.md`; a fragment, `changes/match-case.md` (`### Added`); `trace generate` after prettier.

## Changed while building

| What                                                                                    | Why                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| MC-F reuses `source_unsupported`, its words widened to name ICU, rather than a new code | A new code widens the failure enum the contract, the client and stored tests carry, for a rare source              |
| The bound value is folded as `lower((($n::text))::text ...)`, its cast written twice    | The generator folds whatever expression it is handed, one helper for the column and the value; PostgreSQL drops it |
| The connector checks `pg_collation` only where the tree ignores case                    | A tree that does not ignore case runs on a source without ICU as it did                                            |
