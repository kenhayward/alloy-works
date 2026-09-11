# Publishing engine spike - findings

> **Status: gates complete, decision not yet taken.** All four gate cases in
> [`Publishing_Engine_Spike.md`](Publishing_Engine_Spike.md) have run against all four candidates.
> **Typst is the only candidate that passes all four**, and nothing else passes more than two. It
> is not yet recorded as a decision, for two reasons stated at the end: the five non-gate cases have
> not run, and choosing Typst collides with a decision already taken - ADR-0005 makes XHTML the
> publishing intermediate, and Typst does not read XHTML. That second one is a product call rather
> than an engineering one.
>
> **Three verdicts were nearly declared failed too early.** The first pass reported that no engine
> carried a passage's language, that Typst dropped six footnotes, and that Typst could not break a
> table across pages. All three were the harness, not the engines. They are written up below for
> the same reason the content model spike wrote up the case it declared passed too early.

Only the four gates were in scope for this run, following the depth decision taken for the content
model spike. Cases 5 to 9 have not been run.

## Verdicts

| Gate                        | Typst    | WeasyPrint | PagedJS  | Headless Chrome |
| --------------------------- | -------- | ---------- | -------- | --------------- |
| **1** - Tagged PDF, PDF/UA  | **Pass** | Fail       | Fail     | Fail            |
| **2** - Footnote placement  | **Pass** | Fail       | **Pass** | Fail            |
| **3** - Table across pages  | **Pass** | **Pass**   | Fail     | Fail            |
| **4** - Incremental preview | **Pass** | Fail       | Pass\*   | Pass\*          |

\* PagedJS passes only near the front of a long document; headless Chrome is fast at a job it is
not doing. Both are explained under gate 4.

Under the brief's scoring a gate failure is a cost rather than a disqualification, so each failure
below says what would have to be built. The costs are not symmetrical, and that is most of the
finding.

| Engine          | What would have to be built to pass every gate                                                                                                    | Rough size                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Typst           | Nothing for the gates. The cost is structural instead - see ADR-0005 below                                                                        | A second emitter is small; a theme that compiles twice is not                                 |
| WeasyPrint      | Per-element language in its tagging; a footnote algorithm that splits rather than clipping; incremental layout                                    | The first is days. The second and third are layout-engine work                                |
| PagedJS         | Repeating table headers; repairs to the tagging its DOM restructuring breaks; page numbers without margin boxes; a preview that is not sequential | Headers are days. The rest is inside PagedJS, which has had no stable release since July 2023 |
| Headless Chrome | Footnotes. All of them                                                                                                                            | Footnote layout is pagination. That is building PagedJS                                       |

## Gate 1 - Tagged PDF meeting PDF/UA

**Typst passes. WeasyPrint passes the validator and fails the requirement. Chrome and PagedJS fail
both, and can be made to pass only by giving things up.**

veraPDF 1.30.2, PDF/UA-1 profile, is the verdict. Beside it, the check walks each structure tree to
confirm what a validator cannot: that the headings, the table header cells, the alternative text and
the French passage are really there. A validator checks that nothing machine-checkable is wrong. It
cannot know that a sentence is French.

| Engine          | veraPDF PDF/UA-1                                 | Passage language                   | Header cell scope |
| --------------- | ------------------------------------------------ | ---------------------------------- | ----------------- |
| Typst           | Pass - and on the 272-page document too          | Carried, on marked content         | Yes               |
| WeasyPrint      | Pass - and on the 307-page document too          | **Dropped**, inline and on a block | No                |
| PagedJS         | Fail - 3 rules, rising to 6 on the long document | Dropped                            | Yes               |
| Headless Chrome | Fail - 3 rules                                   | Dropped inline; kept on a block    | Yes               |

**WeasyPrint is the case that shows why the structure walk exists.** It passes veraPDF cleanly on
every document, including the long one. It also writes no per-element language at all: the French
passage is simply English as far as a screen reader is concerned, and an experiment moving the
passage onto its own `<p lang="fr">` changes nothing. PUB-034 requires the language of a differing
passage to be carried. WeasyPrint also drops the header cells' `scope`; a header row in `THead` is
structurally unambiguous, which is why veraPDF accepts it, but row headers and nested headers will
need it. Both are patches to WeasyPrint's tag emission, which is Python and open source - days of
work, and a fork until upstream accepts them.

**Chrome's three failures were each traced to a cause, and each can be closed**, which is why the
experiments in `spikes/publishing-engine/experiments.py` exist:

| Failure (veraPDF rule)                     | Cause                                                                        | Closed by                           | What that costs                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| 7.3-1, a Figure without alternative text   | `<figure>` and `<img>` become two Figure elements; the alt lands on only one | Emitting figures without `<figure>` | Nothing much - the intermediate is ours                      |
| 7.1-3, content neither tagged nor artifact | The page number in an `@page` margin box is not marked as an artifact        | Removing margin boxes               | **No page numbers or running heads**, which PUB-008 requires |
| 7.1-8, no metadata stream                  | Chromium writes no XMP                                                       | Adding it afterwards                | A post-processing step, which is small                       |

With all three changes, Chrome passes PDF/UA-1. The one that matters is the middle row: the
compliant version has no page numbers. PagedJS inherits all of this, because it prints through the
same Chromium, and adds failures of its own from restructuring the DOM into pages - list items
outside lists and footnote calls as untagged link annotations - 125 failed checks on the footnote
case, and 3,600 on the long document.

**The oracle was tested before it was trusted.** An untagged WeasyPrint render is produced as a
control, and veraPDF rejects it on five rules and 85 checks. Without that, a clean verdict would prove
only that the validator ran.

## Gate 2 - Footnote on the page carrying its anchor

**Typst and PagedJS pass. WeasyPrint silently loses text. Chrome has no footnotes.**

Twenty footnotes across roughly nine pages, so that some land near a page break in every engine
without being placed there. Two are long: note 5 fits on a fresh page, so an engine may legitimately
move its anchor forward rather than split it; note 12 is longer than a page's footnote area can hold,
so no engine can avoid the question the gate is asking.

| Engine          | Notes on their anchor's page | Note 5 (fits a fresh page)            | Note 12 (cannot fit anywhere)     |
| --------------- | ---------------------------- | ------------------------------------- | --------------------------------- |
| Typst           | 20 of 20                     | Fits where it is                      | **Splits** across two pages       |
| PagedJS         | 20 of 20                     | Anchor moved forward, note kept whole | **Splits** across two pages       |
| WeasyPrint      | 15 of 20                     | Note moved a page past its anchor     | **Opening 1,752 characters lost** |
| Headless Chrome | 0 of 20                      | Set inline in the paragraph           | Set inline in the paragraph       |

**WeasyPrint's failure is the most important thing this spike found, and it is found only by
looking.** Given a note that cannot fit, WeasyPrint moves it to the next page and grows the footnote
area upward - past the top edge of the page. The first 1,752 characters of the note, starting with
its own number, are positioned above the page and are invisible. There is no split, no error and no
warning. A reader sees a footnote whose beginning is missing, and has no way to know. It is also the
failure mode this specification keeps meeting - not an error, an absence nobody notices - arriving
in a layer nobody would have thought to look at. Separately, four other notes land a page after
their anchor, which PUB-016 forbids.

Fixing this is work inside WeasyPrint's footnote layout, not a configuration.

PagedJS's handling of note 5 is legitimate rather than a cheat: it moves the anchoring line to a new
page and gives the note the rest of it. PUB-016 is satisfied; the cost is a short page before it.

## Gate 3 - A table breaking across pages

**Typst and WeasyPrint pass. PagedJS does not repeat headers. Chrome cannot place the cell's
footnote.**

A forty-row table crossing three pages, with a caption and a footnote anchored in a cell on the last
page.

| Engine          | Header on every page | Caption with the table | Cell footnote on its cell's page | Rows split |
| --------------- | -------------------- | ---------------------- | -------------------------------- | ---------- |
| Typst           | Yes                  | Yes                    | Yes                              | None       |
| WeasyPrint      | Yes                  | Yes                    | Yes                              | None       |
| PagedJS         | **Page 1 only**      | Yes                    | Yes                              | None       |
| Headless Chrome | Yes                  | Yes                    | **Set inline in the cell**       | None       |

PagedJS's second page opens directly on row 17. A handler to repeat headers is a known community
addition and is days of work. **No engine labels a continued table**, and none can express one
without per-document work; the brief lists it as tested rather than as a pass condition, and it
stays a cost for whichever engine wins.

## Gate 4 - Incremental rendering for preview

**Typst passes, and it passes for the reason the brief hoped something would.**

A document of roughly three hundred pages - twenty chapters, 1,680 paragraphs, 480 footnotes,
twenty-four tables and sixteen figures. Every engine measured with a warm process, as a server would
run one. "Edit" means one sentence added to a paragraph near page 38, which reflows everything after
it, and then the time until page 40 is current again. Every Typst edit is new content, so none can
be answered from its cache.

| Engine          | Pages | Full, tagged | Page 40 cold | **Edit, then page 40** | Edit, then page 250 |
| --------------- | ----- | ------------ | ------------ | ---------------------- | ------------------- |
| Typst           | 272   | 1.2 s        | 0.9 s        | **0.36 s**             | The same            |
| Headless Chrome | 300   | 0.9 s        | 0.35 s       | 0.35 s                 | The same            |
| PagedJS         | 304   | 6.7 s        | 6.0 s as PDF | **0.88 s on screen**   | **4.4 s**           |
| WeasyPrint      | 307   | 6.1 s        | 3.8 s        | **3.9 s**              | The same            |

**The requirements state no budget, so these are judged against provisional numbers.** CNT-096
requires preview to be fast enough to use while writing "against a budget stated in the
requirements", and no budget is stated anywhere. This spike used under one second as the target and
two seconds as the ceiling. Those numbers are defensible rather than researched, and the table above
is the raw data so they can move.

**Typst's number comes from how it compiles, not from a trick.** `typst watch` keeps its memoised
layout between compiles, so an edit re-lays out what changed and reuses what did not. The cost does
not depend on where in the document the edit is, because the whole document is re-laid out either
way. That is what the brief meant by "resume from cached layout state", and Typst does it natively.

**PagedJS passes only near the front.** It lays pages out one at a time in a live page, so a preview
tab can show page 40 before the rest exist - 0.88 s including reloading the document. But the same
edit costs 4.4 s to reach page 250. For a writer working late in a long report, it fails.

**Headless Chrome's speed is real and irrelevant.** It lays out three hundred pages in under a
second because it is not placing footnotes, which is most of what makes pagination expensive.

**WeasyPrint has no incremental layout.** Every edit is a full layout, 3.9 s.

**PUB-Q04 is answered, provided the engine is Typst.** Preview can share the pipeline: same compiler,
same templates, same layout, reached incrementally. One qualification, found rather than assumed:
Typst refuses a tagged export of a page range, because a range severs the structure tree. So a
page-range preview is untagged while a publication is PDF/UA-1. The layout is identical and tagging
is an export option, so PUB-006 holds - but it should be written down, not discovered.

## The structural question: ADR-0005 and the intermediate

Section 6 of the brief asked the spike to state this plainly, and it is now the decision rather than
a footnote to one.

**ADR-0005 makes XHTML the publishing intermediate. Typst does not read XHTML.** Choosing Typst
means either emitting Typst from the content model directly - bypassing the intermediate - or
carrying two. Neither is free. What the spike found about the cost is not what the brief expected:

- **The emitter is not the cost.** Both emitters in `cases.py` came to roughly fifty to sixty-five
  lines for this subset. A Typst emitter is not a large thing to write.
- **The theme is the cost.** The editor renders the theme's typefaces at the theme's sizes
  (CNT-097), in a browser, in CSS. If the PDF comes from Typst, every theme exists twice - as CSS for
  the editor and as Typst styling for the output - and the two have to agree. With an HTML engine the
  vocabulary is at least shared. STY's forty-eight requirements are written against one theme model;
  a theme that compiles to two targets is a real piece of work, and it is where the XHTML decision was
  quietly doing its job.
- **Typst markup is code, which changes what an escaping bug is.** In an HTML pipeline a missed
  escape corrupts formatting. In Typst it executes, inside the publishing pipeline, with read access
  to the compile root. The mitigation is also the better design: do not emit markup at all. Emit the
  resolved document as data, and have a fixed Typst template read and render it. Content never becomes
  code, and each compile runs in a root holding only its own job's files.

That last point suggests what the intermediate should become. XHTML was chosen as the intermediate
because the engines expected to win consume it. If the engine does not, the resolved content model -
already JSON, already the thing every format is produced from - is the natural intermediate, with a
renderer per format. That would narrow ADR-0005 rather than overturn it: the content model is
untouched; only its statement about what sits between resolve and render changes.

## What the harness nearly got wrong

**Three failures were declared and then withdrawn**, and each was the harness:

- **"No engine carries a passage's language."** All four engines failing identically was the clue.
  Typst records language on marked content rather than on a structure element, which ISO 32000 allows;
  the check only looked at structure elements. WeasyPrint and Chrome's failures were real.
- **"Typst drops six footnotes and sets fourteen inline."** Typst sets a footnote's number flush
  against its first word, so a search for `note05` missed `5note05`; and it sets page numbers at body
  size, which the "nothing larger below the note" test counted as body text.
- **"Typst cannot break a table."** Typst figures do not break across pages unless told to. The HTML
  engines were given the equivalent in CSS, so leaving Typst's out was an unfair setup, not a finding.

And one pass was nearly declared too early: every long footnote first "fitted", because none was long
enough to force the question. Note 12 was made longer than a page, and that is what exposed
WeasyPrint.

**One bug in the case itself** was found before it cost anything. The "one sentence" edit drew its
words from the document's own random stream, so everything after the edit came out different. For
engines without caching that changed nothing; for Typst it turned one edit into a rewrite of the
remaining two hundred pages. The edit now has its own generator.

## What is a proxy and what is verified

| Claim                                     | How it was established                                                | What would verify it                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PDF/UA-1 conformance                      | veraPDF, the machine-checkable rules                                  | The Matterhorn Protocol has checkpoints only a person can judge; a screen reader on the Typst output              |
| The French passage is announced as French | Language found in the structure tree or marked content                | NVDA or VoiceOver switching voice at the passage                                                                  |
| A note is in the footnote area            | Text positions and font sizes                                         | Opening the PDFs                                                                                                  |
| WeasyPrint's clipped note                 | Traced to exact coordinates above the page edge                       | **Opening `case2-weasyprint.pdf` at page 6**                                                                      |
| Timings                                   | One machine: Docker Desktop, 8 vCPUs, neighbours idle; warm processes | A second machine, and a preview measured as the editor would request it                                           |
| Typst preview in the editor               | Measured as PDF export in watch mode                                  | Typst also renders to SVG, and compiles to WebAssembly - so preview might run in the browser. Neither is measured |

The generated documents are synthetic and uniform. Real reports have denser tables, nested lists and
irregular structure, and the gates should be re-run against a real one before anything is built.

## A requirements gap this exposed

**Nothing pins the engine version.** PUB-043 requires the same baseline, layout version and theme
version to produce the same output, and VER-018 pins every component, asset, theme, typeface and
layout a document used. None of that covers the engine. Re-publishing a baseline years later on a
newer engine can change line breaks, page breaks and therefore page numbers and cross-references,
with no pinned input having moved - the same silent re-render STY-047 was added to prevent for
typefaces, one layer further down.

It applies whichever engine wins, and it is sharper for a fast-moving one: Typst has released
0.14.2, 0.15.0 and 0.15.1 in the last nine months, where PagedJS has had no stable release since
July 2023. A publication should record the engine and version that produced it, and a baseline
should be re-publishable on that version for as long as the baseline exists. That is a requirement
for **VER** and **PUB**, and it belongs in the decision record whichever engine it names.

## What was not run

Cases 5 to 9 - mathematics, running heads and numbering, typefaces, the full 300-page budget, and
determinism - are the correctness and budget cases. Two of them matter to a Typst decision in
particular:

- **Case 7, typefaces.** STY-040 requires a missing typeface to fail the publish. Whether Typst fails
  or substitutes with a warning has not been tested here.
- **Case 6, running heads and numbering.** Roman front matter, restarts and section-carrying heads are
  where CSS Paged Media is strongest; they are expressible in Typst, but not yet shown to be.

Case 5 is likely to favour Typst, which sets mathematics natively; it should still be run.

## Recommendation

**Typst, subject to two things.**

1. **Run cases 5 to 9 against Typst before recording the decision** - with WeasyPrint alongside as
   the runner-up, since it is the only other engine that passes a layout gate and a tagging gate.
   Case 7 especially: a typeface that substitutes silently would be the same class of failure as
   WeasyPrint's footnote, in the engine chosen partly for not having it.
2. **Decide the intermediate.** Choosing Typst means ADR-0005's statement that XHTML is the
   publishing intermediate is narrowed by a new record - the resolved content model becomes the
   intermediate, rendered as data through a fixed Typst template - and the cost of that is a theme
   model that compiles to both CSS and Typst. That is a product decision as much as an engineering
   one, because it is where the typographic promises in STY get made twice.

**ADR-0007 is confirmed, not sent back.** The brief said a gate failed by every candidate would be
the finding that reopens it. No gate was failed by every candidate, and one candidate failed none.

## Where the code is

`spikes/publishing-engine/`, outside the pnpm workspace and outside CI - it needs four PDF engines
and a Java validator. Its README says how to run it. The cases (`cases.py`) and the checks
(`checks.py`) are the regression suite the brief asks to keep; the rest is scaffolding.
