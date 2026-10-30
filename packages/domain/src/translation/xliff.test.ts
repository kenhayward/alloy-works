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

const allTranslated = (content: ContentDocument, target = 'fr') =>
  new Map(xliffUnits(content, target).map((unit) => [unit.id, translate(unit.parts)]));

describe('a component as XLIFF units', () => {
  it('gives a unit for each translatable text, wherever it stands, and none for code or preformatted text', () => {
    expect(xliffUnits(source, 'fr').map((unit) => unit.id)).toEqual([
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
    const [p1] = xliffUnits(source, 'fr');
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
      'fr',
    );
    expect(unit!.parts).toEqual([
      { kind: 'text', text: 'Kept' },
      { kind: 'text', text: ' gone' },
    ]);
  });

  it('LOC-019 names the terms a text uses', () => {
    expect(xliffUnits(source, 'fr')[3]!.terms).toEqual(['term-pond']);
  });
});

describe('a variant from a returned file', () => {
  it('LOC-020 replaces every text, in the language, and keeps structure, marks and references', () => {
    const result = xliffTarget(source, allTranslated(source), 'fr');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.language).toBe('fr');
    // The variant read again gives the same units, each with the translated words.
    expect(xliffUnits(result.content, 'fr').map((unit) => unit.parts)).toEqual(
      xliffUnits(source, 'fr').map((unit) => translate(unit.parts)),
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
    expect(file.match(/<unit /g)).toHaveLength(xliffUnits(source, 'fr').length);
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

describe('a target the content model would refuse (the XL final review)', () => {
  it('refuses a returned text the content model refuses, rather than throwing, and keeps words in NFC', () => {
    const targets = allTranslated(source);
    const over = xliffTarget(
      source,
      new Map([
        ...targets,
        ['b.T1.column.0', [{ kind: 'text', text: 'x'.repeat(201) }] as XliffPart[]],
      ]),
      'fr',
    );
    expect(over).toEqual({ ok: false, problems: [{ unit: 'b.T1.column.0', problem: 'invalid' }] });
    const decomposed = xliffTarget(
      source,
      new Map([
        ...targets,
        ['b.T1.column.0', [{ kind: 'text', text: 'Pe\u0301riode' }] as XliffPart[]],
      ]),
      'fr',
    );
    expect(decomposed.ok && JSON.stringify(decomposed.content)).toContain('"header":"Période"');
  });

  it('sends no unit for a text that is all a pending insertion, so it never blocks a return', () => {
    const pending = document([
      paragraph('p1', [
        text('added', [{ type: 'suggestion', id: 's1', operation: 'insert', author: 'Ada' }]),
      ]),
      paragraph('p2', [text('Kept.')]),
    ]);
    expect(xliffUnits(pending, 'fr').map((unit) => unit.id)).toEqual(['b.p2']);
    expect(xliffTarget(pending, allTranslated(pending), 'fr').ok).toBe(true);
  });
});

describe('index markers, translated (the IX plan, IX-G)', () => {
  const marker = (over: object) => ({ type: 'indexMarker', ...over });
  const indexed = document([
    paragraph('p1', [
      text('Ponds'),
      marker({ term: 'Pond', sub: 'depth' }),
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [paragraph('p-note', [text('Again.'), marker({ term: 'Pond' })])],
      },
    ]),
    paragraph('p2', [
      text('Lakes'),
      marker({ term: 'Lake', sub: 'depth', seeAlso: ['Pond'] }),
      marker({ term: 'Mere', see: 'Lake' }),
    ]),
  ]);

  it('sends each distinct term and sub-entry once, as words, and each marker as a placeholder', () => {
    const units = xliffUnits(indexed, 'fr');
    expect(units.filter((unit) => unit.id.startsWith('ix.'))).toEqual(
      ['Pond', 'Lake', 'Mere']
        .map((words, k) =>
          expect.objectContaining({
            id: `ix.term.${k + 1}`,
            kind: 'words',
            parts: [{ kind: 'text', text: words }],
          }),
        )
        .concat([
          expect.objectContaining({
            id: 'ix.sub.1',
            kind: 'words',
            parts: [{ kind: 'text', text: 'depth' }],
          }),
        ]),
    );
    expect(units.find((unit) => unit.id === 'b.p2')!.parts).toEqual([
      { kind: 'text', text: 'Lakes' },
      { kind: 'ph', id: 'p1' },
      { kind: 'ph', id: 'p2' },
    ]);
  });

  it('rewrites every term, sub-entry, see and see also from its one translation', () => {
    const result = xliffTarget(indexed, allTranslated(indexed), 'fr');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const markers: unknown[] = [];
    JSON.stringify(result.content, (key, value: unknown) => {
      if ((value as { type?: string } | null)?.type === 'indexMarker') markers.push(value);
      return value;
    });
    expect(markers).toEqual([
      marker({ term: '[Pond]', sub: '[depth]' }),
      marker({ term: '[Pond]' }),
      marker({ term: '[Lake]', sub: '[depth]', seeAlso: ['[Pond]'] }),
      marker({ term: '[Mere]', see: '[Lake]' }),
    ]);
  });

  it('refuses a translated term the content model refuses, naming its unit', () => {
    const targets = allTranslated(indexed);
    const result = xliffTarget(
      indexed,
      new Map([
        ...targets,
        ['ix.term.2', [{ kind: 'text', text: 'x'.repeat(201) }] as XliffPart[]],
      ]),
      'fr',
    );
    expect(result).toEqual({ ok: false, problems: [{ unit: 'ix.term.2', problem: 'invalid' }] });
  });
});

describe('a message form, translated (the MF plan, MF-F)', () => {
  const v = { type: 'messageValue' };
  const counted = document([
    paragraph('p1', [
      text('We visited '),
      {
        type: 'messageForm',
        id: 'mf1',
        kind: 'plural',
        binding: {
          type: 'binding',
          id: 'n1',
          query: '00000000-0000-4000-8000-00000000d001',
          parameters: {},
          mode: 'checked',
          take: { column: 'count' },
        },
        arms: {
          '=0': [text('no sites')],
          one: [v, text(' site')],
          other: [v, text(' sites', [strong])],
        },
      },
      text('.'),
    ]),
  ]);
  const formOf = (content: ContentDocument) =>
    (content.content[0] as { content: { type: string; arms?: unknown; binding?: unknown }[] })
      .content[1]!;

  it("LOC-045 sends the form as a placeholder and an arm for each of the target language's categories, then each exact arm, each noting its examples", () => {
    const units = xliffUnits(counted, 'ar');
    expect(units.map((unit) => unit.id)).toEqual([
      'b.p1',
      'b.p1.mf.1.zero',
      'b.p1.mf.1.one',
      'b.p1.mf.1.two',
      'b.p1.mf.1.few',
      'b.p1.mf.1.many',
      'b.p1.mf.1.other',
      'b.p1.mf.1.=0',
    ]);
    expect(units[0]!.parts).toEqual([
      { kind: 'text', text: 'We visited ' },
      { kind: 'ph', id: 'p1' },
      { kind: 'text', text: '.' },
    ]);
    // A category the source has no arm for is sent as its `other`.
    const few = units.find((unit) => unit.id === 'b.p1.mf.1.few')!;
    expect(few.parts).toEqual([
      { kind: 'ph', id: 'p1' },
      { kind: 'sc', id: 'm1' },
      { kind: 'text', text: ' sites' },
      { kind: 'ec', startRef: 'm1' },
    ]);
    expect(few.arm?.note).toBe('few: 3, 4, 5');
    expect(units.find((unit) => unit.id === 'b.p1.mf.1.one')!.parts).toEqual([
      { kind: 'ph', id: 'p1' },
      { kind: 'text', text: ' site' },
    ]);
    expect(units.at(-1)!.arm?.note).toBe('=0: exactly 0');
    // Japanese has one category: one arm, and the exact one.
    expect(xliffUnits(counted, 'ja').map((unit) => unit.id)).toEqual([
      'b.p1',
      'b.p1.mf.1.other',
      'b.p1.mf.1.=0',
    ]);
  });

  it("rebuilds the arms from the target language's units, the binding from the source", () => {
    const result = xliffTarget(counted, allTranslated(counted, 'ar'), 'ar');
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    const form = formOf(result.content);
    expect(Object.keys(form.arms as object)).toEqual([
      'zero',
      'one',
      'two',
      'few',
      'many',
      'other',
      '=0',
    ]);
    // A category sent as `other` keeps its marks, under ids of its own.
    expect((form.arms as Record<string, unknown>).few).toEqual([
      v,
      text('[ sites]', [{ ...strong, id: 'm-strong.few' }]),
    ]);
    expect((form.arms as Record<string, unknown>).other).toEqual([v, text('[ sites]', [strong])]);
    expect(form.binding).toEqual(formOf(counted).binding);
    expect(result.content.language).toBe('ar');
  });

  it("lets an arm leave the value out, and refuses an empty arm or the value twice, naming the arm's unit", () => {
    const targets = allTranslated(counted, 'ar');
    const without = xliffTarget(
      counted,
      new Map([
        ...targets,
        ['b.p1.mf.1.one', [{ kind: 'text', text: 'موقع واحد' }] as XliffPart[]],
      ]),
      'ar',
    );
    if (!without.ok) throw new Error(JSON.stringify(without.problems));
    expect((formOf(without.content).arms as Record<string, unknown>).one).toEqual([
      text('موقع واحد'),
    ]);
    expect(
      xliffTarget(
        counted,
        new Map([
          ...targets,
          ['b.p1.mf.1.few', [] as XliffPart[]],
          [
            'b.p1.mf.1.many',
            [
              { kind: 'ph', id: 'p1' },
              { kind: 'ph', id: 'p1' },
            ] as XliffPart[],
          ],
        ]),
        'ar',
      ),
    ).toEqual({
      ok: false,
      problems: [
        { unit: 'b.p1.mf.1.few', problem: 'empty' },
        { unit: 'b.p1.mf.1.many', problem: 'placeholder_repeated' },
      ],
    });
  });

  it("writes an arm's note for the translator and lets its value be deleted", () => {
    const xml = writeXliff({
      job: 'job-1',
      source: 'en-GB',
      target: 'ar',
      files: [{ component: 'c1', title: 'Visits', type: '', content: counted }],
      terms: new Map(),
    });
    expect(xml).toContain('<note category="plural">few: 3, 4, 5</note>');
    expect(xml).toContain(
      '<unit id="b.p1.mf.1.few"><notes><note category="plural">few: 3, 4, 5</note>',
    );
    expect(xml).toMatch(/<unit id="b\.p1\.mf\.1\.few">.*?<source><ph id="p1" canCopy="no"\/>/);
    expect(xml).toContain('<source>We visited <ph id="p1" canCopy="no" canDelete="no"/>.</source>');
  });
});
