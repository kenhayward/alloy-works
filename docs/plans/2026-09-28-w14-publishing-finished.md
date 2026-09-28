# W14: Publishing, finished

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W14 of
> [the rest of T1](2026-09-25-t1-remainder.md), under Ken's decisions of 2026-09-28:
> [ADR-0029](../decisions/0029-a-browser-suite-in-ci-and-attested-audits.md),
> [ADR-0030](../decisions/0030-the-conformance-report-joins-a-publication-after-it-is-recorded.md),
> [ADR-0031](../decisions/0031-t1-publishes-headings-to-six-levels.md) and STY-079. Its decisions, W-A to
> W-L below, were taken as recommended on his instruction of 2026-09-28 to work through W14, and are his
> to review.

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
| W14.5 | A style says where its caption sits (STY-079, STR-025): the catalogue, the default theme, template 14, Word and the editor            | Minor   |
| W14.6 | Word names what it cannot carry (PUB-100); IAM-075 and IAM-080 claimed and cited                                                      | Minor   |
| W14.7 | The desktop's spelling checker through the platform bridge (CNT-148), and the symbol palette (CNT-057)                                | Minor   |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                 | Instead of                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| W-A | **veraPDF is copied into the worker image from its pinned image** (`/opt/verapdf` and its JRE, by digest), and each worker keeps one in server mode, warm, as the test suite does                                                                                                        | A sidecar service, a second container to run and reach; or a download at build time from a URL nothing pins |
| W-B | **The check is a job of its own, `check_pdf`, enqueued in the transaction that records the publication**, so a worker that dies after recording leaves the check queued, never lost                                                                                                      | A step after recording in the same job, which a crash between the two would skip for ever                   |
| W-C | **The report is a row of its own, `publication_check`**, insert-only, one per PDF output: the checker and its version, the profile, compliant or not, and the failed rules. A publication's page says checked and passed, checked and failed, or not yet checked                         | Updating `publication_output`, which the runtime role may never update                                      |
| W-D | **The 300-page budget is measured in the worker's suite on a declared reference document and recorded beside the result**, binding locally and record-only on CI's runner, as STR-063's navigation budget is                                                                             | A budget binding on CI, whose shared runners are not the declared reference configuration                   |
| W-E | **A heading deeper than six levels is refused for PDF alone**, `heading_too_deep`, naming the section; Word publishes it                                                                                                                                                                 | Refusing every format, which Word does not need                                                             |
| W-F | **The regression corpus is one suite**, `regression.test.ts`: a case for each of the engine spike's nine, ported from `spikes/publishing-engine`, and a case for each publishing defect filed, named by its issue; the keep rules' cases join it                                         | Leaving the spike's cases in Python, which CI never runs                                                    |
| W-G | **The resolution order's test swaps adjacent stages where the code lets a test swap them**, and where the types forbid a swap, the test says so and shows the compile-time refusal instead                                                                                               | Claiming the order is tested where only the types keep it                                                   |
| W-H | **A figure or table carries `numbered`, true by default and stored only when false**, as an equation's does; an unnumbered one takes no number and is left out of the lists of figures and tables                                                                                        | A separate block type for an unnumbered figure, which every place that handles a figure would have to learn |
| W-I | **Caption placement is `caption: 'above' \| 'below'` on a table style and an image style**, in catalogue schema 3; the default theme keeps today's (a table's above, a figure's below), so nothing already published changes                                                             | A document-level setting, which STR-025 rules out: placement is the style's                                 |
| W-J | **Word's report names every structure Word does not carry**, one kind each: a description's language, a quotation, preformatted text and a quoted phrase as structure, a numbered equation set as a table, and a character the maths face lacks                                          | Claiming PUB-100 on the five kinds reported today                                                           |
| W-K | **The desktop's spelling checker is set through one bridge call, `setSpellCheckLanguages(languages)`**, which the shell answers with a pure function in `shell.ts` mapping a component's languages to the dictionaries Electron has; suggestions come from the window's own context menu | Enabling every dictionary at once, which marks correct words in the wrong language                          |
| W-L | **The symbol palette is a dialog of three groups** - mathematical, Greek, and scientific and technical - a keyboard-navigable grid that inserts a character at the cursor and gives the focus back                                                                                       | A character map of all of Unicode, which is the operating system's                                          |

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

## W14.5: Caption placement

1. Catalogue schema 3 with `caption` on table and image styles; the default theme's next version.
2. Template 14 and `publishing/14`; the Word writer; the editor's projection.
3. Tests: STY-079, STR-025.

## W14.6: Word's report whole, and two claims

1. The report kinds W-J names, written by the Word writer and worded on the publication's page.
2. IAM-075's claim, in service-foundations.md, with a test of each store's tenancy: the search
   projection, objects, secrets, publications and caches.
3. IAM-080 cited by the W9 test that shows it.
4. Tests: PUB-100, IAM-075, IAM-080.

**W14.6, as built.** Nine report kinds, `outputReportSchema`'s new members, written by `writeDocx`
and worded on the publication's page: `description_language_lost`, `quotation_not_structure`,
`preformatted_not_structure`, `definition_list_not_structure`, `quoted_phrase_not_structure` and
`inline_code_not_structure`, each by its place - the node and the block, a quoted phrase's or inline
code's the block of runs, a heading's none - and said once for each; `equation_numbered_as_table`,
by its place and label; and, once for a document setting an equation, `equation_alternative_lost` and
`maths_coverage_unchecked`, the Word family named. Three are more than W-J named, found by reading
every construct template 13 tags against the writer: a **definition list**, which the PDF tags as a
list and Word sets as paragraphs; **inline code**, which the PDF tags `Code`; and an **equation's
alternative**, which the PDF's `Formula` carries and OMML has no place for. **The maths face's
characters are reported once per document, not per character**: Cambria Math is not a face the
product ships and its coverage is not kept as data, so which characters Word draws from another face
cannot honestly be said here. The page says each kind named by a place alone once, counting its
places (`reportLines`), rather than a sentence per place. **PUB-100 is claimed** by word-output.md,
read clause by clause in its Accessibility section, and cited by `word/write.test.ts`'s three report
tests, the web page's and the worker's two tests over the whole document, which carry every clause
and name every kind. **IAM-075 is not claimed**: service-foundations.md's "Tenant scope of every
store" shows the search projection, objects, publications, the object store's credentials, sessions,
tokens and the caches scoped, but a sign-in client secret is read from the service's one secret store
by the name a tenant's row gives, and the OpenID Connect configurations are kept by issuer and client
with the secret they were discovered with, so two tenants naming one client share one secret. The
stores' new tests cite nothing but SCH-008, since citing an unclaimed requirement fails `trace
check`; each is ready to cite IAM-075 when the claim is made. **IAM-080** is cited by the W9 test
that offers Authoring only where the permissions give it.

## W14.7: The spelling checker and the symbol palette

1. `setSpellCheckLanguages` on the platform bridge; the shell's pure mapping, pinned by a test; the
   browser's delivery a no-op, since it uses the browser's own checker.
2. The symbol palette: a toolbar button and a shortcut, the dialog, insertion at the cursor.
3. Tests: CNT-148, CNT-057.
