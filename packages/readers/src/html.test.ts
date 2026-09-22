import {
  admit,
  admissionLimits,
  type ContentDocument,
  type ReportEntry,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { readHtml } from './html.js';

const text = (value: string, ...marks: Record<string, unknown>[]) => ({
  type: 'text',
  value,
  marks,
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const strong = { type: 'strong' };
const emphasis = { type: 'emphasis' };

/** What the reader handed over, or the test fails saying it refused. */
function read(html: string) {
  const result = readHtml(html);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.input;
}

const content = (html: string) => (read(html).candidate as { content: unknown[] }).content;

/** The report without its sentences, which the domain's report test pins. */
const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('reading HTML', () => {
  it('reads paragraphs and the nine marks, collapsing whitespace as a browser does', () => {
    expect(
      content(
        `<p>
           The <b>Minster</b>  and <i>the <u>walls</u></i>
         </p>
         <p>x<sub>2</sub> y<sup>n</sup> <code>git</code> <q>so</q>
            <a href="https://example.com/">site</a></p>`,
      ),
    ).toEqual([
      paragraph(
        text('The '),
        text('Minster', strong),
        text(' and '),
        text('the ', emphasis),
        text('walls', emphasis, { type: 'underline' }),
      ),
      paragraph(
        text('x'),
        text('2', { type: 'subscript' }),
        text(' y'),
        text('n', { type: 'superscript' }),
        text(' '),
        text('git', { type: 'inlineCode' }),
        text(' '),
        text('so', { type: 'quotedPhrase' }),
        text(' '),
        text('site', { type: 'hyperlink', href: 'https://example.com/' }),
      ),
    ]);
  });

  it('reads the marks a span says in its style, and a bold that says it is not (Google Docs)', () => {
    const html = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">
      <p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-style:italic;"> slanted</span>
      <span style="text-decoration:underline;vertical-align:super;">up</span></p></b>`;
    expect(content(html)).toEqual([
      paragraph(
        text('Bold', strong),
        text(' slanted', emphasis),
        text(' '),
        text('up', { type: 'underline' }, { type: 'superscript' }),
      ),
    ]);
  });

  it('makes a new paragraph at a line break, since a component has none', () => {
    expect(content('<p>York<br>Leeds<br></p>')).toEqual([
      paragraph(text('York')),
      paragraph(text('Leeds')),
    ]);
  });

  it('reads lists, nested, with a start and a numbering', () => {
    expect(
      content(`<ol start="3"><li>One<ul><li>Under</li></ul></li><li><p>Two</p></li></ol>
               <ol type="a"><li>Letter</li></ol>`),
    ).toEqual([
      {
        type: 'list',
        kind: 'ordered',
        start: 3,
        items: [
          {
            content: [
              paragraph(text('One')),
              { type: 'list', kind: 'unordered', items: [{ content: [paragraph(text('Under'))] }] },
            ],
          },
          { content: [paragraph(text('Two'))] },
        ],
      },
      {
        type: 'list',
        kind: 'ordered',
        format: 'alphabetic',
        items: [{ content: [paragraph(text('Letter'))] }],
      },
    ]);
  });

  it('reads a definition list, each term with what defines it', () => {
    expect(
      content('<dl><dt><b>Ada</b></dt><dd>A person</dd><dd>A language</dd><dt>Grace</dt></dl>'),
    ).toEqual([
      {
        type: 'list',
        kind: 'definition',
        items: [
          {
            term: [text('Ada', strong)],
            content: [paragraph(text('A person')), paragraph(text('A language'))],
          },
          { term: [text('Grace')], content: [paragraph()] },
        ],
      },
    ]);
  });

  it('reads a quotation, and preformatted text exactly with its language from its class', () => {
    expect(
      content(
        '<blockquote><p>Said so.</p></blockquote><pre><code class="language-sql">SELECT 1\n\tFROM x\r\n</code></pre>',
      ),
    ).toEqual([
      { type: 'blockquote', content: [paragraph(text('Said so.'))] },
      { type: 'preformatted', text: 'SELECT 1\n\tFROM x\n', language: 'sql' },
    ]);
  });

  it("reads Word's list paragraphs as a list, nested by level, and leaves its spacing out", () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<style>p.MsoNormal {margin:0cm; font-family:"Calibri"}</style></head><body lang=EN-GB>
<!--StartFragment-->
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span
style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Ada<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span
style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span>&nbsp;&nbsp; </span></span></span><![endif]>Grace<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><![if !supportLists]><span
style='mso-list:Ignore'>2.<span>&nbsp;</span></span><![endif]><b>Alice</b><o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoNormal>After</p>
<!--EndFragment--></body></html>`;
    const input = read(html);
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      {
        type: 'list',
        kind: 'ordered',
        items: [
          {
            content: [
              paragraph(text('Ada')),
              { type: 'list', kind: 'unordered', items: [{ content: [paragraph(text('Grace'))] }] },
            ],
          },
          { content: [paragraph(text('Alice', strong))] },
        ],
      },
      paragraph(text('After')),
    ]);
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'emptyParagraph', count: 1 },
    ]);
  });

  it('keeps a heading as a paragraph, leaves out an image, an equation and a line, and says so', () => {
    const input = read(
      `<h1>Title</h1><h3>Part</h3>
       <p>A <img src="https://example.com/a.png" alt="chart"> figure</p>
       <math><mi>x</mi></math><hr>`,
    );
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      paragraph(text('Title')),
      paragraph(text('Part')),
      paragraph(text('A figure')),
    ]);
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'rewritten', subject: 'heading', count: 2 },
      { stage: 'read', action: 'discarded', subject: 'image', count: 1 },
      { stage: 'read', action: 'discarded', subject: 'mathematics', count: 1 },
      { stage: 'read', action: 'discarded', subject: 'rule', count: 1 },
    ]);
  });

  const cell = (...content: unknown[]) => ({ content, colspan: 1, rowspan: 1 });
  const spanning = (colspan: number, rowspan: number, ...content: unknown[]) => ({
    content,
    colspan,
    rowspan,
  });

  it('reads a table: its caption, header rows and columns, and merged cells', () => {
    expect(
      content(`<table>
         <caption>Readings <i>at noon</i></caption>
         <thead><tr><th>Site</th><th colspan="2">Values</th></tr></thead>
         <tbody>
           <tr><th rowspan="2">York</th><td>1</td><td>2</td></tr>
           <tr><td>3</td><td><ul><li>4</li></ul></td></tr>
         </tbody>
       </table>`),
    ).toEqual([
      {
        type: 'table',
        caption: [text('Readings '), text('at noon', emphasis)],
        headerRows: 1,
        headerColumns: 1,
        rows: [
          { cells: [cell(paragraph(text('Site'))), spanning(2, 1, paragraph(text('Values')))] },
          {
            cells: [
              spanning(1, 2, paragraph(text('York'))),
              cell(paragraph(text('1'))),
              cell(paragraph(text('2'))),
            ],
          },
          {
            cells: [
              cell(paragraph(text('3'))),
              cell({
                type: 'list',
                kind: 'unordered',
                items: [{ content: [paragraph(text('4'))] }],
              }),
            ],
          },
        ],
      },
    ]);
  });

  it('makes a ragged table a grid, and keeps what a cell may not hold as paragraphs, saying so', () => {
    const input = read(`<table>
       <tr><td>a</td><td>b</td><td>c</td></tr>
       <tr><td><blockquote><p>q</p></blockquote></td></tr>
       <tr><td><pre>x\ny</pre></td><td><table><tr><td>inner</td></tr></table></td><td></td></tr>
     </table>`);
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      {
        type: 'table',
        caption: [],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [
              cell(paragraph(text('a'))),
              cell(paragraph(text('b'))),
              cell(paragraph(text('c'))),
            ],
          },
          { cells: [cell(paragraph(text('q'))), cell(paragraph()), cell(paragraph())] },
          {
            cells: [
              cell(paragraph(text('x')), paragraph(text('y'))),
              cell(paragraph(text('inner'))),
              cell(paragraph()),
            ],
          },
        ],
      },
    ]);
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'rewritten', subject: 'table', count: 1 },
      { stage: 'read', action: 'rewritten', subject: 'tableShape', count: 1 },
      { stage: 'read', action: 'rewritten', subject: 'cellBlocks', count: 2 },
    ]);
  });

  it("reads a table from Word's HTML, where nothing marks a header row", () => {
    const input = read(`<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
       style='border-collapse:collapse;mso-yfti-tbllook:1184'>
       <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
         <td width=301 valign=top style='width:225.4pt'><p class=MsoNormal><b>Part<o:p></o:p></b></p></td>
         <td width=301 valign=top style='width:225.4pt'><p class=MsoNormal><b>Count<o:p></o:p></b></p></td>
       </tr>
       <tr style='mso-yfti-irow:1;mso-yfti-lastrow:yes'>
         <td width=301 valign=top style='width:225.4pt'><p class=MsoNormal>Drum<o:p></o:p></p></td>
         <td width=301 valign=top style='width:225.4pt'><p class=MsoNormal>2<o:p></o:p></p></td>
       </tr>
     </table>`);
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      {
        type: 'table',
        caption: [],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [cell(paragraph(text('Part', strong))), cell(paragraph(text('Count', strong)))],
          },
          { cells: [cell(paragraph(text('Drum'))), cell(paragraph(text('2')))] },
        ],
      },
    ]);
    expect(input.report).toEqual([]);
  });

  it('reports a paragraph holding only an image as the image, not as spacing', () => {
    const input = read('<p><img src="https://example.com/a.png"></p><p>After</p>');
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'image', count: 1 },
    ]);
  });

  it('hands a text style over as presentation on its paragraph, for the pipeline to remove', () => {
    expect(
      content(
        '<span style="font-family: Georgia; font-size: 18px; color: rgb(1, 2, 3)"><p>Styled</p></span>',
      ),
    ).toEqual([
      {
        ...paragraph(text('Styled')),
        presentation: { typeface: 'Georgia', size: '18px', colour: 'rgb(1, 2, 3)' },
      },
    ]);
  });

  it('removes control characters and counts them', () => {
    // Not U+0000: the HTML parser drops a NUL in text itself, before any reader sees it.
    const input = read('<p>Yo\u0001rk\u0007</p>');
    expect((input.candidate as { content: unknown[] }).content).toEqual([paragraph(text('York'))]);
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'discarded', subject: 'control', count: 2 },
    ]);
  });

  it('leaves out what is nested too deeply to read, and says so', () => {
    const input = read(`${'<div>'.repeat(300)}Deep${'</div>'.repeat(300)}<p>Shallow</p>`);
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      paragraph(text('Shallow')),
    ]);
    expect(happened(input.report)).toMatchObject([
      { stage: 'read', action: 'discarded', subject: 'unrepresentable' },
    ]);
  });

  it('refuses HTML longer than one addition can hold, before parsing it', () => {
    const result = readHtml('a'.repeat(admissionLimits.characters + 1));
    expect(result).toMatchObject({ ok: false, refusal: 'oversized' });
  });
});

describe('HTML through the admission pipeline', () => {
  const document: ContentDocument = {
    schemaVersion: 1,
    title: 'Notes',
    language: 'en-GB',
    direction: 'ltr',
    content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
  };
  let next = 0;
  const receiver = { document, conditionAxes: [], newIdentifier: () => `n${(next += 1)}` };

  it('CNT-130 never stores a script, an event handler, an embedded object or a link that could run', () => {
    const outcome = admit(
      read(
        `<p onclick="steal()">Hi <a href="javascript:alert(1)">there</a>
           <a href="https://example.com/">site</a></p>
         <script>alert(1)</script>
         <iframe src="https://example.com/"></iframe>
         <p><svg onload="alert(1)"></svg><span style="background: url(https://example.com/x.png)">Bg</span></p>`,
      ),
      receiver,
    );
    if (!outcome.ok) throw new Error(outcome.failure);
    const stored = JSON.stringify(outcome.content);
    for (const word of ['javascript', 'script', 'onclick', 'steal', 'iframe', 'svg', 'url(']) {
      expect(stored).not.toContain(word);
    }
    expect(outcome.content.map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    expect(outcome.report.map((entry) => entry.subject)).toEqual(
      expect.arrayContaining([
        'script',
        'embeddedObject',
        'eventHandler',
        'hyperlink',
        'executableStyle',
      ]),
    );
  });

  it('admits a table the reader made, the grid and every cell as the model holds them', () => {
    const outcome = admit(
      read('<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">wide</td></tr></table>'),
      receiver,
    );
    if (!outcome.ok) throw new Error(outcome.failure);
    expect(outcome.content).toMatchObject([
      { type: 'table', style: 'table', headerRows: 1, headerColumns: 0 },
    ]);
  });

  it("admits what the reader made of Word's list, with every block and mark given an identifier", () => {
    const outcome = admit(
      read(
        `<p style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>-</span><i>One</i></p>`,
      ),
      receiver,
    );
    expect(outcome.ok).toBe(true);
    expect(JSON.stringify(outcome.ok && outcome.content)).toMatch(/"kind":"unordered"/);
  });
});
