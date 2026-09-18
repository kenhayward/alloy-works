import { describe, expect, it } from 'vitest';

import { parseContentDocument } from '../content/model/document.js';

import { contributionsOf, type Contribution } from './contributions.js';
import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  type NumberableNode,
  type NumberingEntry,
} from './numbering.js';
import {
  defaultNumberingScheme,
  formatCounter,
  formatParts,
  numberingSchemeSchema,
  type NumberingRule,
  type NumberingScheme,
} from './scheme.js';

const MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

const section = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'section',
  id: id(name),
  numbered: true,
  matter: 'body',
  title: [{ type: 'text', value: name, marks: [] }],
  children,
  ...over,
});

const reference = (
  name: string,
  children: NumberableNode[] = [],
  over: Partial<NumberableNode> = {},
): NumberableNode => ({
  type: 'reference',
  id: id(name),
  numbered: true,
  matter: 'body',
  children,
  ...over,
});

const figures = (...blocks: string[]): Contribution[] =>
  blocks.map((block) => ({ block, sequence: 'figure', numbered: true }));

/** The pipeline, in its order: resolve, conditions, number. `known` is keyed by occurrence name. */
const table = (
  nodes: NumberableNode[],
  known: Record<string, readonly Contribution[]> = {},
  scheme: NumberingScheme = defaultNumberingScheme,
) =>
  number(
    conditions(
      resolve({ nodes }, new Map(Object.entries(known).map(([name, list]) => [id(name), list]))),
    ),
    scheme,
  );

/** The default scheme with one sequence's body rule changed, or added, parsed as a layout's would be. */
const withRule = (sequence: string, body: Partial<NumberingRule>): NumberingScheme => {
  const base =
    defaultNumberingScheme.sequences[sequence] ?? defaultNumberingScheme.sequences['figure']!;
  return numberingSchemeSchema.parse({
    id: `${defaultNumberingScheme.id}+${sequence}`,
    sequences: Object.fromEntries([
      ...Object.entries(defaultNumberingScheme.sequences),
      [sequence, { ...base, body: { ...base.body, ...body } }],
    ]),
  });
};

const labels = (entries: readonly NumberingEntry[], sequence: string) =>
  entries.filter((entry) => entry.sequence === sequence).map((entry) => entry.label);

describe('numbering an outline', () => {
  it('numbers sections as a counter stack, in document order', () => {
    const numbered = table([
      section('intro'),
      section('method', [section('scope'), section('design', [section('sample')])]),
      section('results'),
    ]);
    expect([...sectionNumbers(numbered).values()]).toEqual(['1', '2', '2.1', '2.2', '2.2.1', '3']);
  });

  it('STR-023 numbers every caption-bearing block in the sequence for its kind, wherever it is nested', () => {
    const figure = (block: string) => ({
      type: 'figure',
      id: block,
      asset: 'asset',
      imageStyle: 'wide',
      caption: 'A caption',
      alternative: { kind: 'decorative' },
    });
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Dosing',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        figure('f1'),
        {
          type: 'table',
          id: 't1',
          caption: 'Doses',
          headerRows: 1,
          headerColumns: 0,
          rows: [
            {
              cells: [
                { content: [{ type: 'equation', id: 'e1', mathml: MATHML, numbered: true }] },
              ],
            },
          ],
        },
        { type: 'list', id: 'l1', kind: 'unordered', items: [{ content: [figure('f2')] }] },
        {
          type: 'blockquote',
          id: 'q1',
          content: [{ type: 'equation', id: 'e2', mathml: MATHML, numbered: true }],
        },
      ],
    });
    const numbered = table([section('one', [reference('dosing')])], {
      dosing: contributionsOf(content),
    });
    const captions = numbered.entries.filter((entry) => entry.block !== null);
    expect(captions.map((entry) => [entry.block, entry.label])).toEqual([
      ['f1', 'Figure 1.1'],
      ['t1', 'Table 1.1'],
      ['e1', 'Equation 1'],
      ['f2', 'Figure 1.2'],
      ['e2', 'Equation 2'],
    ]);
  });

  it('CNT-047 gives an unnumbered block equation no number, and the next one the number it would have taken', () => {
    const content = parseContentDocument({
      schemaVersion: 1,
      title: 'Maths',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
        { type: 'equation', id: 'e2', mathml: MATHML, numbered: false },
        { type: 'equation', id: 'e3', mathml: MATHML, numbered: true },
      ],
    });
    const numbered = table([reference('maths')], { maths: contributionsOf(content) });
    expect(numbered.entries.filter((entry) => entry.sequence === 'equation')).toMatchObject([
      { block: 'e1', label: 'Equation 1' },
      { block: 'e3', label: 'Equation 2' },
    ]);
    // The row's other half: there is no third, ambiguous state. An equation that does not say
    // whether it is numbered is refused outright, at admission, never reaching the engine.
    expect(() =>
      parseContentDocument({
        schemaVersion: 1,
        title: 'Maths',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'equation', id: 'e4', mathml: MATHML }],
      }),
    ).toThrow();
  });

  it('STR-014 numbers each sequence independently, and a sequence the scheme declares beyond its own', () => {
    const mixed: Contribution[] = [
      { block: 't1', sequence: 'table', numbered: true },
      { block: 'f1', sequence: 'figure', numbered: true },
      { block: 'x1', sequence: 'listing', numbered: true },
      { block: 'q1', sequence: 'equation', numbered: true },
      { block: 't2', sequence: 'table', numbered: true },
      { block: 'f2', sequence: 'figure', numbered: true },
    ];
    const outline = [section('one', [reference('mixed')])];
    const declared = table(outline, { mixed }, withRule('listing', { label: 'Listing' }));
    expect(labels(declared.entries, 'table')).toEqual(['Table 1.1', 'Table 1.2']);
    expect(labels(declared.entries, 'figure')).toEqual(['Figure 1.1', 'Figure 1.2']);
    expect(labels(declared.entries, 'listing')).toEqual(['Listing 1.1']);
    expect(labels(declared.entries, 'equation')).toEqual(['Equation 1']);
    // Undeclared, the same contribution numbers nothing and moves no other sequence.
    const undeclared = table(outline, { mixed });
    expect(labels(undeclared.entries, 'listing')).toEqual([]);
    expect(labels(undeclared.entries, 'figure')).toEqual(['Figure 1.1', 'Figure 1.2']);
    expect(labels(undeclared.entries, 'equation')).toEqual(['Equation 1']);
  });

  it('STR-015 restarts a sequence at the depth the scheme declares, or never', () => {
    const outline = [
      section('one', [section('a', [reference('p')]), section('b', [reference('q')])]),
      section('two', [section('c', [reference('r')])]),
    ];
    const known = { p: figures('p1'), q: figures('q1'), r: figures('r1') };
    expect(labels(table(outline, known).entries, 'figure')).toEqual([
      'Figure 1.1',
      'Figure 1.2',
      'Figure 2.1',
    ]);
    const perSection = withRule('figure', { restartAt: 2, prefix: 2 });
    expect(labels(table(outline, known, perSection).entries, 'figure')).toEqual([
      'Figure 1.1.1',
      'Figure 1.2.1',
      'Figure 2.1.1',
    ]);
    const continuous = withRule('figure', { restartAt: null, prefix: null });
    expect(labels(table(outline, known, continuous).entries, 'figure')).toEqual([
      'Figure 1',
      'Figure 2',
      'Figure 3',
    ]);
  });

  it('STR-016 numbers appendices in their own scheme, each restarting its own sequences', () => {
    const numbered = table(
      [
        section('one', [reference('p')]),
        section('glossary', [section('terms', [reference('q')])], { matter: 'appendix' }),
        section('data', [reference('r')], { matter: 'appendix' }),
        section('two', [reference('s')]),
      ],
      { p: figures('p1'), q: figures('q1', 'q2'), r: figures('r1'), s: figures('s1') },
    );
    // A reference is a heading in the outline, so it takes a section number of its own.
    expect([...sectionNumbers(numbered).entries()]).toEqual([
      [id('one'), '1'],
      [id('p'), '1.1'],
      [id('glossary'), 'A'],
      [id('terms'), 'A.1'],
      [id('q'), 'A.1.1'],
      [id('data'), 'B'],
      [id('r'), 'B.1'],
      [id('two'), '2'],
      [id('s'), '2.1'],
    ]);
    expect(labels(numbered.entries, 'figure')).toEqual([
      'Figure 1.1',
      'Figure A.1',
      'Figure A.2',
      'Figure B.1',
      'Figure 2.1',
    ]);
    expect(numbered.entries.find((entry) => entry.block === 'r1')).toMatchObject({
      matter: 'appendix',
      restartedAt: id('data'),
    });
  });

  it(
    "pins decision E's appendix numbers: equations and tables prefixed and restarting per " +
      'appendix, footnotes continuing across two appendices, and body equations continuous',
    () => {
      const outline = [
        section('one', [reference('p'), reference('q')]),
        section('glossary', [reference('r')], { matter: 'appendix' }),
        section('data', [reference('s')], { matter: 'appendix' }),
      ];
      const known = {
        p: [{ block: 'e1', sequence: 'equation', numbered: true }],
        q: [
          { block: 'e2', sequence: 'equation', numbered: true },
          // A body footnote: the body keeps its own footnote counter, independent of the
          // appendices' - both may print '1' with nothing shared between them.
          { block: 'fb0', sequence: 'footnote', numbered: true },
        ],
        r: [
          { block: 'ea1', sequence: 'equation', numbered: true },
          { block: 'ta1', sequence: 'table', numbered: true },
          { block: 'fa1', sequence: 'footnote', numbered: true },
        ],
        s: [
          // The second appendix restarts equation and table too, not only footnote.
          { block: 'ea2', sequence: 'equation', numbered: true },
          { block: 'ta2', sequence: 'table', numbered: true },
          { block: 'fb1', sequence: 'footnote', numbered: true },
        ],
      };
      const numbered = table(outline, known);
      // Body equations are continuous: an appendix later in the document restarts nothing before
      // it. Each appendix restarts and prefixes its own equations independently.
      expect(labels(numbered.entries, 'equation')).toEqual([
        'Equation 1',
        'Equation 2',
        'Equation A.1',
        'Equation B.1',
      ]);
      expect(labels(numbered.entries, 'table')).toEqual(['Table A.1', 'Table B.1']);
      // Footnotes carry no label in the default scheme. The body's own counter ('1') is separate
      // from the appendices' shared one, which continues across both of them ('1', then '2').
      expect(labels(numbered.entries, 'footnote')).toEqual(['1', '1', '2']);
    },
  );

  it(
    'gives no number to a caption in appendix matter before any numbered appendix has started, ' +
      'rather than a bare one that would repeat a body caption of its own',
    () => {
      const outline = [
        section('one', [reference('p')]),
        // Unnumbered, and first in appendix matter: no numbered appendix has begun a chapter yet,
        // so there is no count for its captions to continue.
        section('early', [reference('q')], { matter: 'appendix', numbered: false }),
        section('glossary', [reference('r')], { matter: 'appendix' }),
      ];
      const known = {
        p: [{ block: 'be1', sequence: 'equation', numbered: true }],
        q: [
          { block: 'fq', sequence: 'figure', numbered: true },
          { block: 'eq', sequence: 'equation', numbered: true },
        ],
        r: figures('fr'),
      };
      const numbered = table(outline, known);
      // The body's own equation is unaffected - it is continuous and needs no chapter.
      expect(numbered.entries.find((entry) => entry.block === 'be1')).toMatchObject({
        label: 'Equation 1',
      });
      // No numbered appendix has started: a bare "Figure 1" or "Equation 1" here would repeat
      // 'be1's own label, so these get no number at all, never a guessed one.
      expect(numbered.entries.find((entry) => entry.block === 'fq')).toMatchObject({
        value: null,
        number: null,
        label: null,
      });
      expect(numbered.entries.find((entry) => entry.block === 'eq')).toMatchObject({
        value: null,
        number: null,
        label: null,
      });
      // Once a numbered appendix has begun a chapter, decision D's rule (continue the previous
      // chapter's count) applies exactly as it did before this fix.
      expect(numbered.entries.find((entry) => entry.block === 'fr')).toMatchObject({
        label: 'Figure A.1',
      });
    },
  );

  it('STR-017 excludes a node from numbering without it consuming a number', () => {
    const numbered = table([
      section('preface', [section('thanks')], { numbered: false }),
      section('one'),
      section('aside', [], { numbered: false }),
      section('two'),
    ]);
    expect([...sectionNumbers(numbered).entries()]).toEqual([
      [id('one'), '1'],
      [id('two'), '2'],
    ]);
  });

  it('carries on the counters of the numbered node before an unnumbered one, and restarts nothing', () => {
    const numbered = table(
      [
        section('preface', [reference('p')], { numbered: false }),
        section('one', [reference('q')]),
        section('aside', [reference('r')], { numbered: false }),
        section('two', [reference('s')]),
      ],
      { p: figures('p1'), q: figures('q1'), r: figures('r1'), s: figures('s1') },
    );
    expect(labels(numbered.entries, 'figure')).toEqual([
      'Figure 1',
      'Figure 1.1',
      'Figure 1.2',
      'Figure 2.1',
    ]);
  });

  it('STR-021 numbers each occurrence of one component independently', () => {
    const numbered = table(
      [section('one', [reference('twice')]), section('two', [reference('again')])],
      // Two occurrences of one component: the same contributions, keyed by each occurrence's node.
      { twice: figures('f1', 'f2'), again: figures('f1', 'f2') },
    );
    const f1 = numbered.entries.filter((entry) => entry.block === 'f1');
    expect(f1.map((entry) => [entry.node, entry.label])).toEqual([
      [id('twice'), 'Figure 1.1'],
      [id('again'), 'Figure 2.1'],
    ]);
  });

  it('CNT-041 counts footnotes over the document, not within a component', () => {
    const notes: Contribution[] = [
      { block: 'n1', sequence: 'footnote', numbered: true },
      { block: 'n2', sequence: 'footnote', numbered: true },
    ];
    const numbered = table(
      [
        section('one', [reference('first')], {
          title: [
            { type: 'text', value: 'One', marks: [] },
            { type: 'footnote', id: 'tn', anchor: { kind: 'span' }, content: [] },
          ],
        }),
        section('two', [reference('second')]),
      ],
      { first: notes, second: notes },
    );
    expect(numbered.entries.filter((entry) => entry.sequence === 'footnote')).toMatchObject([
      { node: id('one'), block: 'tn', number: '1' },
      { node: id('first'), block: 'n1', number: '2' },
      { node: id('first'), block: 'n2', number: '3' },
      { node: id('second'), block: 'n1', number: '4' },
      { node: id('second'), block: 'n2', number: '5' },
    ]);
  });

  it('STR-022 traces every number to the node, block, counters and restart that produced it', () => {
    const numbered = table([section('one'), section('two', [section('a', [reference('p')])])], {
      p: figures('p1', 'p2'),
    });
    expect(numbered.scheme).toBe('default/1');
    expect(numbered.entries.find((entry) => entry.block === 'p2')).toEqual({
      node: id('p'),
      block: 'p2',
      sequence: 'figure',
      matter: 'body',
      sections: [2, 1, 1],
      value: 2,
      restartedAt: id('two'),
      number: '2.2',
      label: 'Figure 2.2',
    });
    expect(numbered.entries.find((entry) => entry.node === id('a'))).toEqual({
      node: id('a'),
      block: null,
      sequence: 'section',
      matter: 'body',
      sections: [2, 1],
      value: 1,
      restartedAt: id('two'),
      number: '2.1',
      label: '2.1',
    });
  });

  it('STR-018 numbers the same outline the same way, however its values were built', () => {
    const build = (reversed: boolean): NumberableNode[] => {
      const node = (name: string, children: NumberableNode[] = []) => {
        const members: [string, unknown][] = [
          ['type', 'reference'],
          ['id', id(name)],
          ['numbered', true],
          ['matter', 'body'],
          ['children', children],
        ];
        return Object.fromEntries(
          reversed ? members.reverse() : members,
        ) as unknown as NumberableNode;
      };
      return [node('one', [node('p')]), node('two', [node('q')])];
    };
    const known = (reversed: boolean) => {
      const entries: [string, Contribution[]][] = [
        ['p', figures('p1')],
        ['q', figures('q1')],
        ['one', []],
        ['two', []],
      ];
      return Object.fromEntries(reversed ? entries.reverse() : entries);
    };
    const first = table(build(false), known(false));
    expect(JSON.stringify(table(build(true), known(true)))).toBe(JSON.stringify(first));
    expect(JSON.stringify(table(build(false), known(false)))).toBe(JSON.stringify(first));
    // Nor does the order `number` finds a scheme's own sequences in - the only order it iterates.
    const reversedScheme = numberingSchemeSchema.parse({
      ...defaultNumberingScheme,
      sequences: Object.fromEntries(Object.entries(defaultNumberingScheme.sequences).reverse()),
    });
    expect(JSON.stringify(table(build(false), known(false), reversedScheme))).toBe(
      JSON.stringify(first),
    );
  });

  it('withholds every number an occurrence nobody here can read could have moved, and no other', () => {
    const outline = [
      section('one', [
        reference('readable'),
        reference('secret', [reference('nested')]),
        reference('after'),
      ]),
      section('two', [reference('later')]),
      section('appendixed', [reference('sealed')], { matter: 'appendix' }),
    ];
    const known = {
      readable: figures('a1'),
      // Nested under the unknown occurrence: known in itself, but downstream of it in document order.
      nested: figures('n1'),
      after: figures('b1'),
      later: figures('c1'),
      // An appendix keeps counters of its own, untouched by the body's unknown occurrence.
      sealed: figures('z1'),
    };
    const numbered = table(outline, known);
    expect(numbered.entries.filter((entry) => entry.sequence === 'figure')).toMatchObject([
      { block: 'a1', label: 'Figure 1.1' },
      // Nested under the unknown occurrence: withheld too, though its own content is known.
      { block: 'n1', value: null, number: null, label: null },
      // After the unknown occurrence, in the same chapter: not guessed.
      { block: 'b1', value: null, number: null, label: null },
      // Chapter two restarts the counter, so its figures are known again.
      { block: 'c1', label: 'Figure 2.1' },
      // The appendix's own counter was never touched by the body's unknown occurrence.
      { block: 'z1', label: 'Figure A.1' },
    ]);
    // A continuous sequence stays unknown to the end, whatever the unknown occurrence holds.
    const equations = table(outline, {
      ...known,
      later: [{ block: 'e1', sequence: 'equation', numbered: true }],
    });
    expect(equations.entries.find((entry) => entry.block === 'e1')).toMatchObject({ number: null });
    // And every section number is known, since none depends on what an occurrence holds.
    expect([...sectionNumbers(numbered).values()]).toEqual([
      '1',
      '1.1',
      '1.2',
      '1.2.1',
      '1.3',
      '2',
      '2.1',
      'A',
      'A.1',
    ]);
  });

  it('gives every section the same number whatever the occurrences contribute', () => {
    const outline = [
      section('one', [reference('p', [section('inner')])]),
      section('two', [], { matter: 'appendix' }),
    ];
    const none = sectionNumbers(table(outline));
    const all = sectionNumbers(table(outline, { p: figures('p1', 'p2') }));
    expect([...none.entries()]).toEqual([...all.entries()]);
  });

  it('numbers nine levels', () => {
    let nodes: NumberableNode[] = [reference('deep9')];
    for (let level = 8; level >= 1; level -= 1) nodes = [section(`deep${level}`, nodes)];
    const numbered = table(nodes, { deep9: figures('f') });
    expect(sectionNumbers(numbered).get(id('deep9'))).toBe('1.1.1.1.1.1.1.1.1');
    expect(labels(numbered.entries, 'figure')).toEqual(['Figure 1.1']);
  });

  it('numbers every shape of outline the parse accepts, one section entry per numbered node', () => {
    // A Lehmer / Park-Miller generator over the Mersenne prime 2^31 - 1: every intermediate product
    // (seed, at most ~2^31, times the 48271 multiplier) stays well under 2^53, so - unlike
    // `seed * 1103515245`, which overflows a double's exact integer range after two calls and then
    // returns 0 forever - this one keeps its full period and gives the same two hundred outlines on
    // every run, on every platform.
    let seed = 7;
    const next = (below: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % below;
    };
    let count = 0;
    // Non-triviality, measured across all two hundred runs (the review's readability bits, drawn
    // in the same loop as each occurrence's content below, shift these from an earlier count):
    // 6,425 nodes in all, a maximum recursion depth of 7 (the walk stops generating children past
    // depth 6, so 7 is the deepest call that finds nothing to add), 4,808 numbered and 1,617
    // unnumbered nodes, 3,218 references against 3,207 sections, 208 body and 90 appendix
    // top-level nodes, and 72 of the 200 runs place at least one appendix. Two occurrences of one
    // component - STR-021's own shape - is covered on its own terms by the dedicated test above:
    // this generator gives every occurrence its own identifier, so it demonstrates depth, breadth
    // and every switch instead.
    let totalNodes = 0;
    let maxDepth = 0;
    let numberedNodes = 0;
    let unnumberedNodes = 0;
    let referenceNodes = 0;
    let sectionNodes = 0;
    let bodyTopLevel = 0;
    let appendixTopLevel = 0;
    let runsWithAppendix = 0;
    const grow = (depth: number): NumberableNode[] => {
      maxDepth = Math.max(maxDepth, depth);
      return Array.from({ length: depth > 6 ? 0 : next(4) }, () => {
        count += 1;
        totalNodes += 1;
        const name = `n${count}`;
        const over = { numbered: next(4) !== 0 };
        if (over.numbered) numberedNodes += 1;
        else unnumberedNodes += 1;
        const isSection = next(2) === 0;
        if (isSection) sectionNodes += 1;
        else referenceNodes += 1;
        return isSection
          ? section(name, grow(depth + 1), over)
          : reference(name, grow(depth + 1), over);
      });
    };
    /**
     * An oracle for the default scheme, written afresh rather than by calling
     * `resolve`/`conditions`/`number`, so it can catch a bug in any of them instead of only
     * confirming whichever answer they already happen to agree on. `readable` decides which
     * occurrences this reader may see at all - a section number never depends on it (decision C):
     * only which figure labels are shown does.
     */
    const expectedOutcome = (
      outlineNodes: readonly NumberableNode[],
      figureCountOf: (occurrence: string) => number,
      readable: (occurrence: string) => boolean,
    ) => {
      const sectionRule = defaultNumberingScheme.sequences['section']!;
      const sections: Record<'body' | 'appendix', number[]> = { body: [], appendix: [] };
      const figureCounter: Record<'body' | 'appendix', number> = { body: 0, appendix: 0 };
      // True once an occurrence nobody here can read has stood in this matter since the figure
      // counter last restarted - the same window CNT-047's neighbour, Important #2, and the
      // withholding tests each exercise by hand; here it is derived, not asserted.
      const hiddenSince: Record<'body' | 'appendix', boolean> = { body: false, appendix: false };
      const expectedSections = new Map<string, string>();
      const expectedFigures = new Map<string, string | null>();

      // `matter` is a top-level node's own, inherited by its whole subtree - a child's own
      // `matter` field (always 'body', from the fixture helpers) is never consulted, matching
      // `number`'s own `visit`, which threads `matter` through the recursion rather than reading
      // `node.matter` below the top level.
      const walk = (
        list: readonly NumberableNode[],
        depth: number,
        matter: 'body' | 'appendix',
        numberedAbove: boolean,
      ) => {
        for (const node of list) {
          const takesNumber = numberedAbove && node.numbered;
          if (takesNumber) {
            const stack = sections[matter];
            // Keep this level's own running count (index depth - 1); drop only what is deeper.
            stack.length = depth;
            stack[depth - 1] = (stack[depth - 1] ?? 0) + 1;
            expectedSections.set(
              node.id,
              formatParts(stack, sectionRule[matter]).join(sectionRule[matter].separator),
            );
            // The default scheme restarts figure at depth 1 in both matters, and only there.
            if (depth === 1) {
              figureCounter[matter] = 0;
              hiddenSince[matter] = false;
            }
          }
          if (node.type === 'reference') {
            if (!readable(node.id)) {
              hiddenSince[matter] = true;
            } else {
              const count = figureCountOf(node.id);
              for (let index = 0; index < count; index += 1) {
                figureCounter[matter] += 1;
                if (hiddenSince[matter]) {
                  expectedFigures.set(node.id, null);
                } else {
                  const chapter = sections[matter][0] ?? 0;
                  const own = formatCounter(figureCounter[matter], 'decimal');
                  if (chapter > 0) {
                    const chapterFormat = matter === 'appendix' ? 'upperAlpha' : 'decimal';
                    expectedFigures.set(
                      node.id,
                      `Figure ${formatCounter(chapter, chapterFormat)}.${own}`,
                    );
                  } else if (matter === 'appendix') {
                    // No numbered appendix has started: no count to continue (Important #2).
                    expectedFigures.set(node.id, null);
                  } else {
                    expectedFigures.set(node.id, `Figure ${own}`);
                  }
                }
              }
            }
          }
          walk(node.children, depth + 1, matter, takesNumber);
        }
      };
      for (const node of outlineNodes) walk([node], 1, node.matter, true);
      return { sections: expectedSections, figures: expectedFigures };
    };

    for (let run = 0; run < 200; run += 1) {
      let appendixHere = false;
      const nodes = grow(1).map((node) => {
        const matter = next(3) === 0 ? ('appendix' as const) : ('body' as const);
        if (matter === 'appendix') {
          appendixTopLevel += 1;
          appendixHere = true;
        } else bodyTopLevel += 1;
        return { ...node, matter };
      });
      if (appendixHere) runsWithAppendix += 1;

      // Two readers over the same content: the full reader sees every occurrence (with real
      // content or none); the restricted reader is missing some of them entirely, independent of
      // whether they hold anything (decision C).
      const knownFull = new Map<string, readonly Contribution[]>();
      const knownRestricted = new Map<string, readonly Contribution[]>();
      const hasFigure = new Map<string, boolean>();
      const restrictedCanRead = new Map<string, boolean>();
      for (let index = 1; index <= count; index += 1) {
        const occurrence = id(`n${index}`);
        const holdsFigure = next(3) !== 0;
        const readableHere = next(2) !== 0;
        hasFigure.set(occurrence, holdsFigure);
        restrictedCanRead.set(occurrence, readableHere);
        const content = holdsFigure ? figures(`f${index}`) : [];
        knownFull.set(occurrence, content);
        if (readableHere) knownRestricted.set(occurrence, content);
      }
      const figureCountOf = (occurrence: string) => (hasFigure.get(occurrence) ? 1 : 0);

      const { sections: expectedSections, figures: expectedFull } = expectedOutcome(
        nodes,
        figureCountOf,
        () => true,
      );
      const { figures: expectedRestricted } = expectedOutcome(
        nodes,
        figureCountOf,
        (occurrence) => restrictedCanRead.get(occurrence) === true,
      );

      const fullTable = number(conditions(resolve({ nodes }, knownFull)), defaultNumberingScheme);
      const restrictedTable = number(
        conditions(resolve({ nodes }, knownRestricted)),
        defaultNumberingScheme,
      );

      // Section numbers: computed independently, checked against both readers - neither depends
      // on what any occurrence holds or who may read it (decision C).
      expect([...sectionNumbers(fullTable).entries()]).toEqual([...expectedSections.entries()]);
      expect([...sectionNumbers(restrictedTable).entries()]).toEqual([
        ...expectedSections.entries(),
      ]);

      // Figure labels: the full reader's, checked against the independent oracle.
      const actualFull = new Map(
        fullTable.entries
          .filter((entry) => entry.sequence === 'figure')
          .map((entry) => [entry.node, entry.label]),
      );
      expect(actualFull).toEqual(expectedFull);

      // The restricted reader's, checked against the same oracle run with its own visibility -
      // and, wherever it shows a number at all, that number equals the full reader's (never a
      // different, guessed one).
      const actualRestricted = new Map(
        restrictedTable.entries
          .filter((entry) => entry.sequence === 'figure')
          .map((entry) => [entry.node, entry.label]),
      );
      expect(actualRestricted).toEqual(expectedRestricted);
      for (const [occurrence, label] of expectedRestricted) {
        if (label !== null) expect(label).toBe(expectedFull.get(occurrence) ?? null);
      }
    }
    expect(totalNodes).toBeGreaterThan(1000);
    expect(maxDepth).toBeGreaterThanOrEqual(6);
    expect(numberedNodes).toBeGreaterThan(0);
    expect(unnumberedNodes).toBeGreaterThan(0);
    expect(referenceNodes).toBeGreaterThan(0);
    expect(sectionNodes).toBeGreaterThan(0);
    expect(bodyTopLevel).toBeGreaterThan(0);
    expect(appendixTopLevel).toBeGreaterThan(0);
    expect(runsWithAppendix).toBeGreaterThan(0);
  });
});
