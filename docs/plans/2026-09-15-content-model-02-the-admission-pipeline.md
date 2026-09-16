# Content model 2: the admission pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every piece of content entering a component - a paste, a copy from another component,
and later an import - one way in: a pipeline that sanitises, migrates, normalises, re-identifies and
validates it in that order, and returns what it admitted together with a report of everything it
removed or rewrote.

**Architecture:** A new folder, `packages/domain/src/content/admission/`, pure and platform-free. Each
stage is its own module taking a reader's output as plain JSON and a report collector; `admit` runs them
in the design's order, validates last through `parseContentDocument`, and returns an outcome rather than
throwing. The one reader built here is the product's own clipboard, whose format is the model's and needs
no parser. The one piece of markup inside the model - an equation's MathML - is read by a strict,
hand-written reader inside the sanitise stage, and validation asks the same reader whether an equation's
MathML is already in its form, so content that never passed through admission meets the same rule.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Vitest 5. No new dependency of any kind.

**Spec:** [`../design/content-model.md`](../design/content-model.md), "The admission boundary",
"Identity" and "Where the code lives", with every admission requirement it claims. Read with
[component-editor.md](../design/component-editor.md), "Identity, by operation" and "Invariants the
editor holds" (paste is re-identified before ProseMirror sees it; marks too), and "Equations" (MathML
normalised on entry); [ADR-0005](../decisions/0005-purpose-built-node-and-mark-content-model.md);
[ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md); and the built
`packages/domain/src/content/model/` and `packages/domain/src/stored/`.

Second of the content model plans. [Plan 1](2026-09-13-content-model-01-the-schema.md) built the stored
shape and named four things it left; this is one of them.

## The scope, and why

**In scope: the pipeline's five non-reading stages, the report threaded through them, and the product
clipboard's reader and writer - all in `packages/domain`.** content-model.md is explicit about where
each part lives. "The model stays in `packages/domain`: ... the admission pipeline's five non-reading
stages", and "the pipeline itself stays in the domain package and takes a reader's output as its input,
which is what lets all six stages be tested with no parser in the room". So the stages and the report
are here. The editor's first slice needs them: component-editor.md's identity table has every paste,
"from anywhere", re-identified by the pipeline before ProseMirror sees it, and its review answer 1.1
says foreign paste waiting for the pipeline is build order, "and nothing ships the interim".

**The product clipboard's reader is in scope** because it is the one reader that needs no parser - its
format is the model's own JSON - and it is the source CNT-132 to CNT-135 are about. Without it, internal
copy could not be tested end to end, and the editor would have nothing to paste from itself.

**One change to the model's validation is in scope**: refusing an equation whose MathML the pipeline's
reader would not keep as it stands (decision 17). Without it, the MathML sanitise cleans on a paste could
reach storage uncleaned by any other path, and the rule has to be the reader this plan builds.

**The HTML, Markdown and OOXML readers are out, and belong to a readers plan that creates their
workspace.** content-model.md: "Every format reader and writer moves out ... an HTML reader needs a
parser and a sanitiser, which `packages/domain` exists to exclude. The OOXML reader and writer move to
their own workspace, and a Markdown and an HTML reader join them there rather than in the domain
package." Building the HTML reader here would break the platform-free rule; building its workspace here
would mean choosing a parser dependency and moving the spike's OOXML pair in a plan about something else.
What this plan does for those readers is fix the contract they write to - decision 2 - so they can be
built against a pipeline that already exists.

**Out of scope, each with the plan it belongs to:**

| Not here                                                                                                               | Whose                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The HTML, Markdown and OOXML readers, their workspace, and moving the spike's OOXML pair into it                       | **The readers plan** (content-model.md, "Where the code lives")                                 |
| The editor and ProseMirror: the paste handler, where pasted blocks land, showing the report, the clipboard's MIME type | **The editor session plan** (component-editor.md)                                               |
| Any HTTP route, including an import endpoint                                                                           | **The editor session plan**, with the service; an import route is **IMP**'s                     |
| Storage writes                                                                                                         | **The editor session plan**: an iteration is `fromEditor` then `parseContentDocument`, as today |
| Retiring the spike schema and its gate-case tests                                                                      | **The spike retirement plan** - named in [`README.md`](README.md) as plan 1's first leftover    |
| Resolution (CNT-005, CNT-009)                                                                                          | **The resolution plan**, which needs T3 and T4 capabilities                                     |

**The code below was run before the plan was committed.** Against `main` at 0.20.0 (merge `08fa3d4`),
every block was applied in task order: the domain suite passed (397 tests, 114 of them new), the trace
suite passed with the pin at 122, and `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format` and
`pnpm trace check` were clean. Task 4 was added after that run, and every block was then applied again,
in task order, against the same merge: the domain suite passed with 413 tests, 130 of them new, the trace
suite passed with the pin still at 122, and the same five commands were clean. The database and service
suites were not run: nothing here touches either package, and both need the compose stack. The citation counts each task names were measured from a
regenerated `trace.json`, not estimated. Then the code was removed, so the plan's tasks can be executed
test first. It is still worth watching each test fail: the run proves the code, not the order of an
executor's steps.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail. A test that passes before its implementation exists is testing nothing.
- **Every admission test asserts the report as well as the output (CNT-064).** A test that runs content
  through a stage or through `admit` asserts both what came out and every entry the report holds - the
  whole list, with `toEqual`, never `toContainEqual`. A test that asserts only what came through is the
  spike's silent-drop defect waiting to happen again. The only tests exempt are those that admit
  nothing: the limits measure, the report collector itself, validation's MathML rule, and the clipboard
  writer. The MathML reader's tests assert its findings, which are the report's entries before task 5
  appends them.
- **Name the requirement in the `describe` or `it` title** only when the test demonstrates that
  requirement's own statement, checked with `pnpm trace show <ID>`, and only if content-model.md claims
  it. Not a requirement nearby. The table in
  [Requirements this plan cites, and those it does not](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier. `pnpm trace check` catches a citation no
  design claims; it cannot catch a claimed one the test does not show, so that is the reviewer's check.
- **A cited title is a plain `it('...')` or `describe('...')`.** The trace reads a title written as a
  string literal straight after the call; `it.each([...])('CNT-...')` is never scanned.
- **`packages/domain` stays platform-free.** No React, Electron, `fs`, DOM, `node:crypto`, clock or
  randomness in production code. `URL` and `String.prototype.normalize` are ECMAScript and WHATWG globals
  present in Node and every browser, and the model already uses both. Identifiers come from the caller.
- **Content is data, never instructions.** Nothing from the content is interpolated into a report
  message: messages are fixed strings, and what arrived travels in `detail`, which a caller renders as
  text. A reader's output is untrusted whoever built it - the product clipboard's included, since any
  page can write text claiming its format.
- **No real data anywhere, sanitisation fixtures included.** Invented names only - `Ada`, `Grace`,
  `Leeds`, `York` - `example.test` hosts, and hostile payloads that do nothing beyond `alert(1)`.
- **No em or en dashes in user-facing text.** Report messages are shown to authors: plain hyphens only,
  and `report.test.ts` fails on either dash. Code comments are exempt.
- **Write non-ASCII characters in code as `\u{...}` escapes**, never as literal characters and never
  as four-digit `\uXXXX` escapes, so a combining mark in a fixture is visible in review and survives
  tooling that decodes the short form.
- **A passing run has no errors or warnings.** Nothing here logs.
- **Every walk over content is safe against what arrived.** A recursive stage runs only after
  `exceedsLimits` has bounded nesting; the MathML reader bounds its own. An object is built from entries,
  never by `out[key] = value`, so a member named `__proto__` stays a member for validation to refuse.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump, one changelog entry**, in the last task. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show CNT-0NN` for any requirement named.
- **`trace.json` is committed and the citation count is pinned.** Every task that adds a cited title runs
  `pnpm --filter @alloy-works/trace generate` and moves the pin in `packages/trace/src/trace.test.ts` in
  the same commit. The numbers were measured against 112 citations on `main` at 0.20.0; if `main` has
  moved, set the pin to what the regenerated file holds and say so in the commit.

---

## Decisions taken before this plan was written

content-model.md settles the stages, their order and the report. It leaves the shapes to the plan, and a
reviewer should be able to reject each of these on its own, so they are stated rather than buried in code.

**1. The product clipboard is the only reader here.** See [the scope](#the-scope-and-why). The readers
plan builds the others against decision 2's contract.

**2. A reader hands over untrusted JSON and a list of what it could not represent; it never removes
what the pipeline removes.** `AdmissionInput` is `{ candidate, report }`. `candidate` is shaped like a
content document - `schemaVersion`, `content`, and optionally the source's own `language` and
`direction` - and walked as plain JSON until validation, because what sanitise and normalise remove has
no place in the model's types. A reader uses exactly this vocabulary for what the pipeline removes:

| A reader writes                                                            | For                                           | Removed by  |
| -------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| `{ type: 'script', name }` wherever a node can stand                       | A script, a macro                             | Sanitise    |
| `{ type: 'embeddedObject', name }` wherever a node can stand               | An iframe, an object, an embed, an OLE object | Sanitise    |
| `handlers: string[]` on any node or mark                                   | Event handler attributes, by name             | Sanitise    |
| A `hyperlink` mark with the target that arrived                            | Every link, allowlisted or not                | Sanitise    |
| An equation's `mathml` as it arrived                                       | Every equation                                | Sanitise    |
| `presentation: { typeface?, size?, colour?, [other]: string }` on any node | Formatting, by the name the source gave it    | Normalise   |
| A block, footnote or mark with no `id`                                     | Anything from a source with no identity       | Re-identify |
| `readerEntry(detail)` in `report`                                          | Anything the reader could not represent       | -           |

**Sanitising happens once, in the pipeline, on one set of terms** - IMP-047's "on the same terms as a
paste" is only true if there is one implementation. Anything else the model does not define is not
removed: validation refuses it, and with it the whole admission, so a reader that invents a construct
fails closed rather than smuggling one through.

**3. There is no member naming the source.** CNT-135 requires a copy and a foreign paste reported to one
standard, and content-model.md meets it with one implementation. A pipeline that knew which it had would
be tempted to be two. Where a caller wants to say "pasted from Word", it knows which reader it called.

**4. The report is a list of entries with fixed messages.** Each entry is `{ stage, action, subject,
message, detail?, count? }`: `action` is `discarded`, `rewritten` or `refused`; `subject` names what, from
a closed table; `message` is chosen by action and subject and never built from content; `detail` is what
arrived - a link's target, a handler's name - as data. **What earns one entry per occurrence and what is
counted:** anything security-relevant or navigable is one entry each - scripts, embedded objects, event
handlers, links (CNT-131 requires each link individually), MathML removals; a dropped annotation is one
entry per annotation, not per fragment (CNT-133); formatting, Unicode rewrites, empty runs, empty
paragraphs and new identifiers are one entry each with a `count`, because a report listing four hundred
new identifiers one by one is a report nobody reads. The reader's own entries come first; a refusing
stage appends its own `refused` entry, so the last entry says why.

**5. An outcome, not an exception, and blocks rather than a document.** `admit` returns
`{ ok: true, content, report }` or `{ ok: false, refusal, failure, report }`, with `refusal` one of
`oversized`, `unreadable`, `schemaVersion`, `identifiers`, `invalid`, `empty`. The report comes back
either way. `content` is the admitted `BlockNode[]`: where a paste lands - splitting a paragraph, fitting
a slice's open ends - is the editor's. **Content with nothing left in it is refused as `empty`** rather
than admitted as nothing, so the author is told.

**6. Limits are provisional and checked first.** `admissionLimits` is 8,000,000 characters, nesting 128
deep, 250,000 values, and 64-deep MathML. A list six levels deep, CNT-118's floor, is about 26 levels of
JSON. `exceedsLimits` walks iteratively and runs before sanitise, so no recursive stage ever meets a
stack somebody else sized. CMD-Q03 - when the pipeline needs streaming - stays open for IMP's first real
import; these numbers are sized for a component, not a book.

**7. MathML is sanitised inside `packages/domain`, by a strict reader written for it.** content-model.md
says the non-reading stages need no parser, and component-editor.md says the MathML is normalised on
entry by the normalise stage. Neither considers that an equation's `mathml` is the one string in the
model rendered as markup: the editor inserts it as native MathML, so a script, an `onclick` or an `href`
inside it would reach the page from content every other stage had cleaned. **The ruling:** the sanitise
stage reads MathML with a strict hand-written reader - elements, quoted attributes, text, the five XML
entities and numeric references, and nothing else - keeps an allowlist of MathML Core elements and
attributes, and writes it back in one form. It is not a DOM, it adds no dependency, and it is not lenient:
a comment, CDATA, a declaration, a named entity, an unquoted attribute or an element left open makes the
equation unreadable, and **an unreadable equation is removed and reported rather than the whole admission
refused**, because one bad equation in a long paste should not cost the author the rest. Colour and size
attributes (`mathcolor`, `mathsize`, `mathbackground`) are not on the allowlist, which is CNT-065 for
equations. **The one form is written by sanitise rather than normalise**, because parsing twice is two
readers that can disagree: the namespace declared once on the root, attributes in order, no whitespace
between elements, text in NFC. **Every combining mark is written as a character reference**, because
normalise then applies NFC to every string - and `>` followed by U+0338 composes to U+226F, eating a
tag's `>` and turning the text after it into attributes. Task 3 has the test.

**8. A link is dropped or kept as it arrived, and rewritten only when the URL parser reads it
differently from what it says.** A target that does not parse, or parses to a scheme outside
`allowedLinkSchemes`, loses its mark - the text is kept - and is reported with the target it had. A
target that parses to an allowed scheme is kept byte for byte, so `https://example.test` is not reported
as rewritten to `https://example.test/`. The exception is a target holding a control character, a space,
a tab or a line break, which the parser strips: it is rewritten to the parser's serialisation and
reported, so what is stored is what a browser would follow. That is CNT-131's "rewritten" case.

**9. Formatting that could run code is reported as a script, by sanitise; all formatting is dropped by
normalise.** A `presentation` value holding `expression(`, `javascript:`, `url(`, `-moz-binding`,
`behavior:` or `@import` - after CSS comments and escapes are decoded - is removed by sanitise and
reported as `executableStyle`. Security does not depend on that match: normalise drops every
`presentation` whatever it says, and the model has no member it could survive into. The match exists so
the report says what arrived - "sanitise before normalise, so a hostile target cannot survive
normalisation" made observable.

**10. Migrate uses content's own chain, and sanitise reads shapes as they arrived.**
`contentMigrationChain` - today's private `chain` in `model/migrate.ts`, exported but not promoted - is
the chain stored content is read through. The stage takes the chain as a parameter only so a test can
stand in a second schema version before one exists. Because sanitise runs before migrate, it reads a
link and an equation in whatever schema version arrived: **when schema version 2 changes either shape,
sanitise must learn version 1's and version 2's**, and that plan's fixture will catch it.

**11. Normalise keeps the language content came from, and reports the direction it cannot keep.** Where
the candidate's `language` differs from the receiving component's and is a valid tag, every text node
without a language mark gets one carrying the source's tag, and one entry says so. Losing it would put
French text in an English component with nothing to say it is French - CNT-140 in reverse. **A direction
that differs is reported and not kept: the built model has no member for a run's direction**, although
content-model.md says "a run whose direction differs carries its own". That is a gap in the model, not in
this plan - see [what this plan leaves](#what-this-plan-deliberately-leaves-undone). Empty runs of text
are dropped before paragraphs are judged empty, because ProseMirror cannot hold an empty text node and a
paragraph holding only one is empty to a reader. Adjacent empty paragraphs are collapsed in every block
sequence - root, list items, quotations, cells, footnotes.

**12. Re-identify owns identity on entry, with the caller's allocator.**

- `Receiver` is `{ document, conditionAxes, newIdentifier }`. **The allocator is the caller's**:
  component-editor.md's identity plugin allocates 128 random bits, and a platform-free package has no
  randomness to own. An identifier that is empty or already used anywhere in the receiving component -
  block, footnote or mark - is drawn again, up to eight times, then the admission is refused as
  `identifiers`.
- **Every block and every footnote** gets a new identifier. A copied identifier is never kept, even where
  the receiving component lacks it.
- **Every mark** gets a new identifier, and marks with the same type and the same identifier get the same
  new one, so a fragmented annotation stays one (CNT-004). Type is part of the key, so two different
  marks that arrive sharing an identifier are not merged.
- **Comments and suggestions are always dropped**, even pasted back into the component they came from:
  CNT-133 says a copy into another component, and nothing in T1 creates either, so the narrower rule
  would be untestable code. **The text they covered stays as it stood** - a suggested deletion's text is
  kept, a suggested insertion's text is kept - and the entry says so. COL in T3 decides whether a paste
  within one component keeps its thread.
- **A condition is dropped unless the receiving space has its axis.** `conditionAxes` is `[]` from every
  caller until REU designs axes, so every condition is dropped and reported - content-model.md's
  recommendation for CNT-Q14, which REU still owns.
- **Cross-references keep their targets as they arrived.** What a target names is STR's to design, and
  re-pointing one at a re-identified block would presume the answer.

**13. Validation builds the document from the receiving component.** The admitted blocks are validated
by `parseContentDocument` under the receiving component's `title`, `language` and `direction`, so the
rules that are properties of a document - unique identifiers, no adjacent empty paragraphs, a footnote's
restricted content - hold over what is admitted. **Adjacency across the seam** - a pasted empty paragraph
landing beside one already in the component - is the editor's `appendTransaction`, which component-editor.md
already specifies.

**14. The product clipboard is JSON with a format marker.** `writeProductClipboard(source, blocks)`
writes `{ format: 'alloy-works/content', schemaVersion, language, direction, content }`;
`readProductClipboard(text)` refuses text longer than the character limit before parsing it, refuses
anything that is not an object carrying that marker as `unreadable`, and otherwise returns the rest as a
candidate. It adds no entries of its own on success. **Which clipboard type it travels under** - a
`DataTransfer` type, a `web ` custom format - is the editor's.

**15. Five runtime exports join the package's public surface.** `admit`, `admissionLimits`,
`readProductClipboard`, `writeProductClipboard` and `readerEntry`, with their types. The stages,
`sanitiseMathml` and `contentMigrationChain` stay unexported until something outside the package needs
them: the editor will need `sanitiseMathml` for equations typed as LaTeX, because decision 17 refuses to
store an equation in any other form, and exporting it then is a decision in that plan, pinned by
`index.test.ts`.

**16. Two claimed requirements are built in part and deliberately not cited.** CNT-130 says "pasted
HTML must be sanitised", and no HTML is read here: every test hands the pipeline a reader's output. The
sanitise stage answers the whole of the rest of its statement, and the HTML reader's plan cites it from
real HTML through reader and pipeline together. CNT-063 says the report is "shown to the author at the
time", which the editor does. Citing either here would be citing the half this package can show.

**17. Validation refuses an equation the MathML reader would not keep exactly as it stands, by asking the
reader.** Decision 7 cleans MathML on the way in, and only on the way in. `parseContentDocument` accepted
any non-empty `mathml`, so content reaching validation by another path - an iteration the service parses,
a version read back from storage - could carry an equation sanitise would have cleaned, although CNT-010
validates on every creation, change and read-back. **The ruling:** `equationContentSchema.mathml` is
refined by `isKeptMathml`, which runs `sanitiseMathml` and passes only a readable result with no findings
whose output is the input, byte for byte. Anything the reader would drop, rewrite or refuse fails. It is the
reader itself rather than a description of its output kept in step by hand, because a second implementation
is two readers that can disagree - what decision 7 refused. The failure is a zod issue with a fixed message,
as the model's other value rules are (`not a BCP 47 tag`), so `readContent` quarantines it (CNT-013) and
`admit` refuses it as `invalid`. It cannot refuse what the pipeline admits: sanitise writes the one form,
normalise's NFC leaves that form as it is (decision 7), and tasks 9 and 10 run with the rule in place. Three
consequences, each deliberate:

- **The model imports `admission/mathml.ts`.** The reader stays where decision 7 put it; it imports nothing
  but `limits.ts`, so no module cycle forms.
- **Schema version 1's validation tightens without a new schema version.** That is safe only because no
  content is stored anywhere yet. Task 4 puts the model's own fixtures, `every-node.json` included, in the
  one form. Once iterations are stored, a rule like this needs a migration rather than a fixture edit.
- **Anything that writes an equation must write it in the reader's form**, the editor's LaTeX converter
  included, or its save is refused.

---

## Files

| File                                                                                                  | Responsibility                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/content/admission/report.ts`                                                     | `admissionStages`, `reportMessages`, `ReportEntry`, `createReport`, `readerEntry`                       |
| `packages/domain/src/content/admission/limits.ts`                                                     | `admissionLimits`, `exceedsLimits`                                                                      |
| `packages/domain/src/content/admission/mathml.ts`                                                     | `MATHML_NAMESPACE`, `sanitiseMathml`: the strict reader, the allowlist and the one form; `isKeptMathml` |
| `packages/domain/src/content/model/inline.ts`                                                         | Modified: an equation's MathML refused unless `isKeptMathml` holds                                      |
| `packages/domain/src/content/model/document.test.ts`, `inline.test.ts`, `fixtures/v1/every-node.json` | Modified: their equations written in the one form, and the rule's tests                                 |
| `packages/domain/src/content/admission/sanitise.ts`                                                   | `sanitise`                                                                                              |
| `packages/domain/src/content/admission/migrate.ts`                                                    | `StageResult`, `migrateCandidate`                                                                       |
| `packages/domain/src/content/model/migrate.ts`                                                        | Modified: `chain` exported as `contentMigrationChain`                                                   |
| `packages/domain/src/content/admission/normalise.ts`                                                  | `normalise`                                                                                             |
| `packages/domain/src/content/admission/reidentify.ts`                                                 | `Receiver`, `reidentify`                                                                                |
| `packages/domain/src/content/admission/admit.ts`                                                      | `AdmissionInput`, `AdmissionOutcome`, `AdmissionRefused`, `AdmissionRefusal`, `admit`                   |
| `packages/domain/src/content/admission/clipboard.ts`                                                  | `PRODUCT_CLIPBOARD_FORMAT`, `writeProductClipboard`, `readProductClipboard`, `ReaderResult`             |
| `packages/domain/src/content/admission/index.ts`                                                      | The folder's barrel                                                                                     |
| `packages/domain/src/index.ts`, `index.test.ts`                                                       | Modified: the five exports, promoted and pinned                                                         |
| `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`                                       | Modified: the pin and the regenerated corpus                                                            |

Each module has a `.test.ts` beside it except `index.ts`. Test helpers - `text`, `paragraph`, a counter
allocator - are repeated per test file, as the model's tests do, rather than shared through a module that
would compile into `dist/`.

## How the design's commitments become tests

| content-model.md and component-editor.md say                                                    | Where                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| One pipeline, not one per source; copy and paste reported to one standard (CNT-135)             | Task 10: a copy and a foreign paste of one content, equal outcomes  |
| Sanitise: scripts, event handlers, embedded objects, disallowed link targets, never stored      | Tasks 3 and 5 per construct; task 9 end to end                      |
| Each dropped or rewritten link its own entry, naming the target it had (CNT-131)                | Task 5; task 9                                                      |
| Migrate: brought to current or refused with a named error (CNT-134)                             | Task 6 with a stand-in second version; task 9 refused               |
| Normalise: NFC; typeface, size and colour dropped; adjacent empty paragraphs collapsed          | Task 7; task 9 (CNT-056, CNT-065)                                   |
| MathML normalised on entry, so identical input stores identical bytes                           | Task 3                                                              |
| Content validated on creation, change and read-back (CNT-010), so no path stores unkept MathML  | Task 4                                                              |
| Re-identify: a new identifier for every block and every mark (CNT-132)                          | Task 8; task 10 pasted back into its own component                  |
| Annotations whose owner does not travel dropped, one entry each (CNT-133)                       | Task 8; task 10                                                     |
| Validate: the whole admission refused rather than partly stored                                 | Task 9                                                              |
| The order is load-bearing: sanitise before normalise, migrate before re-identify, validate last | Task 9, each as an observable property                              |
| The report threaded through all stages and returned, not logged                                 | Task 1; every test after it                                         |
| Every admission test asserts the report as well as the output (CNT-064)                         | Every task; task 9's test asserting it over every construct at once |

## Requirements this plan cites, and those it does not

content-model.md claims CNT-060 to CNT-065, CNT-127, CNT-130 to CNT-135 and CNT-056 for admission.
**This plan cites nine**, each only in a test that shows its own statement:

| ID      | Statement, in short                                                                                   | Cited in                           | Tasks |
| ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ----- |
| CNT-134 | Earlier schema versions migrated before entry, or refused with a named error; never stored unmigrated | `migrate.test.ts`, `admit.test.ts` | 5, 8  |
| CNT-056 | Text normalised to one Unicode form on ingest                                                         | `admit.test.ts`                    | 8     |
| CNT-064 | Nothing discarded may be absent from the report; tests assert what was dropped and what survived      | `admit.test.ts`                    | 8     |
| CNT-065 | Pasted content never carries typeface, size or colour into the model                                  | `admit.test.ts`                    | 8     |
| CNT-127 | A target whose scheme is not allowlisted is refused on entry and never stored                         | `admit.test.ts`                    | 8     |
| CNT-131 | A link dropped or rewritten on paste is named individually, with the target it had                    | `admit.test.ts`                    | 8     |
| CNT-132 | Copied content re-identified on paste: every block a new identifier, unique in the receiver           | `clipboard.test.ts`                | 9     |
| CNT-133 | A comment anchor or suggestion pasted into another component is dropped and named                     | `clipboard.test.ts`                | 9     |
| CNT-135 | A copy within the product reported to the same standard as a foreign paste                            | `clipboard.test.ts`                | 9     |

That is ten citations in three files, taking the pin from 112 to 122: 113 after task 6, 119 after task 9,
122 after task 10. CNT-056 and CNT-127 are already `Covered` by the model's tests; the other seven move from
`Designed` to `Covered`.

**Claimed, built in part here, and not cited** - each waits for the plan named:

| ID                        | What is built                                                                                                               | What is missing, and whose                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-130                   | The sanitise stage, for all four constructs, over a reader's output                                                         | Its statement is about pasted HTML, and nothing here reads HTML (decision 16). **The readers plan**                                                                                                      |
| CNT-063                   | A report naming what was normalised and discarded, returned with the content                                                | "Shown to the author at the time". **The editor session plan**                                                                                                                                           |
| CNT-060, CNT-061, CNT-062 | The pipeline those readers feed, and the contract they write to                                                             | The Word, Markdown and HTML readers. **The readers plan**                                                                                                                                                |
| CNT-010                   | Admitted content is validated through the one entry point, and validation refuses MathML the reader would not keep (task 4) | Its statement is when validation runs - creation, change and read-back - and `index.test.ts` already cites it for the one entry point. Task 4's tests show one thing validation checks, not when it runs |
| CNT-023                   | Normalise collapses adjacent empty paragraphs                                                                               | Its statement is that spacing blocks are not representable, which `document.test.ts` already cites                                                                                                       |

**Nearby, and not cited even where a test comes close:** CNT-004 (task 8 keeps a fragmented annotation
under one new identifier, but the statement is the model's, and `marks.test.ts` cites it); CNT-140 (task 7
keeps the source's language as a mark, but the statement is what the model can carry); CNT-043 (task 3
writes one form of MathML and task 4 refuses to store any other, but the statement is one representation
whatever the entry route, which is LaTeX against MathML, and `inline.test.ts` cites it); CNT-013 (task 4
quarantines stored content holding an equation the reader would not keep, but that is one more reason for a
quarantine `migrate.test.ts` already cites); CNT-044 and CNT-048, the editor's. **IMP-047** is what this
pipeline will answer for imports, and no design claims it, so `pnpm trace check` would refuse a citation.

---

## Task 1: The report

**Files:**

- Create: `packages/domain/src/content/admission/report.ts`
- Test: `packages/domain/src/content/admission/report.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `admissionStages: readonly ['read', 'sanitise', 'migrate', 'normalise', 'reidentify', 'validate']`, and `type AdmissionStage`
  - `reportMessages: { discarded: {...}; rewritten: {...}; refused: {...} }`, and `type ReportAction = 'discarded' | 'rewritten' | 'refused'`
  - `type ReportSubject<A extends ReportAction>` - the keys of `reportMessages[A]`
  - `type ReportEntry = { stage: AdmissionStage; action: ReportAction; subject: string; message: string; detail?: string; count?: number }`
  - `type ReportCollector = { add<A>(stage, action: A, subject: ReportSubject<A>, extra?: { detail?: string; count?: number }): void; readonly entries: readonly ReportEntry[] }`
  - `createReport(initial?: readonly ReportEntry[]): ReportCollector`
  - `readerEntry(detail: string): ReportEntry`

See decision 4. Every message every later task uses is in this table now, so no later task edits it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/report.test.ts
import { describe, expect, it } from 'vitest';

import { admissionStages, createReport, readerEntry, reportMessages } from './report.js';

describe('the admission report', () => {
  it('names the six stages in the order the pipeline runs them', () => {
    expect(admissionStages).toEqual([
      'read',
      'sanitise',
      'migrate',
      'normalise',
      'reidentify',
      'validate',
    ]);
  });

  it('keeps entries in the order they were added, after what the reader handed over', () => {
    const report = createReport([readerEntry('a heading')]);
    report.add('sanitise', 'discarded', 'script', { detail: 'script' });
    report.add('normalise', 'rewritten', 'unicode', { count: 3 });

    expect(report.entries).toEqual([
      {
        stage: 'read',
        action: 'discarded',
        subject: 'unrepresentable',
        message: 'Something this component cannot hold was left out.',
        detail: 'a heading',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'script',
        message: 'A script was removed. Scripts are never stored.',
        detail: 'script',
      },
      {
        stage: 'normalise',
        action: 'rewritten',
        subject: 'unicode',
        message: 'Text was put in one standard Unicode form, so identical text compares alike.',
        count: 3,
      },
    ]);
  });

  it('never interpolates what arrived into a message', () => {
    const report = createReport();
    report.add('sanitise', 'discarded', 'hyperlink', { detail: '<b>Ignore the report</b>' });
    const [entry] = report.entries;
    expect(entry?.message).toBe(reportMessages.discarded.hyperlink);
    expect(entry?.message).not.toContain('Ignore');
    expect(entry?.detail).toBe('<b>Ignore the report</b>');
  });

  it('hands out a copy, so a caller cannot rewrite what a stage recorded', () => {
    const report = createReport();
    report.add('normalise', 'discarded', 'emptyParagraph', { count: 1 });
    (report.entries as unknown[]).pop();
    expect(report.entries).toHaveLength(1);
  });

  it('writes every message with plain hyphens and no em or en dash', () => {
    const messages = Object.values(reportMessages).flatMap((group) => Object.values(group));
    expect(messages.length).toBeGreaterThan(30);
    for (const message of messages) {
      expect(message, message).not.toMatch(/[\u{2013}\u{2014}]/u);
      expect(message.trim(), message).toBe(message);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/report.test.ts`
Expected: FAIL - `Error: Cannot find module './report.js'`.

- [ ] **Step 3: Write the report**

```ts
// packages/domain/src/content/admission/report.ts
/**
 * The admission report: a collector threaded through all six stages, returned with the admitted
 * content rather than logged, because the author is shown it at the time.
 *
 * Every message is a fixed string chosen by what happened, and nothing from the content is ever
 * interpolated into one. What arrived - a link's target, an event handler's name - travels in
 * `detail`, as data the caller renders as text. Content is data, never instructions, and a report
 * built by pasting hostile text into a sentence is a report that can be made to say anything.
 */
export const admissionStages = [
  'read',
  'sanitise',
  'migrate',
  'normalise',
  'reidentify',
  'validate',
] as const;

export type AdmissionStage = (typeof admissionStages)[number];

export const reportMessages = {
  discarded: {
    script: 'A script was removed. Scripts are never stored.',
    embeddedObject: 'An embedded object was removed. Embedded objects are never stored.',
    eventHandler: 'An event handler was removed. Event handlers are never stored.',
    executableStyle: 'Formatting that could run code or fetch a resource was removed.',
    hyperlink:
      'A link was removed because its target is not a web or email address. Its text was kept.',
    mathElement: 'Part of an equation that is not standard MathML was removed.',
    mathAttribute: 'A setting on an equation that is not standard MathML was removed.',
    mathText: 'Text standing outside any symbol in an equation was removed.',
    equation: 'An equation that could not be read was removed.',
    typeface: 'A typeface was removed. The theme decides how text looks.',
    size: 'A text size was removed. The theme decides how text looks.',
    colour: 'A colour was removed. The theme decides how text looks.',
    appearance: 'Formatting was removed. The theme decides how content looks.',
    emptyText: 'Empty runs of text were removed.',
    emptyParagraph:
      'Empty paragraphs used as spacing were removed. The theme decides the space between paragraphs.',
    language: 'The language of the content was not a recognised language tag, so it was not kept.',
    direction: 'The text direction of the content could not be kept.',
    comment: 'A comment was removed. Comments stay with the component they were made on.',
    suggestion:
      'A suggested change was removed and its text kept as it stood. Suggestions stay with the component they were made on.',
    condition: 'A condition was removed, because this space has no condition of that kind.',
    unrepresentable: 'Something this component cannot hold was left out.',
  },
  rewritten: {
    hyperlink: 'A link target was rewritten in the form every browser reads the same way.',
    equation: 'Equations were rewritten in one standard form.',
    unicode: 'Text was put in one standard Unicode form, so identical text compares alike.',
    language: 'The text was marked with the language of the component it came from.',
    schemaVersion: 'The content was brought up to date from an earlier version of the format.',
    blockIdentifier:
      'Blocks and footnotes were given new identifiers, so they cannot be mistaken for the ones they were copied from.',
    markIdentifier: 'Marks were given new identifiers.',
  },
  refused: {
    oversized: 'Nothing was added, because the content is larger than one addition can hold.',
    unreadable: 'Nothing was added, because the content could not be read.',
    schemaVersion:
      'Nothing was added, because the content was written in a version of the format this build cannot read.',
    identifiers: 'Nothing was added, because new identifiers could not be allocated.',
    invalid: 'Nothing was added, because what arrived is not content this component can hold.',
    empty: 'Nothing was added, because nothing in it could be kept.',
  },
} as const;

export type ReportAction = keyof typeof reportMessages;
export type ReportSubject<A extends ReportAction = ReportAction> = A extends ReportAction
  ? keyof (typeof reportMessages)[A]
  : never;

export type ReportEntry = {
  readonly stage: AdmissionStage;
  readonly action: ReportAction;
  readonly subject: string;
  readonly message: string;
  /** What arrived, as data: a link's target, a handler's name. Rendered as text, never as markup. */
  readonly detail?: string;
  /** How many, where one entry stands for several of a kind. */
  readonly count?: number;
};

export type ReportCollector = {
  add<A extends ReportAction>(
    stage: AdmissionStage,
    action: A,
    subject: ReportSubject<A>,
    extra?: { detail?: string; count?: number },
  ): void;
  readonly entries: readonly ReportEntry[];
};

export function createReport(initial: readonly ReportEntry[] = []): ReportCollector {
  const entries: ReportEntry[] = [...initial];
  return {
    add(stage, action, subject, extra = {}) {
      const messages: Record<string, string> = reportMessages[action];
      const message = messages[subject as string];
      if (message === undefined) throw new Error(`No report message for ${action} ${subject}`);
      entries.push({
        stage,
        action,
        subject: subject as string,
        message,
        ...(extra.detail === undefined ? {} : { detail: extra.detail }),
        ...(extra.count === undefined ? {} : { count: extra.count }),
      });
    },
    get entries() {
      return [...entries];
    },
  };
}

/**
 * How a reader says it could not represent something. A reader appends rather than shrugging: the
 * spike's Word importer dropped three empty paragraphs without counting them, and every assertion in
 * its test was about what came through.
 */
export function readerEntry(detail: string): ReportEntry {
  return {
    stage: 'read',
    action: 'discarded',
    subject: 'unrepresentable',
    message: reportMessages.discarded.unrepresentable,
    detail,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/report.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
```

Expected: no output beyond each command's header.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/content/admission/report.ts packages/domain/src/content/admission/report.test.ts
git commit -m "Add the admission report every stage appends to"
```

---

## Task 2: The limits one admission is held to

**Files:**

- Create: `packages/domain/src/content/admission/limits.ts`
- Test: `packages/domain/src/content/admission/limits.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `admissionLimits: { characters: 8_000_000; depth: 128; values: 250_000; mathDepth: 64 }`
  - `exceedsLimits(value: unknown): string | undefined` - the first limit exceeded, as a sentence, or `undefined`

See decision 6. These tests hold no content to admit, so they assert no report: `admit` reports a refusal
in task 9.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/limits.test.ts
import { describe, expect, it } from 'vitest';

import { admissionLimits, exceedsLimits } from './limits.js';

const nested = (depth: number): unknown => {
  let value: unknown = { type: 'paragraph', content: [] };
  for (let level = 0; level < depth; level += 1) {
    value = { type: 'blockquote', content: [value] };
  }
  return value;
};

describe('the limits one admission is held to', () => {
  it('admits a component-sized document', () => {
    const paragraphs = Array.from({ length: 2_000 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', value: `Sentence ${index} about Leeds.`, marks: [] }],
    }));
    expect(exceedsLimits({ schemaVersion: 1, content: paragraphs })).toBeUndefined();
  });

  it('admits a list nested six levels deep, the floor the model promises', () => {
    let list: unknown = { type: 'paragraph', content: [] };
    for (let level = 0; level < 6; level += 1) {
      list = { type: 'list', kind: 'ordered', items: [{ content: [list] }] };
    }
    expect(exceedsLimits({ schemaVersion: 1, content: [list] })).toBeUndefined();
  });

  it('refuses nesting deeper than the limit without exhausting the stack', () => {
    expect(exceedsLimits(nested(100_000))).toMatch(/nested more than 128 deep/);
  });

  it('refuses more values than the limit', () => {
    const many = Array.from({ length: admissionLimits.values }, () => 0);
    expect(exceedsLimits(many)).toMatch(/more than 250000 values/);
  });

  it('refuses more characters than the limit, counted across every string', () => {
    const half = 'a'.repeat(admissionLimits.characters / 2);
    expect(exceedsLimits([half, half])).toBeUndefined();
    expect(exceedsLimits([half, half, 'a'])).toMatch(/more than 8000000 characters/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/limits.test.ts`
Expected: FAIL - `Error: Cannot find module './limits.js'`.

- [ ] **Step 3: Write the measure**

```ts
// packages/domain/src/content/admission/limits.ts
/**
 * How much one admission may hold, checked before any stage walks the content.
 *
 * Every stage after this one recurses, and a recursion over content somebody else wrote is a stack
 * somebody else sizes. So the measure is iterative, it runs first, and what it refuses no stage ever
 * sees. The numbers are provisional: content-model.md's CMD-Q03 asks when the pipeline needs
 * streaming and leaves it to the first real import, and these are sized for a component, not a book.
 */
export const admissionLimits = {
  /** Every string's length added together, and the longest clipboard text a reader will parse. */
  characters: 8_000_000,
  /** Nesting of arrays and objects. A list six levels deep (CNT-118) is about 26; this is far above it. */
  depth: 128,
  /** Every value: objects, arrays, strings, numbers, booleans and nulls. */
  values: 250_000,
  /** Element nesting inside one equation's MathML. */
  mathDepth: 64,
} as const;

/** The first limit the value exceeds, as a sentence for the developer, or undefined when within. */
export function exceedsLimits(value: unknown): string | undefined {
  let characters = 0;
  let values = 0;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const next = stack.pop()!;
    values += 1;
    if (values > admissionLimits.values) {
      return `more than ${admissionLimits.values} values`;
    }
    if (typeof next.value === 'string') {
      characters += next.value.length;
      if (characters > admissionLimits.characters) {
        return `more than ${admissionLimits.characters} characters`;
      }
      continue;
    }
    if (typeof next.value !== 'object' || next.value === null) continue;
    if (next.depth > admissionLimits.depth) {
      return `nested more than ${admissionLimits.depth} deep`;
    }
    const members = Array.isArray(next.value) ? next.value : Object.values(next.value);
    for (const member of members) stack.push({ value: member, depth: next.depth + 1 });
  }
  return undefined;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/limits.test.ts`
Expected: PASS, 5 tests. The 100,000-deep test takes tens of milliseconds and must not throw
`RangeError: Maximum call stack size exceeded` - if it does, the walk has become recursive.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/limits.ts packages/domain/src/content/admission/limits.test.ts
git commit -m "Bound what one admission may hold before any stage walks it"
```

---

## Task 3: An equation's MathML, read strictly and written in one form

**Files:**

- Create: `packages/domain/src/content/admission/mathml.ts`
- Test: `packages/domain/src/content/admission/mathml.test.ts`

**Interfaces:**

- Consumes: `admissionLimits.mathDepth` (task 2).
- Produces:
  - `MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'`
  - `type MathmlFinding = { subject: 'script' | 'eventHandler' | 'hyperlink' | 'mathElement' | 'mathAttribute' | 'mathText'; detail: string }` - every subject is a `discarded` key in `reportMessages`
  - `type MathmlResult = { ok: true; mathml: string; findings: readonly MathmlFinding[] } | { ok: false; failure: string }`
  - `sanitiseMathml(source: string): MathmlResult`

See decision 7. The findings are what task 5 turns into report entries, so these tests assert the
findings as well as the output - the report's precursor, on the same terms.

**The adversarial fixtures are the point of this task**, and a reviewer should check each is present:
a `script` element; `on*` attributes in two cases; `href` and `xlink:href`, one of them `javascript:`;
colour, size, `style`, `class` and `id`; an `annotation-xml` carrying HTML with an `onerror`; an element
outside MathML Core; an element inside a token; stray text; a combining mark placed to fuse with a `>`
under NFC; twenty kinds of malformed input; and nesting 100,000 deep.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/mathml.test.ts
import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE, sanitiseMathml } from './mathml.js';

const math = (inner: string, attributes = '') =>
  `<math xmlns="${MATHML_NAMESPACE}"${attributes}>${inner}</math>`;

const readable = (source: string) => {
  const result = sanitiseMathml(source);
  if (!result.ok) throw new Error(`expected readable MathML, got: ${result.failure}`);
  return result;
};

const unreadable = (source: string) => {
  const result = sanitiseMathml(source);
  if (result.ok) throw new Error(`expected unreadable MathML, got: ${result.mathml}`);
  return result.failure;
};

describe('an equation written in one form', () => {
  it('declares the namespace once, orders attributes, and drops whitespace between elements', () => {
    const result = readable(
      `<math display="block" alttext="x equals two">\n  <mi> x </mi>\n  <mo>=</mo>\n  <mn>2</mn>\n</math>`,
    );
    expect(result).toEqual({
      ok: true,
      mathml: math('<mi>x</mi><mo>=</mo><mn>2</mn>', ' alttext="x equals two" display="block"'),
      findings: [],
    });
  });

  it('writes two spellings of one equation as one string', () => {
    const a = readable(
      `<math xmlns="${MATHML_NAMESPACE}"><mfrac linethickness="0" ><mi>a</mi><mi>b</mi></mfrac></math>`,
    );
    const b = readable(`<math><mfrac   linethickness='0'>\n<mi>a</mi>\n<mi>b</mi></mfrac></math>`);
    expect(a.mathml).toBe(b.mathml);
  });

  it('is unchanged by a second pass', () => {
    const once = readable(math('<msup><mi>e</mi><mrow><mi>i</mi><mi>&#x3C0;</mi></mrow></msup>'));
    expect(sanitiseMathml(once.mathml)).toEqual(once);
  });

  it('decodes references and escapes only what markup needs', () => {
    expect(readable(math('<mo>&lt;</mo><mi>&#x3B1;</mi><mtext>A &amp; B</mtext>')).mathml).toBe(
      math('<mo>&lt;</mo><mi>\u{3B1}</mi><mtext>A &amp; B</mtext>'),
    );
  });

  it('self-closes an empty element', () => {
    expect(readable(math('<mspace width="1em"></mspace>')).mathml).toBe(
      math('<mspace width="1em"/>'),
    );
  });

  it('puts text in NFC', () => {
    expect(readable(math('<mi>e\u{301}</mi>')).mathml).toBe(math('<mi>\u{E9}</mi>'));
  });
});

describe('what an equation may not carry', () => {
  it('removes a script element and everything in it', () => {
    const result = readable(math('<mi>x</mi><script>alert(1)</script>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([{ subject: 'script', detail: 'script' }]);
  });

  it('removes an event handler attribute, naming it', () => {
    const result = readable(math('<mi onclick="alert(1)" ONMOUSEOVER="alert(2)">x</mi>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([
      { subject: 'eventHandler', detail: 'onclick' },
      { subject: 'eventHandler', detail: 'ONMOUSEOVER' },
    ]);
  });

  it('removes a link, in either spelling, naming the target it had', () => {
    const result = readable(
      math('<mi href="javascript:alert(1)">x</mi><mi xlink:href="https://example.test/">y</mi>'),
    );
    expect(result.mathml).toBe(math('<mi>x</mi><mi>y</mi>'));
    expect(result.findings).toEqual([
      { subject: 'hyperlink', detail: 'javascript:alert(1)' },
      { subject: 'hyperlink', detail: 'https://example.test/' },
    ]);
  });

  it('removes colour, size, style and identity attributes', () => {
    const result = readable(
      math('<mi mathcolor="red" mathsize="2em" style="color: red" class="big" id="x1">x</mi>'),
    );
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'mathcolor',
      'mathsize',
      'style',
      'class',
      'id',
    ]);
  });

  it('removes an annotation carrying HTML, and the markup inside it', () => {
    const result = readable(
      math(
        '<semantics><mi>x</mi><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"/></annotation-xml></semantics>',
      ),
    );
    expect(result.mathml).toBe(math('<semantics><mi>x</mi></semantics>'));
    expect(result.findings).toEqual([{ subject: 'mathElement', detail: 'annotation-xml' }]);
  });

  it('removes an element that is not MathML Core, and a math element nested in another', () => {
    const result = readable(math('<maction actiontype="toggle"><mi>x</mi></maction><math/>'));
    expect(result.mathml).toBe(`<math xmlns="${MATHML_NAMESPACE}"/>`);
    expect(result.findings).toEqual([
      { subject: 'mathElement', detail: 'maction' },
      { subject: 'mathElement', detail: 'math' },
    ]);
  });

  it('removes an element inside a token, where only text belongs', () => {
    const result = readable(math('<mtext>a<b>bold</b></mtext>'));
    expect(result.mathml).toBe(math('<mtext>a</mtext>'));
    expect(result.findings).toEqual([{ subject: 'mathElement', detail: 'b' }]);
  });

  it('removes text standing outside any token', () => {
    const result = readable(math('stray<mi>x</mi>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([{ subject: 'mathText', detail: 'stray' }]);
  });

  it('writes a combining mark as a reference, so NFC cannot fuse it with the tag before it', () => {
    // `>` followed by U+0338 composes to U+226F under NFC. Written raw, the tag's `>` would be eaten
    // and the text after it read by a browser as attributes of <mi>.
    const result = readable(math('<mi>\u{338} onmouseover=alert(1) x=</mi>'));
    expect(result.mathml).toBe(math('<mi>&#x338; onmouseover=alert(1) x=</mi>'));
    expect(result.mathml.normalize('NFC')).toBe(result.mathml);
    expect(sanitiseMathml(result.mathml.normalize('NFC'))).toEqual(result);
  });
});

describe('an equation that cannot be read', () => {
  it.each([
    ['an element left open', math('<mi>x')],
    ['a closing tag that closes nothing open', math('<mi>x</mo>')],
    ['a stray closing tag', `${math('<mi>x</mi>')}</math>`],
    ['an unquoted attribute', math('<mi class=x>x</mi>')],
    ['an attribute with no value', math('<mi hidden>x</mi>')],
    ['a repeated attribute', math('<mi dir="ltr" dir="rtl">x</mi>')],
    ['an attribute value holding <', math('<mi alttext="<script>">x</mi>')],
    ['a bare ampersand', math('<mtext>A & B</mtext>')],
    ['a named entity XML does not define', math('<mi>&alpha;</mi>')],
    ['a reference to a character XML does not allow', math('<mi>&#0;</mi>')],
    ['a comment', math('<!-- note --><mi>x</mi>')],
    ['CDATA', math('<mtext><![CDATA[<script>alert(1)</script>]]></mtext>')],
    ['a declaration', `<!DOCTYPE math>${math('<mi>x</mi>')}`],
    ['a processing instruction', `<?xml version="1.0"?>${math('<mi>x</mi>')}`],
    ['two roots', `${math('<mi>x</mi>')}${math('<mi>y</mi>')}`],
    ['text beside the root', `x${math('<mi>x</mi>')}`],
    ['a root that is not math', '<mrow><mi>x</mi></mrow>'],
    ['another namespace', '<math xmlns="http://www.w3.org/1999/xhtml"><mi>x</mi></math>'],
    ['a NUL character', math('<mi>\u{0}</mi>')],
    ['a < that starts no element', math('<mi>1 < 2</mi>')],
  ])('refuses %s', (_, source) => {
    expect(unreadable(source)).toMatch(/\S/);
  });

  it('refuses nesting deeper than the limit without exhausting the stack', () => {
    const deep = `<math>${'<mrow>'.repeat(100_000)}<mi>x</mi>${'</mrow>'.repeat(100_000)}</math>`;
    expect(unreadable(deep)).toMatch(/nested more than 64 deep/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/mathml.test.ts`
Expected: FAIL - `Error: Cannot find module './mathml.js'`.

- [ ] **Step 3: Write the reader, the allowlist and the writer**

```ts
// packages/domain/src/content/admission/mathml.ts
import { admissionLimits } from './limits.js';

/**
 * The one piece of markup inside the content model: an equation's MathML (CNT-043).
 *
 * Every other string in a document is text, rendered as text. MathML is rendered as markup - the
 * editor puts it into the page as native MathML - so it is the one place a script, an event handler
 * or a link can hide inside content that has otherwise been sanitised. This reads it, keeps what is
 * on an allowlist of MathML Core, and writes it back in one form.
 *
 * Deliberately not a general XML parser, and not lenient. It reads elements, quoted attributes, text,
 * the five XML entities and numeric references, and refuses everything else - comments, CDATA,
 * declarations, processing instructions, named entities, unquoted attributes, a tag left open - as
 * unreadable. An equation that cannot be read is removed and reported rather than guessed at, because
 * a lenient reader is where a parser differential lives: what this reads as text, a browser reads as
 * a tag.
 */
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

const allowedElements = new Set([
  'annotation',
  'math',
  'merror',
  'mfrac',
  'mi',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mprescripts',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'none',
  'semantics',
]);

/** The elements whose content is text. Text anywhere else is not MathML. */
const tokenElements = new Set(['annotation', 'mi', 'mn', 'mo', 'ms', 'mtext']);

/**
 * No `href`, no `on*`, no `style`, `class` or `id`, and no `mathcolor`, `mathbackground` or
 * `mathsize` - an equation carries no colour or size any more than text does (CNT-065).
 */
const allowedAttributes = new Set([
  'accent',
  'accentunder',
  'alttext',
  'arg',
  'columnalign',
  'columnspan',
  'depth',
  'dir',
  'display',
  'displaystyle',
  'encoding',
  'fence',
  'form',
  'height',
  'intent',
  'largeop',
  'linethickness',
  'lspace',
  'mathvariant',
  'maxsize',
  'minsize',
  'movablelimits',
  'rowalign',
  'rowspan',
  'rspace',
  'scriptlevel',
  'separator',
  'stretchy',
  'symmetric',
  'voffset',
  'width',
]);

export type MathmlFinding = {
  readonly subject:
    'script' | 'eventHandler' | 'hyperlink' | 'mathElement' | 'mathAttribute' | 'mathText';
  readonly detail: string;
};

export type MathmlResult =
  | { readonly ok: true; readonly mathml: string; readonly findings: readonly MathmlFinding[] }
  | { readonly ok: false; readonly failure: string };

type MathElement = { name: string; attributes: [string, string][]; children: MathNode[] };
type MathNode = MathElement | string;

class Unreadable extends Error {}

const NAME = /[A-Za-z_][A-Za-z0-9._:-]*/y;
const NOT_AN_XML_CHARACTER = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function sanitiseMathml(source: string): MathmlResult {
  try {
    if (NOT_AN_XML_CHARACTER.test(source)) {
      throw new Unreadable('it holds a character XML does not allow');
    }
    const root = parse(source);
    if (root.name !== 'math') throw new Unreadable(`its root is <${root.name}>, not <math>`);
    const findings: MathmlFinding[] = [];
    const cleaned = clean(root, findings);
    return { ok: true, mathml: serialise(cleaned, true), findings };
  } catch (error) {
    if (error instanceof Unreadable) return { ok: false, failure: error.message };
    throw error;
  }
}

function readName(source: string, at: number): string | undefined {
  NAME.lastIndex = at;
  return NAME.exec(source)?.[0];
}

function skipWhitespace(source: string, at: number): number {
  let index = at;
  while (index < source.length && ' \t\n\r'.includes(source[index]!)) index += 1;
  return index;
}

function decode(raw: string): string {
  let decoded = '';
  let index = 0;
  for (;;) {
    const amp = raw.indexOf('&', index);
    if (amp === -1) return decoded + raw.slice(index);
    const semicolon = raw.indexOf(';', amp);
    const entity = semicolon === -1 ? '' : raw.slice(amp + 1, semicolon);
    let character: string | undefined = ENTITIES[entity];
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (numeric) {
      const codePoint = numeric[1] ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
      if (codePoint <= 0x10ffff) {
        character = String.fromCodePoint(codePoint);
        if (NOT_AN_XML_CHARACTER.test(character)) character = undefined;
      }
    }
    if (character === undefined) {
      throw new Unreadable(`it holds an entity XML does not define: &${entity.slice(0, 12)}`);
    }
    decoded += raw.slice(index, amp) + character;
    index = semicolon + 1;
  }
}

function parse(source: string): MathElement {
  const documentNode: MathElement = { name: '#document', attributes: [], children: [] };
  const open: MathElement[] = [documentNode];
  let index = 0;

  while (index < source.length) {
    const current = open[open.length - 1]!;
    const lt = source.indexOf('<', index);
    const textEnd = lt === -1 ? source.length : lt;
    if (textEnd > index) {
      current.children.push(decode(source.slice(index, textEnd)));
      index = textEnd;
      continue;
    }

    const next = source[index + 1];
    if (next === '!' || next === '?') {
      throw new Unreadable(
        'comments, CDATA, declarations and processing instructions are not read',
      );
    }

    if (next === '/') {
      const closing = readName(source, index + 2);
      const end = closing === undefined ? -1 : skipWhitespace(source, index + 2 + closing.length);
      if (closing === undefined || source[end] !== '>')
        throw new Unreadable('a closing tag is malformed');
      const element = open.pop();
      if (element === undefined || element === documentNode || element.name !== closing) {
        throw new Unreadable(`</${closing}> closes an element that is not open`);
      }
      index = end + 1;
      continue;
    }

    const opening = readName(source, index + 1);
    if (opening === undefined) throw new Unreadable('a < starts no element');
    const element: MathElement = { name: opening, attributes: [], children: [] };
    const seen = new Set<string>();
    let at = index + 1 + opening.length;
    let selfClosing = false;

    for (;;) {
      const afterSpace = skipWhitespace(source, at);
      if (source.startsWith('/>', afterSpace)) {
        selfClosing = true;
        at = afterSpace + 2;
        break;
      }
      if (source[afterSpace] === '>') {
        at = afterSpace + 1;
        break;
      }
      const attribute = readName(source, afterSpace);
      if (afterSpace === at || attribute === undefined) {
        throw new Unreadable(`<${opening}> has a malformed attribute`);
      }
      const equals = skipWhitespace(source, afterSpace + attribute.length);
      const quoteAt = skipWhitespace(source, equals + 1);
      const quote = source[quoteAt];
      if (source[equals] !== '=' || (quote !== '"' && quote !== "'")) {
        throw new Unreadable(`<${opening}> has an attribute whose value is not quoted`);
      }
      const close = source.indexOf(quote, quoteAt + 1);
      if (close === -1) throw new Unreadable(`<${opening}> has an attribute value left open`);
      const raw = source.slice(quoteAt + 1, close);
      if (raw.includes('<')) throw new Unreadable(`<${opening}> has an attribute value holding <`);
      if (seen.has(attribute)) throw new Unreadable(`<${opening}> repeats an attribute`);
      seen.add(attribute);
      element.attributes.push([attribute, decode(raw)]);
      at = close + 1;
    }

    current.children.push(element);
    if (!selfClosing) {
      open.push(element);
      if (open.length - 1 > admissionLimits.mathDepth) {
        throw new Unreadable(`it is nested more than ${admissionLimits.mathDepth} deep`);
      }
    }
    index = at;
  }

  if (open.length > 1) throw new Unreadable(`<${open[open.length - 1]!.name}> is never closed`);
  const elements = documentNode.children.filter((child) => typeof child !== 'string');
  const strayText = documentNode.children.some(
    (child) => typeof child === 'string' && child.trim() !== '',
  );
  if (elements.length !== 1 || strayText) {
    throw new Unreadable('it does not have exactly one root element');
  }
  return elements[0]!;
}

function clean(element: MathElement, findings: MathmlFinding[]): MathElement {
  const attributes: [string, string][] = [];
  for (const [attribute, value] of element.attributes) {
    if (attribute === 'xmlns') {
      if (value !== MATHML_NAMESPACE) throw new Unreadable(`<${element.name}> is not MathML`);
      continue;
    }
    if (allowedAttributes.has(attribute)) {
      attributes.push([attribute, value.normalize('NFC')]);
      continue;
    }
    const local = attribute.slice(attribute.indexOf(':') + 1).toLowerCase();
    if (local === 'href') findings.push({ subject: 'hyperlink', detail: value });
    else if (local.startsWith('on')) findings.push({ subject: 'eventHandler', detail: attribute });
    else findings.push({ subject: 'mathAttribute', detail: attribute });
  }
  attributes.sort(([a], [b]) => (a < b ? -1 : 1));

  const isToken = tokenElements.has(element.name);
  const children: MathNode[] = [];
  let text = '';
  for (const child of element.children) {
    if (typeof child === 'string') {
      if (isToken) text += child;
      else if (child.trim() !== '') findings.push({ subject: 'mathText', detail: child.trim() });
      continue;
    }
    const local = child.name.slice(child.name.indexOf(':') + 1).toLowerCase();
    if (isToken || child.name === 'math' || !allowedElements.has(child.name)) {
      findings.push({ subject: local === 'script' ? 'script' : 'mathElement', detail: child.name });
      continue;
    }
    children.push(clean(child, findings));
  }
  if (isToken) {
    const collapsed = text
      .replace(/[ \t\n\r]+/g, ' ')
      .trim()
      .normalize('NFC');
    if (collapsed !== '') children.push(collapsed);
  }
  return { name: element.name, attributes, children };
}

/**
 * One form: the namespace declared once, on the root; attributes in lexicographic order; no
 * whitespace between elements; an empty element self-closed.
 *
 * Every combining mark is written as a character reference. NFC is applied to text before it is
 * written, and normalise applies NFC again to every string in the document - including this one. A
 * combining mark written raw after a `>` composes with it under NFC (`>` and U+0338 compose to U+226F), and a
 * tag whose `>` has been eaten reads its text as attributes. As a reference it cannot compose.
 */
function serialise(element: MathElement, isRoot: boolean): string {
  const attributes = isRoot
    ? [['xmlns', MATHML_NAMESPACE] as const, ...element.attributes]
    : element.attributes;
  const start = `<${element.name}${attributes.map(([key, value]) => ` ${key}="${escape(value, true)}"`).join('')}`;
  if (element.children.length === 0) return `${start}/>`;
  const content = element.children
    .map((child) => (typeof child === 'string' ? escape(child, false) : serialise(child, false)))
    .join('');
  return `${start}>${content}</${element.name}>`;
}

function escape(value: string, inAttribute: boolean): string {
  return value.replace(/[&<>"\t\n\r]|\p{M}/gu, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"' && inAttribute) return '&quot;';
    if (character === '"') return character;
    if (!inAttribute && (character === '\t' || character === '\n' || character === '\r')) {
      return character;
    }
    return `&#x${character.codePointAt(0)!.toString(16).toUpperCase()};`;
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/mathml.test.ts`
Expected: PASS, 36 tests.

Then check the combining-mark test is doing its job: temporarily delete `|\p{M}` from the regular
expression in `escape`, run the file again, and watch `writes a combining mark as a reference` fail.
Restore it.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/mathml.ts packages/domain/src/content/admission/mathml.test.ts
git commit -m "Read an equation's MathML strictly and write it back in one form"
```

---

## Task 4: Validation keeps only the MathML the reader keeps

**Files:**

- Modify: `packages/domain/src/content/admission/mathml.ts`, `packages/domain/src/content/admission/mathml.test.ts`
- Modify: `packages/domain/src/content/model/inline.ts`
- Modify: `packages/domain/src/content/model/document.test.ts`, `packages/domain/src/content/model/inline.test.ts`
- Modify: `packages/domain/src/content/model/fixtures/v1/every-node.json`

**Interfaces:**

- Consumes: `sanitiseMathml` and `MATHML_NAMESPACE` (task 3); `parseContentDocument` (`content/model/document.ts`) and `readContent` (`content/model/migrate.ts`), unchanged.
- Produces:
  - `isKeptMathml(source: string): boolean` - true only when `sanitiseMathml(source)` is readable, has no findings, and writes `source` back byte for byte
  - `equationContentSchema.mathml` (`content/model/inline.ts`) refined by `isKeptMathml`, failing with the zod issue message `not in the one form the MathML reader writes`, so `parseContentDocument` throws it and `readContent` quarantines it

See decision 17. The task comes straight after the reader, so every later task - the pipeline's validation
in task 9 above all - runs with the rule in place, and a regression in the reader's one form shows up there
as a refused admission rather than as bytes nobody compared.

No identifier is cited. CNT-010's statement is when validation runs, and `index.test.ts` cites it; these
tests show one thing validation checks. CNT-043 and CNT-013 are already cited by the model's tests, and
[the requirements section](#requirements-this-plan-cites-and-those-it-does-not) says why neither is cited
again. These tests admit nothing, so there is no report to assert.

**The fixtures a reviewer should find:** one equation placed as a block, inline, and inline inside a
footnote, because a footnote's content is validated by a second parse; and twelve ways to miss the one
form - no namespace, whitespace between elements, the namespace declared again inside, attributes out of
order, an empty element not self-closed, text not in NFC, a combining mark written raw, an event handler, a
script, a link, a colour, and an element left open.

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/content/admission/mathml.test.ts`, import `isKeptMathml` beside the other two
names:

```ts
import { isKeptMathml, MATHML_NAMESPACE, sanitiseMathml } from './mathml.js';
```

and add at the end of the file:

```ts
describe('MathML kept exactly as it stands', () => {
  it('is everything the reader writes', () => {
    for (const source of [
      `<math display="block" alttext="x equals two">\n  <mi> x </mi>\n  <mo>=</mo>\n  <mn>2</mn>\n</math>`,
      math('<mo>&lt;</mo><mo>></mo><mi>&#x3B1;</mi><mtext>A &amp; "B"</mtext>'),
      math('<mspace width="1em"></mspace>'),
      math('<mi>e\u{301}</mi><mi>q\u{301}</mi>'),
      math('<mi>\u{338} onmouseover=alert(1) x=</mi>'),
      math('<mi alttext="a&#9;&quot;b&quot;">x</mi>'),
      math('<mi onclick="alert(1)">x</mi><script>alert(2)</script>'),
    ]) {
      const written = readable(source).mathml;
      expect(isKeptMathml(written), written).toBe(true);
    }
  });

  it('is nothing the reader would rewrite, remove anything from, or refuse', () => {
    for (const source of [
      '<math><mi>x</mi></math>',
      math('\n<mi>x</mi>\n'),
      math(`<mi xmlns="${MATHML_NAMESPACE}">x</mi>`),
      math('<mi>x</mi>', ' display="block" alttext="x"'),
      math('<mspace width="1em"></mspace>'),
      math('<mo>></mo>'),
      math('<mi>e\u{301}</mi>'),
      math('<mi>\u{338}</mi>'),
      math('<mi onclick="alert(1)">x</mi>'),
      math('<mi>x</mi><script>alert(1)</script>'),
      math('<mi mathcolor="red">x</mi>'),
      math('<mi>x</mi>stray'),
      math('<mi>x'),
      '',
    ]) {
      expect(isKeptMathml(source), JSON.stringify(source)).toBe(false);
    }
  });
});
```

In `packages/domain/src/content/model/document.test.ts`, replace the one import from `./document.js` with:

```ts
import { MATHML_NAMESPACE } from '../admission/mathml.js';

import { CURRENT_SCHEMA_VERSION, contentDocumentSchema, parseContentDocument } from './document.js';
import { readContent } from './migrate.js';
```

and add at the end of the file:

```ts
describe('an equation, stored only as the MathML reader writes it', () => {
  const kept = `<math xmlns="${MATHML_NAMESPACE}" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>`;

  /** One equation in each place one can stand: a block, inline, and inline inside a footnote. */
  const placed = (mathml: string) =>
    [
      ['as a block', doc([{ type: 'equation', id: 'b1', mathml, numbered: false }])],
      [
        'inline',
        doc([
          { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'equation', mathml }] },
        ]),
      ],
      [
        'inside a footnote',
        doc([
          {
            type: 'paragraph',
            id: 'b1',
            style: 'body',
            content: [
              {
                type: 'footnote',
                id: 'f1',
                anchor: { kind: 'span' },
                content: [
                  {
                    type: 'paragraph',
                    id: 'b2',
                    style: 'footnote',
                    content: [{ type: 'equation', mathml }],
                  },
                ],
              },
            ],
          },
        ]),
      ],
    ] as const;

  it('admits MathML the reader would keep exactly as it stands, wherever the equation stands', () => {
    for (const [where, document] of placed(kept)) {
      expect(() => parseContentDocument(document), where).not.toThrow();
    }
  });

  it.each([
    [
      'with no namespace declared',
      '<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
    ],
    ['with whitespace between elements', kept.replace('<mfrac>', '\n  <mfrac>')],
    [
      'with its namespace declared again inside',
      kept.replace('<mfrac>', `<mfrac xmlns="${MATHML_NAMESPACE}">`),
    ],
    [
      'with attributes out of order',
      kept.replace('display="block"', 'display="block" alttext="a over b"'),
    ],
    ['with an empty element not self-closed', kept.replace('<mi>b</mi>', '<mi></mi>')],
    ['with text not in NFC', kept.replace('<mi>a</mi>', '<mi>e\u{301}</mi>')],
    ['with a combining mark written raw', kept.replace('<mi>a</mi>', '<mi>\u{338}</mi>')],
    ['with an event handler', kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>')],
    ['with a script', kept.replace('<mi>a</mi>', '<mi>a</mi><script>alert(1)</script>')],
    ['with a link', kept.replace('<mi>a</mi>', '<mi href="javascript:alert(1)">a</mi>')],
    ['with a colour', kept.replace('<mi>a</mi>', '<mi mathcolor="red">a</mi>')],
    ['that cannot be read', kept.replace('</mfrac>', '')],
  ])('refuses an equation %s, wherever it stands', (_, mathml) => {
    for (const [where, document] of placed(mathml)) {
      expect(() => parseContentDocument(document), where).toThrow(
        /not in the one form the MathML reader writes/,
      );
    }
  });

  it('quarantines stored content holding an equation the reader would not keep as it stands', () => {
    const outcome = readContent(
      doc([
        {
          type: 'equation',
          id: 'b1',
          mathml: kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>'),
          numbered: true,
        },
      ]),
      { artifact: 'component-10', version: '1.0' },
    );
    expect(outcome).toMatchObject({ ok: false, artifact: 'component-10', version: '1.0' });
    expect(outcome).not.toHaveProperty('document');
    expect(!outcome.ok && outcome.failure).toMatch(/not in the one form the MathML reader writes/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/mathml.test.ts src/content/model/document.test.ts`
Expected: FAIL, 15 of 69 tests. Both new `mathml.test.ts` tests fail with
`TypeError: isKeptMathml is not a function`; the twelve refusals fail with
`AssertionError: as a block: expected [Function] to throw an error`; the quarantine fails with
`expected { ok: true, document: { …(5) } } to match object { ok: false, …(2) }`. The admitting test passes
already. It is there so that refusing every equation cannot pass for the rule.

- [ ] **Step 3: Write the model's own equations in the one form**

Three places in the model's tests hold MathML the reader would rewrite, and in each the namespace is all it
would change. They pass before the rule and after it.

In `packages/domain/src/content/model/fixtures/v1/every-node.json`, change the inline equation's
`"<math><mi>x</mi></math>"` to `"<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><mi>x</mi></math>"`,
and the block equation's `"<math display=\"block\"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"` to
`"<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"`.
Editing a schema version's fixture is safe only because nothing stores content yet - decision 17.

In `packages/domain/src/content/model/document.test.ts`, in `CNT-021 stores a block equation as numbered or
explicitly unnumbered`, change `mathml: '<math/>'` to ``mathml: `<math xmlns="${MATHML_NAMESPACE}"/>` ``.

In `packages/domain/src/content/model/inline.test.ts`, add below the `vitest` import:

```ts
import { MATHML_NAMESPACE } from '../admission/mathml.js';
```

and in `CNT-043 stores an equation as MathML, with the LaTeX typed kept beside it`, change both
`'<math><mi>x</mi></math>'` to `` `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` ``.

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/model`
Expected: FAIL only in the thirteen tests step 2 left failing in `document.test.ts`; every other model test
passes.

- [ ] **Step 4: Ask the reader, from validation**

Add at the end of `packages/domain/src/content/admission/mathml.ts`:

```ts
/**
 * Whether MathML is already what this reader keeps: readable, with nothing to remove, and written
 * exactly as `sanitiseMathml` writes it. Validation asks this of every equation it is handed
 * (`model/inline.ts`), so the rule a stored equation meets is this reader rather than a second
 * description of it - anything the reader would drop, rewrite or refuse is refused.
 *
 * All three conditions are checked. A namespace declared again, or whitespace between elements, is
 * removed with no finding, so findings alone would pass them; a finding always changes the string, but
 * checking it costs nothing and does not rest on that.
 */
export function isKeptMathml(source: string): boolean {
  const result = sanitiseMathml(source);
  return result.ok && result.findings.length === 0 && result.mathml === source;
}
```

In `packages/domain/src/content/model/inline.ts`, add below the `zod` import:

```ts
import { isKeptMathml } from '../admission/mathml.js';
```

and replace `equationContentSchema` and the comment above it with:

```ts
/**
 * CNT-043: MathML is canonical. The LaTeX typed is a non-authoritative input record.
 *
 * The MathML is refused unless the admission pipeline's strict reader would keep it exactly as it
 * stands, because it is the one string in the model rendered as markup: content reaching validation
 * by any path but admission - an iteration the service parses, a version read back - must not carry
 * what sanitise removes from a paste. The check is the reader itself, never a second description.
 */
export const equationContentSchema = {
  mathml: z.string().min(1).refine(isKeptMathml, 'not in the one form the MathML reader writes'),
  latex: z.string().min(1).optional(),
};
```

- [ ] **Step 5: Run the whole domain suite and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run`
Expected: PASS, 345 tests - 283 before this plan, 46 from tasks 1 to 3, and 16 here. Every fixture of every
schema version still migrates and validates.

Then check the byte comparison is doing its job: in `isKeptMathml`, temporarily delete
`&& result.mathml === source`, run the suite again, and watch eight tests fail - `is nothing the reader
would rewrite, remove anything from, or refuse`, and the seven refusals from `with no namespace declared`
to `with a combining mark written raw`. Restore it.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/mathml.ts packages/domain/src/content/admission/mathml.test.ts packages/domain/src/content/model/inline.ts packages/domain/src/content/model/inline.test.ts packages/domain/src/content/model/document.test.ts packages/domain/src/content/model/fixtures/v1/every-node.json
git commit -m "Refuse at validation any MathML the strict reader would not keep as it stands"
```

---

## Task 5: The sanitise stage

**Files:**

- Create: `packages/domain/src/content/admission/sanitise.ts`
- Test: `packages/domain/src/content/admission/sanitise.test.ts`

**Interfaces:**

- Consumes: `allowedLinkSchemes` (`content/model/marks.ts`); `sanitiseMathml` (task 3); `ReportCollector` (task 1).
- Produces: `sanitise(candidate: unknown, report: ReportCollector): unknown` - a new value; the argument is never mutated.

See decisions 2, 8 and 9. No identifier is cited: CNT-130's statement is about pasted HTML (decision 16),
and CNT-127 and CNT-131 are cited in task 9, through the whole pipeline.

**Adversarial fixtures a reviewer should find:** a script at the root and inline; an embedded object with
fallback content; handlers on a block and on a mark; nine link targets - `javascript:` in three spellings
including a tab inside the scheme, `vbscript:`, `data:` carrying a script, `file:`, relative, and not a URL
at all; a link with no target; a target the URL parser reads differently; `expression(` plain, escaped and
split by a comment, `url("javascript:")`, `behavior`, and a comment that only looks like an expression; an
equation carrying a handler and a script; and an unreadable equation.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/sanitise.test.ts
import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from './mathml.js';
import { createReport } from './report.js';
import { sanitise } from './sanitise.js';

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  content,
  ...extra,
});
const candidate = (content: unknown[]) => ({ schemaVersion: 1, content });

const run = (value: unknown) => {
  const report = createReport();
  const output = sanitise(value, report);
  return { output, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the sanitise stage', () => {
  it('passes content with nothing to remove through unchanged, and reports nothing', () => {
    const clean = candidate([
      paragraph([
        text('See the ', []),
        text('guide', [{ type: 'hyperlink', href: 'https://example.test/guide' }]),
      ]),
    ]);
    expect(run(clean)).toEqual({ output: clean, entries: [] });
  });

  it('removes a script wherever a node can stand, naming what the reader called it', () => {
    const { output, entries } = run(
      candidate([
        { type: 'script', name: 'script' },
        paragraph([text('Before'), { type: 'script', name: 'script' }, text('after')]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Before'), text('after')])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
    ]);
  });

  it('removes an embedded object and anything inside it', () => {
    const { output, entries } = run(
      candidate([
        { type: 'embeddedObject', name: 'iframe', content: [paragraph([text('Fallback')])] },
      ]),
    );
    expect(output).toEqual(candidate([]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'iframe' },
    ]);
  });

  it('removes event handlers from any node or mark, one entry for each', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('Click', [{ type: 'strong', handlers: ['onmouseover'] }])], {
          handlers: ['onclick', 'onfocus'],
        }),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Click', [{ type: 'strong' }])])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onmouseover' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onfocus' },
    ]);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '/relative/path',
    'not a url',
  ])('removes a link to %j, keeps its text, and names the target it had', (href) => {
    const { output, entries } = run(
      candidate([
        paragraph([text('Read this', [{ type: 'strong' }, { type: 'hyperlink', href }])]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Read this', [{ type: 'strong' }])])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'hyperlink', detail: href },
    ]);
  });

  it('removes a link with no target at all', () => {
    const { output, entries } = run(candidate([paragraph([text('x', [{ type: 'hyperlink' }])])]));
    expect(output).toEqual(candidate([paragraph([text('x', [])])]));
    expect(entries).toEqual([{ stage: 'sanitise', action: 'discarded', subject: 'hyperlink' }]);
  });

  it('keeps a web or email target exactly as it arrived', () => {
    for (const href of [
      'https://example.test',
      'http://example.test/a?b=c#d',
      'mailto:ada@example.test',
    ]) {
      expect(
        run(candidate([paragraph([text('x', [{ type: 'hyperlink', href }])])])).entries,
      ).toEqual([]);
    }
  });

  it('rewrites a target the URL parser reads differently from what it says, naming what it had', () => {
    const href = 'https://example.test/\tpath\n';
    const { output, entries } = run(
      candidate([paragraph([text('x', [{ type: 'hyperlink', href, title: 'Guide' }])])]),
    );
    expect(output).toEqual(
      candidate([
        paragraph([
          text('x', [{ type: 'hyperlink', href: 'https://example.test/path', title: 'Guide' }]),
        ]),
      ]),
    );
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'rewritten', subject: 'hyperlink', detail: href },
    ]);
  });

  it('reports formatting that could run code as a script, and leaves the rest for normalise', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('x')], {
          presentation: {
            typeface: 'Leeds Sans',
            width: 'expression(alert(1))',
            background: 'expr\\65 ssion(alert(2))',
            border: 'url("javascript:alert(3)")',
            colour: 'red /* expression( */',
            behavior: 'url(evil.htc)',
            filter: 'ex/**/pression(alert(4))',
          },
        }),
      ]),
    );
    expect(output).toEqual(
      candidate([
        paragraph([text('x')], {
          presentation: { typeface: 'Leeds Sans', colour: 'red /* expression( */' },
        }),
      ]),
    );
    expect(entries.map((entry) => [entry.subject, entry.detail])).toEqual([
      ['executableStyle', 'width'],
      ['executableStyle', 'background'],
      ['executableStyle', 'border'],
      ['executableStyle', 'behavior'],
      ['executableStyle', 'filter'],
    ]);
  });

  it('sanitises an equation, reporting each thing removed and the rewrite once', () => {
    const { output, entries } = run(
      candidate([
        {
          type: 'equation',
          numbered: false,
          mathml: '<math><mi onclick="alert(1)">x</mi><script>alert(2)</script></math>',
        },
        paragraph([
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>y</mi></math>` },
        ]),
      ]),
    );
    expect(output).toEqual(
      candidate([
        {
          type: 'equation',
          numbered: false,
          mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>`,
        },
        paragraph([
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>y</mi></math>` },
        ]),
      ]),
    );
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
    ]);
  });

  it('removes an equation that cannot be read, saying why', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('a'), { type: 'equation', mathml: '<math><mi>x</math>' }, text('b')]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('a'), text('b')])]));
    expect(entries).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'equation',
        detail: '</math> closes an element that is not open',
      },
    ]);
  });

  it('leaves the reader output it was given untouched', () => {
    const arrived = candidate([
      paragraph([text('x', [{ type: 'hyperlink', href: 'javascript:alert(1)' }])], {
        handlers: ['onclick'],
      }),
    ]);
    const copy = structuredClone(arrived);
    const { output, entries } = run(arrived);
    expect(arrived).toEqual(copy);
    expect(output).toEqual(candidate([paragraph([text('x', [])])]));
    expect(entries).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/sanitise.test.ts`
Expected: FAIL - `Error: Cannot find module './sanitise.js'`.

- [ ] **Step 3: Write the stage**

```ts
// packages/domain/src/content/admission/sanitise.ts
import { allowedLinkSchemes } from '../model/marks.js';

import { sanitiseMathml } from './mathml.js';
import type { ReportCollector } from './report.js';

/**
 * The first stage: what could run, embed or navigate is gone before anything else touches the
 * content (CNT-130), so no later stage can carry it further or rewrite it into something that passes.
 *
 * It walks the reader's output as plain JSON rather than as the model, because what it removes has
 * no place in the model. The vocabulary a reader uses for it is named in `admit.ts`: a `script` or
 * `embeddedObject` node anywhere a node can stand, a `handlers` member on any node, a `hyperlink`
 * mark with any target, a `presentation` member on any node, and an equation's MathML as it arrived.
 *
 * Nothing is mutated. The reader's output is read and a new value built, so a caller holding the
 * original still holds what arrived.
 */
export function sanitise(candidate: unknown, report: ReportCollector): unknown {
  const tally = { equationsRewritten: 0 };
  const result = visit(candidate, report, tally);
  if (tally.equationsRewritten > 0) {
    report.add('sanitise', 'rewritten', 'equation', { count: tally.equationsRewritten });
  }
  return result === REMOVE ? undefined : result;
}

const REMOVE = Symbol('remove');

/**
 * Whether the URL parser strips or ignores part of the target - a control character, a space, a tab
 * or a line break - so that the target says something other than what a browser reads.
 */
function readsDifferently(href: string): boolean {
  for (const character of href) {
    const code = character.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const EXECUTABLE_STYLE =
  /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|url\s*\(|@import/i;

function visit(
  value: unknown,
  report: ReportCollector,
  tally: { equationsRewritten: number },
): unknown {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const member of value) {
      const next = visit(member, report, tally);
      if (next !== REMOVE) kept.push(next);
    }
    return kept;
  }
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;

  if (record.type === 'script' || record.type === 'embeddedObject') {
    report.add('sanitise', 'discarded', record.type, detail(record.name));
    return REMOVE;
  }

  /** Members this stage rewrote, which replace what arrived. */
  const replaced = new Map<string, unknown>();

  if (record.type === 'hyperlink') {
    const href = record.href;
    let parsed: URL | undefined;
    try {
      parsed = typeof href === 'string' ? new URL(href) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!parsed || !(allowedLinkSchemes as readonly string[]).includes(parsed.protocol)) {
      report.add('sanitise', 'discarded', 'hyperlink', detail(href));
      return REMOVE;
    }
    if (typeof href === 'string' && readsDifferently(href)) {
      report.add('sanitise', 'rewritten', 'hyperlink', { detail: href });
      replaced.set('href', parsed.href);
    }
  }

  if (record.type === 'equation' && typeof record.mathml === 'string') {
    const result = sanitiseMathml(record.mathml);
    if (!result.ok) {
      report.add('sanitise', 'discarded', 'equation', { detail: result.failure });
      return REMOVE;
    }
    for (const finding of result.findings) {
      report.add('sanitise', 'discarded', finding.subject, { detail: finding.detail });
    }
    if (result.mathml !== record.mathml) tally.equationsRewritten += 1;
    replaced.set('mathml', result.mathml);
  }

  // Built as entries rather than by assignment: `out[key] = value` calls the `__proto__` setter for
  // a member of that name, and the member would vanish without a report entry.
  const members: [string, unknown][] = [];
  for (const [key, member] of Object.entries(record)) {
    if (replaced.has(key)) {
      members.push([key, replaced.get(key)]);
      continue;
    }
    if (key === 'handlers') {
      const names = Array.isArray(member) ? member : [member];
      for (const name of names) report.add('sanitise', 'discarded', 'eventHandler', detail(name));
      continue;
    }
    if (key === 'presentation') {
      members.push([key, withoutExecutableStyle(member, report)]);
      continue;
    }
    const next = visit(member, report, tally);
    if (next !== REMOVE) members.push([key, next]);
  }
  return Object.fromEntries(members);
}

/**
 * Formatting is dropped whole by normalise, and the model has no member it could survive into - so a
 * style that runs code cannot be stored whether or not this finds it. This exists so the report says
 * what it was: a script dressed as formatting is a script, and reporting it as a lost typeface would
 * tell the author nothing happened.
 */
function withoutExecutableStyle(presentation: unknown, report: ReportCollector): unknown {
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    return presentation;
  }
  return Object.fromEntries(
    Object.entries(presentation).filter(([property, value]) => {
      if (!EXECUTABLE_STYLE.test(decodeCss(`${property}:${String(value)}`))) return true;
      report.add('sanitise', 'discarded', 'executableStyle', { detail: property });
      return false;
    }),
  );
}

/** CSS comments removed and escapes decoded, so a property reads as a browser would run it. */
function decodeCss(value: string): string {
  let withoutComments = '';
  let index = 0;
  for (;;) {
    const open = value.indexOf('/*', index);
    if (open === -1) {
      withoutComments += value.slice(index);
      break;
    }
    withoutComments += value.slice(index, open);
    const close = value.indexOf('*/', open + 2);
    if (close === -1) break;
    index = close + 2;
  }
  return withoutComments
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/\\(.)/gs, '$1');
}

function detail(value: unknown): { detail?: string } {
  return typeof value === 'string' ? { detail: value } : {};
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/sanitise.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/sanitise.ts packages/domain/src/content/admission/sanitise.test.ts
git commit -m "Sanitise what arrives before any other stage touches it"
```

`pnpm lint` enforces `no-control-regex`: a character class spanning control characters is refused, which
is why `readsDifferently` compares code points instead.

---

## Task 6: The migrate stage

**Files:**

- Modify: `packages/domain/src/content/model/migrate.ts`
- Create: `packages/domain/src/content/admission/migrate.ts`
- Test: `packages/domain/src/content/admission/migrate.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `migrateStored(value: unknown, chain: MigrationChain): Record<string, unknown>` and `type MigrationChain` (`stored/migrate.ts`); `ReportCollector` (task 1).
- Produces:
  - `contentMigrationChain: MigrationChain`, exported from `content/model/migrate.ts` and not from its barrel
  - `type StageResult<T> = { ok: true; value: T } | { ok: false; failure: string }`
  - `migrateCandidate(candidate: unknown, report: ReportCollector, chain?: MigrationChain): StageResult<Record<string, unknown>>` - appends `rewritten schemaVersion` when it migrated, `refused schemaVersion` when it could not

See decision 10.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/migrate.test.ts
import { describe, expect, it } from 'vitest';

import type { MigrationChain } from '../../stored/migrate.js';

import { migrateCandidate } from './migrate.js';
import { createReport } from './report.js';

/** A second schema version that renames a paragraph's `style` to `role`, standing in for the first real one. */
const twoVersions: MigrationChain = {
  subject: 'content',
  current: 2,
  migrations: {
    1: (value) => ({
      ...value,
      content: (value.content as Record<string, unknown>[]).map(({ style, ...block }) => ({
        ...block,
        role: style,
      })),
    }),
  },
};

const entriesOf = (report: ReturnType<typeof createReport>) =>
  report.entries.map(({ message: _, ...entry }) => entry);

describe('the migrate stage', () => {
  it('CNT-134 brings content written against an earlier schema version to the current one, and says so', () => {
    const report = createReport();
    const arrived = {
      schemaVersion: 1,
      content: [{ type: 'paragraph', style: 'body', content: [] }],
    };

    expect(migrateCandidate(arrived, report, twoVersions)).toEqual({
      ok: true,
      value: { schemaVersion: 2, content: [{ type: 'paragraph', role: 'body', content: [] }] },
    });
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'rewritten', subject: 'schemaVersion', detail: '1' },
    ]);
    expect(arrived.schemaVersion).toBe(1);
  });

  it('passes content already at the current version through, and reports nothing', () => {
    const report = createReport();
    const arrived = { schemaVersion: 1, content: [] };
    expect(migrateCandidate(arrived, report)).toEqual({ ok: true, value: arrived });
    expect(report.entries).toEqual([]);
  });

  it('CNT-134 refuses content from a schema version this build has no path from, by name', () => {
    const report = createReport();
    const outcome = migrateCandidate({ schemaVersion: 99, content: [] }, report);
    expect(outcome).toEqual({
      ok: false,
      failure:
        "Stored content was written against schema version 99, which is newer than this build's 1",
    });
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'refused', subject: 'schemaVersion' },
    ]);
  });

  it('refuses content that records no schema version', () => {
    const report = createReport();
    const outcome = migrateCandidate({ content: [] }, report);
    expect(outcome.ok).toBe(false);
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'refused', subject: 'schemaVersion' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/migrate.test.ts`
Expected: FAIL - `Error: Cannot find module './migrate.js'`.

- [ ] **Step 3: Export content's chain**

In `packages/domain/src/content/model/migrate.ts`, change

```ts
const chain: MigrationChain = {
```

to

```ts
export const contentMigrationChain: MigrationChain = {
```

and in `migrate`, change `return migrateStored(value, chain);` to
`return migrateStored(value, contentMigrationChain);`. Leave `model/index.ts` alone: the chain is not
part of the public surface.

- [ ] **Step 4: Write the stage**

```ts
// packages/domain/src/content/admission/migrate.ts
import { contentMigrationChain } from '../model/migrate.js';
import { migrateStored, type MigrationChain } from '../../stored/migrate.js';

import type { ReportCollector } from './report.js';

export type StageResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: string };

/**
 * The third stage: content at an earlier schema version is brought to the current one, or refused by
 * name (CNT-134). It runs before normalise and re-identify, so they work in the current schema's terms.
 *
 * The chain is content's own, the one stored content is read through - a clipboard has no version row,
 * so the version it was written against is the one it carries (CNT-011). `chain` is a parameter only so
 * a test can stand in a second schema version before one exists.
 */
export function migrateCandidate(
  candidate: unknown,
  report: ReportCollector,
  chain: MigrationChain = contentMigrationChain,
): StageResult<Record<string, unknown>> {
  try {
    const from = (candidate as { schemaVersion?: unknown } | null)?.schemaVersion;
    const value = migrateStored(candidate, chain);
    if (typeof from === 'number' && from < chain.current) {
      report.add('migrate', 'rewritten', 'schemaVersion', { detail: String(from) });
    }
    return { ok: true, value };
  } catch (error) {
    report.add('migrate', 'refused', 'schemaVersion');
    return { ok: false, failure: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 5: Run it, and the model's migration tests, and watch them pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/migrate.test.ts src/content/model/migrate.test.ts`
Expected: PASS, 4 tests and 7 tests.

- [ ] **Step 6: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.` In `packages/trace/src/trace.test.ts`, change
`expect(model.citations).toHaveLength(112);` to `toHaveLength(113)` - one citation of CNT-134 in
`migrate.test.ts`, counted once for the file however many titles name it.

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src packages/trace/src/trace.test.ts
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/model/migrate.ts packages/domain/src/content/admission/migrate.ts packages/domain/src/content/admission/migrate.test.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Migrate admitted content to the current schema version, or refuse it by name"
```

---

## Task 7: The normalise stage

**Files:**

- Create: `packages/domain/src/content/admission/normalise.ts`
- Test: `packages/domain/src/content/admission/normalise.test.ts`

**Interfaces:**

- Consumes: `type ContentDocument` (`content/model/document.ts`); `markSchema` (`content/model/marks.ts`); `ReportCollector` (task 1).
- Produces: `normalise(candidate: Record<string, unknown>, receiver: ContentDocument, report: ReportCollector): Record<string, unknown>` - with the root's `language` and `direction` removed, because task 9 validates under the receiving component's.

See decision 11.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/normalise.test.ts
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { normalise } from './normalise.js';
import { createReport } from './report.js';

const receiver: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
};

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  style: 'body',
  content,
  ...extra,
});

const run = (candidate: Record<string, unknown>) => {
  const report = createReport();
  const output = normalise(candidate, receiver, report);
  return { output, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the normalise stage', () => {
  it('passes content with nothing to normalise through unchanged, and reports nothing', () => {
    const clean = { schemaVersion: 1, content: [paragraph([text('Leeds, then York.')])] };
    expect(run(clean)).toEqual({ output: clean, entries: [] });
  });

  it('drops typeface, size and colour wherever they arrive, counting each', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([{ ...text('Big'), presentation: { typeface: 'Leeds Serif', size: '24pt' } }], {
          presentation: { colour: '#c00', typeface: 'Leeds Sans' },
        }),
      ],
    });
    expect(output).toEqual({ schemaVersion: 1, content: [paragraph([text('Big')])] });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 2 },
      { stage: 'normalise', action: 'discarded', subject: 'size', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 1 },
    ]);
  });

  it('drops other formatting, naming each property the reader gave', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('x')], { presentation: { 'text-align': 'center', 'margin-top': '2em' } }),
        paragraph([text('y')], { presentation: { 'text-align': 'right' } }),
        paragraph([text('z')], { presentation: 'color: red' }),
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [paragraph([text('x')]), paragraph([text('y')]), paragraph([text('z')])],
    });
    expect(entries).toEqual([
      {
        stage: 'normalise',
        action: 'discarded',
        subject: 'appearance',
        count: 2,
        detail: 'text-align',
      },
      {
        stage: 'normalise',
        action: 'discarded',
        subject: 'appearance',
        count: 1,
        detail: 'margin-top',
      },
      { stage: 'normalise', action: 'discarded', subject: 'appearance', count: 1 },
    ]);
  });

  it('puts every string in NFC, counting the strings it changed', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('Cafe\u{301}'), text('already \u{E9}')]),
        { type: 'preformatted', text: 'Ame\u{301}lie' },
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([text('Caf\u{E9}'), text('already \u{E9}')]),
        { type: 'preformatted', text: 'Am\u{E9}lie' },
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 2 },
    ]);
  });

  it('drops empty runs of text, then every empty paragraph standing after another', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('One')]),
        paragraph([]),
        paragraph([text('')]),
        paragraph([]),
        paragraph([text('Two'), text('')]),
        {
          type: 'blockquote',
          content: [paragraph([]), paragraph([])],
        },
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([text('One')]),
        paragraph([]),
        paragraph([text('Two')]),
        { type: 'blockquote', content: [paragraph([])] },
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'emptyText', count: 2 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyParagraph', count: 3 },
    ]);
  });

  it('keeps the language content came from as a mark over its text, where it differs', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      language: 'fr-FR',
      direction: 'ltr',
      content: [
        paragraph([
          text('Bonjour'),
          text('Hello', [{ type: 'language', tag: 'en-GB' }]),
          { type: 'footnote', anchor: { kind: 'span' }, content: [paragraph([text('Note')])] },
        ]),
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([
          text('Bonjour', [{ type: 'language', tag: 'fr-FR' }]),
          text('Hello', [{ type: 'language', tag: 'en-GB' }]),
          {
            type: 'footnote',
            anchor: { kind: 'span' },
            content: [paragraph([text('Note', [{ type: 'language', tag: 'fr-FR' }])])],
          },
        ]),
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'language', detail: 'fr-FR' },
    ]);
  });

  it("adds no mark where the language is the receiving component's own", () => {
    const same = {
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: [paragraph([text('x')])],
    };
    expect(run(same)).toEqual({
      output: { schemaVersion: 1, content: [paragraph([text('x')])] },
      entries: [],
    });
  });

  it('reports a language that is not a tag, and a direction it cannot keep', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      language: 'french',
      direction: 'rtl',
      content: [paragraph([text('x')])],
    });
    expect(output).toEqual({ schemaVersion: 1, content: [paragraph([text('x')])] });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'language', detail: 'french' },
      { stage: 'normalise', action: 'discarded', subject: 'direction', detail: 'rtl' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/normalise.test.ts`
Expected: FAIL - `Error: Cannot find module './normalise.js'`.

- [ ] **Step 3: Write the stage**

```ts
// packages/domain/src/content/admission/normalise.ts
import type { ContentDocument } from '../model/document.js';
import { markSchema } from '../model/marks.js';

import type { ReportCollector } from './report.js';

/**
 * The fourth stage, over content sanitise has already made safe and migrate has brought to the
 * current schema.
 *
 * - **Formatting is dropped** (CNT-065). A reader hands over what it found as `presentation`, naming
 *   `typeface`, `size` and `colour` where it can tell; nothing in the model can hold any of it.
 * - **Every string is put in NFC** (CNT-056), so identical text compares and hashes alike.
 * - **Empty runs of text are dropped, then a second empty paragraph beside another** (CNT-023). One
 *   empty paragraph stays: a cursor needs somewhere to be (CNT-124).
 * - **The language the content came from is kept** as a language mark over its text, where it differs
 *   from the receiving component's. A direction that differs cannot be kept - the model has no member
 *   for a run's direction - so it is reported rather than dropped in silence.
 *
 * Every rewrite and every drop is counted and reported. The spike's importer dropped three empty
 * paragraphs and did not count them.
 */
export function normalise(
  candidate: Record<string, unknown>,
  receiver: ContentDocument,
  report: ReportCollector,
): Record<string, unknown> {
  const tally: Tally = {
    typeface: 0,
    size: 0,
    colour: 0,
    appearance: new Map(),
    unicode: 0,
    emptyText: 0,
    emptyParagraph: 0,
  };
  const { language, direction, ...rest } = visit(candidate, tally) as Record<string, unknown>;
  let normalised: Record<string, unknown> = rest;

  for (const subject of ['typeface', 'size', 'colour'] as const) {
    if (tally[subject] > 0)
      report.add('normalise', 'discarded', subject, { count: tally[subject] });
  }
  for (const [property, count] of tally.appearance) {
    report.add('normalise', 'discarded', 'appearance', {
      count,
      ...(property === '' ? {} : { detail: property }),
    });
  }
  if (tally.unicode > 0) report.add('normalise', 'rewritten', 'unicode', { count: tally.unicode });
  if (tally.emptyText > 0) {
    report.add('normalise', 'discarded', 'emptyText', { count: tally.emptyText });
  }
  if (tally.emptyParagraph > 0) {
    report.add('normalise', 'discarded', 'emptyParagraph', { count: tally.emptyParagraph });
  }

  if (typeof language === 'string' && language !== receiver.language) {
    if (markSchema.safeParse({ type: 'language', id: 'probe', tag: language }).success) {
      normalised = withLanguage(normalised, language) as Record<string, unknown>;
      report.add('normalise', 'rewritten', 'language', { detail: language });
    } else {
      report.add('normalise', 'discarded', 'language', { detail: language });
    }
  }
  if (typeof direction === 'string' && direction !== receiver.direction) {
    report.add('normalise', 'discarded', 'direction', { detail: direction });
  }
  return normalised;
}

type Tally = {
  typeface: number;
  size: number;
  colour: number;
  /** Other formatting, by the property name the reader gave it; '' where it gave none. */
  appearance: Map<string, number>;
  unicode: number;
  emptyText: number;
  emptyParagraph: number;
};

function visit(value: unknown, tally: Tally): unknown {
  if (typeof value === 'string') {
    const nfc = value.normalize('NFC');
    if (nfc !== value) tally.unicode += 1;
    return nfc;
  }
  if (Array.isArray(value)) {
    const members = value
      .map((member) => visit(member, tally))
      .filter((member) => {
        if (!isNode(member, 'text') || member.value !== '') return true;
        tally.emptyText += 1;
        return false;
      });
    return members.filter((member, index) => {
      const previous = members[index - 1];
      if (!isEmptyParagraph(member) || !isEmptyParagraph(previous)) return true;
      tally.emptyParagraph += 1;
      return false;
    });
  }
  if (typeof value !== 'object' || value === null) return value;

  // Entries rather than assignment, so a member named `__proto__` stays a member: validation refuses
  // it, rather than the setter swallowing it without a report entry.
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, member]) => {
      if (key !== 'presentation') return [[key, visit(member, tally)]];
      countPresentation(member, tally);
      return [];
    }),
  );
}

function countPresentation(presentation: unknown, tally: Tally): void {
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    tally.appearance.set('', (tally.appearance.get('') ?? 0) + 1);
    return;
  }
  for (const property of Object.keys(presentation)) {
    if (property === 'typeface' || property === 'size' || property === 'colour') {
      tally[property] += 1;
    } else {
      tally.appearance.set(property, (tally.appearance.get(property) ?? 0) + 1);
    }
  }
}

function withLanguage(value: unknown, tag: string): unknown {
  if (Array.isArray(value)) return value.map((member) => withLanguage(member, tag));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, withLanguage(member, tag)]),
  );
  if (isNode(out, 'text')) {
    const marks = Array.isArray(out.marks) ? out.marks : [];
    if (!marks.some((mark) => isNode(mark, 'language'))) {
      out.marks = [...marks, { type: 'language', tag }];
    }
  }
  return out;
}

function isNode(value: unknown, type: string): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === type
  );
}

function isEmptyParagraph(value: unknown): boolean {
  return isNode(value, 'paragraph') && Array.isArray(value.content) && value.content.length === 0;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/normalise.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/normalise.ts packages/domain/src/content/admission/normalise.test.ts
git commit -m "Normalise admitted content: no formatting, one Unicode form, no spacing paragraphs"
```

---

## Task 8: The re-identify stage

**Files:**

- Create: `packages/domain/src/content/admission/reidentify.ts`
- Test: `packages/domain/src/content/admission/reidentify.test.ts`

**Interfaces:**

- Consumes: `type ContentDocument`; `type StageResult` (task 6); `ReportCollector` (task 1).
- Produces:
  - `type Receiver = { document: ContentDocument; conditionAxes: readonly string[]; newIdentifier: () => string }`
  - `reidentify(candidate: Record<string, unknown>, receiver: Receiver, report: ReportCollector): StageResult<Record<string, unknown>>`

See decision 12. No identifier is cited: CNT-132, CNT-133 and CNT-135 are about content copied within the
product and pasted, which task 10 shows through the clipboard and the whole pipeline.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/reidentify.test.ts
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { reidentify, type Receiver } from './reidentify.js';
import { createReport } from './report.js';

const document: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'n1',
      style: 'body',
      content: [{ type: 'text', value: 'Leeds', marks: [{ type: 'strong', id: 'n2' }] }],
    },
  ],
};

/** Hands out n1, n2, n3... in order, so a test can see which identifiers were drawn again. */
const counter = (): (() => string) => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

const receiver = (overrides: Partial<Receiver> = {}): Receiver => ({
  document,
  conditionAxes: [],
  newIdentifier: counter(),
  ...overrides,
});

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (id: string | undefined, content: unknown[]) => ({
  type: 'paragraph',
  ...(id === undefined ? {} : { id }),
  style: 'body',
  content,
});

const run = (candidate: Record<string, unknown>, to: Receiver = receiver()) => {
  const report = createReport();
  const outcome = reidentify(candidate, to, report);
  return { outcome, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the re-identify stage', () => {
  it('gives every block a new identifier, skipping those the receiving component holds', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [paragraph('n1', [text('Copied')]), paragraph(undefined, [text('Foreign')])],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [paragraph('n3', [text('Copied')]), paragraph('n4', [text('Foreign')])],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
    ]);
  });

  it('reaches blocks inside lists, tables, quotations and footnotes', () => {
    const { outcome } = run({
      schemaVersion: 1,
      content: [
        {
          type: 'list',
          id: 'old-list',
          kind: 'unordered',
          items: [{ content: [paragraph('old-item', [text('Item')])] }],
        },
        {
          type: 'table',
          id: 'old-table',
          caption: 'Sites',
          headerRows: 0,
          headerColumns: 0,
          note: [text('Note')],
          rows: [
            {
              cells: [{ content: [paragraph('old-cell', [text('York')])], colspan: 1, rowspan: 1 }],
            },
          ],
        },
        {
          type: 'blockquote',
          id: 'old-quote',
          content: [
            paragraph('old-quoted', [
              {
                type: 'footnote',
                id: 'old-note',
                anchor: { kind: 'span' },
                content: [paragraph('old-note-paragraph', [text('Source')])],
              },
            ]),
          ],
          attribution: [text('Ada')],
        },
      ],
    });
    const ids: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (typeof value !== 'object' || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') ids.push(record.id);
      Object.values(record).forEach(collect);
    };
    collect(outcome.ok ? outcome.value : undefined);
    expect(ids).toEqual(['n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']);
  });

  it('gives every mark a new identifier, and the fragments of one annotation one between them', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('One ', [
            { type: 'emphasis', id: 'm1' },
            { type: 'language', id: 'm2', tag: 'fr-FR' },
          ]),
          text('two', [{ type: 'emphasis', id: 'm1' }]),
          text('three', [{ type: 'strong' }]),
        ]),
      ],
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        content: [
          paragraph('n3', [
            text('One ', [
              { type: 'emphasis', id: 'n4' },
              { type: 'language', id: 'n5', tag: 'fr-FR' },
            ]),
            text('two', [{ type: 'emphasis', id: 'n4' }]),
            text('three', [{ type: 'strong', id: 'n6' }]),
          ]),
        ],
      },
    });
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 3 },
    ]);
  });

  it('does not merge two marks of different types that arrive with one identifier', () => {
    const { outcome } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('x', [
            { type: 'emphasis', id: 'same' },
            { type: 'strong', id: 'same' },
          ]),
        ]),
      ],
    });
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [
        text('x', [
          { type: 'emphasis', id: 'n4' },
          { type: 'strong', id: 'n5' },
        ]),
      ]),
    ]);
  });

  it('drops comments and suggestions, one entry for each annotation however many runs it covers', () => {
    const { outcome, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph('b', [
          text('Kept ', [{ type: 'comment', id: 'c1', threadId: 't1' }]),
          text('text', [
            { type: 'comment', id: 'c1', threadId: 't1' },
            { type: 'suggestion', id: 's1', operation: 'delete', author: 'Grace' },
          ]),
        ]),
      ],
    });
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [text('Kept ', []), text('text', [])]),
    ]);
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('drops a condition whose axis the space lacks, and keeps one whose axis it has', () => {
    const { outcome, entries } = run(
      {
        schemaVersion: 1,
        content: [
          paragraph('b', [
            text('UK only', [
              { type: 'condition', id: 'k1', axis: 'jurisdiction', values: ['uk'] },
            ]),
            text('Vets only', [
              { type: 'condition', id: 'k2', axis: 'audience', values: ['vets'] },
            ]),
          ]),
        ],
      },
      receiver({ conditionAxes: ['audience'] }),
    );
    expect(outcome.ok && outcome.value.content).toEqual([
      paragraph('n3', [
        text('UK only', []),
        text('Vets only', [{ type: 'condition', id: 'n4', axis: 'audience', values: ['vets'] }]),
      ]),
    ]);
    expect(entries).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'condition', detail: 'jurisdiction' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('refuses when the allocator keeps returning identifiers already used', () => {
    const { outcome, entries } = run(
      { schemaVersion: 1, content: [paragraph('b', [text('x')])] },
      receiver({ newIdentifier: () => 'n1' }),
    );
    expect(outcome).toEqual({
      ok: false,
      failure: '8 identifiers in a row were empty or already used in the receiving component',
    });
    expect(entries).toEqual([{ stage: 'reidentify', action: 'refused', subject: 'identifiers' }]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/reidentify.test.ts`
Expected: FAIL - `Error: Cannot find module './reidentify.js'`.

- [ ] **Step 3: Write the stage**

```ts
// packages/domain/src/content/admission/reidentify.ts
import type { ContentDocument } from '../model/document.js';

import type { StageResult } from './migrate.js';
import type { ReportCollector } from './report.js';

/** The component content is being admitted into, and what it needs from its caller. */
export type Receiver = {
  readonly document: ContentDocument;
  /**
   * The condition axes the receiving space has. None exists before REU designs them, so every caller
   * passes `[]` today and every condition is dropped and reported - CNT-Q14's recommendation.
   */
  readonly conditionAxes: readonly string[];
  /**
   * A new identifier, never used before. The caller's, not this package's: the editor's identity
   * plugin allocates 128 random bits, and a platform-free package has no source of randomness it
   * could own. An identifier already in the component, or already allocated here, is drawn again.
   */
  readonly newIdentifier: () => string;
};

/** How many times an identifier that is empty or already used is drawn again before giving up. */
const ATTEMPTS = 8;

class AllocationFailed extends Error {}

/**
 * The fifth stage, over content in the current schema's terms (migrate has run).
 *
 * - **Every block and every footnote gets a new identifier** (CNT-132), unique within the receiving
 *   component. A copied identifier is never kept, even where the receiving component lacks it: a
 *   duplicate is not a visible defect, and comparison would report a copy as a move for ever.
 * - **Every mark gets a new identifier**, and fragments of one annotation - the same type and the
 *   same identifier on several runs - get the same new one, so it stays one annotation (CNT-004).
 * - **Comments and suggestions are dropped**, one report entry for each annotation rather than each
 *   fragment (CNT-133): their threads and authors belong to the component they were made on. The
 *   text they covered stays as it stood. **A condition whose axis the space lacks is dropped too.**
 */
export function reidentify(
  candidate: Record<string, unknown>,
  receiver: Receiver,
  report: ReportCollector,
): StageResult<Record<string, unknown>> {
  const state: State = {
    taken: identifiersIn(receiver.document),
    axes: new Set(receiver.conditionAxes),
    newIdentifier: receiver.newIdentifier,
    report,
    marks: new Map(),
    dropped: new Set(),
    blocks: 0,
  };
  try {
    const content = mapArray(candidate.content, (block) => reidentifyBlock(block, state));
    if (state.blocks > 0) {
      report.add('reidentify', 'rewritten', 'blockIdentifier', { count: state.blocks });
    }
    if (state.marks.size > 0) {
      report.add('reidentify', 'rewritten', 'markIdentifier', { count: state.marks.size });
    }
    return { ok: true, value: { ...candidate, content } };
  } catch (error) {
    if (!(error instanceof AllocationFailed)) throw error;
    report.add('reidentify', 'refused', 'identifiers');
    return { ok: false, failure: error.message };
  }
}

type State = {
  readonly taken: Set<string>;
  readonly axes: ReadonlySet<string>;
  readonly newIdentifier: () => string;
  readonly report: ReportCollector;
  /** New mark identifiers, by the type and identifier the mark arrived with. */
  readonly marks: Map<string, string>;
  /** Annotations already reported as dropped, by type and identifier. */
  readonly dropped: Set<string>;
  blocks: number;
};

/** Every identifier a document holds: its blocks', its footnotes' and its marks'. */
function identifiersIn(document: ContentDocument): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const member of value) walk(member);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') found.add(record.id);
    for (const member of Object.values(record)) walk(member);
  };
  walk(document.content);
  return found;
}

function allocate(state: State): string {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const identifier = state.newIdentifier();
    if (typeof identifier === 'string' && identifier !== '' && !state.taken.has(identifier)) {
      state.taken.add(identifier);
      return identifier;
    }
  }
  throw new AllocationFailed(
    `${ATTEMPTS} identifiers in a row were empty or already used in the receiving component`,
  );
}

function mapArray(value: unknown, map: (member: unknown) => unknown[]): unknown {
  return Array.isArray(value) ? value.flatMap(map) : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function reidentifyBlock(value: unknown, state: State): unknown[] {
  const block = asRecord(value);
  if (!block) return [value];
  const out: Record<string, unknown> = { ...block, id: allocate(state) };
  state.blocks += 1;
  const blocks = (member: unknown) => mapArray(member, (child) => reidentifyBlock(child, state));
  const inlines = (member: unknown) => mapArray(member, (child) => reidentifyInline(child, state));

  if (block.type === 'paragraph') out.content = inlines(block.content);
  if (block.type === 'blockquote') {
    out.content = blocks(block.content);
    if ('attribution' in block) out.attribution = inlines(block.attribution);
  }
  if (block.type === 'list') {
    out.items = mapArray(block.items, (item) => {
      const record = asRecord(item);
      return [record ? { ...record, content: blocks(record.content) } : item];
    });
  }
  if (block.type === 'table') {
    out.rows = mapArray(block.rows, (row) => {
      const record = asRecord(row);
      if (!record) return [row];
      const cells = mapArray(record.cells, (cell) => {
        const cellRecord = asRecord(cell);
        return [cellRecord ? { ...cellRecord, content: blocks(cellRecord.content) } : cell];
      });
      return [{ ...record, cells }];
    });
    if ('note' in block) out.note = inlines(block.note);
  }
  return [out];
}

function reidentifyInline(value: unknown, state: State): unknown[] {
  const inline = asRecord(value);
  if (!inline) return [value];
  if (inline.type === 'text') {
    return [{ ...inline, marks: mapArray(inline.marks, (mark) => reidentifyMark(mark, state)) }];
  }
  if (inline.type === 'footnote') {
    const id = allocate(state);
    state.blocks += 1;
    return [
      {
        ...inline,
        id,
        content: mapArray(inline.content, (block) => reidentifyBlock(block, state)),
      },
    ];
  }
  return [inline];
}

function reidentifyMark(value: unknown, state: State): unknown[] {
  const mark = asRecord(value);
  if (!mark) return [value];
  const key = typeof mark.id === 'string' ? `${String(mark.type)}\u{0}${mark.id}` : undefined;
  const firstSighting = key === undefined || !state.dropped.has(key);

  if (mark.type === 'comment' || mark.type === 'suggestion') {
    if (firstSighting) state.report.add('reidentify', 'discarded', mark.type);
    if (key !== undefined) state.dropped.add(key);
    return [];
  }
  if (mark.type === 'condition' && !(typeof mark.axis === 'string' && state.axes.has(mark.axis))) {
    if (firstSighting) {
      state.report.add(
        'reidentify',
        'discarded',
        'condition',
        typeof mark.axis === 'string' ? { detail: mark.axis } : {},
      );
    }
    if (key !== undefined) state.dropped.add(key);
    return [];
  }

  if (key === undefined) {
    const id = allocate(state);
    state.marks.set(`\u{0}${id}`, id);
    return [{ ...mark, id }];
  }
  let id = state.marks.get(key);
  if (id === undefined) {
    id = allocate(state);
    state.marks.set(key, id);
  }
  return [{ ...mark, id }];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/reidentify.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/reidentify.ts packages/domain/src/content/admission/reidentify.test.ts
git commit -m "Re-identify admitted blocks, footnotes and marks, and drop annotations that do not travel"
```

---

## Task 9: The pipeline, in order, validated last

**Files:**

- Create: `packages/domain/src/content/admission/admit.ts`
- Test: `packages/domain/src/content/admission/admit.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `exceedsLimits` (task 2), `sanitise` (task 5), `migrateCandidate` (task 6), `normalise` (task 7), `reidentify` and `Receiver` (task 8), `createReport` and `ReportEntry` (task 1); `parseContentDocument`, `CURRENT_SCHEMA_VERSION` and `type BlockNode` from the model.
- Produces:
  - `type AdmissionInput = { candidate: unknown; report: readonly ReportEntry[] }`
  - `type AdmissionRefusal = 'oversized' | 'unreadable' | 'schemaVersion' | 'identifiers' | 'invalid' | 'empty'`
  - `type AdmissionRefused = { ok: false; refusal: AdmissionRefusal; failure: string; report: readonly ReportEntry[] }`
  - `type AdmissionOutcome = { ok: true; content: readonly BlockNode[]; report: readonly ReportEntry[] } | AdmissionRefused`
  - `admit(input: AdmissionInput, receiver: Receiver): AdmissionOutcome`

See decisions 2, 3, 5 and 13. This task cites six identifiers; check each title against
`pnpm trace show` before committing.

**Three tests make the design's order observable**, and each fails if its stage moves: a script dressed as
formatting is reported as `executableStyle` before any `normalise` entry; content carrying `presentation`
is admitted, which it would not be if validation read what arrived; and a report's stages never go
backwards. The fourth order - migrate before re-identify - cannot be observed with one schema version, and
decision 10 names the plan where it can.

**Adversarial fixtures end to end:** every construct task 5 removes, eight link spellings, a combining mark
set to fuse with a tag, nesting 100,000 deep carrying a handler that must never be reported, content the
model cannot hold beside content it can, content left empty, an allocator that only returns a used
identifier, and a member named `__proto__`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/admit.test.ts
import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { admit, type AdmissionInput } from './admit.js';
import { MATHML_NAMESPACE } from './mathml.js';
import type { Receiver } from './reidentify.js';
import { admissionStages, readerEntry, type ReportEntry } from './report.js';

const document: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: 'Leeds', marks: [{ type: 'strong', id: 'm1' }] }],
    },
  ],
};

const receiver = (): Receiver => {
  let next = 0;
  return { document, conditionAxes: [], newIdentifier: () => `a${(next += 1)}` };
};

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  style: 'body',
  content,
  ...extra,
});
const foreign = (content: unknown[], report: ReportEntry[] = []): AdmissionInput => ({
  candidate: { schemaVersion: 1, content },
  report,
});

/** The report without its messages, which report.test.ts pins; what happened is what these assert. */
const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('admitting content', () => {
  it('admits clean content as blocks for the receiving component, reporting the new identifiers', () => {
    const outcome = admit(foreign([paragraph([text('York', [{ type: 'emphasis' }])])]), receiver());
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([text('York', [{ type: 'emphasis', id: 'a2' }])], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('never stores a script, an event handler, an embedded object or a link whose scheme is not allowlisted', () => {
    const outcome = admit(
      foreign([
        { type: 'script', name: 'script' },
        paragraph(
          [
            text('Open ', []),
            text('this', [{ type: 'hyperlink', href: 'javascript:alert(1)' }]),
            {
              type: 'equation',
              mathml: '<math><mi href="javascript:alert(2)" onclick="alert(3)">x</mi></math>',
            },
          ],
          { handlers: ['onclick'] },
        ),
        { type: 'embeddedObject', name: 'iframe' },
      ]),
      receiver(),
    );

    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Open '),
          text('this'),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
    ]);
    expect(JSON.stringify(outcome.ok && outcome.content)).not.toMatch(
      /script|onclick|iframe|embeddedObject|handlers|href/,
    );
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(2)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'iframe' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  // One `it` rather than `it.each`: the trace reads a citation from a title written as a string
  // literal, and `it.each(...)('...')` puts the table between the call and the title.
  it('CNT-127 refuses a link whose scheme is not allowlisted on entry, however it is spelled, and never stores it', () => {
    for (const href of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      '\u{1}javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'ftp://example.test/file',
      'file:///C:/Users/Ada/notes.txt',
    ]) {
      const outcome = admit(
        foreign([paragraph([text('Notes', [{ type: 'hyperlink', href }])])]),
        receiver(),
      );
      expect(outcome.ok && outcome.content, href).toEqual([
        paragraph([text('Notes')], { id: 'a1' }),
      ]);
      expect(happened(outcome.report), href).toEqual([
        { stage: 'sanitise', action: 'discarded', subject: 'hyperlink', detail: href },
        { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      ]);
    }
  });

  it('CNT-131 names each link it dropped or rewrote in the report, with the target it had', () => {
    const outcome = admit(
      foreign([
        paragraph([
          text('one', [{ type: 'hyperlink', href: 'javascript:void(0)' }]),
          text('two', [{ type: 'hyperlink', href: 'javascript:void(0)' }]),
          text('three', [{ type: 'hyperlink', href: 'https://example.test/\na' }]),
          text('four', [{ type: 'hyperlink', href: 'https://example.test/kept' }]),
        ]),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('one'),
          text('two'),
          text('three', [{ type: 'hyperlink', id: 'a2', href: 'https://example.test/a' }]),
          text('four', [{ type: 'hyperlink', id: 'a3', href: 'https://example.test/kept' }]),
        ],
        { id: 'a1' },
      ),
    ]);
    expect(happened(outcome.report)).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:void(0)',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:void(0)',
      },
      {
        stage: 'sanitise',
        action: 'rewritten',
        subject: 'hyperlink',
        detail: 'https://example.test/\na',
      },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 2 },
    ]);
  });

  it('CNT-065 carries no typeface, size or colour into the model, from text or from an equation', () => {
    const outcome = admit(
      foreign([
        paragraph(
          [
            {
              ...text('Warning'),
              presentation: { typeface: 'Leeds Sans', size: '18pt', colour: '#c00' },
            },
            { type: 'equation', mathml: '<math><mi mathcolor="#c00" mathsize="2em">x</mi></math>' },
          ],
          { presentation: { colour: 'red' } },
        ),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Warning'),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathcolor' },
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathsize' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'size', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 2 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('CNT-056 stores text in one Unicode normalisation form', () => {
    const outcome = admit(foreign([paragraph([text('Cafe\u{301} in Leeds')])]), receiver());
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([text('Caf\u{E9} in Leeds')], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('keeps an equation in the form sanitise wrote, which NFC cannot turn back into markup', () => {
    const outcome = admit(
      foreign([
        paragraph([
          { type: 'equation', mathml: '<math><mi>\u{338} onmouseover=alert(1) x=</mi></math>' },
        ]),
      ]),
      receiver(),
    );
    const stored = `<math xmlns="${MATHML_NAMESPACE}"><mi>&#x338; onmouseover=alert(1) x=</mi></math>`;
    expect(outcome.ok && outcome.content).toEqual([
      paragraph([{ type: 'equation', mathml: stored }], { id: 'a1' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('sanitises before it normalises, so a script dressed as formatting is reported as a script', () => {
    const outcome = admit(
      foreign([
        paragraph([text('x')], {
          presentation: { typeface: 'Leeds Sans', width: 'expression(alert(1))' },
        }),
      ]),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('x')], { id: 'a1' })]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'width' },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('validates last, over what the stages produced rather than what arrived', () => {
    // `presentation` is not a member the model defines; validating what arrived would refuse it.
    const outcome = admit(
      foreign([paragraph([text('x')], { presentation: { size: '9pt' } })]),
      receiver(),
    );
    expect(outcome.ok).toBe(true);
    expect(happened(outcome.report).map((entry) => entry.stage)).toEqual([
      'normalise',
      'reidentify',
    ]);
  });

  it('reports in the order the stages ran, after what the reader could not represent', () => {
    const outcome = admit(
      foreign(
        [
          paragraph([text('Cafe\u{301}', [{ type: 'comment', id: 'c1', threadId: 't1' }])], {
            handlers: ['onclick'],
          }),
        ],
        [readerEntry('a heading')],
      ),
      receiver(),
    );
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('Caf\u{E9}')], { id: 'a1' })]);
    const stages = outcome.report.map((entry) => admissionStages.indexOf(entry.stage));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'a heading' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });

  it('CNT-064 names in the report everything it removed, and the test asserts both halves', () => {
    const outcome = admit(
      {
        candidate: {
          schemaVersion: 1,
          language: 'en-GB',
          direction: 'ltr',
          content: [
            { type: 'script', name: 'script' },
            paragraph(
              [
                text('Visit '),
                text('the site', [{ type: 'hyperlink', href: 'javascript:alert(1)' }]),
                text(' or '),
                text('the guide', [
                  { type: 'hyperlink', href: 'https://example.test/guide', handlers: ['onclick'] },
                ]),
                {
                  type: 'equation',
                  mathml: '<math><mi mathcolor="red" onmouseover="alert(2)">x</mi></math>',
                },
              ],
              {
                handlers: ['onload'],
                presentation: {
                  typeface: 'Leeds Sans',
                  colour: 'red',
                  width: 'expression(alert(3))',
                },
              },
            ),
            { type: 'embeddedObject', name: 'object' },
            paragraph([]),
            paragraph([text('')]),
            paragraph([
              text('Cafe\u{301}', [
                { type: 'comment', id: 'c1', threadId: 't1' },
                { type: 'suggestion', id: 's1', operation: 'insert', author: 'Grace' },
                { type: 'condition', id: 'k1', axis: 'jurisdiction', values: ['uk'] },
              ]),
            ]),
          ],
        },
        report: [readerEntry('an image')],
      },
      receiver(),
    );

    expect(outcome.ok && outcome.content).toEqual([
      paragraph(
        [
          text('Visit '),
          text('the site'),
          text(' or '),
          text('the guide', [{ type: 'hyperlink', id: 'a2', href: 'https://example.test/guide' }]),
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
        ],
        { id: 'a1' },
      ),
      paragraph([], { id: 'a3' }),
      paragraph([text('Caf\u{E9}')], { id: 'a4' }),
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'an image' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'mathAttribute', detail: 'mathcolor' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onmouseover' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onload' },
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'width' },
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'object' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 1 },
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyText', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyParagraph', count: 1 },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'discarded', subject: 'condition', detail: 'jurisdiction' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('leaves the reader output it was given untouched', () => {
    const input = foreign([
      paragraph([text('x', [{ type: 'hyperlink', href: 'javascript:alert(1)' }])]),
    ]);
    const arrived = structuredClone(input);
    const outcome = admit(input, receiver());
    expect(input).toEqual(arrived);
    expect(outcome.ok && outcome.content).toEqual([paragraph([text('x')], { id: 'a1' })]);
    expect(happened(outcome.report)).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
    ]);
  });
});

describe('refusing an admission', () => {
  it('CNT-134 refuses content from a schema version it cannot migrate, by name, and admits nothing', () => {
    const outcome = admit(
      { candidate: { schemaVersion: 2, content: [paragraph([text('x')])] }, report: [] },
      receiver(),
    );
    expect(outcome).toEqual({
      ok: false,
      refusal: 'schemaVersion',
      failure:
        "Stored content was written against schema version 2, which is newer than this build's 1",
      report: [
        {
          stage: 'migrate',
          action: 'refused',
          subject: 'schemaVersion',
          message:
            'Nothing was added, because the content was written in a version of the format this build cannot read.',
        },
      ],
    });
    expect(outcome).not.toHaveProperty('content');
  });

  it('refuses content the model cannot hold as a whole, rather than keeping the part it can', () => {
    const outcome = admit(
      foreign([
        paragraph([text('Kept?')], { handlers: ['onclick'] }),
        { type: 'heading', level: 1, content: [] },
      ]),
      receiver(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty('content');
    expect(!outcome.ok && outcome.refusal).toBe('invalid');
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 2 },
      { stage: 'validate', action: 'refused', subject: 'invalid' },
    ]);
  });

  it('refuses content with nothing left in it to keep, saying what was removed', () => {
    const outcome = admit(foreign([{ type: 'script', name: 'script' }]), receiver());
    expect(outcome).toMatchObject({ ok: false, refusal: 'empty' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'validate', action: 'refused', subject: 'empty' },
    ]);
  });

  it('refuses content nested past the limit before any stage walks it', () => {
    let nested: unknown = paragraph([text('x')], { handlers: ['onclick'] });
    for (let level = 0; level < 100_000; level += 1)
      nested = { type: 'blockquote', content: [nested] };
    const outcome = admit(foreign([nested], [readerEntry('a table')]), receiver());
    expect(outcome).toMatchObject({
      ok: false,
      refusal: 'oversized',
      failure: 'The content holds nested more than 128 deep',
    });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable', detail: 'a table' },
      { stage: 'sanitise', action: 'refused', subject: 'oversized' },
    ]);
  });

  it('refuses when no new identifier can be allocated, and admits nothing', () => {
    const outcome = admit(foreign([paragraph([text('x')])]), {
      ...receiver(),
      newIdentifier: () => 'b1',
    });
    expect(outcome).toMatchObject({ ok: false, refusal: 'identifiers' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'refused', subject: 'identifiers' },
    ]);
  });

  it('refuses a member named __proto__ rather than losing it without a report entry', () => {
    // JSON.parse makes `__proto__` an ordinary member. Copied by assignment it would call the
    // prototype setter instead, and the member would disappear with nothing said about it.
    const input: AdmissionInput = {
      candidate: JSON.parse(
        '{"schemaVersion":1,"content":[{"type":"paragraph","style":"body","content":[],"__proto__":{"polluted":true}}]}',
      ),
      report: [],
    };
    const outcome = admit(input, receiver());
    expect(outcome).toMatchObject({ ok: false, refusal: 'invalid' });
    expect(outcome).not.toHaveProperty('content');
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'validate', action: 'refused', subject: 'invalid' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/admit.test.ts`
Expected: FAIL - `Error: Cannot find module './admit.js'`.

- [ ] **Step 3: Write the pipeline**

```ts
// packages/domain/src/content/admission/admit.ts
import type { BlockNode } from '../model/blocks.js';
import { CURRENT_SCHEMA_VERSION, parseContentDocument } from '../model/document.js';

import { exceedsLimits } from './limits.js';
import { migrateCandidate } from './migrate.js';
import { normalise } from './normalise.js';
import { reidentify, type Receiver } from './reidentify.js';
import { createReport, type ReportEntry } from './report.js';
import { sanitise } from './sanitise.js';

/**
 * What a reader hands the pipeline: a content-document-shaped value and what the reader itself could
 * not represent. There is no member naming the source, on purpose - one pipeline serves a foreign
 * paste and an internal copy (CNT-135), and a pipeline that knew which it had would be two.
 *
 * `candidate` is `{ schemaVersion, content, language?, direction? }`, where `language` and
 * `direction` are the source's own. It is untrusted, whoever built it, and walked as plain JSON until
 * validation. Beyond the model's own nodes and marks, a reader uses exactly this vocabulary for what
 * the pipeline must remove, and never removes it itself - so that sanitising happens in one place,
 * on one set of terms:
 *
 * - `{ type: 'script', name }` and `{ type: 'embeddedObject', name }`, wherever a node can stand;
 * - `handlers: string[]`, the event handler names, on any node or mark;
 * - `presentation: { typeface?, size?, colour?, [other]: string }` on any node;
 * - a `hyperlink` mark with whatever target arrived, and an equation's MathML as it arrived;
 * - any block, footnote or mark without an `id`.
 *
 * Anything else the model does not define is not removed. Validation refuses it, and with it the
 * whole admission.
 */
export type AdmissionInput = {
  readonly candidate: unknown;
  readonly report: readonly ReportEntry[];
};

export type AdmissionRefusal =
  'oversized' | 'unreadable' | 'schemaVersion' | 'identifiers' | 'invalid' | 'empty';

export type AdmissionRefused = {
  readonly ok: false;
  readonly refusal: AdmissionRefusal;
  /** For the developer. The author is shown the report, whose last entry says why. */
  readonly failure: string;
  readonly report: readonly ReportEntry[];
};

export type AdmissionOutcome =
  | {
      readonly ok: true;
      readonly content: readonly BlockNode[];
      readonly report: readonly ReportEntry[];
    }
  | AdmissionRefused;

/**
 * The admission pipeline: sanitise, migrate, normalise, re-identify, validate, in that order, with one
 * report threaded through them all and returned with the content (CNT-063). The order is load-bearing:
 * sanitise before normalise, so nothing hostile is rewritten into something that passes; migrate
 * before re-identify, so identifiers are allocated in the current schema's terms; validate last, over
 * what the others produced rather than what arrived.
 *
 * An outcome, never an exception, and never part of the content: either every block that survived,
 * validated as a whole, or a named refusal and nothing (CNT-010). The blocks are for the caller to
 * place in the receiving component - where a paste lands is the editor's.
 */
export function admit(input: AdmissionInput, receiver: Receiver): AdmissionOutcome {
  const report = createReport(input.report);
  const refuse = (refusal: AdmissionRefusal, failure: string): AdmissionRefused => ({
    ok: false,
    refusal,
    failure,
    report: report.entries,
  });

  const oversized = exceedsLimits(input.candidate);
  if (oversized !== undefined) {
    report.add('sanitise', 'refused', 'oversized');
    return refuse('oversized', `The content holds ${oversized}`);
  }

  const sanitised = sanitise(input.candidate, report);

  const migrated = migrateCandidate(sanitised, report);
  if (!migrated.ok) return refuse('schemaVersion', migrated.failure);

  const normalised = normalise(migrated.value, receiver.document, report);

  const identified = reidentify(normalised, receiver, report);
  if (!identified.ok) return refuse('identifiers', identified.failure);

  const content = identified.value.content;
  if (Array.isArray(content) && content.length === 0) {
    report.add('validate', 'refused', 'empty');
    return refuse('empty', 'Nothing was left to admit');
  }
  try {
    const { title, language, direction } = receiver.document;
    const document = parseContentDocument({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      title,
      language,
      direction,
      content,
    });
    return { ok: true, content: document.content, report: report.entries };
  } catch (error) {
    report.add('validate', 'refused', 'invalid');
    return refuse('invalid', error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/admit.test.ts`
Expected: PASS, 18 tests.

Then check the `__proto__` test is doing its job: in `sanitise.ts`, temporarily replace
`return Object.fromEntries(members);` with
`const out: Record<string, unknown> = {}; for (const [key, value] of members) out[key] = value; return out;`
and watch `refuses a member named __proto__` fail with the admission accepted. Restore it.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.` Change the pin to `toHaveLength(119)` - CNT-056, CNT-064, CNT-065,
CNT-127, CNT-131 and CNT-134 in `admit.test.ts`.

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission packages/trace/src/trace.test.ts
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/admit.ts packages/domain/src/content/admission/admit.test.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Admit content through every stage in order, validating last"
```

---

## Task 10: The product clipboard, and copying within the product

**Files:**

- Create: `packages/domain/src/content/admission/clipboard.ts`
- Test: `packages/domain/src/content/admission/clipboard.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `admit`, `AdmissionInput`, `AdmissionRefused` (task 9); `admissionLimits` (task 2); `createReport` (task 1); `type BlockNode`, `type ContentDocument` from the model.
- Produces:
  - `PRODUCT_CLIPBOARD_FORMAT = 'alloy-works/content'`
  - `writeProductClipboard(source: ContentDocument, blocks: readonly BlockNode[]): string`
  - `type ReaderResult = { ok: true; input: AdmissionInput } | AdmissionRefused`
  - `readProductClipboard(text: string): ReaderResult`

See decision 14. This task cites three identifiers - CNT-132, CNT-133 and CNT-135 - each through the
writer, the reader and the whole pipeline together, because each statement is about content copied within
the product and pasted.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/content/admission/clipboard.test.ts
import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../model/blocks.js';
import type { ContentDocument } from '../model/document.js';

import { admit, type AdmissionInput } from './admit.js';
import {
  PRODUCT_CLIPBOARD_FORMAT,
  readProductClipboard,
  writeProductClipboard,
} from './clipboard.js';
import { admissionLimits } from './limits.js';
import type { Receiver } from './reidentify.js';
import type { ReportEntry } from './report.js';

const copied: BlockNode[] = [
  {
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: [
      {
        type: 'text',
        value: 'Inspect ',
        marks: [
          { type: 'emphasis', id: 'e1' },
          { type: 'comment', id: 'c1', threadId: 'thread-7' },
        ],
      },
      {
        type: 'text',
        value: 'weekly',
        marks: [
          { type: 'comment', id: 'c1', threadId: 'thread-7' },
          { type: 'suggestion', id: 's1', operation: 'replace', author: 'Grace' },
        ],
      },
    ],
  },
  {
    type: 'list',
    id: 'l1',
    kind: 'ordered',
    items: [{ content: [{ type: 'paragraph', id: 'p2', style: 'body', content: [] }] }],
  },
];

const source: ContentDocument = {
  schemaVersion: 1,
  title: 'Leeds site',
  language: 'en-GB',
  direction: 'ltr',
  content: copied,
};

const target: ContentDocument = {
  schemaVersion: 1,
  title: 'York site',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'y1', style: 'body', content: [] }],
};

const into = (document: ContentDocument): Receiver => {
  let next = 0;
  return { document, conditionAxes: [], newIdentifier: () => `z${(next += 1)}` };
};

const read = (text: string): AdmissionInput => {
  const result = readProductClipboard(text);
  if (!result.ok) throw new Error(`expected the clipboard to read, got ${result.refusal}`);
  return result.input;
};

const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('the product clipboard', () => {
  it('writes copied blocks with the schema version, language and direction they were written in', () => {
    expect(JSON.parse(writeProductClipboard(source, copied))).toEqual({
      format: PRODUCT_CLIPBOARD_FORMAT,
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: copied,
    });
  });

  it('reads what it wrote back as a reader output, reporting nothing of its own', () => {
    expect(read(writeProductClipboard(source, copied))).toEqual({
      candidate: { schemaVersion: 1, language: 'en-GB', direction: 'ltr', content: copied },
      report: [],
    });
  });

  it.each([
    ['text that is not JSON', 'Inspect weekly'],
    ['JSON in another format', JSON.stringify({ format: 'text/html', content: [] })],
    ['JSON with no format', JSON.stringify({ schemaVersion: 1, content: [] })],
    ['a JSON array', '[]'],
  ])('refuses %s as unreadable', (_, text) => {
    const result = readProductClipboard(text);
    expect(result).toMatchObject({ ok: false, refusal: 'unreadable' });
    expect(result).not.toHaveProperty('input');
    expect(happened(result.ok ? [] : result.report)).toEqual([
      { stage: 'read', action: 'refused', subject: 'unreadable' },
    ]);
  });

  it('refuses text longer than one admission may hold, before parsing it', () => {
    const result = readProductClipboard(' '.repeat(admissionLimits.characters + 1));
    expect(result).toMatchObject({ ok: false, refusal: 'oversized' });
    expect(result).not.toHaveProperty('input');
    expect(happened(result.ok ? [] : result.report)).toEqual([
      { stage: 'read', action: 'refused', subject: 'oversized' },
    ]);
  });
});

describe('copying within the product', () => {
  it('CNT-132 gives every pasted block a new identifier, even pasted back into the component it came from', () => {
    const outcome = admit(read(writeProductClipboard(source, copied)), into(source));
    if (!outcome.ok) throw new Error(`expected an admission, got ${outcome.refusal}`);

    const blockIds = (blocks: readonly BlockNode[]): string[] =>
      blocks.flatMap((block) => [
        block.id,
        ...(block.type === 'list' ? block.items.flatMap((item) => blockIds(item.content)) : []),
      ]);
    const pasted = blockIds(outcome.content);
    expect(pasted).toEqual(['z1', 'z3', 'z4']);
    for (const id of blockIds(copied)) expect(pasted).not.toContain(id);
    expect(outcome.content[1]).toEqual({
      type: 'list',
      id: 'z3',
      kind: 'ordered',
      items: [{ content: [{ type: 'paragraph', id: 'z4', style: 'body', content: [] }] }],
    });
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('CNT-133 drops a comment anchor and a suggestion pasted into another component, and names each once', () => {
    const outcome = admit(read(writeProductClipboard(source, copied)), into(target));
    if (!outcome.ok) throw new Error(`expected an admission, got ${outcome.refusal}`);

    expect(outcome.content[0]).toEqual({
      type: 'paragraph',
      id: 'z1',
      style: 'body',
      content: [
        { type: 'text', value: 'Inspect ', marks: [{ type: 'emphasis', id: 'z2' }] },
        { type: 'text', value: 'weekly', marks: [] },
      ],
    });
    expect(JSON.stringify(outcome.content)).not.toMatch(/comment|suggestion|thread-7|Grace/);
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('CNT-135 reports a copy within the product to the same standard as a foreign paste of the same content', () => {
    const hostile = [
      ...copied,
      {
        type: 'paragraph',
        id: 'p3',
        style: 'body',
        handlers: ['onclick'],
        content: [
          {
            type: 'text',
            value: 'here',
            marks: [{ type: 'hyperlink', id: 'h1', href: 'javascript:alert(1)' }],
          },
        ],
      },
    ];
    const internal = admit(
      read(
        JSON.stringify({ format: PRODUCT_CLIPBOARD_FORMAT, schemaVersion: 1, content: hostile }),
      ),
      into(target),
    );
    const foreign = admit(
      { candidate: { schemaVersion: 1, content: hostile }, report: [] },
      into(target),
    );

    expect(internal).toEqual(foreign);
    expect(internal.ok && internal.content).toHaveLength(3);
    expect(happened(internal.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 4 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('marks text copied from a component in another language with the language it came from', () => {
    const french: ContentDocument = { ...source, language: 'fr-FR' };
    const outcome = admit(
      read(
        writeProductClipboard(french, [
          {
            type: 'paragraph',
            id: 'p9',
            style: 'body',
            content: [{ type: 'text', value: 'Bonjour', marks: [] }],
          },
        ]),
      ),
      into(target),
    );
    expect(outcome.ok && outcome.content).toEqual([
      {
        type: 'paragraph',
        id: 'z1',
        style: 'body',
        content: [
          { type: 'text', value: 'Bonjour', marks: [{ type: 'language', id: 'z2', tag: 'fr-FR' }] },
        ],
      },
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'language', detail: 'fr-FR' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/clipboard.test.ts`
Expected: FAIL - `Error: Cannot find module './clipboard.js'`.

- [ ] **Step 3: Write the reader and the writer**

```ts
// packages/domain/src/content/admission/clipboard.ts
import type { BlockNode } from '../model/blocks.js';
import type { ContentDocument } from '../model/document.js';

import type { AdmissionInput, AdmissionRefused } from './admit.js';
import { admissionLimits } from './limits.js';
import { createReport } from './report.js';

/**
 * The product's own clipboard: the one reader that needs no parser, because its format is the
 * model's. Copying writes the blocks with the schema version, base language and direction of the
 * component they came from; pasting reads that back as a reader's output for `admit`.
 *
 * It is trusted no further than any other source. Any page can put text on a clipboard claiming to
 * be this format, so what it reads goes through every stage a foreign paste does - which CNT-135
 * requires anyway - and this function only turns text into a candidate or says it could not.
 */
export const PRODUCT_CLIPBOARD_FORMAT = 'alloy-works/content';

export function writeProductClipboard(
  source: ContentDocument,
  blocks: readonly BlockNode[],
): string {
  return JSON.stringify({
    format: PRODUCT_CLIPBOARD_FORMAT,
    schemaVersion: source.schemaVersion,
    language: source.language,
    direction: source.direction,
    content: blocks,
  });
}

export type ReaderResult = { readonly ok: true; readonly input: AdmissionInput } | AdmissionRefused;

export function readProductClipboard(text: string): ReaderResult {
  const report = createReport();
  if (text.length > admissionLimits.characters) {
    report.add('read', 'refused', 'oversized');
    return {
      ok: false,
      refusal: 'oversized',
      failure: `The clipboard holds more than ${admissionLimits.characters} characters`,
      report: report.entries,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).format !== PRODUCT_CLIPBOARD_FORMAT
  ) {
    report.add('read', 'refused', 'unreadable');
    return {
      ok: false,
      refusal: 'unreadable',
      failure: `The clipboard does not hold ${PRODUCT_CLIPBOARD_FORMAT}`,
      report: report.entries,
    };
  }

  const candidate: Record<string, unknown> = { ...parsed };
  delete candidate.format;
  return { ok: true, input: { candidate, report: [] } };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain exec vitest run src/content/admission/clipboard.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.` Change the pin to `toHaveLength(122)`.

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src/content/admission packages/trace/src/trace.test.ts
pnpm --filter @alloy-works/domain typecheck
pnpm lint
git add packages/domain/src/content/admission/clipboard.ts packages/domain/src/content/admission/clipboard.test.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Copy and paste within the product through the admission pipeline"
```

---

## Task 11: Promote the pipeline to the package's public surface

**Files:**

- Create: `packages/domain/src/content/admission/index.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/index.test.ts`

**Interfaces:**

- Consumes: everything tasks 1 to 10 produce.
- Produces, from `@alloy-works/domain`: `admit`, `admissionLimits`, `readProductClipboard`,
  `writeProductClipboard`, `readerEntry`; and the types `AdmissionInput`, `AdmissionOutcome`,
  `AdmissionRefusal`, `AdmissionRefused`, `ReaderResult`, `Receiver`, `AdmissionStage`, `ReportAction`,
  `ReportEntry`.

See decision 15. `index.test.ts` pins runtime exports only; the types are for the editor and the readers.

- [ ] **Step 1: Pin the new surface, and watch it fail**

In `packages/domain/src/index.test.ts`, in the first test's list, after `'readContent',` add:

```ts
        // The admission pipeline, promoted in the plan that built it.
        'admissionLimits',
        'admit',
        'readProductClipboard',
        'readerEntry',
        'writeProductClipboard',
```

Run: `pnpm --filter @alloy-works/domain exec vitest run src/index.test.ts`
Expected: FAIL - `exports the content model and the metadata rules as its public surface`, the received
list missing the five names.

- [ ] **Step 2: Write the barrel and promote it**

```ts
// packages/domain/src/content/admission/index.ts
export { admit } from './admit.js';
export type {
  AdmissionInput,
  AdmissionOutcome,
  AdmissionRefusal,
  AdmissionRefused,
} from './admit.js';

export { readProductClipboard, writeProductClipboard } from './clipboard.js';
export type { ReaderResult } from './clipboard.js';

export { admissionLimits } from './limits.js';

export type { Receiver } from './reidentify.js';

export { readerEntry } from './report.js';
export type { AdmissionStage, ReportAction, ReportEntry } from './report.js';
```

In `packages/domain/src/index.ts`, after `export * from './content/model/index.js';` add:

```ts
// The admission pipeline: every paste, copy and import enters a component through it.
export * from './content/admission/index.js';
```

- [ ] **Step 3: Run the whole domain suite and the build**

```bash
pnpm --filter @alloy-works/domain test
pnpm build
```

Expected: the domain suite passes, 413 tests; the build succeeds, because `apps/web`, `packages/db` and
the service import the package's `dist/` and none of the new names collides with an existing export.

- [ ] **Step 4: Typecheck, lint, format, commit**

```bash
pnpm exec prettier --write packages/domain/src
pnpm typecheck
pnpm lint
git add packages/domain/src/content/admission/index.ts packages/domain/src/index.ts packages/domain/src/index.test.ts
git commit -m "Promote the admission pipeline to the domain package's public surface"
```

---

## Task 12: The trace, the docs and the release

**Files:**

- Modify: `packages/trace/src/trace.test.ts` (the pin's comment)
- Modify: `docs/architecture.md`, `docs/design/content-model.md` (the status note), `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Not modified: `docs/features.md` and `README.md` - see step 7

- [ ] **Step 1: Say where the pin came from**

In `packages/trace/src/trace.test.ts`, above `expect(model.citations).toHaveLength(122);`, add:

```ts
// 122, from 112: the admission pipeline (docs/plans/2026-09-15-content-model-02-the-admission-pipeline.md)
// cites nine of the requirements content-model.md claims for admission - CNT-056, CNT-064, CNT-065,
// CNT-127, CNT-131, CNT-132, CNT-133, CNT-134 and CNT-135 - ten times across three domain test files.
// CNT-130 and CNT-063 are built in part and left uncited, and the plan says what each waits for.
```

- [ ] **Step 2: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm --filter @alloy-works/trace test
```

Expected: `No problems in the corpus.`, and the trace suite passes.

- [ ] **Step 3: Report what moved, and do not overstate it**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm test
pnpm trace verify
pnpm trace stats
```

Expected, measured when this plan was written: `Covered` in T1 rises from 54 to 61 (CNT-064, CNT-065,
CNT-131, CNT-132, CNT-133, CNT-134, CNT-135) and Constraint stays at 17, and `pnpm trace verify` reports the
seven as `Verified` - in the sense the trace can prove, that a test naming each passed, and no larger:
nothing pastes through the pipeline yet, and no author has seen a report. `Verified` was not computed when
this plan was written, because the scratch run did not bring up the compose stack. If `main` has moved,
report what the commands say rather than these numbers.

- [ ] **Step 4: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 5: Describe the pipeline as built**

In `docs/architecture.md`, replace the status quote's first paragraph - the seven lines from
"> Status: scaffolding" to "> proved the path end to end, and is not a decision about content." - with:

```markdown
> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules
> and the version chain. The workspaces, the split between web and desktop, and the seam between them are
> real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - and the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain). Nothing authors, pastes, cuts or publishes any of it yet.
> The single `Component` beside it in `packages/domain` is still the scaffolding that
> proved the path end to end, and is not a decision about content.
```

In the Workspaces table, in the `packages/domain` row's Holds cell, after "its canonical form and its
migration chain -" insert `the admission pipeline everything entering a component passes through -`.

Add a section after "The content model" and before "Metadata":

```markdown
## The admission pipeline

`packages/domain/src/content/admission/` is the one way content enters a component from outside it - a
paste, a copy from another component, and later an import - designed in
[`design/content-model.md`](design/content-model.md), "The admission boundary". Nothing calls it yet: the
editor that pastes through it, and the readers of Word, Markdown and HTML that will feed it, are later
plans.

| File            | Holds                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.ts`     | The entries every stage appends, with fixed messages; what arrived travels in `detail`, never in a message                                          |
| `limits.ts`     | The provisional limits one admission is held to, measured without recursion before any stage walks the content                                      |
| `mathml.ts`     | A strict reader of an equation's MathML, an allowlist of MathML Core, the one form it is written back in, and the check validation makes against it |
| `sanitise.ts`   | Scripts, embedded objects, event handlers, links whose scheme is not allowlisted, executable formatting, MathML                                     |
| `migrate.ts`    | Content at an earlier schema version brought to current through content's own chain, or refused                                                     |
| `normalise.ts`  | Formatting dropped, NFC, empty runs and adjacent empty paragraphs removed, the source's language kept as a mark                                     |
| `reidentify.ts` | A new identifier for every block, footnote and mark; comments, suggestions and conditions without an axis dropped                                   |
| `admit.ts`      | The stages in order, validation last, and the outcome: blocks and the report, or a named refusal and the report                                     |
| `clipboard.ts`  | The product's own clipboard format, written on copy and read on paste                                                                               |

**Four properties, because each is a decision rather than an implementation detail.**

**One pipeline, and it does not know the source.** A reader turns its format into untrusted JSON, using a
fixed vocabulary for what the pipeline removes, and never removes it itself; a copy within the product and
a foreign paste are therefore reported to one standard. Anything no stage knows is refused by validation,
with the whole admission.

**The report comes back with the content.** Every stage that discards or rewrites appends to it, and a
refusal returns it too, ending with why. Messages are fixed strings; content is never interpolated into one.

**An outcome, never an exception, and never part of the content.** Either every block that survived,
validated as a whole under the receiving component's root, or a named refusal and nothing.

**MathML is the one markup this package reads.** An equation is rendered as markup, so it is the one string
a script could hide in. The reader refuses rather than guesses, and writes every combining mark as a
reference so that NFC cannot fuse one with a tag. Validation asks the same reader: `parseContentDocument`
refuses an equation whose MathML the reader would not keep exactly as it stands, so content that reaches
validation without passing through admission meets the same rule, and there is no second description of
the form to drift from the first.
```

- [ ] **Step 6: Say in the design what is now built**

In `docs/design/content-model.md`, replace the whole "Part of this is built" note - the seven quoted lines
under the introduction - with:

```markdown
> **Part of this is built.** The stored shape - the nodes, the marks, the root a version holds, the
> canonical serialisation, the migration chain and the output mapping - is in
> `packages/domain/src/content/model/`, and the admission pipeline's five non-reading stages, its report
> and the product clipboard's reader are in `packages/domain/src/content/admission/`. Validation refuses
> an equation whose MathML the pipeline's reader would not keep as it stands.
> [`../architecture.md`](../architecture.md) describes both as they stand rather than as they were
> planned. What is still design here: the Word, Markdown and HTML readers, resolution, and the round-trip
> test CNT-001 is satisfied by, which needs an editor. This document keeps the argument and the
> requirements it owns, because the reasoning is not a thing the code records.
```

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS - `design.test.ts` reads the document's tables, and neither changes.

- [ ] **Step 7: Leave the features alone, and say why**

`docs/features.md` and `README.md` stay as they are: nothing a person can see or do has changed. A reviewer
asking why the Features table did not move should find this step.

- [ ] **Step 8: Mark the plan built**

In `docs/plans/README.md`, in the content model section, change this plan's status from `Planned` to
`Built (PR #n)`, and add a paragraph after the table naming what it leaves, from "What this plan
deliberately leaves undone" below.

- [ ] **Step 9: Bump the version and write the changelog**

A functional enhancement: Minor + 1, Build 0, from whatever `version.json` says on `main` when this lands.
At the time of writing that is `0.20.0`, so `0.21.0`. Set it in `version.json`, the root `package.json` and
`apps/desktop/package.json`. `apps/desktop/src/version.test.ts` fails if they disagree, or if the
changelog's top entry does not match.

Add to the top of `CHANGELOG.md`:

```markdown
## 0.21.0 - YYYY-MM-DD (PR #n)

### Added

- **One way in for content**, built from [the content model design](docs/design/content-model.md).
  Everything pasted or copied into a component will pass through the same checks, in the same order,
  wherever it came from.
- **Anything that could run code or navigate is removed before content is kept**: scripts, embedded
  objects, event handlers, links that are not web or email addresses, formatting that could run code, and
  anything in an equation that is not standard MathML. An equation is only ever kept in one standard form,
  however it arrives.
- **Formatting is dropped and spacing paragraphs are removed**, because the theme decides how content
  looks. Text is kept in one Unicode form, and text copied from a component in another language keeps its
  language.
- **Copied content gets new identifiers**, so a copy is never mistaken for the original, and comments and
  suggestions stay with the component they were made on.
- **A report of everything removed or changed**, returned with the content so it can be shown at the
  time. Content that cannot be kept whole is refused whole, with a reason.
- Nothing in the application pastes through it yet; the editor will.
```

- [ ] **Step 10: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs/architecture.md docs/design/content-model.md docs/plans/README.md CHANGELOG.md packages/trace/src/trace.test.ts
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.21.0: the admission pipeline"
git push -u origin <branch>
gh pr create --base main --title "Build the admission pipeline"
```

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **The Word, Markdown and HTML readers** (CNT-060 to CNT-062), their workspace, the parser each needs, and
  moving the spike's OOXML reader and writer out of `packages/domain` into it. **The readers plan.** It
  writes to decision 2's contract, bounds its own input by `admissionLimits.characters`, and cites CNT-130
  from real HTML. It also answers what content-model.md does not: whether a heading pasted into a component
  becomes a paragraph with a reader entry, since headings are outline nodes rather than content.
- **Pasting in the editor** - the paste handler, fitting admitted blocks into a slice, the adjacency seam,
  showing the report (CNT-063), the clipboard's MIME type, plain-text paste, and exporting `sanitiseMathml`
  so that an equation typed as LaTeX is written in the reader's form, which validation now requires before
  it will store one (decision 17). **The editor session plan.**
- **A run's direction has no member in the model.** content-model.md says "a run whose direction differs
  carries its own", and the built marks have no direction. Normalise reports a direction it cannot keep.
  **Raise it as an issue against the content model**, beside #88.
- **What a cross-reference target names**, and so whether re-identify should re-point one at a copied
  block. **STR.**
- **Whether a paste within one component keeps its comments and suggestions.** **COL, T3.**
- **Condition axes.** Every caller passes `conditionAxes: []` until **REU** designs them and decides
  CNT-Q14.
- **When the pipeline needs streaming** (CMD-Q03), and whether the provisional limits hold. **IMP's first
  real import.**
- **Import as a product feature** - IMP-047's report, an import route, a component split from a document.
  **IMP's design.**
- **Retiring the spike schema and its gate-case tests**, and resolution. Plan 1's leftovers, unchanged.
