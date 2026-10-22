import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
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

  it('reads Markdown and HTML as one run of blocks, their headings kept as paragraphs until IMe', () => {
    const read = readImport(strToU8('# Ada\n\nGrace *wrote*'), 'markdown');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.flow.map((item) => item.kind === 'block' && item.source)).toEqual([
      'Ada',
      'Grace wrote',
    ]);
    expect(read.report.map((entry) => entry.subject)).toContain('heading');
    expect(readImport(strToU8('<p>Edsger</p>'), 'html')).toMatchObject({ ok: true });
  });
});
