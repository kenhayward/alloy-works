# 0013 - Typst, rendering resolved data through a fixed template

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 carried the pagination and PDF engine as
the last irreversible decision. [ADR-0007](0007-no-per-server-licensing-in-the-publishing-pipeline.md)
had limited it to open-source engines, and
[`Publishing_Engine_Spike.md`](../specification/Publishing_Engine_Spike.md) set nine cases against
four of them - WeasyPrint, PagedJS, Typst and headless Chrome. The findings are in
[`Publishing_Engine_Spike_Findings.md`](../specification/Publishing_Engine_Spike_Findings.md); what
follows is what they decided.

**Typst was the only engine to pass all four gates, and nothing else passed more than two.** Its
tagged output meets PDF/UA-1 and carries a passage's language, which WeasyPrint's does not. It places
every footnote on its anchor's page and splits one too long to fit, where WeasyPrint sets the opening
of such a note above the top of the page, invisibly. And it previews incrementally - an edit reaches
page 40 of a 300-page document in under half a second wherever the edit is - which answers PUB-Q04,
the tension between a preview that is fast and one that comes from the same pipeline as a publication.

Cases 5 to 9 then ran against Typst and WeasyPrint. Typst passed all five, two of them with a cost the
pipeline can carry; WeasyPrint passed on budget but printed one contents entry with the wrong page
number, while its own link on that line pointed at the right one.

**Choosing Typst collides with [ADR-0005](0005-purpose-built-node-and-mark-content-model.md).** That
record makes XHTML "the defined publishing intermediate, and a first-class export", and Typst does not
read XHTML. The spike found that the cost of that is not the code to emit something else - both
emitters it wrote were small - but two things the XHTML intermediate had been doing quietly:

- **A theme was one thing.** The editor renders the theme's typefaces at the theme's sizes in CSS
  (CNT-097). If the PDF comes from Typst, a theme must produce both CSS for the editor and Typst for
  the output, and the two must agree.
- **An escaping slip was a formatting bug.** Typst markup is a programming language. An emitter that
  writes it turns every missed escape into code executing inside the publishing pipeline - which the
  spike demonstrated: one unescaped line of content printed a file from the compile root into the
  document.

## Decision

**Typst paginates and renders the PDF. It is given the resolved document as data, read by one fixed
template, and never Typst source.**

- **The resolved content model is the publishing intermediate.** Resolve produces the document with
  transclusion, conditions, variables and bindings applied (PUB-002) as JSON - the shape the content
  model already has. That is what a renderer consumes.
- **One template, which never changes per document.** It reads the JSON with `json()` and builds the
  page from values. Every string arrives as a string and is set as text. Nothing is evaluated, so
  content cannot become code however it is written; the spike tried, and it came out as the literal
  characters. This is PUB-062.
- **Equations take the same route, without `eval`.** The content model stores LaTeX (CNT-044). LaTeX
  becomes MathML - which Word needs anyway on its way to OMML - and MathML becomes a structural tree
  the template assembles from Typst's own maths functions, each operator as a Typst symbol so that it
  keeps its native class, size and stretch. A construct the tree does not recognise fails the build
  rather than rendering as source (CNT-049).
- **Each compile runs in a root holding only its own job's files.** Typst confines file access to
  the compile root; the root is where that confinement has to mean something.
- **Fonts come only from the files the baseline pins** - `--ignore-system-fonts`,
  `--ignore-embedded-fonts`, `--font-path` - so nothing on a host can reach the output (STY-047).
  Typst warns rather than fails on a missing face; **the pipeline treats that warning as a failed
  publish** (STY-040). And because no engine warns about a face that loads but lacks a character, the
  pipeline checks glyph coverage itself before compiling (STY-049).
- **The creation timestamp is always pinned**, to the time recorded with the publication. With it,
  output is byte-identical run to run and across x86 and ARM; without it, only dates and identifiers
  differ.
- **A publication records the Typst version and the template version that produced it** (PUB-063),
  and a baseline stays re-publishable on that version (VER-041).
- **Preview is the same compiler, kept warm.** A long-lived compilation per open document reuses
  unchanged layout between edits. A page-range preview is untagged, because Typst cannot tag part of a
  document; a publication is always PDF/UA-1 (PUB-061).

**This narrows ADR-0005 without superseding it.** The content model, the marks and everything else in
that record stand. XHTML remains a first-class export and the natural source of an HTML reading
format (PUB-056). What changes is only which representation sits between resolve and render - and
the answer is the one every format was already produced from. ADR-0005's status stays Accepted,
because the status vocabulary has no word for "partly superseded" and it would be wrong to say the
whole record no longer holds.

## What would change the answer

- **The theme compiling twice turning out to cost more than it saves.** Every other finding favours
  Typst; this is the one that could reverse it. It becomes measurable when the theme model is
  designed, and if a single theme cannot reliably produce both a CSS editor view and a Typst template
  that agree, an HTML engine with the defects the spike found becomes the cheaper thing to fix.
- **A screen reader disagreeing with the validator.** PDF/UA-1 conformance here is veraPDF's
  machine-checkable rules. The Matterhorn Protocol has checkpoints only a person can judge, and
  nobody has listened to the output yet.
- **Typst's direction.** It is Apache-2.0 and moving quickly - three releases in nine months. Speed is
  why PUB-063 pins the version; a change of licence or direction would make the template, which is
  ours, the thing to carry to another engine.
- **Documents far beyond 300 pages.** Memory grew linearly, about 1.7 MB a page. A thousand-page
  document is a sizing question for workers; ten thousand would be a different one.
- **Real content behaving unlike synthetic content.** Every document the spike used was generated.
  The cases should be re-run against a real report before the pipeline is built on them.

## Consequences

- **PUB-Q01 and PUB-Q04 are settled**, and scope §10 loses its last irreversible decision.
- **The theme model has to compile to two targets.** STY's design must say how one theme produces
  CSS for the editor and parameters for the template, and how the two are kept in agreement. That is
  the largest piece of work this decision creates.
- **Seven requirements follow.** PUB-061 to PUB-064 (untagged range previews, content as data, the
  engine version recorded, a provisional publish budget), VER-041 (re-publishable on that version),
  CNT-114 (a provisional preview budget, which CNT-096 had promised and nobody had written), and
  STY-049 (every character must have a glyph in the theme's faces).
- **Word output is not decided here**, but it now shares a step: LaTeX to MathML serves both the
  Typst tree and OMML.
- **WeasyPrint's two silent defects are recorded, not reported upstream by this record.** A footnote
  set above the page and a contents entry printing a stale page number are both worth an issue on
  that project; neither changes this decision.
- **`spikes/publishing-engine/template.typ` and `typst_data.py` are the first draft of the shape**,
  and should be read before the publishing pipeline is designed - especially the note on why
  operators are symbols rather than strings.
