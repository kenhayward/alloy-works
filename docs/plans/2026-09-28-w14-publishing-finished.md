# W14: Publishing, finished

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W14 of
> [the rest of T1](2026-09-25-t1-remainder.md), under Ken's decisions of 2026-09-28:
> [ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md),
> [ADR-0030](../decisions/0030-the-conformance-report-joins-a-publication-after-it-is-recorded.md),
> [ADR-0031](../decisions/0031-t1-publishes-headings-to-six-levels.md) and STY-079. Its decisions, W-A to
> W-L below, were taken as recommended on his instruction of 2026-09-28 to work through W14, and are his
> to review. W-M was the lead's, from W14.7's final review.

**Goal:** every PDF publication is checked and says so; a heading too deep for PDF/UA-1 is refused by
name; the regression corpus holds the engine's cases and every defect's; a figure or table may be
unnumbered, and a style says where its caption sits; Word names everything it cannot carry; and the
last of the editor's T1 features, a spelling checker in the desktop app and a symbol palette, exist.

| PR    | Holds                                                                                                                                 | Version |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W14.0 | This plan                                                                                                                             | Build   |
| W14.1 | veraPDF on every publication: the checker in the worker image, a `check_pdf` job the record enqueues, `publication_check`, the page   | Minor   |
| W14.2 | Six heading levels, refused by name for PDF; the 300-page budget measured                                                             | Minor   |
| W14.3 | The regression corpus: the engine spike's cases and every publishing defect's, the keep rules among them; the resolution order's test | Minor   |
| W14.4 | A figure or table explicitly unnumbered (issue #129): the stored member, the editor, numbering, the PDF and Word                      | Minor   |
| W14.5 | A style says where its caption sits (STY-079, STR-025): the catalogue, the default theme, template 15, Word and the editor            | Minor   |
| W14.6 | Word names what it cannot carry (PUB-100); IAM-075 and IAM-080 claimed and cited                                                      | Minor   |
| W14.7 | The desktop's spelling checker through the platform bridge (CNT-178), and the symbol palette (CNT-057)                                | Minor   |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                     | Instead of                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| W-A | **veraPDF is copied into the worker image from its pinned image** (`/opt/verapdf` and its JRE, by digest), and each worker keeps one in server mode, warm, as the test suite does                                                                                                                            | A sidecar service, a second container to run and reach; or a download at build time from a URL nothing pins |
| W-B | **The check is a job of its own, `check_pdf`, enqueued in the transaction that records the publication**, so a worker that dies after recording leaves the check queued, never lost                                                                                                                          | A step after recording in the same job, which a crash between the two would skip for ever                   |
| W-C | **The report is a row of its own, `publication_check`**, insert-only, one per PDF output: the checker and its version, the profile, compliant or not, and the failed rules. A publication's page says checked and passed, checked and failed, or not yet checked                                             | Updating `publication_output`, which the runtime role may never update                                      |
| W-D | **The 300-page budget is measured in the worker's suite on a declared reference document and recorded beside the result**, binding locally and record-only on CI's runner, as STR-063's navigation budget is                                                                                                 | A budget binding on CI, whose shared runners are not the declared reference configuration                   |
| W-E | **A heading deeper than six levels is refused for PDF alone**, `heading_too_deep`, naming the section; Word publishes it                                                                                                                                                                                     | Refusing every format, which Word does not need                                                             |
| W-F | **The regression corpus is one suite**, `regression.test.ts`: a case for each of the engine spike's nine, ported from `spikes/publishing-engine`, and a case for each publishing defect filed, named by its issue; the keep rules' cases join it                                                             | Leaving the spike's cases in Python, which CI never runs                                                    |
| W-G | **The resolution order's test swaps adjacent stages where the code lets a test swap them**, and where the types forbid a swap, the test says so and shows the compile-time refusal instead                                                                                                                   | Claiming the order is tested where only the types keep it                                                   |
| W-H | **A figure or table carries `numbered`, true by default and stored only when false**, as an equation's does; an unnumbered one takes no number and is left out of the lists of figures and tables                                                                                                            | A separate block type for an unnumbered figure, which every place that handles a figure would have to learn |
| W-I | **Caption placement is `caption: 'above' \| 'below'` on a table style and an image style**, in catalogue schema 3; the default theme keeps today's (a table's above, a figure's below), so nothing already published changes                                                                                 | A document-level setting, which STR-025 rules out: placement is the style's                                 |
| W-J | **Word's report names every structure Word does not carry**, one kind each: a description's language, a quotation, preformatted text and a quoted phrase as structure, a numbered equation set as a table, and a character the maths face lacks                                                              | Claiming PUB-100 on the five kinds reported today                                                           |
| W-K | **The desktop's spelling checker is set through one bridge call, `setSpellCheckLanguages(languages)`**, which the shell answers with a pure function in `shell.ts` mapping a component's languages to the dictionaries Electron has; suggestions come from the window's own context menu                     | Enabling every dictionary at once, which marks correct words in the wrong language                          |
| W-L | **The symbol palette is a dialog of three groups** - mathematical, Greek, and scientific and technical - a keyboard-navigable grid that inserts a character at the cursor and gives the focus back                                                                                                           | A character map of all of Unicode, which is the operating system's                                          |
| W-M | **The palette dims what the typeface at the cursor lacks, pointing to an equation**: the family set there - the paragraph's style, or code's in preformatted text and inline code - is asked by the publish's glyph check, and a character it lacks stays in the grid, disabled, named as not in that family | Offering only covered characters, which hides the maths an author came for                                  |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; the full suite before each pull request, and its CI log read.
- A stored shape is checked against every write path it admits (W14.4, W14.5).
- Every trigger or function reading a table reads it by `tg_table_schema`.
- A publication already recorded publishes the same again: a new template version is added, never an
  old one changed.

## W14.1: veraPDF on every publication

1. `deploy/Dockerfile`'s worker stage copies veraPDF and its JRE from the pinned image; the image's
   entry-point check runs it.
2. A migration: `publication_check`, insert-only, deleted with its publication; the job kind
   `check_pdf`, enqueued in `recordPublication`'s transaction for each PDF output.
3. The worker keeps one warm veraPDF, as the test harness's server mode does, without Docker.
4. The publication's routes and page show the check.
5. Tests: PUB-091 (a publication's PDF checked and its report kept; a failing PDF's rules named); the
   check re-queued when a worker dies after recording.

## W14.2: Six levels, and the budget

1. `assemble` refuses a heading deeper than six for PDF, `heading_too_deep`, naming the section.
2. The regression corpus's nine-level case becomes a document refused for PDF and published to Word.
3. The budget: a declared 300-page reference document of prose, figures, tables, equations and
   footnotes, published a stated number of times, its p95 and slowest recorded beside the
   configuration.
4. Tests: PUB-103, PUB-102.

## W14.3: The regression corpus, and the order

1. The spike's nine cases ported; a case for each publishing defect filed; the keep rules' cases moved
   in.
2. The resolution order's test (W-G).
3. docs/testing.md's account of the corpus brought up to date.
4. Tests: PUB-087, PUB-092, PUB-098.

## W14.4: Unnumbered figures and tables (issue #129)

1. The requirement row from issue #129, landed by this pull request, which closes it.
2. `numbered` on figure and table blocks, the editor's toggle in the Figure and Table panels, numbering,
   the lists, the PDF and Word.
3. Tests: TAB-034, and the new row.

**W14.4, as built.** Issue #129 is **STR-071**, in STR rather than TAB because it is a rule of the
sequences, beside the row it supersedes: STR-070 numbered every figure and table, so the choice to
leave one unnumbered changes what the product must do and is a new row, which also keeps STR-070's
appendix case (the issue's comment) and says an unnumbered one is in no list and a reference to it
prints its caption. TAB-034's pointer moves from STR-023 to STR-071, a clarity edit. The stored member
is W-H's: `numbered: z.literal(false).optional()` on `tableNodeSchema` and `figureNodeSchema`, so a
numbered one has one spelling, the member absent, and `numbered: true` is refused; optional and so
additive, it leaves every stored table and figure valid and its canonical form, and so its digest,
unchanged, with `CURRENT_SCHEMA_VERSION` 1 and no migration - no content schema version was needed. The
editor's `tableFigure` and `figure` carry `numbered`, true by default, `fromEditor` writing the member
only when false; `setTableNumbered` and `setFigureNumbered` are one undoable step each, behind a
**Numbered** box in the Table panel and the Figure panel, never an inline image's. The product's own
clipboard keeps it through admission, which spreads a block; the readers write none; the service
refuses `numbered: true` as `content_invalid`. `contributionsOf` takes `numbered` from the block, so
`number` gives an unnumbered one no entry: no label, no counter value, no place in `listOf`.
`documentTargets` and `ownTargets` offer one by its caption, marked `unnumbered`, and `targetForms`
drops its number forms; resolution binds it to its caption with no label, so a title form prints the
caption and a number form fails `cross_reference_form_unavailable`, as an unnumbered equation's does.
**A new template was needed**, against the hope of avoiding one: template 13 already sets a caption
with no label, but its lists are Typst's `outline` over every figure of a kind, which would have
listed an unnumbered table with no number. So `publishing/14` gives a `PublishedTable` and a
`PublishedFigure` `listed`, false where the block has no numbering entry, and **template 14** is
template 13 with `outlined: b.listed` on both; `PUBLISHING_SCHEMA_13` freezes `publishing/13`,
`PIPELINE_VERSION` is `'14'`, and a document with none unnumbered is set by template 14 exactly as by
template 13, measured. W14.5's caption placement therefore takes template 15 and `publishing/15`,
not 14. The Word writer needed no change: with no entry, `captionRuns` writes no `SEQ` field, so Word
neither counts nor lists it. Tests: STR-071 in the domain's numbering, lists, references, `assemble`
and Word writer, the editor, the web panels and dialog, and the worker's PDF (text, tags, list and
veraPDF) for a table and a figure and its Word document through the Open XML SDK; TAB-034 in
`assemble`; STR-070's five numbering tests retitled STR-071. Not run: Word itself and the end-to-end
suite.

## W14.5: Caption placement

1. Catalogue schema 3 with `caption` on table and image styles; the default theme's next version.
2. Template 15 and `publishing/15` (W14.4 took 14); the Word writer; the editor's projection.
3. Tests: STY-079, STR-025.

## W14.6: Word's report whole, and two claims

1. The report kinds W-J names, written by the Word writer and worded on the publication's page.
2. IAM-075's claim, in service-foundations.md, with a test of each store's tenancy: the search
   projection, objects, secrets, publications and caches.
3. IAM-080 cited by the W9 test that shows it.
4. Tests: PUB-100, IAM-075, IAM-080.

## W14.7: The spelling checker and the symbol palette

1. `setSpellCheckLanguages` on the platform bridge; the shell's pure mapping, pinned by a test; the
   browser's delivery a no-op, since it uses the browser's own checker.
2. The symbol palette: a toolbar button and a shortcut, the dialog, insertion at the cursor.
3. Tests: CNT-178 (CNT-148 until the final review superseded it), CNT-057.

**W14.7, as built.** `PlatformBridge` gained `setSpellCheckLanguages(languages)`. Every component
editor holds its base language in `spellingFor(bridge)` (`apps/web/src/platform/spelling.ts`) while it
is open and as it changes, and the bridge is told the list of every component open whenever it changes,
but never emptied, since setting no dictionary would switch the desktop's checker off for the page's
other fields, and never the list it was last told, which StrictMode's second opening would be. Only the
base language is asked for, not a marked run's: CNT-147 already stops a run in another language being
checked, so its dictionary would check nothing. The browser's bridge does nothing. The preload sends the
list on `alloy-works:spell-check-languages`, pinned in `shell.test.ts`, and is typed as the renderer's
own `PlatformBridge`, so the contract binds the shell. The main process decides with
`spellCheckerChoice` in `shell.ts`: a request that is not an array of at most eight tags in the stored
model's shape is refused whole and logged without its content; macOS is left to the system's checker,
where Electron's `setSpellCheckerLanguages` does nothing; each tag maps by `spellCheckerLanguages` to the
tag's own dictionary, its language's, that language's usual one (`en-US` for English, `xx-XX`
otherwise) or any of that language, else is dropped; and a request mapping to none leaves the
dictionaries as they were. The window's `context-menu` offers up to five suggestions and **Add to
dictionary**, structured by `spellingMenu` and carried out by `main.ts`. The palette is a registry row,
**Symbols** on `Mod-Shift-m`, prompting as **Equation** does: `canInsertSymbol` and `insertSymbol` in
`packages/editor/src/symbols.ts` type one code point at the selection in one transaction, anywhere text
is typed. `SymbolPalette` draws the three groups of `apps/web/src/editor/symbols.ts` - 66 mathematical,
53 Greek and 19 scientific and technical characters, each by its code point, NFC-stable, named by its
Unicode name in plain words taken from the Unicode Character Database - as grids of twelve to a row,
one tab stop each, and gives the focus back to the view it was opened over, the surface or a footnote's
text. The icon is an omega, as a letterform. Not run: the packaged app, so no dictionary Electron
downloads or marks with was watched, and nothing on macOS.

**From the final review:** 50 of the palette's 138 characters - most of the logic and set symbols,
the double-struck number sets, degrees Celsius and Fahrenheit and the Planck constants - are not in
the default theme's Liberation Serif or Mono, so inserting one failed the publish (STY-049). Under
W-M the palette asks `typefaceAt` (`apps/web/src/theme/check.ts`) of the family set where
`textWhereAt` (`packages/editor/src/resolution.ts`) says the cursor stands, by the same
`characterProblems` and `covers` the surface's marks use, and dims what it lacks: `aria-disabled`,
still reachable by the arrows, named "..., not in <family>; use an equation", with one line above
the grids saying so; with no presentation every character is offered, as before. The CNT-057 test
names the degree sign rather than degrees Celsius, and a data test holds the Greek group and that
test's characters to the default serif. `insertSymbol` now refuses what its doc said it refused -
the line and paragraph separators, a lone surrogate, a format character and private use - and its
range test counts one transaction and one undo. CNT-148 was superseded by CNT-178, because macOS
chooses its checker's languages itself and an application cannot set them; features.md already said
so, which is what CNT-178 asks. A word added to the desktop's dictionary is kept in the app's own
and cannot yet be removed, which the docs now say.
