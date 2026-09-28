# Auditing a release

> The two checks a person makes before a release, which no test can make for them: the editor
> audited against WCAG 2.2 AA (CNT-177), and the Matterhorn Protocol checkpoints only a person can
> judge reviewed on the publishing regression corpus (PUB-104). What to run, what to look at, what to
> write down, and the rows that put the release's name to it.

A test demonstrates most of what a release promises. Two things it cannot: whether the editor is
usable by somebody who cannot see it or cannot hold a mouse, and whether a published PDF reads
sensibly to a screen reader. Automated checks find a minority of accessibility failures - the rest
need a person with a keyboard and a screen reader. So each release's baseline says that a person did
this, who, and when, and a release whose person has not looked cannot say its editor meets WCAG 2.2 AA
([ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md)).

The two are independent: they can be made on different days by different people. Both are made
**before every release**, whatever the release changed. The automated half - axe-core over every
state of the editor and the document view - runs in CI on every push (CNT-176,
[the browser suite](../testing.md#the-browser-suite)); this guide is the other half.

Allow about a day for the WCAG audit the first time, and half that once the record from the last
release is beside you. The Matterhorn review takes about two hours.

## Before you start

1. **Check out the release**: the commit its pull request merged, or its tag once it has one
   (`git checkout v<version>`). Everything below is run from that checkout, so the record describes
   what ships.
2. **Bring up the whole system** from it, as [deploy/README.md](../../deploy/README.md) says:

   ```bash
   docker compose -f deploy/compose.yaml up -d --build --wait
   ```

   The renderer is then at `http://dev.acme.localhost:8088`. Sign in as Ada from the stand-in's page.
   If a stack is already running on those ports, run a second one on ports of its own as
   [docs/testing.md](../testing.md#the-browser-suite) shows, and use its address throughout.

3. **Run the browser suite against it**, which is what CI ran, and leaves behind the documents and
   components it made, one of each state this guide asks you to look at:

   ```bash
   pnpm --filter @alloy-works/browser fetch-chromium   # once per machine
   pnpm test:browser
   ```

   Against a second stack, set `ALLOY_BROWSER_SERVICE`, `ALLOY_BROWSER_API` and `ALLOY_BROWSER_IDP`
   to its addresses first, as docs/testing.md shows. It must pass. If it does not, stop: the release
   is not ready to audit.

4. **Check the allow-list is empty.** `ALLOWED` in `tests/browser/src/testing/axe.ts` holds each
   violation axe finds that is filed as an issue rather than fixed. **The WCAG audit cannot pass while
   it holds anything** (the W13 plan's B-I): a violation a machine can see is a failure a person does
   not need to find again. If it is not empty, the audit is recorded as failing on those criteria,
   each naming its issue.

5. **Print what axe could not decide**:

   ```bash
   pnpm --filter @alloy-works/browser undecided
   ```

   It reads the report the suite just wrote, `.trace-results/browser.json`, and lists every state in
   which axe met something it could not judge, with the rule and the element. Almost all of it is
   `color-contrast` over something axe could not measure - text over a gradient, an image or a
   translucent panel, or in a stacking context it cannot see through. Each is yours to judge, with a
   contrast checker on the colours as they are drawn.

## The WCAG 2.2 AA audit (CNT-177)

**Where.** The web delivery, in two browsers with the screen reader each is normally used with:
Chrome or Edge with NVDA on Windows, and Safari with VoiceOver on macOS. The desktop application loads
the same renderer, so it needs only a check that it opens, signs in and edits one component the same
way, by keyboard.

**What.** Every state the browser suite checks, which are the states a person reaches - the titles of
the tests in `tests/browser/src/accessibility.test.ts` and `outline.test.ts` name them, and each
`checkAxe` call names one:

- the screen signed out, Home, the four lists, Search with results, API tokens, and Administration's
  sections;
- the component editor with a component holding every block and mark - the cursor in each; the Link,
  Language, Reference, Equation, Figure and Image dialogs and the symbol palette; the paste report;
  the List, Table, Preformatted text, Figure, Recovery and Fields panels; the title strip's language
  and direction; a save that failed;
- the document view in Reading and in Authoring, boundaries shown, the outline edited by keyboard and
  by pointer, a node reached by a link, the version chooser, a section's title and its Equation dialog,
  the removal question, a component opened in place, the preview pane, and a publish and its
  publication.

**How.** Go through the criteria in the record's table, below, in order. For each, decide on what
you can see and hear, not on what the code says it does. The ones no automated check reaches are the
reason you are here, and are where to spend the time:

- **Keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11).** Put the mouse away. Reach and operate everything
  above with `Tab`, `Shift+Tab`, the arrow keys, `Enter`, `Space` and `Escape`, and the editor's `F6`
  and `Shift+F6` between its regions. Nothing may hold the focus so that the keyboard cannot leave;
  the order must follow the meaning; the focus must always be visible, and never wholly hidden by the
  status bar or a pane.
- **Reflow and resizing (1.4.4, 1.4.10).** Narrow the window to 320 CSS pixels wide (the browser's
  device toolbar does this) and zoom to 200%: nothing may need scrolling in two directions to read,
  except the document's own page and a table, and nothing may be cut off.
- **Text spacing (1.4.12).** Apply line height 1.5, paragraph spacing 2, letter spacing 0.12 and word
  spacing 0.16 times the font size, with a bookmarklet or an extension that sets them: no text may be
  clipped or overlap.
- **Meaningful sequence and structure (1.3.1, 1.3.2).** With the screen reader, read each state from
  the top: headings are headings at the right level, a list is a list, a table's headers are read with
  its cells, and the order read is the order meant.
- **What the screen reader announces (4.1.2, 4.1.3).** Every control says its name, what it is and its
  state; each change the page announces - a save failing, an outline edit, a paste's report, a
  publish - is heard once, when it happens, without the focus moving.
- **Contrast axe could not decide (1.4.3, 1.4.11)**, from the list you printed above.
- **Target size (2.5.8)**, where axe marked something undecided or where two small controls sit close.

A criterion that does not apply - there is no audio or video in the product, for one - is recorded as
not applicable, with why.

**A failure** is filed as a GitHub issue describing what a person meets, how to reproduce it and what
they should have met, as any bug is (CLAUDE.md, "Branches, issues and pull requests"), and recorded
against its criterion with the issue's number. Where axe can see it, the fix adds nothing to the
allow-list - the suite fails until it is fixed.

## The Matterhorn review (PUB-104)

**What it is.** The Matterhorn Protocol, published by the PDF Association, describes how a PDF can
fail PDF/UA-1, checkpoint by checkpoint, and marks each failure condition as one a machine can test or
one only a person can judge. veraPDF checks every publication against the
machine's (PUB-103); this review is the person's, on the publishing regression corpus - the documents
that exercise everything the product publishes, grown by a case for each publishing defect fixed.
Take the checkpoints and their failure conditions from the protocol itself, and say in the record
which version of it you used; this guide does not restate them, and names none by number.

PUB-104 asks for this review whenever the engine, the template or the publishing pipeline changes.
This guide makes it before each release, so a change merged between two releases is reviewed with
the next release, not when it lands; publishing.md names that gap, and PUB-104 is not claimed by any
design until it is settled. A release that changed any of the three should say in the record which
changes it reviewed.

**Get the PDFs.** The corpus keeps every PDF it compiles where `ALLOY_CORPUS_PDFS` names a directory,
each named by the case that made it:

```bash
pnpm --filter @alloy-works/worker fetch-typst      # once per machine
pnpm --filter @alloy-works/worker fetch-verapdf    # once per machine, needs Docker
pnpm --filter @alloy-works/domain build
ALLOY_CORPUS_PDFS=/somewhere/corpus pnpm --filter @alloy-works/worker exec vitest run src/regression.test.ts
```

The suite needs the development database the other suites use (`docker compose -f
deploy/compose.yaml up -d --wait postgres seaweedfs`, or `ALLOY_TEST_DATABASE_URL` pointed at one). It
must pass. The directory then holds about sixty PDFs; a case that compiles more than one numbers them.

**Read them** in a reader that shows the tag tree beside the page - Adobe Acrobat's Tags panel, or PAC,
the PDF Accessibility Checker, whose screen reader preview reads the tree as a screen reader would -
and with a screen reader over the page. For each checkpoint in the record's table, judge its human
failure conditions on the cases that exercise it. The spike's nine cases (`case-1` to `case-9` in
the file names) cover most of what the product sets; the defects' cases are where it has gone wrong
before. What to look for, in the product's terms:

- **Reading order, and what is content.** The structure tree read in order is the text in the
  order it is meant: a footnote after its paragraph, a figure's caption with its figure, a table's note
  after its table. What is not content - the running heads and feet, the page numbers, the **Not
  approved** notice on every page after the one where it is read - is an artifact the screen reader
  skips.
- **Headings.** Each section is a heading at its depth, the document's title the first; nothing
  is a heading that is not one.
- **Tables.** Header rows and header columns are tagged as headers, merged cells span what they
  span, and a table continued across pages repeats its header rows on each.
- **Lists, notes and references.** A list is a list with its numbering; a footnote is a note
  tied to its mark; a cross-reference is a link that goes where it says.
- **Graphics and mathematics.** Each figure's words say what it shows, a decorative image is
  an artifact, and each equation is a formula whose words say what it is.
- **Language.** A passage marked in another language is read in it.
- **Navigation.** The bookmarks are the headings, in order.

Record each checkpoint's verdict. A failure is filed as an issue with the case's name, and becomes a
case of its own in the corpus when it is fixed (docs/testing.md, "The regression corpus and veraPDF").

## The record

Commit each record in the release's pull request, before the baseline cites it, at
`docs/audits/<version>/wcag.md` and `docs/audits/<version>/matterhorn.md`. A record is **never edited
afterwards**: like a review, it is evidence of what a person saw on that day
([docs/audits/README.md](../audits/README.md)).

`wcag.md`:

```markdown
# WCAG 2.2 AA audit, <version>

> **Audited:** YYYY-MM-DD, by <your name>. **Build:** <the commit>. **With:** <browser and version,
> screen reader and version, each pair>; the desktop application on <operating system>.
> **Allow-list:** empty. **Browser suite:** passed at <the commit>.

| Criterion                                                  | Level | Verdict | Notes |
| ---------------------------------------------------------- | ----- | ------- | ----- |
| 1.1.1 Non-text Content                                     | A     |         |       |
| 1.2.1 Audio-only and Video-only (Prerecorded)              | A     |         |       |
| 1.2.2 Captions (Prerecorded)                               | A     |         |       |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A     |         |       |
| 1.2.4 Captions (Live)                                      | AA    |         |       |
| 1.2.5 Audio Description (Prerecorded)                      | AA    |         |       |
| 1.3.1 Info and Relationships                               | A     |         |       |
| 1.3.2 Meaningful Sequence                                  | A     |         |       |
| 1.3.3 Sensory Characteristics                              | A     |         |       |
| 1.3.4 Orientation                                          | AA    |         |       |
| 1.3.5 Identify Input Purpose                               | AA    |         |       |
| 1.4.1 Use of Color                                         | A     |         |       |
| 1.4.2 Audio Control                                        | A     |         |       |
| 1.4.3 Contrast (Minimum)                                   | AA    |         |       |
| 1.4.4 Resize Text                                          | AA    |         |       |
| 1.4.5 Images of Text                                       | AA    |         |       |
| 1.4.10 Reflow                                              | AA    |         |       |
| 1.4.11 Non-text Contrast                                   | AA    |         |       |
| 1.4.12 Text Spacing                                        | AA    |         |       |
| 1.4.13 Content on Hover or Focus                           | AA    |         |       |
| 2.1.1 Keyboard                                             | A     |         |       |
| 2.1.2 No Keyboard Trap                                     | A     |         |       |
| 2.1.4 Character Key Shortcuts                              | A     |         |       |
| 2.2.1 Timing Adjustable                                    | A     |         |       |
| 2.2.2 Pause, Stop, Hide                                    | A     |         |       |
| 2.3.1 Three Flashes or Below Threshold                     | A     |         |       |
| 2.4.1 Bypass Blocks                                        | A     |         |       |
| 2.4.2 Page Titled                                          | A     |         |       |
| 2.4.3 Focus Order                                          | A     |         |       |
| 2.4.4 Link Purpose (In Context)                            | A     |         |       |
| 2.4.5 Multiple Ways                                        | AA    |         |       |
| 2.4.6 Headings and Labels                                  | AA    |         |       |
| 2.4.7 Focus Visible                                        | AA    |         |       |
| 2.4.11 Focus Not Obscured (Minimum)                        | AA    |         |       |
| 2.5.1 Pointer Gestures                                     | A     |         |       |
| 2.5.2 Pointer Cancellation                                 | A     |         |       |
| 2.5.3 Label in Name                                        | A     |         |       |
| 2.5.4 Motion Actuation                                     | A     |         |       |
| 2.5.7 Dragging Movements                                   | AA    |         |       |
| 2.5.8 Target Size (Minimum)                                | AA    |         |       |
| 3.1.1 Language of Page                                     | A     |         |       |
| 3.1.2 Language of Parts                                    | AA    |         |       |
| 3.2.1 On Focus                                             | A     |         |       |
| 3.2.2 On Input                                             | A     |         |       |
| 3.2.3 Consistent Navigation                                | AA    |         |       |
| 3.2.4 Consistent Identification                            | AA    |         |       |
| 3.2.6 Consistent Help                                      | A     |         |       |
| 3.3.1 Error Identification                                 | A     |         |       |
| 3.3.2 Labels or Instructions                               | A     |         |       |
| 3.3.3 Error Suggestion                                     | AA    |         |       |
| 3.3.4 Error Prevention (Legal, Financial, Data)            | AA    |         |       |
| 3.3.7 Redundant Entry                                      | A     |         |       |
| 3.3.8 Accessible Authentication (Minimum)                  | AA    |         |       |
| 4.1.2 Name, Role, Value                                    | A     |         |       |
| 4.1.3 Status Messages                                      | AA    |         |       |

## What axe could not decide

<The summary line `undecided` printed, and what you concluded of each rule.>
```

Those are WCAG 2.2's fifty-five success criteria at levels A and AA, as the W3C Recommendation lists
them at <https://www.w3.org/TR/WCAG22/>; 4.1.1 Parsing was removed in 2.2. Read each criterion's
wording and its Understanding document there, not from this table.
Each verdict is **Pass**, **Fail** with its issue's number, or **Not applicable** with why.

`matterhorn.md` is the same shape: a banner naming the date, you, the commit, the reader and the
screen reader, and the protocol's version; a table of every checkpoint, by the number and name the
protocol gives it, each with its verdict - **Pass**, **Fail** with its issue, or **Not applicable**
where the product makes nothing the checkpoint governs (it makes no forms, sound or embedded files,
for three) - and the cases each was judged on.

## The rows

Then, in the release's baseline (`docs/specification/baselines/<version>.md`, which a person writes -
[its README](../specification/baselines/README.md)), include CNT-176, CNT-177, CNT-078 and PUB-104, and
say how the three that no test cites are verified:

```markdown
## Verification

| ID          | Kind        | By                                                            |
| ----------- | ----------- | ------------------------------------------------------------- |
| **CNT-177** | attestation | <your name>, YYYY-MM-DD, docs/audits/<version>/wcag.md        |
| **PUB-104** | attestation | <their name>, YYYY-MM-DD, docs/audits/<version>/matterhorn.md |
| **CNT-078** | inherited   | CNT-177, CNT-176                                              |
```

`pnpm trace gate` refuses an attestation whose `By` is shorter than thirty characters or holds no date
as `YYYY-MM-DD`, or names a record under `docs/audits/` that is not there; and meets an `inherited`
row only where every requirement it names is included and met itself. CNT-176 needs no row of its
own: the browser suite's test naming it passing is its evidence. So CNT-078 is met only in a release
whose suite passed and whose audit a person made.

**Where the audit found a failure**, the record says so and the release does not attest: CNT-177 and
CNT-078 go in the baseline's `## Excluded` table, each with a reason naming the issues, rather than in
`## Included`. The same for PUB-104. A release may ship without claiming conformance; it may not claim
it over a failure somebody wrote down.

Run `pnpm trace gate` last. It must pass.
