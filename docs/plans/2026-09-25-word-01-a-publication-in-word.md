# Word 1: A publication in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as themes 1 was. It builds the first of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M): the
> plumbing (WO-A, WO-J, WO-K), the styles, paragraphs, headings, marks, links, languages, faces and the
> page, with the Word check (WO-L). Ken agreed every recommendation on 2026-09-25, and gave permission
> to download the Open XML SDK for validating in CI.
>
> **Built** (PR #231). [What the build changed](#what-the-build-changed) records where it departed
> from the rulings below.

**Goal:** a document can be published to Word. A request may name `docx`, alone or beside `pdf`; the
worker runs `assemble` once, told the formats, and the Word writer in `packages/domain` makes a `.docx`
that Word treats as its own - the theme's styles as Word styles, every property stated, headings
numbered by Word from the layout's scheme, the cover, the contents as a field, the running heads and
feet, "Not approved" on every page, marks, links and languages - with the faces embedded where Word can
carry them. The publication holds one output per format, each with its producer and a report of what
Word could not carry. Every `.docx` a test makes is valid by the Open XML SDK, and the Word check opens
the fixtures in Word itself.

**Not in this slice:** lists, quotations, preformatted text, tables and figures, inline images
(Word 2); footnotes, captions, cross-references, and lists of figures, tables and equations (Word 3);
equations (Word 4). A document holding any of them is refused for Word, by name, until its slice
lands - its PDF is unaffected. PUB-028's review marks (T6). The field-update prompt's acceptance by real
recipients (the design's open question).

**Requirements** each test cites, only where it shows the whole statement (read each with
`pnpm trace show`):

- **PUB-012** (a layout differs per format): layout schema 5 with a `docx` member, read and refused.
- **PUB-024** (heading numbers a numbering definition, never literal text): the writer's
  `numbering.xml`, and the Word check's list strings against the numbering table. The design listed it
  under Word 3; headings are this slice's, and a heading cannot be written without its number.
- **PUB-027** (styles map to Word styles): the full projection, read back.
- **PUB-034** and **CNT-084** (the document's and each passage's language carried into the output):
  cited once both outputs show it - the PDF's tests already do, so a Word test naming them completes
  them.
- **CNT-128** (a hyperlink carried to every output): `w:hyperlink` beside the PDF's link.
- **PUB-092** (keeps and widow control by style, passed to each engine as its own rule): the Word
  styles' `w:keepNext`, `w:keepLines` and `w:widowControl`, with the PDF's tests.
- **PUB-065** and **PUB-074** (pagination is Word's, the PDF is the paged record, and a Word-only
  request with page references is refused, or its report says it has none): the report and the
  refusal. In this slice no reference reaches Word, so PUB-074's refusal is tested through the request.
- **STY-052** (a face Word may not embed declares one it may, and every publication reports the
  substitution): the reader's refusal and the report. Its existing citation shows only the style
  projection; this slice completes it.
- **PUB-029** (verified by opening in Word, as a standing practice): the Word check and its recorded
  run.
- **Not cited:** PUB-023 (first-class, once Word 4 lands), PUB-025, PUB-026, PUB-066 (Word 3), PUB-035
  (Word 2), PUB-067 and CNT-045 (Word 4), STY-053 (its Word half waits for the Word check's
  measurements), TAB-039 and TAB-049 (Word 2).

## Rulings

- **R1. No `publishing/14`.** Nothing the Typst template reads changes: the Word writer's inputs - the
  layout's Word page, the resolved theme, image sizes against the Word page - are carried beside the
  document in what `assemble` returns, as the numbering table is. `PUBLISHING_SCHEMA_CURRENT`,
  template 13 and the PDF's `PIPELINE_VERSION` stay. The design said "becomes `publishing/14`"; a
  schema whose PDF half is byte for byte 13's buys a template copy and nothing else.
- **R2. `assemble` told its formats.** `AssembleInput` gains `formats` (at least one of `pdf`,
  `docx`). Each failure knows whether it is the PDF engine's own - `line_too_wide`, `caption_too_long`,
  `image_too_wide`, `table_header_spans_body`, a footnote, link or reference target in a table's
  header rows, `equation_unrenderable` for what Typst cannot set - and is reported only where `pdf` is
  asked for. The glyph checks and `typeface_not_embeddable` apply to both (the Word faces are the same
  files; `embedding.word` is checked for Word). Where `docx` is asked for, `assemble` returns
  `word: WordInput` beside the document: the layout's `docx` format, the resolved theme, and each
  figure's and image's size against the Word page (none in this slice). A request for both fails if
  either would.
- **R3. Not yet written, refused by name.** Where `docx` is asked for, a block or inline this slice
  does not write - `list`, `blockquote`, `preformatted`, `table`, `figure`, `equation`, an image, a
  footnote, a reference, and the lists after the contents - fails `word_not_yet`, naming the construct
  and where it stands, as `assemble`'s other failures do. Each later slice removes its constructs from
  the list. Where only `pdf` is asked for, nothing changes.
- **R4. Layout schema 5** adds `formats.docx`: the page (size, orientation, margins, gutter), the head
  and foot slots, and each matter's page numbering - the shapes the `pdf` member uses, by the same
  refinements. `PUBLISHING_FORMATS` becomes `['pdf', 'docx']`. **The default layout 0.6** is 0.5 with
  a `docx` member copying the `pdf` member's values, seeded by migration 0026, hash-guarded as 0023 and
  0025 were. A layout without a `docx` member still refuses a `docx` request (`format_unsupported`,
  PUB-014).
- **R5. The theme's Word side.** `projectStylesXml` projects every paragraph and character property
  (the design's "Styles are the theme's" paragraph): alignment, the three indents, background and
  padding (the fill, borders in its colour spaced by the padding, indents that keep it in the column),
  keep-together, widow and orphan control, hyphenation, contextual spacing; each mark's underline,
  colour, face, position and scale; `w:szCs` beside every `w:sz`; a `w:docDefaults` with the document
  language; heading styles named `Heading N`. `wordRun` names the character style of the first mark
  that carries appearance, skipping `language` and `hyperlink`. **The default theme 0.3** declares, for
  STIX Two Math, `embedding.word: false` and `wordFamily: 'Cambria Math'`; the reader refuses a face
  whose `embedding.word` is false and which declares no `wordFamily` (STY-052). Seeded by migration
  0026 beside the layout, hash-guarded as 0025 was.
- **R6. The writer**, `packages/domain/src/word/`, pure, exported: `writeDocx(published, numbering,
word, faces): { bytes, report }`, where `faces` maps each file the theme names to its bytes (the
  worker reads them; the domain reads no file). The parts: `[Content_Types].xml`, relationships,
  `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `fontTable.xml` and the embedded
  faces, headers and footers, `docProps/core.xml` (title, language). **Settings**: compatibility mode
  15, `w:doNotUseHTMLParagraphAutoSpacing`, `w:updateFields`, `w:embedTrueTypeFonts`, the document
  language. **Deterministic**: the same inputs make the same bytes (a fixed zip timestamp, parts in a
  fixed order, bookmark names by document order), which a test checks.
- **R7. Headings and numbering.** One numbering definition linked from the heading styles for the body,
  and one each for front matter and appendices, given to their headings by direct `w:numPr`, their
  formats and separators from the layout's section rules (measured M2). A section rule Word cannot
  compute fails `numbering_not_in_word`, naming the sequence and the rule; the default scheme's do not.
  Depth past six takes `Heading 6`'s style, as the PDF does, and past nine levels of numbering fails by
  name (WO-I).
- **R8. The page.** The cover a section of its own, unnumbered, `w:titlePg`; front matter, body and
  appendices each a section starting a page, with its page numbering from the `docx` member; the
  contents a `TOC \o` field to the layout's depth, on its own page, prefilled with the entries and no
  pages; "Not approved" (the layout's `notice` words, in the `notice` role) in every header, the cover's
  included; the running slots a paragraph with a centre and a right tab stop, their fields `PAGE`,
  `NUMPAGES` and `STYLEREF` by the level-1 heading style's name, `title` and `revision` as text; the
  notice sentence after the cover's title. The first paragraph of a section that starts a page writes
  no space before (M16).
- **R9. Text.** Paragraphs in their resolved style; marks by `wordRun`; `quotedPhrase` as the character
  style with no quotation marks added; a hyperlink as `w:hyperlink` with an external relationship;
  `language` marks and components in another language as `w:lang` (and `w:bidi`, `w:rtl` and
  `w:lang w:bidi` for a right-to-left language); contextual spacing turned off, and the facing spaces
  dropped, between two same-style paragraphs in different containers (M1 d8) - in this slice, between
  components.
- **R10. Faces.** Each face the theme's text uses whose `embedding.word` is true is embedded, every file
  of it the document needs (regular, bold, italic, bold italic as used), obfuscated by ECMA-376's font
  key; a face with a `wordFamily` is named by it and reported. `m:mathPr`'s `m:mathFont` is the maths
  face's Word face (used from Word 4).
- **R11. The store**, migration 0026: `formats` widened to any of `pdf` and `docx` on the request and
  the publication; `publication_output` takes `docx`, a `standard` null for it, and gains `producer`
  (`typst` with template 13, or `word`), `producer_version`, and `report jsonb`; the whole-record
  trigger requires one output per format the publication names. `recordPublication` writes each
  output; the contract's `PublicationView.outputs[]` carries format, standard, producer and report.
- **R12. The request and the job.** `requestPublication` accepts `docx` where the layout declares it;
  a request without `pdf` whose document holds a page reference is refused `page_reference_without_pdf`
  (PUB-074) - in this slice every reference is refused by R3 first, so the check stands on the outline
  and is tested there. The job asks `assemble` for the requested formats, runs Typst for `pdf` and the
  writer for `docx`, and records every output or none. The Word writer's version is `word/1`.
- **R13. The report.** Per output, a list of entries each naming what Word could not carry: a face
  substituted (STY-052) and, for a Word-only publication, that it carries no page-cited output
  (PUB-074); for every Word output, that page numbers cite the PDF (PUB-065). Later slices add tables'
  lost header columns, unrepeated headers and omitted labels. The service shows it on the publication.
- **R14. The web.** The documents page's publish action asks which formats - PDF, Word or both, PDF
  by default - where the layout declares both; a publication lists each output with a download, and a
  `view` link for the PDF only.
- **R15. Validation.** `apps/worker/tools/ooxml-check/`: a small .NET 8 console program over
  `DocumentFormat.OpenXml`'s `OpenXmlValidator` (Office 2019 file format), its package pinned by a
  NuGet lock file, built into an image from digest-pinned `mcr.microsoft.com/dotnet` images by
  `pnpm --filter @alloy-works/worker fetch-ooxml-check`, as veraPDF's is pulled; CI runs it beside
  `fetch-verapdf`. `checkOoxml(bytes)` in `apps/worker/src/testing/` returns its errors, and every
  worker test that makes a `.docx` asserts none.
- **R16. The Word check** (WO-L, PUB-029): `apps/worker/scripts/word-check.ps1`, grown from
  `spikes/word-measure/measure.ps1`. It builds the fixture documents through the worker's own path,
  opens each in Word through COM, updates its fields, and checks: it opens without an error; the
  headings' list strings equal the numbering table's section numbers; each embedded face is embedded;
  and saving it again changes no paragraph's text or style. It writes a record, and each pull request
  that changes the writer pastes its result. It runs on Windows with Word, not in CI.

## What the build changed

Built a task at a time, task 4 split in two - 4a, `assemble` told its formats, and 4b, the writer - for
smaller reviews. What the design took from it is word-output.md's
[What was built](../design/word-output.md#what-was-built); what follows is where the build departed
from the rulings above, and why.

**Rulings that moved before a line was written.**

- **PUB-024 moved into this slice** from Word 3, where the design listed it: headings are this
  slice's, and a heading cannot be written without its number.
- **Two migrations, not one.** R4 and R11 named 0026 for the layout and the store, and R5 for the
  theme; two tasks must not share a file, so 0026 is the theme's 0.3 alone (`0026_word`) and 0027 the
  layout's 0.6 and the store (`0027_word_layout_and_outputs`).
- **The contents is this slice's** (R8), since the default layout declares one and without it no
  document could be published to Word under the default.

**`assemble` (R1 to R3).**

- **R1 held**: no `publishing/14`. Template 13's pipeline pin, a digest of what `assemble` answers
  for one fixed input, passed unchanged, and the job's test compiles the document `assemble(['pdf'])`
  makes and finds it byte for byte the PDF stored beside a Word output.
- **`formats` is a required non-empty tuple**, and an empty list throws, a caller's defect. A failure
  is the PDF engine's own only where its every cause is: a reference whose target is in a header row
  _and_ lacks the form is every format's. **`equation_unrenderable` is split**: `unreadable`, `merror`
  and `empty` are every format's (`EQUATIONS_OWN`), the maths tree's other reasons the PDF's, for Word
  4 to decide. **`continuation_words_missing` is the PDF's**, since Word sets no continued label.
  `image_in_caption`, the other footnote and reference placements, `language_not_publishable`, the
  glyph checks and `nothing_to_publish` stay every format's.
- **A new compose failure, `format_unsupported`**, `detail` the format, for a request that reaches
  `assemble` asking for Word under a layout with no Word page, or with none at all. The door refuses
  it first (PUB-014), so it is met only past that check, and it is said rather than thrown.
- **`typeface_not_embeddable` keeps its one code and its sentence**, which names the PDF; for Word it
  is reached only by a theme built past the reader.
- **`word_not_yet` refuses at the stored construct, before its PDF checks**, `detail` the stored type
  (`list`, `blockquote`, `preformatted`, `table`, `figure`, `equation`, `image`, `footnote`,
  `crossReference`), or `listOf:<sequence>` for a list after the contents. **The cost, for Word 2 to
  4**: a PDF engine refusal still drops its construct from the published document, which is safe for
  Word only while `word_not_yet` refuses the same construct. Taking a figure, an image or a table off
  the list must stop `caption_too_long`, `image_too_wide` and the header-row reference dropping it for
  Word, or a Word-only publication loses it in silence. No test can yet show a Word-only request
  publishing past an engine refusal, since each arises inside a construct R3 refuses.
- **`word` is `WordInput | null`**, not optional, so every caller decides. It gained `scheme` (task
  4b), since the writer needs the section rules and neither the document nor the numbering table holds
  them. `images` is a `ReadonlyMap` whose key is left for Word 2's first figure.

**The theme (R5).**

- **`projectStylesXml(theme, { language, direction }, options?)`**, in the published document's own
  shapes; the options link the heading styles to their list and append the writer's contents styles.
  `w:docDefaults` carries the `text` place's face and size and the language, and `w:lang w:bidi` only
  in a right-to-left document. No `pPrDefault` and no `Normal` are written, since every paragraph
  names a style.
- **Measured in Word, and changed by it.** Every style states `w:outlineLvl` - its depth for a
  heading's, 9 otherwise - since the default's Title and Contents heading, based on heading 1, were
  listed in Word's contents without it; and `numId 0`, or they would take heading 1's number.
  Alignment start and end are `left` and `right`, which Word mirrors in a right-to-left paragraph as it
  does `start` and `end`. A panel's indents are its padding and 2pt, since Word's fill reaches 1.8 to
  2pt past its border's spacing, so its text stands 4pt narrower than the PDF's; the border's spacing
  is whole points up to 31, the most the standard allows. Every value that is off is written, since
  `basedOn` is kept and Word inherits property by property. A non-heading style named _heading N_ is
  written `<name> (<id>)`, since Word takes the name as its built-in heading.
- **Not measured**: `w:bCs` and `w:iCs` beside `w:b` and `w:i`, by M15's reading of `w:szCs`.
- **`scale` reaches Word per run**: a character style states no size, and `wordRun` pins every scaled
  run's size, so a recipient restyling inline code in Word cannot change its relative size. Sizes
  round to half points, so 8.8pt preformatted text is 9pt in Word. A run both subscript and
  superscript takes the inner mark's position, since Word holds one.
- **`wordRun` names the first mark whose character style states anything**, rather than skipping
  `language` and `hyperlink` by name: under the default that skips the link, the language and the
  quoted phrase, as R5 asks, and a theme that styles its links names `mark-hyperlink`, so Word
  restyles them.
- **The reader's refusal is `typeface_word_face_missing`**, and `embedding.word` now means a Word
  document can carry the face. 0.2 is frozen as `SECOND_DEFAULT_THEME`, as 0.1 became `FIRST_`.

**The layout, the store and the request (R4, R11, R12).**

- **`docx` is optional in schema 5 and `pdf` required**, so a layout without Word refuses it and every
  layout makes the paged record. The Word page takes the PDF page's rules but is **held to 1584pt, 22
  inches, each way**, Word's own limit, where a PDF page may reach 14400pt. A schema 4 layout reads as
  having no Word page, and `continued` is required of any layout written at schema 4 or later. 0.5 is
  frozen as `FIFTH_DEFAULT_LAYOUT`.
- **Formats are a set spelled PDF first**: `{pdf}`, `{docx}` or `{pdf, docx}`. A publication's engine
  and template are the PDF's, and null exactly without one (`publication_made_by_typst`); its pipeline,
  fonts, digest and numbering stay required, since one `assemble` made every output. A Typst output's
  `producer_version` is its publication's template version, backfilled from each publication by the
  one update an output row has taken, made as the owner. A PDF's report must be empty. A report's
  entries are closed by the domain's schema, checked on the way into and out of the store; the
  database checks only that it is an array.
- **PUB-074's refusal is at the request**, `page_reference.without_pdf`, on the wire
  `page_reference_without_pdf`, over the section titles and the content of every resolved component
  version - paragraphs, list terms and items, quotations and attributions, captions, notes, cells and
  footnotes - read once and shared with the images' resolution. **Any page reference counts**,
  `withoutPages` or not: Word has pages, just not the PDF's. A component the publisher may not read is
  not read for a page; its request is taken and fails at the job as `occurrence_unreadable`.
- **`RequestPublicationBody.formats` stays distinct strings**, not an enum, so an unknown format is
  still refused by name as `format_unsupported` (PUB-014). A PDF output's `report` is an empty tuple in
  the contract and its `view` a link; a Word output's `standard` and `view` are null.

**The writer (R6 to R10, R13).**

- **`writeDocx` takes one object**, `{ document, numbering, word, formats, faces }`, the domain's
  idiom, with `formats` so the report knows whether a PDF stands beside it; `faces` is keyed by
  SHA-256, the theme's own key for a file. A zip entry's time is 1980-01-01 from local fields, which
  read back the same in every time zone; a face's obfuscation key is the first 128 bits of its hash.
- **`numbering_not_in_word`** refuses four things, `detail` `section:<matter>:<why>`, each once per
  matter and reason: a separator holding `%`, letters past _z_ from the 28th (Word's doubled letters
  are the standard's, not measured), a roman numeral past 3999, and a heading numbered past a ninth
  level. A level's suffix is a space, not M2's tab, with no indent, as the PDF prints the number. A
  heading deeper than six takes `Heading 6`'s style with direct `w:numPr` and `w:outlineLvl`.
- **The page (R8).** The contents stands in a section of its own, so its running head can leave out
  the section field, which Word prints as an error before any level-1 heading. The section field is
  `STYLEREF "Heading 1" \n`, a space, `STYLEREF "Heading 1"`. The cover's notice-only header is both
  its first and its default, so a cover running to a second page keeps the notice alone. Headers and
  footers stand half their margin from the edge, which the layout does not say; `w:mirrorMargins` is
  written only where inside and outside differ or there is a gutter; a matter entered a second time
  continues the numbers before it, since Word cannot resume a chain as the PDF does. The contents is
  prefilled with number, tab and title, in writer styles `TOC1` to `TOCN` based on the contents
  entry's, to at most nine levels. The layout's words carry the layout's language, left to right.
- **M1 d8 is not written** (R9). No two same-style paragraphs of different containers face each other
  in this slice: each component's paragraphs follow its heading, and template 13 sets the top level as
  one flow, which Word's own contextual spacing already matches, so writing d8 there would contradict
  the PDF. It is Word 2's, for quotations, list items and cells. The writer's test asserts no direct
  `w:contextualSpacing` anywhere.
- **Right to left.** Every run of a right-to-left passage carries `w:rtl` and `w:lang w:bidi`, Latin
  included, as the PDF sets the whole passage right to left; the running paragraph carries `w:bidi`,
  its tab stops unchanged. **The revision is written in no direction** (task 6): with `w:rtl`, Word set
  the foot "0.7Revision", where Typst's bidi places digits by their characters.
- **Faces (R10).** Each Word family is named once; files are embedded only for faces the text is set
  in, each weight and posture used, the regular where a weight has none, and two typefaces of one Word
  family share its files. **`face_substituted` is reported only for a face the text is set in**, so
  the default's maths face reports nothing until Word 4 sets an equation, though `m:mathFont` names
  Cambria Math.
- **The report (R13)**: `face_substituted` with `family` and `wordFamily`, `no_page_cited_output` and
  `pages_cite_the_pdf`, in that order. The web says each in a sentence and leaves out a kind it does
  not know.

**The job and the web (R12, R14).**

- Outputs are made PDF first, each kept in the store as it is made, and recorded together. A Word
  output that cannot be kept after its PDF was fails the request `store_failed` with nothing recorded,
  the PDF left unreferenced, as a refused record already leaves one. The faces are read for Word by
  `pinnedFacesByHash`, the compile's own hash-checked read.
- **`DocumentView.layout.formats` was added to the contract**, since R14's "where the layout declares
  both" needs the page to know. The choice is three radio buttons in a group labelled **Publish as**,
  the button's name following it; the lists say which formats each publication was made in, and the
  downloads stay on the publication's page, since the list routes sign no links. Home's cards name
  Word beside the PDF (task 7).

**Verification (R15, R16).**

- **The validator's image is tagged by a hash of its five source files**, since a locally built image
  has no registry digest: a changed source names an image no machine has, and the tests say to run
  `fetch-ooxml-check` rather than validate with a stale build. `fetch-ooxml-check` skips a build whose
  tag exists. A file that is not a package is a thrown error, not a verdict, as with veraPDF's checker.
  The CI step is not `continue-on-error`, as its neighbours are not.
- **The Word check is a worker test with the PowerShell script beside it**, not a script alone: pdf.js
  and the typed readers are in the test, and the script is COM alone. It has five fixtures, a
  right-to-left one added to look at 4b's unmeasured right-to-left rulings. Its citation is on the
  describe inside `describe.runIf`, which `packages/trace` does not read, and it cites PUB-029 alone,
  since a skipped citation makes a requirement's outcome skipped in CI and would demote PUB-024. Every
  path handed to COM is cast to a string: a wrapped path made Word's export and save wait for ever.
- **Word showed two things the writer could not change**, both recorded in word-output.md: the digits
  of a right-to-left heading's number drawn in Times New Roman Bold, which the check pins exactly; and
  Word, hidden, updating the fields on opening, so the prefilled contents is never seen. Word rebuilds
  an entry as number, space, title; the prefill puts a tab after the number, which is left open.

**Citations.** PUB-012, PUB-024, PUB-027, PUB-034, CNT-084, CNT-128, STY-052's report half beside its
existing citation, PUB-074 and PUB-029; the citations pin moved from 316 to 325. **Not cited**:
PUB-092, since its "shown by the regression corpus to hold" is the PDF's corpus and nothing measures
Word's pagination; PUB-065, which asks for cross-references Word 1 refuses, `pages_cite_the_pdf` being
its record half; PUB-073, whose one baseline waits for T3; and PUB-023, PUB-066 and STY-053, for the
reasons the list above gives.

## Tasks

1. **Validation** (`apps/worker`, CI): R15 - the .NET tool, its lock file, the fetch script, the CI
   step, `checkOoxml`, and a test that it passes a hand-built valid document and refuses an invalid one.
2. **The theme's Word side** (`packages/domain`, `packages/db`): R5 - the projection, `wordRun`, the
   reader's STY-052 refusal, the default theme 0.3 and its seed in migration 0026's theme half.
3. **Layout, store and contract** (`packages/domain`, `packages/db`, `packages/api-contract`,
   `packages/api-client`, `apps/service`): R4, R11, R12's request half, R13's shape - layout schema 5,
   the default layout 0.6 and migration 0026's layout and store halves, the request accepting `docx`,
   the PUB-074 refusal, the contract and the client.
4. **`assemble` and the writer** (`packages/domain`): R1, R2, R3, R6 to R10, R13's entries - the
   formats, the target-aware failures, `word_not_yet`, `WordInput`, and the writer with its tests
   reading the parts back.
5. **The job and the web** (`apps/worker`, `apps/web`): R12's job half, R14 - both outputs from one
   job, the faces read and handed on, every `.docx` validated, the publish choice and the downloads.
6. **The Word check** (`apps/worker/scripts`): R16 - the script, its fixtures, one recorded run.
7. **Docs**: word-output.md's "What was built", publishing.md, architecture, features and the README,
   CLAUDE.md's status, this plan's status, the version (Minor, 0.70.0) and the changelog; trace
   generate and pins.
