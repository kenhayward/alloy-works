# Word 1: A publication in Word

> **A sketch**, built test first a task at a time, with one final whole-branch review before the pull
> request, as themes 1 was. It builds the first of the four slices in word-output.md's
> [Word output on publishing/13](../design/word-output.md#word-output-on-publishing13) (WO-M): the
> plumbing (WO-A, WO-J, WO-K), the styles, paragraphs, headings, marks, links, languages, faces and the
> page, with the Word check (WO-L). Ken agreed every recommendation on 2026-09-25, and gave permission
> to download the Open XML SDK for validating in CI.

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
