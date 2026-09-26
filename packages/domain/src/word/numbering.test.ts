import { describe, expect, it } from 'vitest';

import { scanXml, type XmlElementEvent } from '../content/ooxml/xml.js';
import {
  conditions,
  number,
  resolve,
  type NumberableNode,
  type NumberingTable,
} from '../structure/numbering.js';
import type { Contribution } from '../structure/contributions.js';
import { walkOutline, type OutlineMatter } from '../structure/outline.js';
import {
  defaultNumberingScheme,
  numberingSchemeSchema,
  type NumberingRule,
  type NumberingScheme,
} from '../structure/scheme.js';

import {
  captionField,
  footnoteProperties,
  footnoteSections,
  numberingNotInWord,
  numberingXml,
} from './numbering.js';

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

/** What Word cannot compute of an outline of sections alone, numbered by `scheme`. */
const sectionProblems = (nodes: NumberableNode[], scheme = defaultNumberingScheme) =>
  numberingNotInWord(scheme, numbered(nodes, scheme), { nodes });

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
    expect(sectionProblems(outline)).toEqual([]);
  });

  it('refuses a separator holding a per cent sign, which Word reads as a number to come, in every matter that has one', () => {
    const scheme = withSections((rules) => {
      rules.front = { ...rules.front, separator: '%' };
      rules.appendix = { ...rules.appendix, separator: ' %1 ' };
    });
    // Whether or not anything is numbered in that matter: the definition is written all the same.
    expect(sectionProblems([node('intro', 'body')], scheme)).toEqual([
      { node: null, block: null, detail: 'section:front:separator' },
      { node: null, block: null, detail: 'section:appendix:separator' },
    ]);
  });

  it('refuses letters past z, where Word writes "bb" for the scheme\'s "ab", naming the first heading and once', () => {
    const appendices = (count: number) =>
      Array.from({ length: count }, (_, index) => node(`a${index + 1}`, 'appendix'));
    // Up to "aa" Word and the scheme agree: its letter doubled is the scheme's 27th.
    expect(sectionProblems(appendices(27))).toEqual([]);
    expect(sectionProblems(appendices(30))).toEqual([
      { node: 'a28', block: null, detail: 'section:appendix:letters' },
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
    expect(
      numberingNotInWord(defaultNumberingScheme, table, { nodes: [node('far', 'front')] }),
    ).toEqual([{ node: 'far', block: null, detail: 'section:front:roman' }]);
  });

  it('refuses a heading numbered past the ninth level, the most Word numbers (WO-I)', () => {
    const chain = (depth: number, matter: OutlineMatter): NumberableNode =>
      depth === 1
        ? node(`d${depth}`, matter)
        : { ...node(`d${depth}`, matter), children: [chain(depth - 1, matter)] };
    // Built from the deepest up: the outermost is `d10`, and the tenth level is `d1`.
    expect(sectionProblems([chain(9, 'body')])).toEqual([]);
    expect(sectionProblems([chain(10, 'body')])).toEqual([
      { node: 'd1', block: null, detail: 'section:body:depth' },
    ]);
    // An unnumbered heading that deep takes no number, and Word is asked to compute none.
    const unnumbered = { ...chain(10, 'body'), numbered: false };
    expect(sectionProblems([unnumbered])).toEqual([]);
  });
});

/**
 * A component in the outline, and the captions its occurrence holds, in order: `t…` a table's, `e…` an
 * equation's, `n…` a footnote's, and any other a figure's.
 */
type Holding = NumberableNode & {
  readonly captions: readonly string[];
  readonly children: readonly Holding[];
};
const holding = (
  id: string,
  matter: OutlineMatter,
  captions: string[] = [],
  children: Holding[] = [],
  numbered = true,
): Holding => ({ type: 'reference', id, numbered, matter, children, captions });

const SEQUENCES: Readonly<Record<string, string>> = { t: 'table', e: 'equation', n: 'footnote' };

/** The numbering table of an outline of components, and what Word cannot compute of it. */
function captioned(nodes: Holding[], scheme = defaultNumberingScheme) {
  const contributions = new Map<string, Contribution[]>();
  walkOutline(nodes, (each) => {
    contributions.set(
      each.id,
      each.captions.map((block) => ({
        block,
        sequence: SEQUENCES[block[0]!] ?? 'figure',
        numbered: true,
      })),
    );
  });
  const table = number(conditions(resolve({ nodes }, contributions)), scheme);
  return { table, problems: numberingNotInWord(scheme, table, { nodes }) };
}

/** The default scheme with a sequence's rules changed, held to the scheme's own parse. */
const withRules = (
  sequence: 'figure' | 'table' | 'equation',
  change: (rules: NumberingScheme['sequences'][string]) => void,
): NumberingScheme => {
  const scheme = structuredClone(defaultNumberingScheme);
  change(scheme.sequences[sequence]!);
  return numberingSchemeSchema.parse(scheme);
};

/** A rule counting on through its matter, never restarting and taking no prefix. */
const continuous = (rule: NumberingRule): NumberingRule => ({
  ...rule,
  restartAt: null,
  prefix: null,
});

const problem = (node: string, block: string, detail: string) => ({ node, block, detail });

describe('a caption rule Word cannot compute (Word 2, ruling R1)', () => {
  it('finds nothing in the default scheme: every figure and table number it writes is one Word computes', () => {
    const { table, problems } = captioned([
      // An unnumbered foreword gives its figure no number, and Word is asked to compute none.
      holding('foreword', 'front', ['ff'], [], false),
      holding('preface', 'front', ['fp', 'tp']),
      // Before the body's first chapter a number has no prefix, and Word's count restarts at the
      // chapter as the scheme's does (measured: an unnumbered Heading 1 restarts a SEQ too).
      holding('opening', 'body', ['fo'], [], false),
      holding('intro', 'body', ['f1', 't1'], [holding('scope', 'body', ['f2'])]),
      holding('method', 'body', ['f3']),
      holding('tables', 'appendix', ['fa', 'ta'], [holding('values', 'appendix', ['fb'])]),
    ]);
    expect(problems).toEqual([]);
    const captions = table.entries.filter((entry) => entry.sequence !== 'section');
    expect(captions.map((entry) => [entry.block, entry.label])).toEqual([
      ['ff', null],
      ['fp', 'Figure i.1'],
      ['tp', 'Table i.1'],
      ['fo', 'Figure 1'],
      ['f1', 'Figure 1.1'],
      ['t1', 'Table 1.1'],
      ['f2', 'Figure 1.2'],
      ['f3', 'Figure 2.1'],
      ['fa', 'Figure A.1'],
      ['ta', 'Table A.1'],
      ['fb', 'Figure A.2'],
    ]);
  });

  it('refuses a caption after a heading with no number, which Word takes as the chapter and restarts its count at', () => {
    // Measured in Word 16: `STYLEREF 1 \s` gives 0 for an unnumbered Heading 1 and `SEQ \s 1` restarts
    // there, so Word prints "Figure 0.1" where the scheme carries on to "Figure 1.2".
    const { table, problems } = captioned([
      holding('intro', 'body', ['f1']),
      holding('interlude', 'body', ['f2', 't1'], [], false),
      holding('method', 'body', ['f3']),
    ]);
    expect(table.entries.find((entry) => entry.block === 'f2')?.label).toBe('Figure 1.2');
    expect(problems).toEqual([
      problem('interlude', 'f2', 'figure:body:prefix'),
      problem('interlude', 'f2', 'figure:body:restart'),
      // The document's first table is 1 to both: only its prefix is Word's own.
      problem('interlude', 't1', 'table:body:prefix'),
    ]);
  });

  it("computes a prefix at the second level, as Word's STYLEREF 2 does, and refuses a caption before its chapter's first second-level heading", () => {
    const scheme = withRules('figure', (rules) => {
      rules.body = { ...rules.body, prefix: 2, restartAt: 2 };
    });
    const under = captioned(
      [
        holding('intro', 'body', [], [holding('scope', 'body', ['f1', 'f2'])]),
        holding('method', 'body', [], [holding('design', 'body', ['f3'])]),
      ],
      scheme,
    );
    expect(under.problems).toEqual([]);
    expect(under.table.entries.find((entry) => entry.block === 'f3')?.label).toBe('Figure 2.1.1');
    // Measured in Word 16: STYLEREF 2 finds the last second-level heading, 1.1, where the scheme
    // writes 2.0; `SEQ \s 2` restarts at the chapter, as the scheme's counter does.
    const before = captioned(
      [
        holding('intro', 'body', [], [holding('scope', 'body', ['f1'])]),
        holding('method', 'body', ['f2']),
      ],
      scheme,
    );
    expect(before.table.entries.find((entry) => entry.block === 'f2')?.label).toBe('Figure 2.0.1');
    expect(before.problems).toEqual([problem('method', 'f2', 'figure:body:prefix')]);
  });

  it("refuses a count that carries on through its matter where Word's one sequence counts the matter before it too", () => {
    const scheme = withRules('figure', (rules) => {
      rules.front = continuous(rules.front);
      rules.body = continuous(rules.body);
      rules.appendix = continuous(rules.appendix);
    });
    // Across chapters of one matter, Word's SEQ with no restart counts as the scheme does.
    const chapters = [holding('intro', 'body', ['f1']), holding('method', 'body', ['f2', 'f3'])];
    expect(captioned(chapters, scheme).problems).toEqual([]);
    // Each matter counts from 1 in the scheme, and Word's sequence carries on from the preface's.
    const matters = [holding('preface', 'front', ['f0']), holding('intro', 'body', ['f1'])];
    expect(captioned(matters, scheme).problems).toEqual([
      problem('intro', 'f1', 'figure:body:restart'),
    ]);
  });

  it('refuses a prefix or a restart past the ninth level, where Word has no heading style', () => {
    const scheme = withRules('table', (rules) => {
      rules.body = { ...rules.body, prefix: 10, restartAt: 10 };
    });
    expect(captioned([holding('intro', 'body', ['t1', 't2'])], scheme).problems).toEqual([
      problem('intro', 't1', 'table:body:prefix'),
      problem('intro', 't1', 'table:body:restart'),
    ]);
  });

  it('refuses a separator holding a character Word cannot write in a run, where the number is prefixed', () => {
    const separated = (separator: string) =>
      withRules('figure', (rules) => {
        rules.body = { ...rules.body, separator };
      });
    const control = separated(`x${String.fromCharCode(1)}`);
    expect(captioned([holding('intro', 'body', ['f1', 'f2'])], control).problems).toEqual([
      problem('intro', 'f1', 'figure:body:separator'),
    ]);
    // Where the scheme writes no prefix the separator is never written, and is not asked.
    const unprefixed = [holding('opening', 'body', ['f0'], [], false)];
    expect(captioned(unprefixed, control).problems).toEqual([]);
    // A caption's separator is words between two fields, not a level's text: a per cent sign and a
    // tab are written as they are.
    for (const writable of ['%', String.fromCharCode(9), ' - ']) {
      const { problems } = captioned([holding('intro', 'body', ['f1'])], separated(writable));
      expect(problems).toEqual([]);
    }
  });

  it('refuses letters past z, where Word writes "bb" for the scheme\'s "ab", naming the first caption and once', () => {
    const scheme = withRules('table', (rules) => {
      rules.body = { ...continuous(rules.body), format: ['lowerAlpha'] };
    });
    const tables = (count: number) => Array.from({ length: count }, (_, index) => `t${index + 1}`);
    expect(captioned([holding('intro', 'body', tables(27))], scheme).problems).toEqual([]);
    expect(captioned([holding('intro', 'body', tables(30))], scheme).problems).toEqual([
      problem('intro', 't28', 'table:body:letters'),
    ]);
  });

  it('refuses a roman numeral past 3999, which the scheme writes in decimal and Word does not', () => {
    const scheme = withRules('figure', (rules) => {
      rules.body = { ...continuous(rules.body), format: ['upperRoman'] };
    });
    const figures = (count: number) => Array.from({ length: count }, (_, index) => `f${index + 1}`);
    expect(captioned([holding('intro', 'body', figures(3999))], scheme).problems).toEqual([]);
    expect(captioned([holding('intro', 'body', figures(4001))], scheme).problems).toEqual([
      problem('intro', 'f4000', 'figure:body:roman'),
    ]);
  });

  it('asks nothing of equations, which Word does not number yet', () => {
    const scheme = withRules('equation', (rules) => {
      rules.body = { ...rules.body, prefix: 12, restartAt: 12 };
    });
    const outline = [
      holding('intro', 'body', ['e1', 'n1']),
      holding('interlude', 'body', ['e2', 'n2'], [], false),
    ];
    expect(captioned(outline, scheme).problems).toEqual([]);
  });
});

describe('a footnote rule Word cannot compute (Word 3, ruling R2)', () => {
  /** The default scheme with its footnote rules changed, held to the scheme's own parse. */
  const withFootnotes = (change: (rules: NumberingScheme['sequences'][string]) => void) => {
    const scheme = structuredClone(defaultNumberingScheme);
    change(scheme.sequences['footnote']!);
    return numberingSchemeSchema.parse(scheme);
  };
  const notes = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => `n${from + index}`);

  it('finds nothing in the default scheme: each matter counts from 1, as Word does restarting each section', () => {
    const { table, problems } = captioned([
      holding('preface', 'front', ['n1', 'n2']),
      holding('intro', 'body', ['n3'], [holding('scope', 'body', ['n4'])]),
      holding('method', 'body', ['n5'], [], false),
      holding('tables', 'appendix', ['n6']),
    ]);
    expect(problems).toEqual([]);
    const footnotes = table.entries.filter((entry) => entry.sequence === 'footnote');
    expect(footnotes.map((entry) => [entry.block, entry.label])).toEqual([
      ['n1', '1'],
      ['n2', '2'],
      ['n3', '1'],
      ['n4', '2'],
      ['n5', '3'],
      ['n6', '1'],
    ]);
  });

  it("counts a matter entered a second time from 1 again, as Word's section does: passing where the matter's earlier sections held none, and refusing it where they did", () => {
    // Measured in Word 16: the body entered again after an appendix printed its note 5, its place
    // among every note, where its section carried on (`continuous`); each section restarts instead.
    const carried = [
      holding('intro', 'body', ['n1', 'n2']),
      holding('tables', 'appendix'),
      holding('method', 'body', ['n3']),
    ];
    expect(captioned(carried).problems).toEqual([problem('method', 'n3', 'footnote:body:restart')]);
    // A matter whose footnotes begin in the second section it holds starts its count there.
    const late = [
      holding('intro', 'body'),
      holding('tables', 'appendix', ['n1']),
      holding('method', 'body', ['n2']),
    ];
    expect(captioned(late).problems).toEqual([]);
  });

  it('refuses a restart Word would not make, where it meets a footnote, and passes one that never does', () => {
    const scheme = withFootnotes((rules) => {
      rules.body = { ...rules.body, restartAt: 1 };
    });
    // One chapter holding footnotes: the scheme's restart and Word's section agree.
    expect(captioned([holding('intro', 'body', ['n1', 'n2'])], scheme).problems).toEqual([]);
    expect(
      captioned([holding('intro', 'body', ['n1']), holding('method', 'body', ['n2'])], scheme)
        .problems,
    ).toEqual([problem('method', 'n2', 'footnote:body:restart')]);
  });

  it("refuses a number Word cannot write at all: a word before it, or its chapter's number, where the scheme writes one", () => {
    const labelled = withFootnotes((rules) => {
      rules.front = { ...rules.front, label: 'Note' };
    });
    expect(captioned([holding('preface', 'front', ['n1', 'n2'])], labelled).problems).toEqual([
      problem('preface', 'n1', 'footnote:front:label'),
    ]);
    const prefixed = withFootnotes((rules) => {
      rules.body = { ...rules.body, prefix: 1 };
    });
    // Before the body's first chapter the scheme writes no prefix, and nothing is refused.
    expect(captioned([holding('opening', 'body', ['n1'], [], false)], prefixed).problems).toEqual(
      [],
    );
    expect(captioned([holding('intro', 'body', ['n1', 'n2'])], prefixed).problems).toEqual([
      problem('intro', 'n1', 'footnote:body:prefix'),
    ]);
  });

  it('refuses letters past z and a roman numeral past 3999, naming the first footnote and once', () => {
    const lettered = withFootnotes((rules) => {
      rules.body = { ...rules.body, format: ['lowerAlpha'] };
    });
    expect(captioned([holding('intro', 'body', notes(1, 27))], lettered).problems).toEqual([]);
    expect(captioned([holding('intro', 'body', notes(1, 30))], lettered).problems).toEqual([
      problem('intro', 'n28', 'footnote:body:letters'),
    ]);
    const roman = withFootnotes((rules) => {
      rules.appendix = { ...rules.appendix, format: ['upperRoman'] };
    });
    expect(captioned([holding('tables', 'appendix', notes(1, 3999))], roman).problems).toEqual([]);
    expect(captioned([holding('tables', 'appendix', notes(1, 4001))], roman).problems).toEqual([
      problem('tables', 'n4000', 'footnote:appendix:roman'),
    ]);
  });
});

describe('the footnote numbering each section is written with (Word 3, ruling R2; M5)', () => {
  it('makes a section of each run of top-level nodes of one matter, which every node beneath them stands in', () => {
    const nodes = [
      holding('preface', 'front'),
      holding('intro', 'body', [], [holding('scope', 'body')]),
      holding('tables', 'appendix'),
      holding('method', 'body', [], [holding('design', 'body')]),
      holding('results', 'body'),
    ];
    const sections = footnoteSections(nodes);
    expect(sections.matters).toEqual(['front', 'body', 'appendix', 'body']);
    expect(sections.sectionOf.get('scope')).toBe(1);
    expect(sections.sectionOf.get('design')).toBe(3);
    expect(sections.sectionOf.get('results')).toBe(3);
  });

  it("writes the matter's format as Word's number format, and Word's count started again at each section", () => {
    const scheme = structuredClone(defaultNumberingScheme);
    scheme.sequences['footnote']!.appendix.format = ['decimal', 'lowerAlpha'];
    expect(footnoteProperties(scheme, 'front')).toBe(
      '<w:footnotePr><w:numFmt w:val="decimal"/><w:numRestart w:val="eachSect"/></w:footnotePr>',
    );
    expect(footnoteProperties(scheme, 'appendix')).toBe(
      '<w:footnotePr><w:numFmt w:val="lowerLetter"/><w:numRestart w:val="eachSect"/></w:footnotePr>',
    );
  });
});

describe("the fields a caption's number is written with (Word 2, ruling R1)", () => {
  it("names the label's word, the heading level of its prefix, the separator, the sequence, its format and its restart", () => {
    const { table } = captioned([
      holding('foreword', 'front', ['ff'], [], false),
      holding('opening', 'body', ['fo'], [], false),
      holding('intro', 'body', ['t1']),
    ]);
    const entry = (block: string) => table.entries.find((each) => each.block === block)!;
    expect(captionField(defaultNumberingScheme, entry('t1'))).toEqual({
      word: 'Table',
      prefix: 1,
      separator: '.',
      sequence: 'Table',
      format: 'arabic',
      restart: 1,
    });
    // Where the scheme writes no prefix, the number is the sequence's field alone.
    expect(captionField(defaultNumberingScheme, entry('fo'))).toEqual({
      word: 'Figure',
      prefix: null,
      separator: '.',
      sequence: 'Figure',
      format: 'arabic',
      restart: 1,
    });
    // A caption the scheme gives no number is written with no field, and a heading has none of these.
    expect(captionField(defaultNumberingScheme, entry('ff'))).toBeNull();
    const heading = table.entries.find((each) => each.sequence === 'section')!;
    expect(captionField(defaultNumberingScheme, heading)).toBeNull();
  });

  it("writes each format as Word's field format switch names it", () => {
    const formats = ['decimal', 'lowerAlpha', 'upperAlpha', 'lowerRoman', 'upperRoman'] as const;
    const written = formats.map((format) => {
      const scheme = withRules('figure', (rules) => {
        rules.body = { ...rules.body, format: [format] };
      });
      const { table } = captioned([holding('intro', 'body', ['f1'])], scheme);
      return captionField(
        scheme,
        table.entries.find((each) => each.block === 'f1')!,
      )?.format;
    });
    expect(written).toEqual(['arabic', 'alphabetic', 'ALPHABETIC', 'roman', 'ROMAN']);
  });
});
