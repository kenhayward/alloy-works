# Publishing engine spike - findings

> **Status: complete, and decided in [ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md).** All nine cases in
> [`Publishing_Engine_Spike.md`](Publishing_Engine_Spike.md) have run. The four gates ran against all
> four candidates; **Typst was the only one to pass all four**, and nothing else passed more than two.
> Cases 5 to 9 then ran against the two finalists, Typst and WeasyPrint, and so did the gates again
> in the shape the decision prescribes - the resolved document as data, read by one fixed Typst
> template - because recording a decision on an unmeasured shape is how a case gets declared passed
> too early.
>
> **Eight verdicts were nearly declared failed too early**, three in the first round and five in the
> second. Every one was the harness or the template rather than an engine, and every one was caught
> by refusing to record a verdict until the page itself had been looked at. They are written up below,
> because the pattern matters more than any one of them. **Two engine defects survived that scrutiny**,
> both in WeasyPrint and both silent: a footnote whose opening is set above the top of the page, and a
> contents entry that prints the wrong page number while its own link goes to the right one.

## Verdicts

| Gate                        | Typst    | WeasyPrint | PagedJS  | Headless Chrome |
| --------------------------- | -------- | ---------- | -------- | --------------- |
| **1** - Tagged PDF, PDF/UA  | **Pass** | Fail       | Fail     | Fail            |
| **2** - Footnote placement  | **Pass** | Fail       | **Pass** | Fail            |
| **3** - Table across pages  | **Pass** | **Pass**   | Fail     | Fail            |
| **4** - Incremental preview | **Pass** | Fail       | Pass\*   | Pass\*          |

\* PagedJS passes only near the front of a long document; headless Chrome is fast at a job it is
not doing. Both are explained under gate 4.

Cases 5 to 9 ran against the two engines that passed a layout gate and a tagging gate between them.

| Case                                | Typst                                     | WeasyPrint                                                       |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| **5** - Mathematics                 | **Pass**                                  | Pass with cost - equations are images                            |
| **6** - Running heads and numbering | **Pass**                                  | **Pass**                                                         |
| **7** - Typefaces                   | Pass with cost - warns, does not fail     | Pass with cost - warns, does not fail                            |
| **8** - The long document           | **Pass** - 1.3 s, every page number right | Pass on budget - 8.7 s; one contents entry prints the wrong page |
| **9** - Determinism                 | **Pass**, with the timestamp pinned       | **Pass**                                                         |

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

## Case 5 - Mathematics

**Both pass. Typst sets mathematics; WeasyPrint shows pictures of it, and one consequence is silent.**

An equation in running text, in a heading, in a table cell, in a footnote and in a caption, and two
numbered display equations with an unnumbered one between them - so the second must be (2), or the
unnumbered one consumed a number CNT-047 says it must not.

|                                          | WeasyPrint                         | Typst                     |
| ---------------------------------------- | ---------------------------------- | ------------------------- |
| All five positions                       | Yes                                | Yes                       |
| Accessible alternative on every equation | 8 of 8, tagged as Figure           | 8 of 8, tagged as Formula |
| Numbering: (1), (2), and no (3)          | Yes                                | Yes                       |
| Equation reachable as text               | No - it is an image                | Yes                       |
| Heading's bookmark keeps its equation    | **No** - "Summation over a sample" | Yes                       |
| PDF/UA-1                                 | Pass                               | Pass                      |

WeasyPrint has no mathematics of its own, so equations are typeset by MathJax into SVG and placed as
images. That works, and it passes the validator. It also means an equation in a heading vanishes
from the heading's bookmark without a trace: the navigation pane says "Summation over a sample" and
nobody is told the sum was ever there.

**The LaTeX route into Typst is where the recommended shape was hardest, and it holds.** The content
model stores LaTeX (CNT-044). Translating LaTeX to Typst source and evaluating it would reopen the hole
the data shape exists to close, so the route is LaTeX to MathML - which Word needs anyway on its way to
OMML - and MathML to a small structural tree the template assembles from Typst's own maths functions.
An element the tree does not recognise fails the build, which is what CNT-049 asks for.

The first render by that route had real typographic defects, and they were the template's, not
Typst's: operators arrived as strings, and a string set in maths is just text, so `E=mc²` lost its
spacing, an integral stayed small with its limits stacked, and a bracket would not stretch. Turning
each operator into a Typst symbol gives it everything Typst knows about that character natively. After
that the data route and Typst's own markup are indistinguishable by eye.

## Case 6 - Running heads, numbering and front matter

**Both pass, page by page.** A title page without a number, front matter in roman from ii, the body
restarting at 1 at the first chapter, running heads carrying the current chapter and suppressed where
a chapter opens, and an appendix numbered A-1 onward. Every element is expressed once, in the theme
or the template, and nothing in the document repeats it.

One difference a reader will notice: **Typst writes PDF page labels, and WeasyPrint does not.** In
Typst's output a viewer's page box says "iii" and "A-2", matching the printed numbers. In WeasyPrint's
it says 5 on a page printed 1, and a reader told to go to page 12 lands on the wrong one.

## Case 7 - Typefaces and embedding

**Both embed and subset correctly. Neither fails when a face is missing - both warn and substitute,
so the cost is the same for both: the pipeline must treat that warning as a failed publish.**

| A face declared by the theme is missing | What appears instead                 | What is said                                        |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| WeasyPrint                              | Noto Sans, from the system           | A logged warning                                    |
| Typst, system fonts                     | Libertinus Serif, Typst's own        | A warning, with the line of the theme that named it |
| Typst, pinned fonts only                | Liberation Serif, the only face left | The same warning                                    |

Typst can be confined to exactly the font files a baseline pins - `--ignore-system-fonts`,
`--ignore-embedded-fonts`, `--font-path` - which is what STY-047 needs and what makes case 9 hold
across machines. One consequence: pinning excludes Typst's built-in mathematics face, so a theme's
pinned set has to include one, as ADR-0010 already expected.

**A second silent failure turned up beside the case, and no setting catches it.** Case 7 asks what
happens when a face cannot be loaded. It does not ask what happens when a face loads and lacks the
characters it is asked to set. Tried with an Arabic phrase in a Latin face: with system fonts, Typst
quietly borrows the glyphs from DejaVu Sans, a face nobody declared; with pinned fonts only, it sets
five empty boxes. In both cases the exit code is 0 and there is no warning. The document ships with
words a reader cannot read. The remedy is ours to build, and it is small: before compiling, check that
every character in the resolved document exists in the theme's pinned faces, and fail if not. That
is STY-049. It was tested on Typst only; WeasyPrint's font fallback is the same shape and was not
tried.

## Case 8 - The 300-page document

**Both are well inside the provisional budget. Typst gets every generated page number right; WeasyPrint
prints one wrong, silently.**

The brief's document: 400 components, 60 figures, 40 tables, 200 footnotes, a generated contents, a
list of figures, twenty cross-references that print a page number, and fifty references. Timed at a
quarter, half and full length, each the fastest of three fresh processes.

|                                   | Typst                     | WeasyPrint                   |
| --------------------------------- | ------------------------- | ---------------------------- |
| Pages                             | 252                       | 276                          |
| Publish                           | **1.3 s**                 | 8.7 s                        |
| Per page at 1/4, 1/2, full length | 5.0, 4.9, 5.1 ms - linear | 27, 30, 32 ms - slowly worse |
| Peak memory                       | 433 MB                    | 426 MB                       |
| Contents entries right            | **400 of 400**            | 399 of 400                   |
| List of figures right             | 60 of 60                  | 60 of 60                     |
| Cross-references right            | 20 of 20                  | 20 of 20                     |

Scope §11 promises a publish budget and states none; this spike used thirty seconds for 300 pages,
which PUB-064 now records as provisional. Memory grows linearly in both, at about 1.7 MB a page, so a
1,000-page document wants something like 1.7 GB of worker - a sizing input rather than a problem.

**WeasyPrint's wrong entry was traced before it was believed.** Heading sec063 sits on page 53. The
contents line for it prints 54. The link on that same line goes to page 53. So WeasyPrint knew where
the heading was, and printed a number from an earlier layout pass that it never corrected. One entry
in four hundred is exactly the rate at which nobody finds it by reading.

## Case 9 - Determinism

**Both pass.** The same input rendered twice on one machine, and once on a second machine of a
different architecture - x86 and ARM, because publishing runs on servers and an ARM server beside an
x86 one is the realistic second machine, and the likeliest place for floating-point layout to differ.
The ARM run used Typst's own aarch64 binary under emulation.

- **Typst, with its creation timestamp pinned** (`SOURCE_DATE_EPOCH`): byte-identical, run to run and
  across architectures, for all three documents tried. Unpinned, eight lines differ - dates and
  document identifiers - and every page renders pixel-identical.
- **WeasyPrint**: byte-identical in every mode, pinned or not.

So the set of fields allowed to differ is empty, provided the pipeline always pins the timestamp. It
should pin it to the time recorded with the publication, so that re-publishing a baseline reproduces
the original rather than a copy of it dated today.

## The recommended shape, measured

The decision prescribes something the gates did not test: not Typst markup, but the resolved document
as JSON, read by one fixed template (`template.typ`) that never changes per document. It was measured
rather than assumed.

| Gate re-run in the data shape | Result                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| 1 - Tagged PDF                | Pass - PDF/UA-1, and the French passage carried                            |
| 2 - Footnotes                 | Pass - 20 of 20 on their anchor's page, note 12 split                      |
| 3 - Table                     | Pass                                                                       |
| 4 - Preview                   | Pass - an edit reaches page 40 in 0.39 to 0.45 s, against 0.36 s as markup |

**The security property was demonstrated, not asserted.** A paragraph of content reading
`#read("secret.txt")`, `$x^2$`, `*bold*`, `<label>` and `@ref`, and an equation whose LaTeX carries the
same call, were rendered with a file called `secret.txt` in the compile root. In the data shape both
come out as those literal characters and the file is never read. The same text written straight into
Typst markup, as an emitter that forgot to escape would write it, **printed the file's contents into
the document**. Typst's own sandbox limits that reach to the compile root, which is why each job must
compile in a root holding only its own files.

The template is about 130 lines. The data emitter, MathML included, is about 120 lines of Python.
Neither is large; the cost the decision carries is still the theme, not the code.

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

## What the harness nearly got wrong, again

The first round withdrew three failures. The second round withdrew five, and four were mine in the
template or the theme rather than in a check:

- **"Typst gets case 6 wrong from page 8."** A page holding only the tail of a paragraph carried no
  marker, and the check lost track of which chapter it was in. Typst was right on every page.
- **"WeasyPrint cannot restart page numbering."** The CSS reset the counter on an element, which
  WeasyPrint ignores. A page group - `@page body:nth(1 of body)` - does it properly.
- **"WeasyPrint gets 0 of 400 contents entries right."** The same CSS: an element counter stuck at 1
  made every page reference read 1. Fixed, it is 399 of 400 - and the one is real.
- **"Typst puts figure 18 on the wrong page."** The template let every figure break across pages, to
  let tables do so, and an image parted from its caption. Only tables may break now.
- **"The data route cannot typeset mathematics properly."** Operators set as strings, above.

**The lesson is the same one twice over, and it is the one the content model spike recorded:** a
harness that reads its own output proves only that it agrees with itself. Every one of these was
caught by opening the page before recording the verdict, and every engine defect that remains was
confirmed the same way.

## What is a proxy and what is verified

| Claim                                     | How it was established                                                | What would verify it                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PDF/UA-1 conformance                      | veraPDF, the machine-checkable rules                                  | The Matterhorn Protocol has checkpoints only a person can judge; a screen reader on the Typst output              |
| The French passage is announced as French | Language found in the structure tree or marked content                | NVDA or VoiceOver switching voice at the passage                                                                  |
| A note is in the footnote area            | Text positions and font sizes                                         | Opening the PDFs                                                                                                  |
| WeasyPrint's clipped note                 | Traced to exact coordinates above the page edge                       | **Opening `case2-weasyprint.pdf` at page 6**                                                                      |
| Timings                                   | One machine: Docker Desktop, 8 vCPUs, neighbours idle; warm processes | A second machine, and a preview measured as the editor would request it                                           |
| Typst preview in the editor               | Measured as PDF export in watch mode                                  | Typst also renders to SVG, and compiles to WebAssembly - so preview might run in the browser. Neither is measured |
| Mathematics typeset correctly             | Looked at, rendered to an image, against Typst's native output        | Somebody who reads mathematics for a living                                                                       |
| Determinism across architectures          | Typst's aarch64 binary under emulation                                | A real ARM server                                                                                                 |
| WeasyPrint's wrong contents number        | Printed number against the link's own destination                     | **Opening `case8-weasyprint.pdf`**, contents entry sec063, and following the number                               |

The generated documents are synthetic and uniform. Real reports have denser tables, nested lists and
irregular structure, and the gates should be re-run against a real one before anything is built.

## Requirements gaps this exposed

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
for **VER** and **PUB**, and it belongs in the decision record whichever engine it names. It is
now **PUB-063** and **VER-041**.

Three more came out of cases 4 to 8, and are now written down:

- **A preview budget** (CNT-114) and **a publish budget** (PUB-064), both provisional. CNT-096 and scope
  §11 each promised a number; neither stated one.
- **Content reaches the engine as data** (PUB-062), and a page-range preview may be untagged while a
  publication never is (PUB-061).
- **Every character must have a glyph in the theme's faces** (STY-049), because no engine setting
  catches it and the failure is a document with unreadable words in it.

## Decision

**Typst, rendering the resolved document as data through one fixed template.** Recorded in
[ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md), which narrows ADR-0005: XHTML stays a first-class export, and stops being the thing
between the content model and the PDF.

**ADR-0007 is confirmed, not sent back.** The brief said a gate failed by every candidate would be the
finding that reopens it. No gate was failed by every candidate, and one candidate failed none.

## Where the code is

`spikes/publishing-engine/`, outside the pnpm workspace and outside CI - it needs four PDF engines
and a Java validator. Its README says how to run it. The cases (`cases.py`, `cases_more.py`) and the
checks (`checks.py`, `checks_more.py`) are the regression suite the brief asks to keep, and
`template.typ` with `typst_data.py` is the first working draft of the shape ADR-0013 prescribes. The
rest is scaffolding.
