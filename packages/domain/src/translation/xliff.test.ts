import { describe, expect, it } from 'vitest';
import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { writeXliff, xliffTarget, xliffUnits, type XliffPart } from './xliff.js';

/** An asset version, invented. */
const ASSET = '00000000-0000-4000-8000-00000000a001';

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (id: string, content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const strong = { type: 'strong', id: 'm-strong' };
const emphasis = { type: 'emphasis', id: 'm-em' };
const term = { type: 'definedTerm', id: 'm-term', term: 'term-pond' };

const document = (content: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sampling',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

/** Every member a unit stands in. */
const source = document([
  paragraph('p1', [
    text('See '),
    { type: 'crossReference', id: 'x1', target: { kind: 'block', block: 'p2' }, display: 'number' },
    text(' for the '),
    text('large', [strong]),
    text(' ponds', [strong, emphasis]),
    text(' and '),
    text('npm install', [{ type: 'inlineCode', id: 'm-code' }]),
    text(' and '),
    text('Teich', [{ type: 'language', id: 'm-de', tag: 'de' }]),
    { type: 'variable', name: 'site' },
    { type: 'citation', entry: 'ada-1843' },
    {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [paragraph('p-note', [text('Counted twice.')])],
    },
    {
      type: 'image',
      asset: ASSET,
      imageStyle: 'inline',
      alternative: { kind: 'own', text: 'A pond' },
    },
    text('.'),
  ]),
  paragraph('p2', [text('A '), text('pond', [term]), text(' is still water.')]),
  {
    type: 'list',
    id: 'l1',
    kind: 'definition',
    items: [{ term: [text('Pond')], content: [paragraph('p3', [text('Still water.')])] }],
  },
  {
    type: 'table',
    id: 't1',
    caption: [text('Sites')],
    headerRows: 0,
    headerColumns: 0,
    note: [text('Visited in May.')],
    rows: [{ cells: [{ content: [paragraph('p4', [text('York')])], colspan: 1, rowspan: 1 }] }],
  },
  {
    type: 'boundTable',
    id: 'T1',
    binding: {
      type: 'binding',
      id: 'k1',
      query: '00000000-0000-4000-8000-00000000d001',
      parameters: {},
      mode: 'checked',
    },
    caption: [text('Readings')],
    columns: [
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' } },
    ],
    headerColumn: false,
    empty: [text('No readings.')],
    source: [text('Survey')],
  },
  {
    type: 'figure',
    id: 'g1',
    asset: ASSET,
    imageStyle: 'column-width',
    caption: [text('The north pond')],
    alternative: { kind: 'own', text: 'Reeds round a pond' },
  },
  {
    type: 'blockquote',
    id: 'q1',
    content: [paragraph('p5', [text('Water finds its level.')])],
    attribution: [text('Grace')],
  },
  { type: 'preformatted', id: 'r1', text: 'depth > 2' },
]);

/** A translator who changes the words and leaves every tag where it stands. */
const translate = (parts: readonly XliffPart[]): XliffPart[] =>
  parts.map((part) => (part.kind === 'text' ? { kind: 'text', text: `[${part.text}]` } : part));

const allTranslated = (content: ContentDocument) =>
  new Map(xliffUnits(content).map((unit) => [unit.id, translate(unit.parts)]));

describe('a component as XLIFF units', () => {
  it('gives a unit for each translatable text, wherever it stands, and none for code or preformatted text', () => {
    expect(xliffUnits(source).map((unit) => unit.id)).toEqual([
      'b.p1',
      'b.p-note',
      'b.p1.image.12',
      'b.p2',
      'b.l1.term.0',
      'b.p3',
      'b.t1.caption',
      'b.p4',
      'b.t1.note',
      'b.T1.caption',
      'b.T1.column.0',
      'b.T1.column.1',
      'b.T1.unit.1',
      'b.T1.empty',
      'b.T1.source',
      'b.g1.caption',
      'b.g1.alternative',
      'b.p5',
      'b.q1.attribution',
    ]);
  });

  it('LOC-020 holds every inline node that is not text, and code and other languages, as placeholders, and marks as pairs', () => {
    const [p1] = xliffUnits(source);
    expect(p1!.parts).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'ph', id: 'p1' },
      { kind: 'text', text: ' for the ' },
      { kind: 'sc', id: 'm1' },
      { kind: 'text', text: 'large' },
      { kind: 'sc', id: 'm2' },
      { kind: 'text', text: ' ponds' },
      { kind: 'ec', startRef: 'm2' },
      { kind: 'ec', startRef: 'm1' },
      { kind: 'text', text: ' and ' },
      { kind: 'ph', id: 'p2' },
      { kind: 'text', text: ' and ' },
      { kind: 'ph', id: 'p3' },
      { kind: 'ph', id: 'p4' },
      { kind: 'ph', id: 'p5' },
      { kind: 'ph', id: 'p6' },
      { kind: 'ph', id: 'p7' },
      { kind: 'text', text: '.' },
    ]);
    expect(p1!.marks.get('m1')).toEqual(strong);
  });

  it('sends neither a pending insertion nor a comment', () => {
    const [unit] = xliffUnits(
      document([
        paragraph('p1', [
          text('Kept', [{ type: 'comment', id: 'c1', threadId: 'th1' }]),
          text(' added', [{ type: 'suggestion', id: 's1', operation: 'insert', author: 'Ada' }]),
          text(' gone', [{ type: 'suggestion', id: 's2', operation: 'delete', author: 'Ada' }]),
        ]),
      ]),
    );
    expect(unit!.parts).toEqual([
      { kind: 'text', text: 'Kept' },
      { kind: 'text', text: ' gone' },
    ]);
  });

  it('LOC-019 names the terms a text uses', () => {
    expect(xliffUnits(source)[3]!.terms).toEqual(['term-pond']);
  });
});

describe('a variant from a returned file', () => {
  it('LOC-020 replaces every text, in the language, and keeps structure, marks and references', () => {
    const result = xliffTarget(source, allTranslated(source), 'fr');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.language).toBe('fr');
    // The variant read again gives the same units, each with the translated words.
    expect(xliffUnits(result.content).map((unit) => unit.parts)).toEqual(
      xliffUnits(source).map((unit) => translate(unit.parts)),
    );
    const p1 = result.content.content[0] as { content: { type: string }[] };
    expect(p1.content.map((node) => node.type)).toEqual(
      (source.content[0] as { content: { type: string }[] }).content.map((node) => node.type),
    );
    // The footnote and the image come back translated, from the source's place, not the file's.
    expect(JSON.stringify(p1)).toContain('[Counted twice.]');
    expect(JSON.stringify(p1)).toContain('[A pond]');
    expect(result.content.content[7]).toEqual(source.content[7]);
  });

  it('LOC-020 lets a pair move and split, and joins runs of one set of marks', () => {
    const one = document([paragraph('p1', [text('a large pond', [strong])])]);
    const result = xliffTarget(
      one,
      new Map([
        [
          'b.p1',
          [
            { kind: 'text', text: 'un ' },
            { kind: 'sc', id: 'm1' },
            { kind: 'text', text: 'grand' },
            { kind: 'text', text: ' étang' },
            { kind: 'ec', startRef: 'm1' },
          ],
        ],
      ]),
      'fr',
    );
    expect(result).toEqual({
      ok: true,
      content: expect.objectContaining({
        content: [paragraph('p1', [text('un '), text('grand étang', [strong])])],
      }),
    });
  });

  it('LOC-020 refuses a placeholder missing, repeated or invented, a pair unknown, and tags in words', () => {
    const targets = allTranslated(source);
    const p1 = targets.get('b.p1')!;
    const problem = (unit: string, parts: XliffPart[]) => {
      const result = xliffTarget(source, new Map([...targets, [unit, parts]]), 'fr');
      return result.ok ? [] : result.problems;
    };
    expect(
      problem(
        'b.p1',
        p1.filter((part) => !(part.kind === 'ph' && part.id === 'p1')),
      ),
    ).toEqual([{ unit: 'b.p1', problem: 'placeholder_missing' }]);
    expect(problem('b.p1', [...p1, { kind: 'ph', id: 'p1' }])).toEqual([
      { unit: 'b.p1', problem: 'placeholder_repeated' },
    ]);
    expect(problem('b.p1', [...p1, { kind: 'ph', id: 'p9' }])).toEqual([
      { unit: 'b.p1', problem: 'placeholder_unknown' },
    ]);
    expect(problem('b.p1', [...p1, { kind: 'sc', id: 'm9' }])).toEqual([
      { unit: 'b.p1', problem: 'pair_unknown' },
    ]);
    expect(problem('b.T1.column.0', [{ kind: 'ph', id: 'p1' }])).toEqual([
      { unit: 'b.T1.column.0', problem: 'not_words' },
    ]);
  });

  it('refuses a unit missing and a unit not sent', () => {
    const targets = allTranslated(source);
    targets.delete('b.p3');
    targets.set('b.elsewhere', [{ kind: 'text', text: 'x' }]);
    expect(xliffTarget(source, targets, 'fr')).toEqual({
      ok: false,
      problems: [
        { unit: 'b.elsewhere', problem: 'unknown' },
        { unit: 'b.p3', problem: 'missing' },
      ],
    });
  });
});

describe('a job file', () => {
  it('holds whatever a block identifier or a text says as data: escaped, and a character XML cannot carry as a code point', () => {
    const odd = document([paragraph('p"1><x', [text('Bell & <b>')])]);
    const written = writeXliff({
      job: 'job-2',
      source: 'en-GB',
      target: 'fr',
      files: [{ component: 'c1', title: 'Odd', type: 'note', content: odd }],
      terms: new Map(),
    });
    expect(written).toContain('<unit id="b.p&quot;1&gt;&lt;x">');
    expect(written).toContain('<source>Bell<cp hex="0007"/> &amp; &lt;b&gt;</source>');
    expect(written).toContain('<note category="title">Odd</note>');
  });

  const file = writeXliff({
    job: 'job-1',
    source: 'en-GB',
    target: 'fr',
    files: [{ component: 'c1', title: 'Sampling & <ponds>', type: 'procedure', content: source }],
    terms: new Map([['term-pond', { source: 'pond', target: 'étang' }]]),
  });

  it('is XLIFF 2.1, one file a component and one unit a text', () => {
    expect(file).toContain(
      '<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" xmlns:gls="urn:oasis:names:tc:xliff:glossary:2.0" version="2.1" srcLang="en-GB" trgLang="fr">',
    );
    expect(file).toContain('<file id="f.c1" original="component:c1">');
    expect(file.match(/<unit /g)).toHaveLength(xliffUnits(source).length);
    expect(file).toContain(
      '<source>See <ph id="p1" canCopy="no" canDelete="no"/> for the <sc id="m1" type="fmt" subType="xlf:b" canCopy="no" canDelete="no"/>large',
    );
  });

  it('LOC-019 carries the title and type, the text either side, and the terms a text uses', () => {
    expect(file).toContain(
      '<notes><note category="title">Sampling &amp; &lt;ponds&gt;</note><note category="type">procedure</note></notes>',
    );
    expect(file).toContain(
      '<unit id="b.p2"><gls:glossary><gls:glossEntry><gls:term>pond</gls:term><gls:translation>étang</gls:translation></gls:glossEntry></gls:glossary><notes><note category="context">A pond</note><note category="context">Pond</note></notes>',
    );
  });
});
