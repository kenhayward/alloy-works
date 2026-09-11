# 0015 - Word output: our own writer, reflowable by design

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 left the Word generation approach open
as "direct OOXML or an intermediate representation", constrained by
[ADR-0005](0005-purpose-built-node-and-mark-content-model.md)'s commitment to designing the schema
against the OOXML mapping. PUB-023 makes Word a first-class output; PUB-024 to PUB-028 require
numbering definitions rather than literal numbers, real footnotes, cross-references as fields, real
styles and tracked changes; PUB-029 requires the output to be verified in Word itself.

Two things settled since have narrowed the question. [ADR-0013](0013-typst-rendering-resolved-data-through-a-fixed-template.md)
made the resolved content model the intermediate every renderer reads, so "an intermediate" would
now mean a second one. And the direct route has already survived Word twice: the content model
spike's emitter - heading numbering, footnotes, `REF` fields, tracked changes, comments - was verified
in Word after four defects were found and fixed, and
[ADR-0014](0014-themes-resolve-once-project-three-times.md)'s style projection, with its run pins for
Word's bold and italic toggles, was verified in Word too.

The alternatives considered were Pandoc, which writes heading numbers as literal text and
cross-references as hyperlinks, failing PUB-024 and PUB-026; converting HTML or ODT through
LibreOffice, which gives up control of the style mapping PUB-027 depends on; and the `docx` library,
which is capable and MIT-licensed but places an abstraction between the product and the mapping
ADR-0005 committed to owning, while every construct would still need verifying in Word.

## Decision

**Word output is written by our own OOXML writer, in `packages/domain`, from the same resolved
document the PDF is made from. It reflows: its pages are Word's, and the PDF is the paged record.**

- **One writer, platform-free.** Pure TypeScript, zipped with `fflate`, growing out of the spike's
  emitter. It shares the resolve stage with the PDF, and takes its styles from the theme's Word
  projection and its runs from `wordRun` (ADR-0014).
- **Word reflows, and the product says so.** Word lays out its own pages and a recipient's first edit
  reflows everything after it, so no attempt is made to reproduce the PDF's page breaks. The Word
  document carries the same content, numbering and cross-references; a page number cites the PDF,
  and the publication record states it.
- **Anything showing a page number is a Word field, refreshed by Word when the document opens.**
  Contents, lists of figures and tables, and "see page N" references are fields, never numbers copied
  from the PDF, whose pages are not Word's. The document asks Word to update its fields on opening;
  a recipient sees Word's prompt once and gets numbers that are right. Section, figure and equation
  numbers are known from resolution and are written as fields with those numbers already in them;
  page numbers in headers and footers Word updates by itself.
- **Equations are native Word equations**, built from the same structural maths tree the PDF uses
  (ADR-0013) - never images, and never through Microsoft's MathML stylesheet, which ships with Office
  on terms that do not permit redistributing it.

## What would change the answer

- **The prompt proving unacceptable to recipients.** Some organisations' recipients will read Word's
  field-update prompt as a warning. The fallback is refreshing fields on the server with LibreOffice -
  no prompt, at the price of page numbers computed by LibreOffice's layout rather than Word's, and a
  large runtime in the publishing pipeline.
- **A customer requiring Word and PDF to share pages.** In this market people cite page numbers, and
  some will want "page 14" to mean the same page in both. The answer would be to state that it cannot
  survive an edit and offer it per layout, not to make it the default.
- **The mapping outgrowing hand-written XML.** If the set of constructs grows until owning the writer
  costs more than a library's abstraction does, the `docx` library is the alternative - but only
  where it can express what the requirements say, which is the reason it was not chosen here.

## Consequences

- **The spike's emitter becomes product code.** Its minimal XML scanner is the importer's concern,
  not the writer's, and is replaced when import is built, as the spike itself said it should be.
- **Two mechanics are decided and not yet seen in Word**: fields refreshed on opening, and native
  equations built from the maths tree. Both are checked in Word under PUB-029 before anything is
  built on them.
- **Maths needs a second projection of the same tree**, and it has one subtlety the PDF did not: in
  Word's equation format a sum, an integral or a limit contains its operand, where MathML sets the
  operand beside it, so the converter must take the next element in.
- **Generated Word parts are checked against the ECMA-376 schemas** in the conformance harness,
  because Word refuses a file with elements out of order rather than reading past them.
- Three requirements follow: PUB-065 (Word leaves pagination to Word, and the PDF is what a page
  number cites), PUB-066 (page numbers in Word are fields Word refreshes, never copied from the PDF),
  and PUB-067 (equations in Word are native, from the same structure as the PDF's).
- Scope §10 loses the Word generation approach; three reversible decisions remain.
