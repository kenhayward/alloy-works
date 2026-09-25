# Word output - measurements in Word (2026-09-25)

Microsoft Word 16.0 (COM `Version` "16.0"), UI and install language 1033 (en-US), on Windows 11,
driven from Windows PowerShell 5.1. Every document was built by hand from part XML with the kit
(`docx.mjs`), opened read-only in a hidden Word, measured through COM (`measure.ps1`), and, where
the brief asks what Word _sets_, exported to PDF by Word and read back with pdfjs (baselines, font
programs) and rendered to PNG by Windows' own PDF renderer (`Windows.Data.Pdf`) to look at it.

Scripts, one per probe, are in `probes/`; every document, JSON report, PDF and PNG is in `out/`.
Numbers below are exactly as Word or the PDF reported them. Where something was not observed, it
says so.

## Kit and method

- `measure.ps1` extended: records the WINWORD process it starts and stops only that one if `Quit`
  leaves it running; `-Probe <ps1>` dot-sources a probe's own COM reads with `$doc`/`$out` in scope;
  `-Json` writes the report as UTF-8; the report carries the window caption.
- `docx.mjs` extended: `files`, `overrides` and `defaults` for arbitrary package parts (fontTable,
  fonts). Nothing else in it changed.
- `probes/common.mjs` adds `COMPAT15` (`w:compat/compatSetting compatibilityMode=15`, used by every
  probe except where M1 compares), `fld()` (a complex field with a prefilled result; switches typed
  as `/h` and turned into backslashes in code), `bm()`, `lvl()`. `probes/headings.mjs` is M2's
  measured heading setup, reused by M3, M4, M8 and M9.
- Readers: `probes/run.ps1` (build + measure; `-Both` measures as opened and after updating fields),
  `probes/show.mjs`, `probes/ys.mjs` (steps between paragraphs), `probes/pdftext.mjs` (PDF baselines
  and font names), `probes/pdffonts.mjs` (which family names each embedded font program carries),
  `probes/pdfpng.ps1` (PDF page to PNG), `probes/crop.ps1`, `probes/fillbox.ps1` (bounding box, in
  points, of a colour in a rendered page), `probes/openall.ps1` (open every file in a folder).
- "Updated" means `measure.ps1 -UpdateFields`: every TOC/TOF `.Update()`, `Fields.Update()`, and each
  header/footer's fields - what a person gets after accepting the update prompt or pressing F9.
- Liberation Serif is not installed; every run that asks for it is set by Word in Times New Roman
  (`TimesNewRomanPSMT` in every PDF, except M10's embedded case). COM still reports the font name as
  "Liberation Serif". Liberation Serif and Times New Roman are metric-compatible, so positions are
  meaningful.

**A limit of the harness, measured.** "Opens without repair" cannot be fully observed hidden with
alerts off: a control with an unknown element in a paragraph (`<w:bogusElement/>`, `m10-broken`)
opened with no error and a normal caption ("m10-broken.docx - Read-Only"). Malformed XML does fail
to open (`ERROR: Word experienced an error trying to open the file`), which is how two of my own
probe bugs showed (an unescaped `&` in M11's label text; a truncated `sectPr` in an M10 variant),
both fixed and rerun. So below, "opens" means Word opened it without error and laid it out; it is
not proof that no silent repair happened.

**Housekeeping.** A hidden WINWORD (PID 33824, started 09:43:20, no window, no documents) was already
running when this work began; it was not started here and was left alone. One WINWORD this work
started (PID 29512) spun at full CPU for minutes in an M11 loop that linearised each equation through
COM; it had no window and was stopped. That COM read was removed from M11.

---

## M1 Space between paragraphs, and contextual spacing

Default theme's `quotation` style (`default.ts`, catalogue 0.2): spaceBefore **16.5** (330 twips),
spaceAfter **12.65** (253), lineSpacing **14.35** inherited from the base (287, `atLeast`),
contextualSpacing **true**; `body`: spaceAfter 2.75 (55), contextualSpacing false.

Script `probes/m1.mjs`; documents `m1-nocompat` (no `w:compat`, Word reports `CompatibilityMode` 12),
`m1-compat15` (15), `m1-htmlflag` (15 plus `<w:doNotUseHTMLParagraphAutoSpacing/>` in `w:compat`).
Each case on its own page. "Step" is the COM y difference between consecutive paragraphs' first
lines; a control of two paragraphs with no spacing steps **14.40** (Word's pitch for a 14.35 `atLeast`
line, in COM and in the PDF baselines alike). Gap = step - 14.40.

```xml
<!-- style -->
<w:pPr><w:spacing w:before="330" w:after="253" w:line="287" w:lineRule="atLeast"/><w:contextualSpacing/>...
<!-- (c) direct override -->
<w:pPr><w:pStyle w:val="quotation"/><w:contextualSpacing w:val="0"/></w:pPr>
<!-- the flag that changes (a) -->
<w:compat><w:doNotUseHTMLParagraphAutoSpacing/><w:compatSetting w:name="compatibilityMode" ... w:val="15"/></w:compat>
```

| Case                                     | compat 12 step / gap | compat 15 step / gap | 15 + doNotUseHTMLParagraphAutoSpacing step / gap |
| ---------------------------------------- | -------------------- | -------------------- | ------------------------------------------------ |
| (a) A after 12.65, B before 16.5, direct | 30.90 / 16.50        | 30.90 / 16.50        | 43.50 / 29.10                                    |
| (b) both quotation, contextual on        | 14.40 / 0            | 14.40 / 0            | 14.40 / 0                                        |
| (c1) off on B only                       | 18.30 / 3.90         | 18.30 / 3.90         | 30.90 / 16.50                                    |
| (c2) off on A only                       | 27.00 / 12.60        | 27.00 / 12.60        | 27.00 / 12.60                                    |
| (c3) off on both                         | 30.90 / 16.50        | 30.90 / 16.50        | 43.50 / 29.10                                    |

PDF baselines agree (compat 15, case a: 98.42 -> 129.14, step 30.72; case c1: 114.86 -> 133.10, step 18.24).

Reading: by default Word does **not** add the two spaces - it sets max(12.65, 16.5) = 16.5; and
contextual spacing removes a paragraph's own space on the side that faces a same-style neighbour, but
the neighbour's space is still reduced by the suppressed one (c1: 16.5 - 12.65 = 3.85, observed 3.90).
With `doNotUseHTMLParagraphAutoSpacing` the spaces add (29.10 for 29.15) and contextual spacing is
simply per paragraph, per side: c1 = B's 16.5 only, c2 = A's 12.65 only.

(d) Two consecutive quotations, each two paragraphs, between body text. The PDF's gaps (STY-050,
spaces add) are 2.75 + 16.5 = 19.25 into the first, 0 within, 12.65 + 16.5 = 29.15 between, 0 within,
12.65 + 0 out. Steps (gap in brackets):

| Variant                                                                                                                                                                                 | T0->Q1a          | Q1a->Q1b     | Q1b->Q2a         | Q2a->Q2b     | Q2b->T1          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ | ---------------- | ------------ | ---------------- |
| d1 all quotation style, compat 15                                                                                                                                                       | 30.90 (16.5)     | 14.40        | 14.10 (0)        | 14.40        | 27.00 (12.6)     |
| d1 same, with the flag                                                                                                                                                                  | 33.60 (19.2)     | 14.40        | 14.40 (0)        | 14.10        | 27.00 (12.6)     |
| d2 Q1b and Q2a `contextualSpacing=0`, flag                                                                                                                                              | 33.60            | 30.90 (16.5) | 43.50 (29.1)     | 27.00 (12.6) | 27.00            |
| d3 no contextual; direct before/after per position, flag                                                                                                                                | 33.60 (19.2)     | 14.40        | 43.50 (29.1)     | 14.40        | 27.00 (12.6)     |
| **d8** style kept; last paragraph of a quotation followed by another: `contextualSpacing=0` + `before=0`; first paragraph of the following one: `contextualSpacing=0` + `after=0`; flag | **33.60 (19.2)** | **14.40**    | **43.50 (29.1)** | **14.40**    | **27.00 (12.6)** |
| d6 every space written as the STY-050 sum on the lower paragraph's before, afters 0, compat 15 (no flag)                                                                                | 33.60            | 14.40        | 43.50            | 14.40        | 26.70            |
| d7 style kept, Q2a off with before 41.8, compat 15 (no flag)                                                                                                                            | 30.90            | 14.40        | 43.20 (28.8)     | 27.30        | 27.00            |

d8's PDF baselines: 98.42, 131.90, 146.30, 189.74, 204.14, 231.14 (steps 33.48, 14.40, 43.44, 14.40, 27.00).

```xml
<w:p><w:pPr><w:pStyle w:val="quotation"/><w:contextualSpacing w:val="0"/><w:spacing w:before="0"/></w:pPr>...Q1b</w:p>
<w:p><w:pPr><w:pStyle w:val="quotation"/><w:contextualSpacing w:val="0"/><w:spacing w:after="0"/></w:pPr>...Q2a</w:p>
```

**Finding:** Word collapses adjacent spaces to the larger (compat 12 and 15 alike); with
`w:doNotUseHTMLParagraphAutoSpacing` they add as STY-050 does, and then d8 (or d3) reproduces every
PDF gap within 0.2pt while a quotation's own paragraphs stay contextually spaced.

## M2 Heading styles and numbering

Script `probes/m2.mjs`. Styles `w:styleId="heading-1"`/`"heading-2"`, linked to abstractNum 1
(`%1`, `%1.%2`, each level's `w:pStyle` naming the style) by `w:numPr` in the style. Front-matter
headings carry direct `w:numPr` numId 2 (abstractNum 2, `lowerRoman` `%1`); appendix headings numId 3
(abstractNum 3, `upperLetter` `%1`, second level `decimal` `%1.%2`). Four variants: name "Heading 1"
with `w:outlineLvl`; name "Heading 1" without; name "heading 1" (lower case) without; name
"Section Heading" with `w:outlineLvl`. Two TOC fields: `TOC \o "1-3" \h \z \u` and `TOC \o "1-3" \h`.

```xml
<w:style w:type="paragraph" w:styleId="heading-1"><w:name w:val="Heading 1"/>...
  <w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>...(<w:outlineLvl w:val="0"/>)</w:pPr>
<w:p><w:pPr><w:pStyle w:val="heading-1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>...
```

| Variant                       | Style.NameLocal                      | BuiltIn | OutlineLevel | wdStyleHeading1 in use |
| ----------------------------- | ------------------------------------ | ------- | ------------ | ---------------------- |
| "Heading 1", outlineLvl       | Heading 1 / Heading 2                | true    | 1 / 2        | true                   |
| "Heading 1", no outlineLvl    | Heading 1 / Heading 2                | true    | 1 / 2        | true                   |
| "heading 1", no outlineLvl    | Heading 1 / Heading 2                | true    | 1 / 2        | true                   |
| "Section Heading", outlineLvl | Section Heading / Subsection Heading | false   | 1 / 2        | false                  |

ListString of every heading, in order, identical in all four: **i, ii, 1, 1.1, 1.2, 2, 2.1, A, A.1,
A.2, B**. Both TOC fields, in all four variants, after update: `i Preface by Ada 1`, `ii Foreword by
Grace 1`, `1 Introduction 1`, `1.1 Scope 2`, ... `A Tables of values 2`, `A.1 First values 2`,
`B Glossary 2` - entries carry the numbers (as `number<tab>title<tab>page`), in TOC 1 / TOC 2.

**Finding:** a style named "Heading N" (either case) is Word's built-in Heading N whatever its styleId,
with the outline level implied; per-matter numbering by direct `numPr` over one style-linked list gives
i/1/A with `A.1`, and `TOC \o` picks up any style with an outline level, numbers included.

## M3 Caption numbers as fields

Script `probes/m3.mjs`. Captions `Figure {STYLEREF 1 \s}.{SEQ Figure \* ARABIC \s 1} text` (and
`Table`), in a front chapter, two body chapters (one under a second-level heading) and an appendix
chapter, headings as M2. Variants: prefilled with the scheme's values (`m3-level`); `STYLEREF
"Heading 1" \s` (`m3-name`); `STYLEREF 1` without `\s` (`m3-nos`); every value prefilled wrong as
"Z.9" (`m3-wrongfill`), to prove the update.

| Caption (in order)    | as opened, wrongfill | updated, level / name / wrongfill | updated, no `\s`          |
| --------------------- | -------------------- | --------------------------------- | ------------------------- |
| front chapter figure  | Figure Z.9           | Figure i.1                        | Figure Preface by Ada.1   |
| body 1 figure         | Figure Z.9           | Figure 1.1                        | Figure Introduction.1     |
| body 1 figure         | Figure Z.9           | Figure 1.2                        | Figure Introduction.2     |
| body 1 table          | Table Z.9            | Table 1.1                         | Table Introduction.1      |
| body 1, under 1.1     | Figure Z.9           | Figure 1.3                        | Figure Introduction.3     |
| body 2 figure         | Figure Z.9           | Figure 2.1                        | Figure Method.1           |
| body 2 table          | Table Z.9            | Table 2.1                         | Table Method.1            |
| appendix A figure     | Figure Z.9           | Figure A.1                        | Figure Tables of values.1 |
| appendix A table      | Table Z.9            | Table A.1                         | Table Tables of values.1  |
| appendix A, under A.1 | Figure Z.9           | Figure A.2                        | Figure Tables of values.2 |

**Finding:** `SEQ \s 1` restarts at every Heading 1 (front, body and appendix alike, not at level 2),
`STYLEREF 1 \s` returns the heading's list number in its matter's format ("i", "1", "A"), and until
updated a field shows exactly its prefilled result.

## M4 Cross-references as fields

Script `probes/m4.mjs`. Hidden bookmarks `_Ref000000001` around the caption's label and number
(`Figure {STYLEREF}.{SEQ}`) and `_Ref000000002` around a numbered heading's text, both on page 2;
references on page 1 (before), on page 2 either side of the caption, and on page 3 (after).
`m4-right` prefilled with what the scheme prints, `m4-wrong` prefilled wrong.

| Field                                         | where                     | prefilled (right / wrong) | updated (both)        |
| --------------------------------------------- | ------------------------- | ------------------------- | --------------------- |
| `REF _Ref000000001 \h`                        | p1 / p3                   | Figure 2.1 / Figure 9.9   | **Figure 2.1**        |
| `REF _Ref000000001 \p \h`                     | p1 (other page, before)   | below / nowhere           | **below**             |
| `REF _Ref000000001 \p \h`                     | p3 (other page, after)    | above / nowhere           | **above**             |
| `REF _Ref000000001 \p \h`                     | p1, second paragraph      | x / nowhere               | **below**             |
| `REF _Ref000000001 \p \h`                     | p2, before / after target | below, above / nowhere    | **below / above**     |
| `REF _Ref000000001 \p \h`, run `w:lang de-DE` | p1 / p3                   | unten / nowhere           | **unten / oben**      |
| `REF _Ref000000002 \r \h`                     | p1 / p3                   | 2 / 9                     | **2**                 |
| `REF _Ref000000002 \h`                        | p1 / p3                   | Method / Wrong title      | **Method**            |
| `REF _Ref000000002 \r \p \h`                  | p1 / p3                   | 2 below / nothing         | **2 below / 2 above** |
| `PAGEREF _Ref000000001 \h`                    | p1 / p3                   | (empty)                   | **2**                 |
| `PAGEREF _Ref000000001 \h`                    | p1 / p3                   | ?                         | **2**                 |

`\p` gave "above"/"below" on a different page as well as on the same one (never "on page N"); its word
followed the language of the field's run (de-DE -> unten/oben) with the UI in en-US. Bookmarks
(`Bookmarks.ShowHidden = true`): `_Ref000000001`, `_Ref000000002` hidden as expected.

Bookmark names: a 45-character `_Ref000...` was **truncated to 40** on open (read back as
`_Ref000000000000000000000000000000000000`, len 40), and `REF` naming the full 45 characters still
updated from "WRONG long" to the target text. A hyphenated `b-abcdefghijklmnopqrstuvwxyz-1` was
**kept as is**: listed as a visible bookmark, `REF` to it updated from "WRONG hyphen" to the target
text, `<w:hyperlink w:anchor="b-...">` became `HYPERLINK \l "b-..."` with `SubAddress` intact, and a
`SaveAs2` copy wrote `w:name="b-abcdefghijklmnopqrstuvwxyz-1"` back unchanged (and the long name as
the 40-character one). No error, no visible repair.

**Finding:** REF/PAGEREF give the scheme's text and page only after an update (prefill is what shows
until then); `\p` is above/below by document order, in the field run's language; Word does not reject
a hyphenated or over-long bookmark name - it keeps the first and silently truncates the second to 40.

## M5 Footnotes

Script `probes/m5.mjs`. `footnotes.xml` with `w:type="separator" w:id="-1"` and
`continuationSeparator w:id="0"`, settings `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>`.
Section 1: two notes in text, one in a table cell, one in text after the table; section 2 (next page):
automatic, `w:customMarkFollows` "*", automatic, `w:customMarkFollows` "7".

```xml
<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:customMarkFollows="1" w:id="6"/><w:t>*</w:t></w:r>
<w:sectPr><w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>...
```

| Note                                          | restart eachSect (mark, page) | no restart (mark, page) |
| --------------------------------------------- | ----------------------------- | ----------------------- |
| text 1                                        | 1, p1                         | 1, p1                   |
| text 2                                        | 2, p1                         | 2, p1                   |
| table cell (`Information(12)` in table: true) | 3, p1                         | 3, p1                   |
| text after table                              | 4, p1                         | 4, p1                   |
| section 2, automatic                          | **1**, p2                     | 5, p2                   |
| custom "*"                                    | *, p2                         | *, p2                   |
| section 2, automatic after "*"                | **2**, p2                     | **6**, p2               |
| custom "7"                                    | 7, p2                         | 7, p2                   |

`Range.FootnoteOptions.NumberingRule` per section: 1, 1 (restart) / 0, 0. PDF: each note at the foot
of its reference's page in reference order (p1 notes at baselines 737.02-768.10), the cell's note
among them in order, marks superscript 6.96pt in text and 6.00pt in the note.

**Finding:** real footnotes number themselves in document order, cells included, restart per section
with `numRestart eachSect`, and a `customMarkFollows` note shows its own text and does not consume a
number - so assemble's label can be carried as a custom mark, at the price of Word no longer
numbering it.

## M6 Tables

Script `probes/m6.mjs`. Table style `table` (name "Table") with `tblBorders` all `single w:sz="8"`
black, `tblCellMar` 100 twips each side, `tblStylePr` `firstRow` (fill D9E2F3, bold), `firstCol`
(fill E2EFD9), `band1Horz` (fill FFF2CC); table with
`<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>`,
`w:tblCaption`/`w:tblDescription`, a `w:tblHeader` row and 60 body rows. A second table: header row,
one row, a `w:cantSplit` row holding 80 paragraphs, one row.

- `Table.Title` = "Values by Ada", `Table.Descr` = "Sixty rows of values that Ada measured.";
  `Style.NameLocal` "Table", `Style.BuiltIn` false.
- Padding read back 5 / 5 / 5 / 5; border `LineWidth` top, insideH, insideV = 8 (wdLineWidth100pt).
- `Rows(1).HeadingFormat` = -1 (true), `Rows(2)` = 0. Table 1 spans pages 1-3; PDF: the header row's
  "Name" (TimesNewRomanPS-BoldMT) stands at the top of pages 2 and 3 (baseline 88.22) - **it repeats**.
- Shading through COM (`Cell.Shading.BackgroundPatternColor`, BGR): row 1 cells F3E2D9 = **D9E2F3**,
  bold -1; cell (2,1) D9EFE2 = **E2EFD9** (firstCol); (2,2) CCF2FF = **FFF2CC** (banded); (3,2)
  -16777216 (automatic, not banded); (4,2) **FFF2CC**. `band1Horz` fell on body rows 1 and 3 (table
  rows 2 and 4).
- The `cantSplit` row taller than a page (table 2): row 2 on page 4; the tall row **moved to page 5,
  started there with no header row above it**, ran 54 lines (baselines 88.22-758.74), and **split
  anyway**: lines 55-80 on page 6 under a repeated header (Head A at 88.22), then the last row. No line
  lost (54 + 26 = 80). `AllowBreakAcrossPages` = 0.

**Finding:** a table style with first-row/first-column/banding conditions, a repeating header, and
`tblCaption`/`tblDescription` all read back exactly; `band1Horz` bands the odd body rows (1st, 3rd),
and a `cantSplit` row taller than a page is pushed to a new page, split regardless, and that page
loses the repeated header.

## M7 Figures and images

Script `probes/m7.mjs`, images from `probes/png.mjs` (40x20 solid PNGs built from bytes), each drawn
144 x 72pt.

```xml
<wp:docPr id="2" name="Picture 2"><a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">
  <adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></wp:docPr>
<wp:positionV relativeFrom="margin"><wp:align>top</wp:align></wp:positionV> ... <wp:wrapTopAndBottom/>
```

- (a) Inline with `descr`: `InlineShape.AlternativeText` "A red bar drawn by Ada", 144 x 72, page 1.
- (c) Decorative: `InlineShape.Decorative` exists and reads **-1** for the flagged image, 0 for the
  other; its `AlternativeText` "".
- (b) Float `align="top"` anchored in a paragraph 25 lines down page 2: `Shape.Top` -999999
  (wdShapeTop), `RelativeVerticalPosition` 0 (margin), `WrapFormat.Type` 4, anchor page 2. Rendered:
  the image occupies **72.0-144.0pt, x 225.8-369.8** (the top of the text area, centred), and the
  page's first text line moved from baseline 82.20 to **154.22** (+72.02). `align="bottom"` on page 3:
  `Shape.Top` -999997 (wdShapeBottom); image at **698.2-770.2pt** (the foot of the text area,
  841.92 - 72 = 769.92), text above unmoved.
- Not a result: an earlier run of this probe set `RelativeVerticalPosition` to the page from COM before
  exporting, and that PDF showed the image at the page's top edge; that was my change, not Word's
  reading, and the probe no longer does it.

**Finding:** inline `descr` and the decorative extension are both read (`AlternativeText`,
`Decorative` = true); a `wrapTopAndBottom` float aligned top/bottom `relativeFrom="margin"` goes to the
top/bottom of the text area of its anchor's page, pushing the text down by its height when at the top.

## M8 Page furniture

Script `probes/m8.mjs`. Three sections by `nextPage` breaks. Section 1: `pgNumType fmt="lowerRoman"
start="1"`, `w:titlePg`, first header "Not approved" + "[cover header]", first footer "[cover footer]";
default header `Not approved | head: {STYLEREF "Heading 1"} | with /n: {STYLEREF "Heading 1" \n}`;
default footer `Page {PAGE} of {NUMPAGES}`. Section 2: `decimal start="1"`; section 3: `decimal`, no
start. Sections 2 and 3 declare no header/footer references.

Per page, from the PDF after update:

| Page | Header                                               | Footer           | Body                |
| ---- | ---------------------------------------------------- | ---------------- | ------------------- |
| 1    | Not approved / [cover header]                        | [cover footer]   | cover title         |
| 2    | Not approved \| head: Preface \| with /n: i          | Page **ii** of 7 | i Preface           |
| 3    | Not approved \| head: Introduction \| with /n: 1     | Page **1** of 7  | 1 Introduction      |
| 4    | Not approved \| head: **Method** \| with /n: 2       | Page 2 of 7      | text, then 2 Method |
| 5    | Not approved \| head: Method \| with /n: 2           | Page 3 of 7      | no heading          |
| 6    | Not approved \| head: Tables of values \| with /n: A | Page **4** of 7  | A Tables of values  |
| 7    | Not approved \| head: Tables of values \| with /n: A | Page 5 of 7      | text                |

COM per section: section 1 `NumberStyle` 2 (lowerRoman), restart true, start 1, different first page
-1; section 2 style 0, restart true, start 1, `LinkToPrevious` true; section 3 style 0, restart false.
Also seen: the heading opening a section after a section break sat at y 81.9 (space before kept),
after a page break at 72 (space before dropped).

**Finding:** the furniture works as fields: "Not approved" in every header including the cover's own,
STYLEREF by style name gives the first Heading 1 on the page or else the last before it, `\n` its
number; the cover counts as page i so the front's first numbered page prints "ii", the appendix
continues the body's decimal count, and NUMPAGES is the physical count (7).

## M9 Contents and lists

Script `probes/m9.mjs`. `TOC \o "1-3" \h \z \u` and `TOC \h \z \c "Figure"` before a body whose
headings and captions stand on pages 2-5; prefilled (a) empty, (b) with entry text but no page numbers.

- As opened: (a) the two fields show nothing; (b) show the prefilled entry text. `TablesOfContents`
  1 and `TablesOfFigures` 1 in both (Word classifies the `\c` TOC as a table of figures).
- Updated, identical for (a) and (b): TOC `1 Introduction 2`, `1.1 Scope 3`, `2 Method 4`,
  `A Tables of values 5` (styles TOC 1 / TOC 2); list `Figure 1.1 First figure 2`, `Figure 2.1 Second
figure 4`, `Figure A.1 Appendix figure 5` (style Table of Figures) - the whole caption paragraph,
  label included. Word leaves one empty paragraph after each updated field.

**Finding:** prefilled entries are only what shows before an update; the update rebuilds both
lists completely from the headings and SEQ captions, pages included, whatever was prefilled.

## M10 Fonts

Script `probes/m10.mjs`. `word/fontTable.xml` with `<w:embedRegular r:id=".." w:fontKey="{GUID}"/>`,
the font part `word/fonts/fontN.odttf` (content type
`application/vnd.openxmlformats-officedocument.obfuscatedFont`), the first 32 bytes XORed with the
GUID's 16 bytes taken in reverse order (ECMA-376 Part 1, 17.8.1), `<w:embedTrueTypeFonts/>` in settings.

Font files: `LiberationSerif-Regular.ttf` sfnt tag `00010000` (TrueType), OS/2 fsType 0;
`STIXTwoMath-Regular.otf` tag `4f54544f` = **'OTTO' (CFF outlines)**, tables `CFF DSIG GDEF GPOS GSUB
MATH OS/2 cmap head hhea hmtx maxp name post`, fsType 0.

| Document                                           | opens | `EmbedTrueTypeFonts` | PDF font for the text                                                | font program's own names |
| -------------------------------------------------- | ----- | -------------------- | -------------------------------------------------------------------- | ------------------------ |
| Liberation Serif embedded                          | yes   | true                 | `BCDEEE+___WRD_EMBED_SUB_45`                                         | **Liberation**           |
| Liberation Serif not embedded                      | yes   | false                | `TimesNewRomanPSMT`                                                  | Times                    |
| STIX Two Math embedded, `m:mathFont` STIX Two Math | yes   | true                 | equations **Calibri** (Type0 + TrueType); plain STIX run **Calibri** | Calibri                  |
| STIX Two Math not embedded, same mathFont          | yes   | false                | equations **CambriaMath**; plain STIX run **Cambria**                | Cambria                  |
| both embedded                                      | yes   | true                 | text `___WRD_EMBED_SUB_45`; equations Calibri                        |                          |

COM said "STIX Two Math" as the equations' font in the embedded case, and "Cambria Math" (no run font)
or "" (runs naming STIX) in the plain case. The rendered equations (x = a/b + sum) were well formed in
both; with STIX embedded the glyphs are Calibri's (pdfjs' text for the numerator/denominator read "x"
through the subset's ToUnicode, but the rendering shows a and b). Setting `w:rFonts` STIX Two Math on
the equation runs changed nothing in either case.

**Finding:** an embedded, obfuscated TrueType face is used for layout and carried into the PDF; the
CFF STIX Two Math is not - embedded, Word sets maths in Calibri, and without it in Cambria Math - so a
Word document cannot set its equations in STIX Two Math.

## M11 Equations (OMML)

Script `probes/m11.mjs` (constructs listed in it, 1-23, each inline in a labelled paragraph and then in
`m:oMathPara`), `m:mathPr` with `m:mathFont` Cambria Math, `m:dispDef`, `m:wrapIndent 1440`. Then a
numbered equation (centre tab, `m:oMath`, right tab, `(SEQ Equation)`) and an equation 24 terms wide,
once in `m:oMathPara` and once at the tabs numbered.

- Opens; `OMaths.Count` **49** (23 x 2 + 3); inline ones `Type` 1, display ones 0; all "Cambria Math";
  2 pages; `SEQ Equation` results 1 and 2. The PDF uses TimesNewRomanPSMT and CambriaMath only.
- Identifier variants became Mathematical Alphanumeric characters in the PDF text: italic x U+1D465,
  upright `d` U+0064, bold v U+1D42F, bold-italic w U+1D498, double-struck R U+211D, script L U+2112,
  fraktur g U+1D524, sans s U+1D5CC, monospace m U+1D696 (`m:scr` + `m:sty p`).
- Looked at (renders `out/m11-crop-A..D.png`): number and operators; sum with limits above and below
  in display and as scripts inline, operand beside it; integral with limits at the side; `lim` with
  `x->0` beneath (`m:func` + `m:limLow`), argument sin x / x; fraction; fraction without a bar;
  binomial; square root; cube root with its degree; x sub i sup 2; prescripts 2 over 1 before x;
  hat accent; overline and underline; overbrace with n above; `d f / d x` with an empty left fence and
  a bar on the right; angle brackets with a middle bar; 2x2 matrix in brackets; phantom (a+b hidden,
  its width kept before c); f'' (x) from U+2032 U+2032; an em space between a and b - **all set as
  intended**.
- Cases (`m:d {` around `m:eqArr` rows without `&`): brace and two rows correct, but each row is
  **centred** (the second row starts left of the first) and the two spaces after the comma widen in
  display. The aligned multi-line equation (`&=` in both rows) **aligns on the `=`**.
- Too wide, `m:oMathPara`: Word **broke it at `+` into three lines**, continuation lines indented.
  Too wide at the tabs, inline `m:oMath`: it wrapped as text over three lines from the left margin and
  the number "(2)" landed mid-line after the last term, not at the right.
- Numbered equation: E = mc^2 centred, "(1)" at the right margin, same baseline.

**Finding:** OMML carries every construct in the maths tree and Word sets each correctly in Cambria
Math; cases need `&` alignment points to left-align their rows, and a numbered equation built with
tabs breaks badly when too wide, where a display `m:oMathPara` breaks itself at operators.

## M12 Language and direction

Script `probes/m12.mjs`: docDefaults `w:lang en-GB`; paragraph 1 with a `de-DE` run; paragraph 2
`<w:bidi/>` with Hebrew runs `<w:rtl/><w:lang w:bidi="he-IL"/>`, a Latin "Ada" (`w:lang w:bidi` only,
no `w:rtl`) and "2026."; paragraph 3 the same runs without `w:bidi`; paragraph 4 English.

- `LanguageID` per word: English 2057, German words **1031**, Hebrew words **1037**, "Ada" inside the
  Hebrew paragraph 2057 (it has no `w:rtl`, so its `w:val` language, the default, applies).
  `Range.LanguageID` of a mixed paragraph: 9999999 (wdUndefined).
- `ReadingOrder`: paragraph 2 **0 (right to left)**, others 1.
- PDF: paragraph 2 set **right to left against the right margin** - x of the pieces 486.09 (the first
  Hebrew words), 465.22 ("Ada"), 448.89, 426.19 ("2026"), 423.67 (the full stop at the left end).
  Paragraph 3, left to right: 74.53, 111.98, 130.34.
- The Hebrew runs were set at **9.96pt**, the Latin at 11.04. The docDefaults state `w:sz 22` and no
  `w:szCs`; that a complex-script run takes `w:szCs` (and 10pt without it) is the reading, not a
  separate measurement - no variant with `w:szCs` was run. Hebrew fell to Times New Roman
  (Liberation Serif not installed).

**Finding:** `w:lang`/`w:bidi` and `w:rtl` read back per run and a `w:bidi` paragraph is set right to
left; every size must be written as `w:szCs` as well as `w:sz`, or right-to-left text drops to 10pt (the cause inferred, see above).

## M13 Background and padding

Script `probes/m13.mjs`. Style `panel`: `w:shd` fill F0F0F0, `w:pBdr` top/left/bottom/right `single
w:sz="4" w:space="6" w:color="F0F0F0"`, spacing before/after 12pt (240), line 14.35 atLeast; `panel-nobdr`
the same without borders; `panel-inset` = `panel` plus `w:ind left/right 120` (6pt). Each: body
text, two panel paragraphs, body text. Fill extent read from the rendered page (`fillbox.ps1`, 5 px/pt).

| Case       | fill top-bottom (pt) | fill left-right (pt) | text x | baselines: before, panel 1, panel 2, after |
| ---------- | -------------------- | -------------------- | ------ | ------------------------------------------ |
| bordered   | 114.40 - 166.60      | **64.20 - 531.60**   | 72.02  | 98.42, 131.18, 157.58, 190.46              |
| unbordered | 114.40 - 153.40      | 70.60 - 525.20       | 72.02  | 98.42, 124.70, 151.10, 177.38              |
| inset      | 114.40 - 166.60      | **70.20 - 525.60**   | 78.02  | 98.42, 131.18, 157.58, 190.46              |

(Text column 72.0-523.3.) The borders grow the fill by the padding plus the border on every side:
horizontally 6.4-7.8pt **outside the text column** unless indents of the padding pull it back (inset);
vertically the text-to-panel steps grow from 26.28 to 32.76 above and to 32.88 below (+6.48, +6.60).
The two panel paragraphs share one box: one continuous fill, and the step between them stays 26.40
(no padding inside the group).

**Finding:** fill plus same-colour `pBdr` spacing does pad the fill on all four sides and joins
consecutive same-style paragraphs into one panel, but the padding lies outside the paragraph's text
edges, so the writer needs `w:ind` equal to the padding to keep the panel in the column, and it adds
padding + border to the space above and below.

## M14 Even-row banding

Script `probes/m14.mjs` (+ `m14.ps1`). M6's table style (1pt black rules, 5pt padding, `firstRow`
bold) in four variants, each on a table of one `w:tblHeader` row and six body rows, applied with
`<w:tblLook w:val="0420" w:firstRow="1" ... w:noHBand="0" w:noVBand="1"/>`:

```xml
<w:tblPr><w:tblStyleRowBandSize w:val="1"/>...</w:tblPr>
<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/></w:tcPr></w:tblStylePr>
```

`Cell(r, 2).Shading.BackgroundPatternColor` per table row (row 1 is the header; body row n is table
row n + 1), converted from BGR:

| Variant                                     | r1   | r2 (body 1) | r3 (body 2) | r4 (body 3) | r5 (body 4) | r6 (body 5) | r7 (body 6) |
| ------------------------------------------- | ---- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| band2Horz FFF2CC, band size 1               | auto | auto        | **FFF2CC**  | auto        | **FFF2CC**  | auto        | **FFF2CC**  |
| band1Horz DDEBF7 + band2Horz FFF2CC, size 1 | auto | DDEBF7      | FFF2CC      | DDEBF7      | FFF2CC      | DDEBF7      | FFF2CC      |
| band2Horz FFF2CC, band size 2               | auto | auto        | auto        | FFF2CC      | FFF2CC      | auto        | auto        |
| band2Horz FFF2CC, no `tblStyleRowBandSize`  | auto | auto        | auto        | auto        | auto        | auto        | auto        |

The rendered PDF shows the same (`out/m14-p1.png`): band2-only fills body rows 2, 4, 6; both-bands
alternates blue from body row 1 and yellow from body row 2; size 2 fills body rows 3-4 (the second
band of two rows); with no band size nothing is filled.

**Finding:** `band2Horz` with `w:tblStyleRowBandSize w:val="1"` fills the 2nd, 4th, 6th body rows,
counting from the first row after the header - the template's banding - and the band size is required:
without it Word bands nothing; with 2 it bands pairs.

## M15 Complex-script size

Script `probes/m15.mjs` (+ `m15.ps1`). M12's Hebrew paragraph (`w:bidi`, runs
`<w:rtl/><w:lang w:bidi="he-IL"/>`) under three style sets: (a) docDefaults `w:sz 22` only, as M12;
(b) `w:szCs 22` beside it in docDefaults; (c) docDefaults `w:sz` only and
`<w:rPr><w:szCs w:val="22"/></w:rPr>` on the Normal paragraph style.

| Variant                      | COM `Font.Size` / `Font.SizeBi`, every word | PDF size, Hebrew runs | PDF size, "Ada" (no `w:rtl`) | Hebrew x positions             |
| ---------------------------- | ------------------------------------------- | --------------------- | ---------------------------- | ------------------------------ |
| (a) sz only                  | 11 / **10**                                 | **9.96**              | 11.04                        | 486.09, 448.89, 426.19, 423.67 |
| (b) szCs in docDefaults      | 11 / **11**                                 | **11.04**             | 11.04                        | 482.14, 443.14, 418.39, 415.63 |
| (c) szCs in the Normal style | 11 / **11**                                 | **11.04**             | 11.04                        | 482.14, 443.14, 418.39, 415.63 |

`Font.Size` reads 11 on the Hebrew words even in (a); only `SizeBi` shows the 10.

**Finding:** confirmed - a right-to-left run takes its size from `w:szCs`, and without one it is 10pt
(9.96 in the PDF); `w:szCs` beside `w:sz`, in docDefaults or in the style, makes it 11pt.

## M16 Cover in its own section

Script `probes/m16.mjs` (+ `m16.ps1`, a copy of `m8.ps1`). Section 1 the cover only: `w:titlePg`,
first header "Not approved", an empty first footer, default header `Not approved | {STYLEREF "Heading 1"}`
and footer `Page {PAGE} of {NUMPAGES}` (inherited by the later sections), **no `w:pgNumType`**.
Section 2 front matter `<w:pgNumType w:fmt="lowerRoman" w:start="1"/>`, two pages; section 3 body
`decimal start="1"`, two pages - the first opening with a heading straight after the section break,
the second with a heading after a page break (`<w:br w:type="page"/>` in its own paragraph). Two
documents, identical but for the Heading 1 style's space before: 0 (`m16-before0`) and 12pt (240,
`m16-before12`).

Per page after update (PDF; same in both documents):

| Page                   | Header                       | Footer              |
| ---------------------- | ---------------------------- | ------------------- |
| 1 (cover)              | Not approved                 | (nothing)           |
| 2 (front, Preface)     | Not approved \| Preface      | Page **i** of **5** |
| 3                      | Not approved \| Preface      | Page ii of 5        |
| 4 (body, Introduction) | Not approved \| Introduction | Page 1 of 5         |
| 5 (Method)             | Not approved \| Method       | Page 2 of 5         |

COM per section: 1 - style 0, restart false, different first page -1; 2 - lowerRoman, restart true,
start 1; 3 - decimal, restart true, start 1.

Heading at the top of a page:

| Heading                                         | before 0: COM y / PDF baseline | before 12: COM y / PDF baseline |
| ----------------------------------------------- | ------------------------------ | ------------------------------- |
| Preface, after the section break from the cover | 72 / 86.90                     | **84 / 98.90**                  |
| Introduction, after a section break             | 72 / 86.90                     | **84 / 98.90**                  |
| Method, after a page break                      | 72 / 86.90                     | **72 / 86.90**                  |

**Finding:** with the cover alone in its own unnumbered section, the first front page prints "i" and
NUMPAGES still counts every physical page (5, cover included); a heading's space before is kept at
the top of a page that a section break began (+12.00) and dropped after a page break.

## M17 A numbered display equation that survives being too wide

Script `probes/m17.mjs`. Maths font Cambria Math, `m:wrapIndent` 1440. Every SEQ prefilled "9",
every REF "8", to prove the update. Rendered `out/m17-crop.png`.

```xml
<!-- (a)/(b) -->
<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>(all nil)</w:tblBorders>
  <w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>
  <w:tblGrid><w:gridCol w:w="8126"/><w:gridCol w:w="900"/></w:tblGrid>
  <w:tr><w:tc>(vAlign center)<w:p><m:oMathPara><m:oMath>...</m:oMath></m:oMathPara></w:p></w:tc>
        <w:tc>(900 dxa, vAlign center)<w:p><w:pPr><w:jc w:val="right"/></w:pPr>( <w:bookmarkStart w:name="_Ref000000011"/>{SEQ Equation \* ARABIC}<w:bookmarkEnd/> )</w:p></w:tc></w:tr></w:tbl>
<!-- (c) -->
<m:oMathPara><m:oMath><m:eqArr><m:e>...<m:r><m:t>#</m:t></m:r><m:d>(3)</m:d></m:e></m:eqArr></m:oMath></m:oMathPara>
```

- (a) Short equation in the table: E = mc^2 centred in its cell (x 254.33), "(1)" right-aligned at
  x 510.58, baseline 95.06 against the equation's 95.42.
- (b) Too wide in the table: Word **broke it at `+` within the cell** into three lines (baselines
  121.34, 134.66, 147.86; the first line starts at x 83.18 and the widest ends by x 463, inside the
  cell's right edge at about 478), continuation lines indented; "(2)" stays at the right, x 510.58,
  baseline 134.18, **vertically centred on the middle line** (`w:vAlign center`).
- (c) `m:eqArr` with `#`: the `#` is not printed, but the number is not placed at the margin either.
  Short: "(3)" set **immediately after** the equation in Cambria Math (x 311.11; equation and number
  centred together). Too wide: **no line break at all** - one line from x 72.02 running past the right
  margin to x 582.48 near the page edge (595.32); terms 13-24 and "(4)" are **not drawn** (absent from
  the PDF text and the render).
- (d) Fallback: the too-wide `m:oMathPara` broke itself into three lines (225.26, 238.58, 251.78), and
  "(3)" stands alone at the right, x 510.58, baseline 264.41, one line below the last line.
- SEQ results after update 1, 2, 3 (from 9); `REF _Ref000000011 \h` -> **1** and `REF _Ref000000012 \h`
  -> **2** (from 8); PDF "References: (a) is 1, (b) is 2."

**Finding:** a borderless two-cell row - `m:oMathPara` in a wide cell, `(SEQ Equation)` right-aligned
in a fixed narrow cell - keeps the number at the right whether the equation fits or breaks at
operators within its cell, and a REF to a bookmark round the SEQ updates; `m:eqArr` `#` numbering
neither right-aligns the number nor breaks, and a too-wide one is cut off at the page edge.

---

## Summary

| Probe | Finding                                                                                                                                                                                                                      | What it means for the writer                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1    | Word sets max(after, before) unless `w:doNotUseHTMLParagraphAutoSpacing`; with it spaces add and contextual spacing is per paragraph, per side                                                                               | Always write the flag; carry the theme's spaces in styles; at a boundary between two same-style blocks (two quotations) write `contextualSpacing=0` with `before=0` on the last paragraph and `after=0` on the next first paragraph (d8) |
| M2    | "Heading N" names are Word's built-ins, outline level implied; direct `numPr` per matter gives i / 1 / A / A.1; TOC entries carry numbers                                                                                    | Name the heading styles "Heading N" (styleId can stay `heading-N`); one style-linked list for the body, direct `numPr` to a lowerRoman and an upperLetter list for front matter and appendices                                           |
| M3    | `SEQ \s 1` restarts at every Heading 1; `STYLEREF 1 \s` gives i / 1 / A                                                                                                                                                      | Captions can be live fields that agree with assemble's labels; prefill them with the label, which shows until an update                                                                                                                  |
| M4    | REF/PAGEREF/`\p` resolve on update; `\p` is above/below in the field run's language; long names truncated to 40, hyphens kept                                                                                                | Write bookmark names Word's own way (`_Ref` + digits, 40 max) and never rely on truncation; prefill REF with assemble's text and PAGEREF with a placeholder; `\p` cannot say "on page N"                                                 |
| M5    | Footnotes number in order (cells included) and restart per section; custom marks take no number                                                                                                                              | Real footnotes with Word numbering; restart per section only where the layout restarts; a custom mark only where assemble's label must be kept verbatim                                                                                  |
| M6    | Style conditions, repeat header, caption/description all read back; `band1Horz` = odd body rows; oversize `cantSplit` row splits anyway and loses the header on its first page                                               | Band the template's even rows with `band2Horz` and `tblStyleRowBandSize 1` (M14); never write `cantSplit` on a row that can exceed a page                                                                                                |
| M7    | `descr` and the decorative extension read; top/bottom floats go to the text area of the anchor's page                                                                                                                        | Alternative text in `wp:docPr descr`, decorative by the `adec` extension; float figures as `wrapTopAndBottom` anchors aligned top or bottom `relativeFrom="margin"`                                                                      |
| M8    | Headers/footers with STYLEREF, PAGE, NUMPAGES per section work; the cover is page i                                                                                                                                          | Put the cover in the front section as a title page or in its own section if the front must start at i; NUMPAGES is physical, as the PDF's `pages` is                                                                                     |
| M9    | TOC and TOF rebuild completely on update                                                                                                                                                                                     | Write the fields with assemble's entries (and no pages) as the prefill; pages appear only after an update                                                                                                                                |
| M10   | Embedded obfuscated TrueType Liberation Serif is used; CFF STIX Two Math is not (Calibri embedded, Cambria Math without)                                                                                                     | Embed the TrueType faces; maths must be declared as Cambria Math or another installed TrueType maths face, and the substitution reported (STY-052)                                                                                       |
| M11   | Every maths-tree construct sets correctly in OMML; cases rows centre without `&`; tab-numbered equations break badly when too wide                                                                                           | Map the tree to OMML; write cases with `&`; number displays in a way that survives a line break (not a tab line), or refuse too-wide numbered equations                                                                                  |
| M12   | Per-run language and a bidi paragraph read and set correctly; Hebrew set at 9.96pt where only `w:sz` was given (cause confirmed in M15)                                                                                      | Write `w:lang w:bidi` + `w:rtl` for right-to-left runs, `w:bidi` for the paragraph, and `w:szCs` beside every `w:sz`                                                                                                                     |
| M13   | Same-colour `pBdr` pads the fill all round, outside the text edges, and groups consecutive paragraphs                                                                                                                        | Write background as `w:shd` + same-colour `pBdr` with `w:space` = padding and `w:ind` = padding (+ border) to stay in the column; account for padding in the spaces                                                                      |
| M14   | `band2Horz` with `tblStyleRowBandSize 1` fills body rows 2, 4, 6; without a band size nothing is banded; size 2 bands pairs                                                                                                  | Write the template's banding as `band2Horz` and always write `w:tblStyleRowBandSize w:val="1"`                                                                                                                                           |
| M15   | Right-to-left runs take `w:szCs`: without it 10pt (9.96), with it 11pt, from docDefaults or the style                                                                                                                        | Write `w:szCs` beside every `w:sz`, in docDefaults and in every style                                                                                                                                                                    |
| M16   | Cover alone in an unnumbered first section: the front starts at "i", NUMPAGES counts every page (5); a heading's space before is kept after a section break, dropped after a page break                                      | Put the cover in its own section to match the PDF's front numbering; a section-opening heading carries its space before at the page top                                                                                                  |
| M17   | A borderless two-cell row (equation cell + fixed number cell) keeps the number right, breaks within the cell, and a REF to a bookmark round the SEQ updates; `eqArr` `#` numbering does neither and is clipped when too wide | Number display equations with the two-cell row; never `m:eqArr` `#`; the number-below paragraph is a working fallback                                                                                                                    |
