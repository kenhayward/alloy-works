import { DEFAULT_IMPORT_LEVELS, blockIdentifierFrom, proposeImport } from '@alloy-works/domain';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx } from './docx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const styles = `<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>
</w:styles>`;

const numbering = `<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="11"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
</w:numbering>`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF = strToU8('GIF89a...');

/** A package with Word's own part names, its body the XML given, and any other parts. */
function docx(
  body: string,
  extra: Readonly<Record<string, string | Uint8Array>> = {},
  rels = '',
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="${W14}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(styles),
    'word/numbering.xml': strToU8(numbering),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`,
    ),
    ...Object.fromEntries(
      Object.entries(extra).map(([name, part]) => [
        name,
        typeof part === 'string' ? strToU8(part) : part,
      ]),
    ),
  });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (inner: string, style?: string, extra = '') =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`;
const field = (code: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const bookmark = (id: number, name: string, inner: string) =>
  `<w:bookmarkStart w:id="${id}" w:name="${name}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
const text = (value: string, extra: object = {}) => ({
  type: 'text',
  value,
  marks: [],
  ...extra,
});
const para = (...content: object[]) => ({ type: 'paragraph', content });

function read(bytes: Uint8Array) {
  const answer = readDocx(bytes);
  if (!answer.ok) throw new Error(answer.failure);
  return answer;
}
const blocks = (answer: ReturnType<typeof read>) =>
  answer.flow.flatMap((item) => (item.kind === 'block' ? [item.block] : []));
const subjects = (report: readonly { subject: string; detail?: string; count?: number }[]) =>
  report.map((entry) => [entry.subject, entry.detail, entry.count]);

let next = 0;
const newIdentifier = () => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(12, (next += 1));
  return blockIdentifierFrom(bytes);
};
const options = { language: 'en', direction: 'ltr' as const, newIdentifier };

const footnotes = (notes: string) =>
  `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>${notes}</w:footnotes>`;

describe('readDocx, structure (IMc)', () => {
  it('IMP-006 reads a footnote at its reference, as a footnote holding its paragraphs', () => {
    const answer = read(
      docx(p(`${run('Ponds')}<w:r><w:footnoteReference w:id="2"/></w:r>${run(' hold newts.')}`), {
        'word/footnotes.xml': footnotes(
          `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>${run(' Counted by Grace.')}</w:p></w:footnote>`,
        ),
      }),
    );
    expect(blocks(answer)).toEqual([
      para(
        text('Ponds'),
        { type: 'footnote', anchor: { kind: 'span' }, content: [para(text('Counted by Grace.'))] },
        text(' hold newts.'),
      ),
    ]);
    expect(subjects(answer.report)).toEqual([]);
    const { parts } = proposeImport(answer.flow, DEFAULT_IMPORT_LEVELS, options);
    expect(parts[0]!.flags).toEqual([]);
  });

  it('IMP-007 reads a footnote once: one that refers to itself, or is referred to again, is reported as not read there', () => {
    const answer = read(
      docx(
        p(
          `${run('Ponds')}<w:r><w:footnoteReference w:id="2"/></w:r>${run(' and lakes')}<w:r><w:footnoteReference w:id="2"/></w:r>`,
        ),
        {
          'word/footnotes.xml': footnotes(
            `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>${run(' Counted by Grace.')}<w:r><w:footnoteReference w:id="2"/></w:r></w:p></w:footnote>`,
          ),
        },
      ),
    );
    expect(blocks(answer)).toEqual([
      para(
        text('Ponds'),
        { type: 'footnote', anchor: { kind: 'span' }, content: [para(text('Counted by Grace.'))] },
        text(' and lakes'),
      ),
    ]);
    expect(subjects(answer.report)).toEqual([['notYetRead', 'footnote', 2]]);
  });

  it('IMP-006 reads list numbering that carries on after a paragraph from where it left off, and numbering that restarts from its start', () => {
    const item = (value: string, numId: string) =>
      p(run(value), undefined, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
    const answer = read(
      docx(
        [
          item('Ada', '2'),
          item('Grace', '2'),
          p(run('Between')),
          item('Edsger', '2'),
          p(run('Again')),
          item('Alan', '3'),
        ].join(''),
      ),
    );
    const list = (start: number | undefined, ...names: string[]) => ({
      type: 'list',
      kind: 'ordered',
      format: 'decimal',
      ...(start === undefined ? {} : { start }),
      items: names.map((name) => ({ content: [para(text(name))] })),
    });
    expect(blocks(answer)).toEqual([
      list(undefined, 'Ada', 'Grace'),
      para(text('Between')),
      list(3, 'Edsger'),
      para(text('Again')),
      list(undefined, 'Alan'),
    ]);
  });

  it("IMP-006 reads a caption onto its table or figure, its label and number left to the theme, and a figure's image with its alternative text", () => {
    const drawing = (id: string, descr: string) =>
      `<w:r><w:drawing><wp:inline><wp:docPr w:id="1" name="Picture 1" descr="${descr}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const answer = read(
      docx(
        [
          p(
            `${run('Table ')}<w:fldSimple w:instr=" SEQ Table \\* ARABIC ">${run('1')}</w:fldSimple>${run(': Newts by pond')}`,
            'Caption',
          ),
          `<w:tbl><w:tr><w:tc>${p(run('Newt'))}</w:tc></w:tr></w:tbl>`,
          p(drawing('rId9', 'A newt on a stone')),
          p(`${run('Figure ')}${field('SEQ Figure \\* ARABIC', '1')}${run('. A newt')}`, 'Caption'),
          p(drawing('rId10', 'A moving newt')),
        ].join(''),
        { 'word/media/image1.png': PNG, 'word/media/image2.gif': GIF },
        `<Relationship Id="rId9" Type="${R}/image" Target="media/image1.png"/>` +
          `<Relationship Id="rId10" Type="${R}/image" Target="media/image2.gif"/>`,
      ),
    );
    expect(answer.images).toEqual([
      { placeholder: '00000000-0000-4000-8000-000000000001', format: 'png', bytes: PNG },
    ]);
    expect(blocks(answer)).toEqual([
      {
        type: 'table',
        headerRows: 0,
        headerColumns: 0,
        caption: [text('Newts by pond')],
        rows: [{ cells: [{ content: [para(text('Newt'))], colspan: 1, rowspan: 1 }] }],
      },
      {
        type: 'figure',
        asset: '00000000-0000-4000-8000-000000000001',
        imageStyle: 'figure',
        caption: [text('A newt')],
        alternative: { kind: 'own', text: 'A newt on a stone' },
      },
    ]);
    expect(subjects(answer.report)).toEqual([['imageFormat', 'gif', 1]]);
  });

  it('IMP-006 IMP-033 reads REF, NOTEREF and PAGEREF fields as cross-references to what their bookmark is in, and lists one whose bookmark is not in the file with the text it showed', () => {
    const answer = read(
      docx(
        [
          p(bookmark(1, '_Ref1', run('Methods')), 'Heading1'),
          p(bookmark(2, '_Ref2', run('Sampling began in May.'))),
          p(
            `${bookmark(3, '_Ref3', `${run('Table ')}<w:fldSimple w:instr=" SEQ Table ">${run('1')}</w:fldSimple>`)}${run(' Counts')}`,
            'Caption',
          ),
          `<w:tbl><w:tr><w:tc>${p(run('Newt'))}</w:tc></w:tr></w:tbl>`,
          p(`${run('Seen')}${bookmark(4, '_Ref4', '<w:r><w:footnoteReference w:id="2"/></w:r>')}`),
          p(
            [
              run('See '),
              field('REF _Ref1 \\h', 'Methods'),
              run(', page '),
              field('PAGEREF _Ref2 \\h', '4'),
              run(', '),
              field('REF _Ref3 \\h', 'Table 1'),
              run(', note '),
              field('NOTEREF _Ref4 \\h', '1'),
              run(' and '),
              field('REF _Ref9 \\h', 'Section 9'),
            ].join(''),
          ),
        ].join(''),
        {
          'word/footnotes.xml': footnotes(
            `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>${run('By Grace.')}</w:p></w:footnote>`,
          ),
        },
      ),
    );
    const heading = answer.flow[0]!;
    expect(heading).toMatchObject({ kind: 'heading', text: 'Methods' });
    const anchor = heading.kind === 'heading' ? heading.anchor : undefined;
    const [sampling, table, seen, see] = blocks(answer) as Record<string, unknown>[];
    const note = (seen!.content as Record<string, unknown>[])[1]!;
    const reference = (block: string, display: string, extra: object = {}) =>
      expect.objectContaining({
        type: 'crossReference',
        target: { kind: 'block', block },
        display,
        ...extra,
      });
    expect(see!.content).toEqual([
      text('See '),
      reference(anchor!, 'title'),
      text(', page '),
      reference(sampling!.id as string, 'page', { withoutPages: 'number' }),
      text(', '),
      reference(table!.id as string, 'number'),
      text(', note '),
      reference(note.id as string, 'number'),
      text(' and '),
      reference('wx-1', 'title'),
    ]);
    expect(answer.references).toEqual([
      { key: 'wx-1', bookmark: '_Ref9', field: 'REF', text: 'Section 9' },
    ]);
    // What each field showed is the source's, for review, never the content's.
    const source = answer.flow.at(-1)!;
    expect(source.kind === 'block' && source.source).toBe(
      'See Methods, page 4, Table 1, note 1 and Section 9',
    );
  });

  it('IMP-005 reads each tracked change by its author, and IMP-009 lists its authors', () => {
    const answer = read(
      docx(
        p(
          `${run('The newts ')}<w:ins w:id="5" w:author="Ada" w:date="2026-01-02T00:00:00Z">${run('quickly ')}</w:ins>` +
            `<w:del w:id="6" w:author="Grace"><w:r><w:delText xml:space="preserve">slowly </w:delText></w:r></w:del>${run('left.')}`,
        ),
      ),
    );
    expect(blocks(answer)).toEqual([
      para(
        text('The newts '),
        text('quickly ', { change: { kind: 'insert', author: 'Ada', id: '5' } }),
        text('slowly ', { change: { kind: 'delete', author: 'Grace', id: '6' } }),
        text('left.'),
      ),
    ]);
    const source = answer.flow[0]!;
    expect(source.kind === 'block' && source.source).toBe('The newts slowly left.');
    expect(answer.identities).toEqual([
      { name: 'Ada', email: null, carries: ['changes'] },
      { name: 'Grace', email: null, carries: ['changes'] },
    ]);
    expect(subjects(answer.report)).toEqual([]);
  });

  it('IMP-005 reads a comment with the span it covers and its reply, one crossing a paragraph marked as crossing', () => {
    const comments = `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">
      <w:comment w:id="0" w:author="Ada" w:initials="AL" w:date="2026-01-02T00:00:00Z"><w:p w14:paraId="00000001"><w:r><w:annotationRef/></w:r>${run('Check this count.')}</w:p></w:comment>
      <w:comment w:id="1" w:author="Grace" w:initials="GH"><w:p w14:paraId="00000002">${run('Recounted: three.')}</w:p></w:comment>
      <w:comment w:id="2" w:author="Edsger"><w:p w14:paraId="00000003">${run('Too long?')}</w:p></w:comment>
    </w:comments>`;
    const extended = `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="00000001" w15:done="0"/><w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/></w15:commentsEx>`;
    const answer = read(
      docx(
        p(
          `${run('We saw ')}<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>${run('three newts')}<w:commentRangeEnd w:id="0"/><w:commentRangeEnd w:id="1"/>${run(' today.')}<w:r><w:commentReference w:id="0"/></w:r>`,
        ) +
          p(`${run('Then ')}<w:commentRangeStart w:id="2"/>${run('we left')}`) +
          p(`${run('for home.')}<w:commentRangeEnd w:id="2"/>`),
        { 'word/comments.xml': comments, 'word/commentsExtended.xml': extended },
      ),
    );
    const [first, second] = blocks(answer) as { id?: string }[];
    expect(answer.comments).toEqual([
      {
        id: '0',
        block: first!.id,
        quote: 'three newts',
        before: 'We saw ',
        crossed: false,
        author: 'Ada',
        initials: 'AL',
        date: '2026-01-02T00:00:00Z',
        text: 'Check this count.',
        replies: [{ author: 'Grace', initials: 'GH', date: null, text: 'Recounted: three.' }],
      },
      {
        id: '2',
        block: second!.id,
        quote: 'we left',
        before: 'Then ',
        crossed: true,
        author: 'Edsger',
        initials: null,
        date: null,
        text: 'Too long?',
        replies: [],
      },
    ]);
    expect(answer.identities.map((each) => [each.name, each.carries])).toEqual([
      ['Ada', ['comments']],
      ['Edsger', ['comments']],
      ['Grace', ['comments']],
    ]);
  });

  it("IMP-009 lists the file's own author and last editor with any email the file gives, and never keeps its properties in content, saying which were left out", () => {
    const answer = read(
      docx(p(`<w:ins w:id="1" w:author="Ada Lovelace">${run('Newts.')}</w:ins>`), {
        'docProps/core.xml': `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pond survey</dc:title><dc:creator>Ada Lovelace</dc:creator><cp:lastModifiedBy>Grace Hopper</cp:lastModifiedBy></cp:coreProperties>`,
        'docProps/app.xml': `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>C:\\Users\\ada\\Normal.dotm</Template><Company>Pond Survey Ltd</Company></Properties>`,
        'docProps/custom.xml': `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Desk"><vt:lpwstr>Fourth floor</vt:lpwstr></property></Properties>`,
        'word/settings.xml': `<w:settings xmlns:w="${W}"><w:rsids><w:rsidRoot w:val="00A1B2C3"/></w:rsids></w:settings>`,
        'word/people.xml': `<w15:people xmlns:w15="${W15}"><w15:person w15:author="Ada Lovelace"><w15:presenceInfo w15:providerId="AD" w15:userId="S::ada@example.com::0001"/></w15:person></w15:people>`,
      }),
    );
    expect(answer.identities).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com', carries: ['changes', 'creator'] },
      { name: 'Grace Hopper', email: null, carries: ['lastModifiedBy'] },
    ]);
    expect(answer.properties).toEqual({
      title: 'Pond survey',
      creator: 'Ada Lovelace',
      lastModifiedBy: 'Grace Hopper',
      template: 'C:\\Users\\ada\\Normal.dotm',
      company: 'Pond Survey Ltd',
      'custom:Desk': 'Fourth floor',
    });
    expect(JSON.stringify(answer.flow)).not.toMatch(/Hopper|Survey Ltd|Fourth floor/);
    expect(subjects(answer.report)).toEqual([
      ['fileProperty', 'company', 1],
      ['fileProperty', 'creator', 1],
      ['fileProperty', 'custom', 1],
      ['fileProperty', 'lastModifiedBy', 1],
      ['fileProperty', 'rsid', 1],
      ['fileProperty', 'template', 1],
    ]);
  });

  it('IMP-007 reports an equation as not read with its text kept in the source, text boxes left out, content controls and other fields kept as their text', () => {
    const answer = read(
      docx(
        p(
          `${run('Area ')}<m:oMath><m:r><m:t>a=πr</m:t></m:r></m:oMath>` +
            `<w:sdt><w:sdtContent>${run(' by Ada')}</w:sdtContent></w:sdt>${run(' on ')}${field('DATE \\@ "d MMMM"', '2 May')}` +
            `<w:r><w:drawing><wp:anchor><wp:docPr w:id="2" name="Text Box 2"/><a:graphic><a:graphicData><w:txbxContent>${p(run('Aside'))}</w:txbxContent></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`,
        ),
      ),
    );
    expect(blocks(answer)).toEqual([para(text('Area  by Ada on 2 May'))]);
    const source = answer.flow[0]!;
    expect(source.kind === 'block' && source.source).toBe('Area a=πr by Ada on 2 May');
    expect(subjects(answer.report)).toEqual([
      ['notYetRead', 'equation', 1],
      ['textBox', undefined, 1],
      ['contentControl', undefined, 1],
      ['field', 'DATE', 1],
    ]);
  });

  it('tallies an XE field as another field, making no index marker (the IX plan, IX-F)', () => {
    const xe =
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> XE "Alloy:tempering" </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const answer = read(docx(p(`${run('An alloy')}${xe}${run(' tempered')}`)));
    expect(blocks(answer)).toEqual([para(text('An alloy tempered'))]);
    expect(subjects(answer.report)).toEqual([['field', 'XE', 1]]);
  });
});
