import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPORT_LEVELS, proposeImport } from '@alloy-works/domain';
import { checkImportFile, readImport } from './import.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const word = zipSync({
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:body></w:document>`,
  ),
});

describe('checkImportFile', () => {
  it('takes a Word document only when it is a zip holding word/document.xml', () => {
    expect(checkImportFile(word, 'docx')).toBe(true);
    expect(checkImportFile(zipSync({ 'a.xml': strToU8('<a/>') }), 'docx')).toBe(false);
    expect(checkImportFile(strToU8('# Ada'), 'docx')).toBe(false);
  });

  it('takes Markdown and HTML only as text', () => {
    expect(checkImportFile(strToU8('# Ada\n\nGrace'), 'markdown')).toBe(true);
    expect(checkImportFile(strToU8('<p>Ada</p>'), 'html')).toBe(true);
    expect(checkImportFile(word, 'markdown')).toBe(false);
    expect(checkImportFile(new Uint8Array([0xff, 0xfe, 0x00, 0x41]), 'html')).toBe(false);
  });
});

describe('readImport', () => {
  it('reads a Word document into its flow', () => {
    const read = readImport(word, 'docx');
    expect(read.ok && read.flow).toEqual([
      {
        kind: 'block',
        block: { type: 'paragraph', content: [{ type: 'text', value: 'Ada', marks: [] }] },
        source: 'Ada',
      },
    ]);
  });

  it('IMP-049 reads Markdown and HTML headings as headings by their level, broken out as Word is', () => {
    const markdown = ['Before', '# Ada', '## Grace *wrote*', 'Text'].join(
      String.fromCharCode(10, 10),
    );
    const read = readImport(strToU8(markdown), 'markdown');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(
      read.flow.map((item) => (item.kind === 'heading' ? [item.level, item.text] : item.source)),
    ).toEqual(['Before', [1, 'Ada'], [2, 'Grace wrote'], 'Text']);
    expect(read.flow[1]).toMatchObject({ kind: 'heading', style: 'Heading 1' });
    expect(read.report.map((entry) => entry.subject)).not.toContain('heading');
    const { parts } = proposeImport(read.flow, DEFAULT_IMPORT_LEVELS, {
      language: 'en',
      direction: 'ltr',
      newIdentifier: () => crypto.randomUUID(),
    });
    expect(parts.map((part) => [part.kind, part.title])).toEqual([
      ['component', 'Introduction'],
      ['section', 'Ada'],
      ['component', 'Grace wrote'],
    ]);

    // A heading inside a quotation or a list is no outline's: a paragraph, and said, as a paste's.
    const html = readImport(
      strToU8('<div><h2>Edsger</h2></div><blockquote><h3>Deep</h3></blockquote>'),
      'html',
    );
    expect(html.ok && html.flow.map((item) => item.kind)).toEqual(['heading', 'block']);
    expect(html.ok && html.report).toContainEqual(
      expect.objectContaining({ action: 'rewritten', subject: 'heading', count: 1 }),
    );
  });

  it('IMP-049 never fetches an image by its address, saying it was left out, and holds a data image as a Word one is', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const data = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const html =
      `<p><img src="https://example.com/ada.png"></p><p><img alt="Ada's chart" src="${data}"></p>` +
      '<p><img src="data:image/gif;base64,R0lGODlh"></p>';
    const read = readImport(strToU8(html), 'html');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.images).toEqual([{ placeholder: expect.any(String), format: 'png', bytes: png }]);
    expect(read.flow).toEqual([
      {
        kind: 'block',
        block: {
          type: 'figure',
          asset: read.images[0]!.placeholder,
          imageStyle: 'figure',
          caption: [],
          alternative: { kind: 'own', text: "Ada's chart" },
        },
        source: "Ada's chart",
      },
    ]);
    expect(read.report).toContainEqual(
      expect.objectContaining({ action: 'discarded', subject: 'image', count: 2 }),
    );
  });

  it('IMP-049 reports what a Markdown import leaves out, as a Word one does: an image it cannot read', () => {
    const markdown = ['# Pond', 'Ada ![A far newt](https://example.com/newt.png) saw it.'].join(
      String.fromCharCode(10, 10),
    );
    const read = readImport(strToU8(markdown), 'markdown');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.images).toEqual([]);
    expect(read.report).toEqual([
      expect.objectContaining({ stage: 'read', action: 'discarded', subject: 'image', count: 1 }),
    ]);
    // The words around it are kept.
    expect(read.flow.map((item) => item.kind === 'block' && item.source)).toEqual([
      false,
      'Ada saw it.',
    ]);
  });
});
