# Reading the trace

> How to run the traceability tooling, and how to read what it tells you. Two audiences, two reading
> paths, one worked example that goes all the way through.

This repository holds 1,360 product requirements. Every one of them has an identifier, and the point
of `packages/trace` is that the identifier is a handle: you can ask what answers a requirement, what
demonstrates it, and whether the demonstration passed, and get an answer computed from the repository
rather than remembered by somebody.

**If you are working on the code**, read [For a developer](#for-a-developer). You need the commands,
the convention for citing a requirement from a test, and what makes the gate fail.

**If you are assessing this product or its supplier**, read [For an auditor](#for-an-auditor). You need
to know which artifact answers which question, how to reproduce it from a release tag, and - stated
plainly rather than buried - what the evidence does not prove.

**Either way, read [The chain](#the-chain) first**, and then
[the worked example](#a-worked-example-iam-043) last. The worked example is the shortest route to
understanding the whole thing.

## The chain

Four links, each held by a different artifact, each checkable:

```
a requirement          docs/specification/requirements/IAM-...md      the statement, and its identifier
      |
      v
a design claims it     docs/design/service-foundations.md            ## Requirements owned
      |
      v
a test names it        apps/service/src/sign-in.test.ts              the identifier in the test's title
      |
      v
the test passed        .trace-results/service.json                   written by an ordinary `pnpm test`
```

Nothing in that chain is maintained by hand. A design document declares what it owns; a test names
what it verifies; a test run records what passed. `packages/trace` reads all four and computes the
rest, which is why there is no coverage column anybody has to remember to update.

**The fifth link is the one a person writes**: a **baseline** declaring which requirements a given
release is answerable for. That is a commitment, not a computation, and the tool never writes one.

## For a developer

### The identifiers

`CNT-014` is three letters of area and three digits. The rules exist so the identifier stays worth
citing, and [`../specification/requirements/README.md`](../specification/requirements/README.md) is
the full account. The two that catch people out:

- **An identifier is allocated once and never reused**, even when the requirement it named is
  withdrawn. A withdrawn requirement keeps its row. So `pnpm trace next CNT` gives you the highest
  allocated plus one, never the count.
- **`ZZZ` is reserved for fixtures.** Use it in test data. The citation scanner ignores that area
  entirely, which is what stops a test about the tooling from looking like a citation of a real
  requirement.

### Finding the requirements that govern what you are about to build

```bash
pnpm trace search 'footnote'      # every requirement whose statement mentions it
pnpm trace area CNT               # a whole area, with each requirement's state
pnpm trace area --all             # every area at once, in the areas index's order
pnpm trace show CNT-014           # one requirement: statement, design, tests, state
pnpm trace tranche T1             # a tranche by area, with a count per state
pnpm trace tranche T1 CNT         # that tranche's requirements in one area, in full
pnpm trace stats                  # the whole corpus by tranche and state
```

`search` is usually the one you want. Twenty-five requirements mention footnotes, spread across six
areas, and finding them by reading is how you miss one.

### Citing a requirement from a test

**This is the convention the whole chain rests on.** Name the requirement in the test's title:

```ts
it('refuses to start where the environment does not permit Google (IAM-043)', async () => {
```

That is all. The scanner reads `describe` and `it` titles; a citation in a comment does not count,
deliberately, because mentioning a requirement is not claiming to verify it.

There is a second, stronger form. When the product refuses something _because of_ a requirement, it
can say so in the response:

```ts
expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
```

A `rule:` field is unusually good evidence - the product cites the requirement it is enforcing, so an
auditor can see it from outside the system. **But it establishes `Covered`, never `Verified`**, because
a test result is identified by its name and a `rule:` field is not in the name. If you want a
requirement verified, name it in the title.

Two things not to do:

- **Do not name a requirement in a title that does not exercise it.** The gate will believe you.
- **Do not use a real identifier as sample data.** Use `ZZZ-001`. A real one in a fixture reads as a
  citation: the service's error-envelope test named `IAM-018` as its sample refusal rule, and the scan
  read a test about envelope shape as coverage of a permission requirement. It names `ZZZ-001` now.

### The states, and what each one means

| State        | What it means                                  | Computed from           |
| ------------ | ---------------------------------------------- | ----------------------- |
| `Specified`  | The requirement exists. Nothing claims it      | its row                 |
| `Designed`   | A design document claims it                    | `## Requirements owned` |
| `Covered`    | A test names it                                | the citation scan       |
| `Verified`   | Every test naming it passed, in this run       | the JSON reports        |
| `Withdrawn`  | No longer in force. **Not a gap**              | its `Status` column     |
| `Superseded` | Replaced by another requirement. **Not a gap** | its `Status` column     |

`Withdrawn` and `Superseded` are exits from the ladder, not rungs on it. A superseded requirement is
not unfinished work however well tested it is, and the tool will not promote one.

`Verified` needs a test run to have happened. Every package's test config writes a JSON report into
`.trace-results/` as a side effect of `pnpm test` - twelve of them, one per package with tests - so:

```bash
pnpm test && pnpm trace verify
```

`verify` refuses to compute anything from reports that are stale, incomplete, or from a failed run. A
number computed from a broken run is worse than no number.

### Reading `pnpm trace check`

`check` reports every property of the corpus that no single row can establish. It exits non-zero when
there is anything to report, so it is usable as a gate. Nine kinds:

| Kind                 | What happened                                     | Usually fixed by                                |
| -------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `issued-twice`       | One identifier appears twice                      | renumbering the later one                       |
| `wrong-document`     | A requirement sits in another area's document     | moving the row                                  |
| `not-contiguous`     | An area has a hole below its highest number       | restoring a row deleted instead of withdrawn    |
| `supersedes-unknown` | A `Superseded by` points at nothing               | fixing the target                               |
| `claims-unknown`     | A design claims an identifier that does not exist | fixing the claim                                |
| `claims-superseded`  | A design claims a requirement no longer in force  | claiming the replacement instead                |
| `claimed-twice`      | Two designs claim one requirement                 | deciding which owns it                          |
| `cites-unknown`      | A test names an identifier that does not exist    | a renumbering nobody followed through           |
| `cited-undesigned`   | A test names a requirement no design claims       | a design claiming it, or an unintended citation |

`not-contiguous` is the one worth understanding: it is what catches a requirement **deleted** rather
than withdrawn. A hole is the only trace such a deletion leaves.

### What makes the gate fail

```bash
pnpm trace gate
```

It reads the newest baseline and answers one question: is every requirement this release declared
actually met? It fails when

- an included requirement is not met by its declared kind - no test names it, or a test naming it
  failed, or it inherits from something unmet;
- an included requirement is no longer in force;
- the **declaration itself** is malformed - a requirement both included and excluded, a duplicate
  verification row, an attestation with no substance;
- a corpus problem touches the baseline.

It does **not** fail on the corpus's other problems. A stale design claim on a requirement nobody has
declared is not this release's problem, and `check` still reports it.

It **does** fail when the test run it reads has failed, because evidence from a broken run is not
evidence. That is the one way the gate is not narrow, and it is deliberate.

### Adding a requirement

A requirement arrives as a GitHub issue, through the **Requirement** form, and lands as a row by pull
request - so the issue is the record of who asked and why.

```bash
pnpm trace draft 71        # read the filed issue and draft a row
```

`draft` allocates the identifier, prints a row that will parse, and lists the sections of the area
document it might belong in. **It prints; it never inserts.** Where a requirement belongs is a
judgement about meaning - beside the ones it relates to - and a tool that guessed would file a
footnote requirement under tables while the corpus still parsed, so nothing would catch it.

Paste the row into the section it belongs in, and put `Fixes #<issue>` in the pull request body.

If the filer gave no tranche, the row carries `T?`, which **the parser refuses** - so a missing
tranche cannot be forgotten into the corpus.

### After changing a requirement or a design

```bash
pnpm --filter @alloy-works/trace generate
```

`packages/trace/trace.json` is generated from the documents and committed, the same way
`openapi.json` is, and a test fails when the two drift apart. Regenerate it in the same commit as the
change.

## For an auditor

### Which artifact answers which question

| Your question                                                | Where it is answered                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| What does this product claim to do?                          | [`../specification/requirements/`](../specification/requirements/) - 1,360 requirements, 22 areas |
| What is this **release** answerable for?                     | [`../specification/baselines/`](../specification/baselines/) - one document per release           |
| For each of those, what answers it and what demonstrates it? | the release's `matrix.md` in [`../trace/`](../trace/)                                             |
| What is known to be missing?                                 | that release's `gaps.md`, and `pnpm trace check`                                                  |
| Which tests ran, and what did they do?                       | that release's `results.md`                                                                       |
| Did the release meet its own declaration?                    | `README.md` in the pack, and `pnpm trace gate`                                                    |

### The baseline, and why it is small

A baseline is a hand-written declaration of the requirements a release is answerable for. It is not
computed, no command writes one, and
[`../specification/baselines/README.md`](../specification/baselines/README.md) explains why: a
baseline a tool can edit is not a declaration, it is a cache.

**`0.13.0` declares seven requirements and excludes four, each with a stated reason.** Seven out of 1,360 is not an error. This product is scaffolding: it can sign in, isolate a tenant, run a job and
resolve a theme, and those are the things it can demonstrate end to end. A matrix that is complete
across a declared scope of seven is better evidence than one 13% populated across everything.

Each exclusion says why. `IAM-018` is excluded because, at that release, it was named only by a
`rule:` field and claimed by no design, so it could not be traced end to end - not because it was
inconvenient. A baseline is never rewritten afterwards, so it still reads that way: the citation it
refers to was a fixture's sample data and has since been removed, which a later baseline will say.

### Reading an evidence pack

A pack is four documents under `docs/trace/<version>/`, committed at the release:

1. **`README.md`** - the version, the commit, the baseline, and the verdict. Read this first.
2. **`matrix.md`** - one row per requirement the release claims: its statement, the design that
   answers it, the tests that demonstrate it, and the verdict. **Nothing outside the baseline appears
   here.**
3. **`gaps.md`** - every problem in the corpus, every exclusion with its reason, and a count by
   tranche of what the release does not claim.
4. **`results.md`** - every test that named a claimed requirement, and what it did.

`matrix.md`'s Evidence column indexes the citations; `results.md` carries the complete list. Follow a
row from the matrix into `results.md` to see every test behind it.

### Reproducing a pack

A pack records a run, so it is the one artifact here **never** compared against a fresh generation.
Its README names the commit it was generated at, and `pnpm trace pack` refuses to run from a working
tree that is not clean - so that commit contains every input the pack was built from. Check out that
commit, run `pnpm test` and `pnpm trace pack <version>`, and the documents come back identical.

### What the evidence proves, and what it does not

**It proves linkage.** For each requirement the release claims: a design answers it, a named test
exercises it, and that test passed in the recorded run.

**It does not prove correctness.** A test titled for a requirement that asserts nothing would still
read as verified. The matrix proves the chain is joined up, not that the requirement is true of the
code or that the test is a good one. The discipline that makes the linkage meaningful is
[test-driven development](../testing.md), applied by people - and every tool in this space has this
property. The ones implying otherwise are less honest, not more capable.

**`pnpm trace check` reports no problems today**, and the `0.13.0` pack's `gaps.md` records the seven
it found at that release - six designs still claiming a requirement a review had superseded, and one
requirement cited by a fixture's sample data. Both facts matter. A pack is evidence for its own tag
and is never regenerated, so `gaps.md` keeps saying what was true then; `check` says what is true now.
Three of the six superseded claims moved to their replacement, and three were dropped instead, because
the replacement asked for more than the design answers. Each of those three designs says so in prose
beside its table, which is the honest outcome: a gap named is not a gap hidden, and claiming a
requirement a design only partly answers is the one failure this whole apparatus exists to prevent.

### The gate is enforced, not advisory

`pnpm trace gate` runs in CI on every push and pull request, and it is the **only** check in this
repository's pipeline that is not advisory. The others - lint, format, typecheck, build, test - carry
`continue-on-error` while the repository establishes its baseline, which
[`../ci-and-releases.md`](../ci-and-releases.md) explains. A pull request that breaks the traceability
chain fails.

## A worked example: IAM-043

One requirement, end to end.

**1. The requirement**, in `docs/specification/requirements/IAM-identity-tenancy-and-access-control.md`:

> **IAM-043** - A tenant must declare which authentication routes it permits - its own provider,
> Google accounts, or both - and must be able to close a route once it no longer needs it. Tranche
> `T1`.

**2. A design claims it.** `docs/design/service-foundations.md`'s `## Requirements owned` table names
`IAM-043` and says how it is met. Exactly one design may claim a requirement; two is a reported
problem.

**3. Tests name it.** Three of them, and between them they cover both halves of the statement:

```
apps/service/src/google-sign-in.test.ts:139   refuses to start where the environment does not permit Google (IAM-043)
apps/service/src/google-sign-in.test.ts:304   ends the sessions Google issued when the environment closes the route (IAM-043)
apps/service/src/sign-in.test.ts:153          rule: 'IAM-043' in the refusal payload
```

**4. Ask the tool:**

```bash
$ pnpm trace show IAM-043
IAM-043  T1  Covered
A tenant must declare which authentication routes it permits ...
  specified  IAM-identity-tenancy-and-access-control.md:95
  design     service-foundations.md
  tested     apps/service/src/google-sign-in.test.ts:139
  ...
```

`Covered` rather than `Verified` because no test run has been read yet. After `pnpm test`,
`pnpm trace verify` shows it `Verified`.

**5. The release declares it.** `docs/specification/baselines/0.13.0.md` includes `IAM-043`, with one
clause saying what puts it in force - that sign-in refuses an unpermitted route and closing one ends
the sessions it issued.

**6. The gate checks it.** `pnpm trace gate` confirms a test names it and every such test passed.

**7. The pack records it.** `docs/trace/0.13.0/matrix.md` carries the row; `results.md` lists every
test behind it.

That is the whole chain. Seven requirements currently make that journey; the number grows as the
product does, and it is checkable at every step rather than asserted at the end.

## Every command

| Command                         | What it does                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm trace show <ID>`          | One requirement: statement, tranche, state, design, citing tests                     |
| `pnpm trace search <term>`      | Every requirement whose statement mentions the term                                  |
| `pnpm trace area <XXX>`         | Every requirement in an area, with its state                                         |
| `pnpm trace area --all`         | Every area, in the areas index's order, each under a heading with its name and count |
| `pnpm trace next <XXX>`         | The next free identifier in an area                                                  |
| `pnpm trace tranche <Tn> [XXX]` | A tranche by area, or one area of it in full                                         |
| `pnpm trace stats`              | The corpus by tranche and state                                                      |
| `pnpm trace check`              | Every problem in the corpus. Non-zero exit when there is one                         |
| `pnpm trace verify [dir]`       | The same table, with `Verified` computed from a test run                             |
| `pnpm trace baseline [name]`    | A committed baseline: what it includes, excludes and why                             |
| `pnpm trace gate [name]`        | Pass or fail a baseline. Non-zero exit on failure                                    |
| `pnpm trace pack <version>`     | Write the evidence pack. Refuses a dirty working tree                                |
| `pnpm trace draft <issue>`      | Draft a row from a filed issue. Prints only, never writes                            |

## Where the rest lives

- [`../specification/requirements/README.md`](../specification/requirements/README.md) - how a
  requirement is written, and the identifier rules
- [`../specification/baselines/README.md`](../specification/baselines/README.md) - what a baseline is
  and how one is written
- [`../architecture.md`](../architecture.md) - where `packages/trace` sits in the repository
- [`../testing.md`](../testing.md) - the citation convention and the JSON reports, in the context of
  the whole test strategy
- [`../superpowers/specs/2026-09-13-requirements-traceability-design.md`](../superpowers/specs/2026-09-13-requirements-traceability-design.md) -
  the design this was all built from, including what was considered and rejected
