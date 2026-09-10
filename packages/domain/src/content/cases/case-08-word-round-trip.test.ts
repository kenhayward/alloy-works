import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { exportDocx, importDocx } from '../ooxml/index.js';

/**
 * Case 8 of the content model spike - a GATE.
 * See docs/specification/Content_Model_Spike.md.
 *
 * The fixture is a real Word document, not hand-written OOXML: a Heading 1, a paragraph carrying a
 * footnote and a REF cross-reference, and then track changes turned on for one insertion, one
 * deletion and one comment. Hand-written XML would test our reading of the format rather than what
 * Word actually emits, and the fidelity bar depends on the second.
 *
 * Its author was scrubbed to an invented name before it entered the repository - a Word document
 * carries the author's name and a Microsoft account identifier, and neither belongs in a fixture.
 *
 * Passing means: numbering, cross-references and footnotes survive the export; the import produces
 * suggestions attributable to the Word author plus a comment thread; and anything not
 * representable is REPORTED rather than dropped silently.
 */

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'word-round-trip.docx'),
);

describe('case 8 - Word round-trip', () => {
  describe('importing what Word produced', () => {
    const imported = importDocx(fixture);

    it('turns tracked insertions and deletions into suggestions, attributed to the Word author', () => {
      const suggestions = imported.suggestions;

      expect(suggestions.map((each) => each.operation).sort()).toEqual([
        'delete',
        'insert',
        'insert',
      ]);
      expect([...new Set(suggestions.map((each) => each.author))]).toEqual(['Grace Hopper']);
    });

    it('keeps the text each suggestion covers, rather than flattening it into the paragraph', () => {
      const text = (id: string) => imported.suggestions.find((each) => each.id === id)?.text.trim();

      expect(imported.suggestions.map((each) => each.text.trim()).sort()).toEqual([
        'footnote',
        'new',
        'xref',
      ]);
      expect(text(imported.suggestions[0]!.id)).toBeTruthy();
    });

    it('turns the Word comment into a thread', () => {
      expect(imported.threads).toEqual([
        expect.objectContaining({ author: 'Grace Hopper', body: 'I am a comment' }),
      ]);
    });

    it('anchors that thread in the content rather than leaving it floating', () => {
      const threadId = imported.threads[0]!.id;
      const anchored = imported.components.some((component) =>
        component.content.content.some(
          (block) =>
            block.type === 'paragraph' &&
            block.content.some(
              (inline) =>
                inline.type === 'text' &&
                inline.marks.some((mark) => mark.type === 'comment' && mark.threadId === threadId),
            ),
        ),
      );

      expect(anchored).toBe(true);
    });

    it('keeps the footnote and its text', () => {
      expect(imported.footnotes.map((footnote) => footnote.text.trim())).toEqual([
        'I am a footnote',
      ]);
    });

    it('keeps the cross-reference, pointing at the heading it targets', () => {
      const target = imported.crossReferences[0]?.targetId;

      expect(imported.crossReferences).toHaveLength(1);
      expect(imported.outline.some((section) => section.bookmark === target)).toBe(true);
    });

    /**
     * Word puts headings inline in the body. The scope puts them in the outline, because a
     * component reused at two different depths cannot carry its own heading level. So the importer
     * has to SPLIT, and what comes back is an outline plus components - not one blob of content.
     */
    it('produces an outline of sections and components, not headings inside content', () => {
      expect(imported.outline.map((section) => section.title)).toEqual([
        'This is a numbered heading',
        'This is a cross referenced heading',
      ]);
      expect(imported.components.length).toBeGreaterThan(0);
    });

    it('reports what it could not represent instead of dropping it silently', () => {
      expect(imported.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'section-properties-not-imported',
      );
    });

    /**
     * The fixture separates its blocks with three empty paragraphs, and Word writes an empty
     * paragraph as a SELF-CLOSING `<w:p/>`. The walker only finished a paragraph on a closing tag,
     * so those three were never counted and the diagnostic never fired: content was dropped in
     * silence, which is the one thing the import contract says cannot happen.
     *
     * It went unnoticed because every other assertion here is about what survived. Nothing was
     * asserting about what did not.
     */
    it('counts the empty paragraphs it dropped, including self-closing ones', () => {
      const dropped = imported.diagnostics.find(
        (diagnostic) => diagnostic.code === 'empty-paragraphs-dropped',
      );

      expect(dropped).toBeDefined();
      expect(dropped?.detail).toMatch(/\b3\b/);
    });
  });

  describe('exporting and reading back', () => {
    it('round-trips the outline, the footnote, the cross-reference and the suggestions', () => {
      const first = importDocx(fixture);
      const second = importDocx(exportDocx(first));

      expect(second.outline.map((section) => section.title)).toEqual(
        first.outline.map((section) => section.title),
      );
      expect(second.footnotes.map((footnote) => footnote.text.trim())).toEqual(
        first.footnotes.map((footnote) => footnote.text.trim()),
      );
      expect(second.crossReferences).toHaveLength(first.crossReferences.length);
      expect(second.suggestions.map((each) => each.operation).sort()).toEqual(
        first.suggestions.map((each) => each.operation).sort(),
      );
      expect([...new Set(second.suggestions.map((each) => each.author))]).toEqual(['Grace Hopper']);
    });

    it('produces a package Word can open - the parts it requires are all present', () => {
      const parts = importDocx(exportDocx(importDocx(fixture))).parts;

      expect(parts).toEqual(
        expect.arrayContaining([
          '[Content_Types].xml',
          '_rels/.rels',
          'word/document.xml',
          'word/_rels/document.xml.rels',
          'word/footnotes.xml',
          'word/styles.xml',
        ]),
      );
    });
  });

  /**
   * Everything above verifies the export with our own reader, which proves the mapping is
   * self-consistent - not that Word accepts it. Opening an exported file in Word found three things
   * our reader could not: headings with no number, a footnote with no number, and no vertical
   * separation where the source had blank lines. See issue #7.
   *
   * These tests assert the OOXML constructs that produce those three. They are proxies: only Word
   * can confirm the rendering, and it did so for these before they were written down here.
   */
  describe('the constructs Word needs in order to render it correctly', () => {
    const exported = unzipSync(exportDocx(importDocx(fixture)));
    const decoder = new TextDecoder();
    const partText = (name: string): string => decoder.decode(exported[name] ?? new Uint8Array());
    const styleBlock = (id: string): string =>
      new RegExp(`<w:style [^>]*w:styleId="${id}">([\\s\\S]*?)</w:style>`).exec(
        partText('word/styles.xml'),
      )?.[1] ?? '';

    it('ships a numbering definition, so headings can be numbered at all', () => {
      expect(Object.keys(exported)).toContain('word/numbering.xml');
      expect(partText('word/numbering.xml')).toMatch(/<w:abstractNum\b/);
      expect(partText('word/numbering.xml')).toMatch(/<w:numFmt w:val="decimal"\/>/);
    });

    it('declares the numbering part, or Word silently ignores it', () => {
      expect(partText('[Content_Types].xml')).toContain('/word/numbering.xml');
      expect(partText('word/_rels/document.xml.rels')).toContain('numbering.xml');
    });

    it('links every heading level to that numbering', () => {
      for (const level of [1, 2, 3]) {
        expect(styleBlock(`Heading${level}`)).toMatch(/<w:numPr>/);
        expect(styleBlock(`Heading${level}`)).toMatch(
          new RegExp(`<w:ilvl w:val="${level - 1}"\\/>`),
        );
      }
    });

    /**
     * `w:footnoteReference` in the body renders the number in the text. The number at the FOOT of
     * the page comes from `w:footnoteRef` inside the footnote's own content, and a footnote missing
     * it prints its text with nothing in front of it.
     */
    it('puts the auto-numbering mark inside the footnote itself', () => {
      const footnotes = partText('word/footnotes.xml');

      expect(footnotes.match(/<w:footnoteRef\/>/g) ?? []).toHaveLength(1);
    });

    it('makes the in-text footnote mark superscript', () => {
      expect(styleBlock('FootnoteReference')).toMatch(/<w:vertAlign w:val="superscript"\/>/);
    });

    /**
     * The source document separated its headings from its text with empty paragraphs. Those are
     * presentation, not content, so the importer drops them and says so - which means the EXPORT
     * has to supply the separation from the layout instead. It did not, so the document came back
     * with the heading run into the text.
     */
    /**
     * A heading alone at the foot of a page with its text overleaf is the sort of thing that makes
     * output look unfinished, and it is invisible until something paginates. It belongs with the
     * spacing, because both are the layout doing what empty paragraphs were doing by hand.
     */
    it('keeps a heading with the text beneath it across a page break', () => {
      for (const level of [1, 2, 3]) {
        expect(styleBlock(`Heading${level}`)).toMatch(/<w:keepNext\/>/);
      }
    });

    it('carries spacing in the styles, so separation never depends on empty paragraphs', () => {
      expect(partText('word/styles.xml')).toMatch(
        /<w:docDefaults>[\s\S]*?<w:spacing[^>]*w:after="[1-9]/,
      );
      expect(styleBlock('Heading1')).toMatch(/<w:spacing[^>]*w:before="[1-9]/);
      expect(styleBlock('Heading1')).toMatch(/<w:spacing[^>]*w:after="[1-9]/);
    });
  });
});
