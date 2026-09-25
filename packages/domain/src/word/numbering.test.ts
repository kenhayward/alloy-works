import { describe, expect, it } from 'vitest';

import { scanXml, type XmlElementEvent } from '../content/ooxml/xml.js';
import {
  conditions,
  number,
  resolve,
  type NumberableNode,
  type NumberingTable,
} from '../structure/numbering.js';
import type { OutlineMatter } from '../structure/outline.js';
import {
  defaultNumberingScheme,
  numberingSchemeSchema,
  type NumberingScheme,
} from '../structure/scheme.js';

import { numberingNotInWord, numberingXml } from './numbering.js';

/** A numbered section node, and the nodes beneath it. */
const node = (
  id: string,
  matter: OutlineMatter,
  children: NumberableNode[] = [],
  numbered = true,
): NumberableNode => ({ type: 'section', id, numbered, matter, title: [], children });

/** The numbering table `assemble` hands the writer, for an outline of sections alone. */
const numbered = (nodes: NumberableNode[], scheme = defaultNumberingScheme): NumberingTable =>
  number(conditions(resolve({ nodes }, new Map())), scheme);

/** The default scheme with its section rules changed, held to the scheme's own parse. */
const withSections = (
  change: (rules: NumberingScheme['sequences'][string]) => void,
): NumberingScheme => {
  const scheme = structuredClone(defaultNumberingScheme);
  change(scheme.sequences['section']!);
  return numberingSchemeSchema.parse(scheme);
};

/** Every element of the part, in document order. */
const elements = (xml: string): XmlElementEvent[] =>
  scanXml(xml).filter(
    (event): event is XmlElementEvent => event.kind !== 'text' && event.kind !== 'close',
  );

/** One abstract numbering definition's levels: each level's format, text, suffix and linked style. */
function levels(xml: string, abstract: number) {
  const events = scanXml(xml);
  const start = events.findIndex(
    (event) =>
      event.kind === 'open' &&
      event.name === 'w:abstractNum' &&
      event.attrs['w:abstractNumId'] === String(abstract),
  );
  expect(start, `abstract numbering ${abstract}`).toBeGreaterThanOrEqual(0);
  const found: {
    ilvl: string;
    format?: string | undefined;
    text?: string | undefined;
    suffix?: string | undefined;
    style?: string | undefined;
  }[] = [];
  for (const event of events.slice(start + 1)) {
    if (event.kind === 'close' && event.name === 'w:abstractNum') break;
    if (event.kind === 'text' || event.kind === 'close') continue;
    if (event.name === 'w:lvl') found.push({ ilvl: event.attrs['w:ilvl']! });
    const level = found[found.length - 1];
    if (level === undefined) continue;
    if (event.name === 'w:numFmt') level.format = event.attrs['w:val'];
    if (event.name === 'w:lvlText') level.text = event.attrs['w:val'];
    if (event.name === 'w:suff') level.suffix = event.attrs['w:val'];
    if (event.name === 'w:pStyle') level.style = event.attrs['w:val'];
  }
  return found;
}

describe('the numbering Word computes a heading number from (Word 1, ruling R7)', () => {
  const links = new Map([
    [1, 'heading-1'],
    [2, 'heading-2'],
    [3, 'heading-3'],
  ]);
  const xml = numberingXml(defaultNumberingScheme, links);

  it("writes one definition per matter from the scheme's section rules: body 1, front 2, appendix 3", () => {
    const nums = elements(xml).filter((event) => event.name === 'w:num');
    expect(nums.map((each) => each.attrs['w:numId'])).toEqual(['1', '2', '3']);
    const bindings = elements(xml)
      .filter((event) => event.name === 'w:abstractNumId')
      .map((each) => each.attrs['w:val']);
    expect(bindings).toEqual(['1', '2', '3']);
    // Every abstract definition before every instance, as CT_Numbering's sequence requires.
    const names = elements(xml).map((event) => event.name);
    expect(names.lastIndexOf('w:abstractNum')).toBeLessThan(names.indexOf('w:num'));
  });

  it('numbers nine levels in each, the last format repeating and the parts joined by the separator, as `number` writes them', () => {
    const body = levels(xml, 1);
    expect(body).toHaveLength(9);
    expect(body.map((level) => level.format)).toEqual(Array(9).fill('decimal'));
    expect(body[0]!.text).toBe('%1');
    expect(body[2]!.text).toBe('%1.%2.%3');
    expect(body[8]!.text).toBe('%1.%2.%3.%4.%5.%6.%7.%8.%9');
    // M2: front matter i, i.1; appendices A, A.1 - the default scheme's.
    expect(levels(xml, 2).map((level) => level.format)).toEqual([
      'lowerRoman',
      ...Array(8).fill('decimal'),
    ]);
    expect(levels(xml, 3).map((level) => level.format)).toEqual([
      'upperLetter',
      ...Array(8).fill('decimal'),
    ]);
    // A space after the number, as the PDF sets "1 Introduction", not a tab to a stop.
    expect(new Set(body.map((level) => level.suffix))).toEqual(new Set(['space']));
  });

  it('links the body list from the heading styles, level by level, and no other list from any style', () => {
    expect(levels(xml, 1).map((level) => level.style)).toEqual([
      'heading-1',
      'heading-2',
      'heading-3',
      ...Array(6).fill(undefined),
    ]);
    expect(levels(xml, 2).every((level) => level.style === undefined)).toBe(true);
    expect(levels(xml, 3).every((level) => level.style === undefined)).toBe(true);
  });

  it("writes each matter's own separator and formats, escaped", () => {
    const scheme = withSections((rules) => {
      rules.body = { ...rules.body, separator: '-', format: ['upperRoman', 'lowerAlpha'] };
      rules.appendix = { ...rules.appendix, separator: '<&>' };
    });
    const written = numberingXml(scheme, links);
    expect(levels(written, 1).slice(0, 3)).toMatchObject([
      { format: 'upperRoman', text: '%1' },
      { format: 'lowerLetter', text: '%1-%2' },
      { format: 'lowerLetter', text: '%1-%2-%3' },
    ]);
    expect(levels(written, 3)[1]!.text).toBe('%1<&>%2');
    expect(written).toContain('%1&lt;&amp;&gt;%2');
  });
});

describe('a section rule Word cannot compute (Word 1, ruling R7)', () => {
  const outline = [
    node('front', 'front', [node('front-a', 'front')]),
    node('intro', 'body', [node('scope', 'body', [node('limits', 'body')]), node('aims', 'body')]),
    node('unnumbered', 'body', [node('beneath', 'body')], false),
    node('method', 'body'),
    node('tables', 'appendix', [node('values', 'appendix')]),
    node('glossary', 'appendix'),
  ];

  it('finds nothing in the default scheme: every number it writes is one Word computes', () => {
    expect(numberingNotInWord(defaultNumberingScheme, numbered(outline))).toEqual([]);
  });

  it('refuses a separator holding a per cent sign, which Word reads as a number to come, in every matter that has one', () => {
    const scheme = withSections((rules) => {
      rules.front = { ...rules.front, separator: '%' };
      rules.appendix = { ...rules.appendix, separator: ' %1 ' };
    });
    // Whether or not anything is numbered in that matter: the definition is written all the same.
    expect(numberingNotInWord(scheme, numbered([node('intro', 'body')], scheme))).toEqual([
      { node: null, detail: 'section:front:separator' },
      { node: null, detail: 'section:appendix:separator' },
    ]);
  });

  it('refuses letters past z, where Word writes "bb" for the scheme\'s "ab", naming the first heading and once', () => {
    const appendices = (count: number) =>
      Array.from({ length: count }, (_, index) => node(`a${index + 1}`, 'appendix'));
    // Up to "aa" Word and the scheme agree: its letter doubled is the scheme's 27th.
    expect(numberingNotInWord(defaultNumberingScheme, numbered(appendices(27)))).toEqual([]);
    expect(numberingNotInWord(defaultNumberingScheme, numbered(appendices(30)))).toEqual([
      { node: 'a28', detail: 'section:appendix:letters' },
    ]);
  });

  it('refuses a roman numeral past 3999, which the scheme writes in decimal', () => {
    const table: NumberingTable = {
      scheme: defaultNumberingScheme.id,
      entries: [
        {
          node: 'far',
          block: null,
          sequence: 'section',
          matter: 'front',
          sections: [4000],
          value: 4000,
          restartedAt: null,
          number: '4000',
          label: '4000',
        },
      ],
    };
    expect(numberingNotInWord(defaultNumberingScheme, table)).toEqual([
      { node: 'far', detail: 'section:front:roman' },
    ]);
  });

  it('refuses a heading numbered past the ninth level, the most Word numbers (WO-I)', () => {
    const chain = (depth: number, matter: OutlineMatter): NumberableNode =>
      depth === 1
        ? node(`d${depth}`, matter)
        : { ...node(`d${depth}`, matter), children: [chain(depth - 1, matter)] };
    // Built from the deepest up: the outermost is `d10`, and the tenth level is `d1`.
    expect(numberingNotInWord(defaultNumberingScheme, numbered([chain(9, 'body')]))).toEqual([]);
    expect(numberingNotInWord(defaultNumberingScheme, numbered([chain(10, 'body')]))).toEqual([
      { node: 'd1', detail: 'section:body:depth' },
    ]);
    // An unnumbered heading that deep takes no number, and Word is asked to compute none.
    const unnumbered = { ...chain(10, 'body'), numbered: false };
    expect(numberingNotInWord(defaultNumberingScheme, numbered([unnumbered]))).toEqual([]);
  });
});
