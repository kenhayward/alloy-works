import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { checkOoxml } from './ooxml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * A minimal WordprocessingML package: its content types, the package's relationship to the main part,
 * and a body holding one paragraph with these properties. Built by hand rather than by the writer,
 * so the checker is proved against a document whose every byte the test states.
 */
function docx(paragraphProperties: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:pPr>${paragraphProperties}</w:pPr><w:r><w:t>Ada wrote this.</w:t></w:r></w:p>` +
        '</w:body></w:document>',
    ),
  });
}

describe('checking a Word document with the Open XML SDK', () => {
  it('finds nothing wrong with a valid document', async () => {
    const errors = await checkOoxml(docx('<w:pStyle w:val="Normal"/><w:jc w:val="center"/>'));

    expect(errors).toEqual([]);
  });

  it('refuses a paragraph whose properties are out of order, naming the element', async () => {
    // CT_PPrBase is a sequence with w:pStyle first, so w:jc before it is a schema error, not a style.
    const errors = await checkOoxml(docx('<w:jc w:val="center"/><w:pStyle w:val="Normal"/>'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      part: '/word/document.xml',
      path: expect.stringContaining('w:pPr[1]') as unknown,
      type: 'Schema',
    });
    expect(errors[0]?.description).toContain(`${W}:pStyle`);
  });

  it('throws for bytes that are not a package at all, rather than listing their errors', async () => {
    await expect(checkOoxml(strToU8('Grace wrote this, not a zip'))).rejects.toThrow(
      'could not be opened as a Word document',
    );
  });
});
