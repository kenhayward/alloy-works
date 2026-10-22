import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IMPORT_LEVELS,
  blockIdentifierFrom,
  proposeImport,
  type ImportFlowItem,
} from '@alloy-works/domain';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx } from './docx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK = `${R}/hyperlink`;

const styles = `<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Chapter"><w:name w:val="Chapter"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ChapterPlus"><w:name w:val="Chapter Plus"/><w:basedOn w:val="Chapter"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`;

const numbering = `<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="10">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="3"/><w:numFmt w:val="lowerRoman"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num>
</w:numbering>`;

/** A package with Word's own part names, its body the XML given. */
function docx(
  body: string,
  extra: Readonly<Record<string, string>> = {},
  rels: string = '',
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(styles),
    'word/numbering.xml': strToU8(numbering),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`,
    ),
    ...Object.fromEntries(Object.entries(extra).map(([name, text]) => [name, strToU8(text)])),
  });
}

const p = (text: string, style?: string, extra = '') =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function flowOf(bytes: Uint8Array) {
  const read = readDocx(bytes);
  if (!read.ok) throw new Error(read.failure);
  return read;
}

const headings = (flow: readonly ImportFlowItem[]) =>
  flow.flatMap((item) => (item.kind === 'heading' ? [[item.level, item.style, item.text]] : []));
const blocks = (flow: readonly ImportFlowItem[]) =>
  flow.flatMap((item) => (item.kind === 'block' ? [item.block] : []));
const subjects = (report: readonly { subject: string; detail?: string; count?: number }[]) =>
  report.map((entry) => [entry.subject, entry.detail, entry.count]);
const text = (value: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', value, marks: [] }],
});

let next = 0;
const newIdentifier = () => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(12, (next += 1));
  return blockIdentifierFrom(bytes);
};
const options = { language: 'en', direction: 'ltr' as const, newIdentifier };

describe('readDocx', () => {
  it('IMP-004 reads headings by their style, whatever its identifier, or by its outline level', () => {
    const read = flowOf(
      docx(
        [
          p('A report by Ada', 'Title'),
          p('Methods', 'Heading1'),
          p('Sampling', 'berschrift2'),
          p('Body text'),
          p('Appendix', 'ChapterPlus'),
          p('Direct', undefined, '<w:outlineLvl w:val="2"/>'),
        ].join(''),
      ),
    );
    expect(read.title).toBe('A report by Ada');
    expect(read.language).toBe('en-GB');
    expect(headings(read.flow)).toEqual([
      [1, 'Heading 1', 'Methods'],
      [2, 'Heading 2', 'Sampling'],
      [1, 'Chapter Plus', 'Appendix'],
      [3, 'Outline level 3', 'Direct'],
    ]);
    expect(blocks(read.flow)).toEqual([text('Body text')]);
  });

  it('reads bold, italic and underline as marks, and reports formatting the theme decides', () => {
    const read = flowOf(
      docx(
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>both</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:color w:val="FF0000"/></w:rPr><w:t>red</w:t></w:r></w:p>`,
      ),
    );
    expect(blocks(read.flow)).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', value: 'Bold', marks: [{ type: 'strong' }] },
          { type: 'text', value: 'both', marks: [{ type: 'emphasis' }, { type: 'underline' }] },
          { type: 'text', value: 'red', marks: [] },
        ],
      },
    ]);
    expect(subjects(read.report)).toEqual([['appearance', undefined, 1]]);
  });

  it('reads lists as lists, nested by their level, their kind and start from the numbering', () => {
    const item = (value: string, numId: string, ilvl: string) =>
      p(
        value,
        undefined,
        `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`,
      );
    const read = flowOf(
      docx(
        [
          item('Ada', '1', '0'),
          item('Grace', '1', '1'),
          item('Edsger', '1', '0'),
          p('Between'),
          item('First', '2', '0'),
          p('By style', 'ListBullet'),
        ].join(''),
      ),
    );
    expect(blocks(read.flow)).toEqual([
      {
        type: 'list',
        kind: 'unordered',
        items: [
          {
            content: [
              text('Ada'),
              {
                type: 'list',
                kind: 'ordered',
                format: 'roman',
                start: 3,
                items: [{ content: [text('Grace')] }],
              },
            ],
          },
          { content: [text('Edsger')] },
        ],
      },
      text('Between'),
      { type: 'list', kind: 'ordered', format: 'decimal', items: [{ content: [text('First')] }] },
      { type: 'list', kind: 'unordered', items: [{ content: [text('By style')] }] },
    ]);
  });

  it('reads tables, their header rows and merged cells', () => {
    const cell = (value: string, props = '') =>
      `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${p(value)}</w:tc>`;
    const read = flowOf(
      docx(
        `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Name', '<w:gridSpan w:val="2"/>')}${cell('Role')}</w:tr>` +
          `<w:tr>${cell('Ada', '<w:vMerge w:val="restart"/>')}${cell('Lovelace')}${cell('Writer')}</w:tr>` +
          `<w:tr>${cell('', '<w:vMerge/>')}${cell('King')}</w:tr></w:tbl>`,
      ),
    );
    const one = (value: string, colspan = 1, rowspan = 1) => ({
      content: [text(value)],
      colspan,
      rowspan,
    });
    expect(blocks(read.flow)).toEqual([
      {
        type: 'table',
        headerRows: 1,
        headerColumns: 0,
        caption: [],
        rows: [
          { cells: [one('Name', 2), one('Role')] },
          { cells: [one('Ada', 1, 2), one('Lovelace'), one('Writer')] },
          // Short a cell: made up to the grid's width, and said.
          {
            cells: [
              one('King'),
              { content: [{ type: 'paragraph', content: [] }], colspan: 1, rowspan: 1 },
            ],
          },
        ],
      },
    ]);
    expect(subjects(read.report)).toEqual([['tableShape', undefined, 1]]);
  });

  it('IMP-007 reports what it does not read yet, and keeps the text a change rejected would leave', () => {
    const read = flowOf(
      docx(
        `<w:p><w:r><w:t>Seen</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>` +
          `<w:ins w:id="1" w:author="Grace"><w:r><w:t>added</w:t></w:r></w:ins>` +
          `<w:del w:id="2" w:author="Grace"><w:r><w:delText xml:space="preserve"> kept</w:delText></w:r></w:del>` +
          `<w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>` +
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF _Ref1 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve"> 2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>` +
          `<w:r><w:drawing><w:inline/></w:drawing></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>` +
          `<w:p/><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>` +
          `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
      ),
    );
    expect(blocks(read.flow)).toEqual([text('Seen kept 2')]);
    expect(subjects(read.report)).toEqual(
      expect.arrayContaining([
        ['notYetRead', 'footnote', 1],
        ['notYetRead', 'trackedChange', 2],
        ['notYetRead', 'comment', 1],
        ['notYetRead', 'field', 1],
        ['notYetRead', 'image', 1],
        ['notYetRead', 'equation', 1],
        ['emptyParagraph', undefined, 2],
        ['pageSetup', undefined, undefined],
      ]),
    );
  });

  it('IMP-047 never reads macros, embedded objects or controls, follows no outside file, and drops a link whose scheme is not allowed', () => {
    const bytes = docx(
      `<w:p><w:hyperlink r:id="rId5"><w:r><w:t>Ada's page</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:hyperlink r:id="rId6"><w:r><w:t>a script</w:t></w:r></w:hyperlink></w:p>`,
      {
        'word/vbaProject.bin': 'macro bytes',
        'word/embeddings/oleObject1.bin': 'ole bytes',
        'word/activeX/activeX1.xml': '<ax/>',
      },
      `<Relationship Id="rId5" Type="${HYPERLINK}" Target="https://example.com/ada" TargetMode="External"/>` +
        `<Relationship Id="rId6" Type="${HYPERLINK}" Target="javascript:alert(1)" TargetMode="External"/>` +
        `<Relationship Id="rId7" Type="${R}/attachedTemplate" Target="file:///C:/templates/evil.dotm" TargetMode="External"/>`,
    );
    const read = flowOf(bytes);
    expect(subjects(read.report)).toEqual(
      expect.arrayContaining([
        ['macro', undefined, 1],
        ['embeddedObject', undefined, 2],
        ['externalRelationship', undefined, 1],
      ]),
    );
    const { parts } = proposeImport(read.flow, DEFAULT_IMPORT_LEVELS, options);
    const paragraph = parts[0]!.blocks[0] as {
      content: { value: string; marks: { type: string; href?: string }[] }[];
    };
    expect(
      paragraph.content.map((each) => [each.value, each.marks.map((mark) => mark.href)]),
    ).toEqual([
      ["Ada's page", ['https://example.com/ada']],
      [' and a script', []],
    ]);
    expect(parts[0]!.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'discarded', subject: 'hyperlink' }),
      ]),
    );
  });

  it('refuses what is not a Word document, and one whose XML declares a document type', () => {
    expect(readDocx(strToU8('Ada'))).toMatchObject({ ok: false, refusal: 'unreadable' });
    expect(readDocx(zipSync({ 'a.txt': strToU8('Ada') }))).toMatchObject({
      ok: false,
      refusal: 'unreadable',
    });
    const doctype = zipSync({
      'word/document.xml': strToU8(
        `<!DOCTYPE w:document [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${W}"/>`,
      ),
    });
    expect(readDocx(doctype)).toMatchObject({ ok: false, refusal: 'unsafe' });
  });

  it('IMP-001 reads a document Word wrote into an outline and its content, saying what it left out', () => {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'word-round-trip.docx'),
    );
    const read = flowOf(fixture);
    expect(headings(read.flow)).toEqual([
      [1, 'Heading 1', 'This is a numbered heading'],
      [1, 'Heading 1', 'This is a cross referenced heading'],
    ]);
    const { parts } = proposeImport(read.flow, DEFAULT_IMPORT_LEVELS, options);
    expect(parts.map((part) => [part.kind, part.title])).toEqual([
      ['section', 'This is a numbered heading'],
      ['component', 'This is a numbered heading'],
      ['section', 'This is a cross referenced heading'],
    ]);
    // The deletion's text is kept and the insertions' left out, as a change rejected would.
    expect(parts[1]!.source).toContain('contains a footnote This is a paragraph');
    expect(parts[1]!.source).not.toContain('xref');
    expect(subjects(read.report)).toEqual(
      expect.arrayContaining([
        ['notYetRead', 'footnote', 1],
        ['notYetRead', 'trackedChange', 3],
        ['notYetRead', 'comment', 1],
        ['notYetRead', 'field', 1],
        ['emptyParagraph', undefined, 3],
        ['pageSetup', undefined, undefined],
      ]),
    );
  });
});
