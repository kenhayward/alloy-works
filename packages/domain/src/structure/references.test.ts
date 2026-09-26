import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { crossReferenceNodeSchema, type CrossReferenceTarget } from '../content/model/inline.js';

import { contributionsOf, type Contribution } from './contributions.js';
import { conditions, number, resolve } from './numbering.js';
import type { OutlineMatter, OutlineNode, OutlineViewNode } from './outline.js';
import {
  documentTargets,
  formsFor,
  kindWord,
  printableForms,
  printed,
  referenceResolver,
  targetForms,
  type BoundTarget,
  type ReferenceKind,
  type ReferenceTarget,
} from './references.js';
import { defaultNumberingScheme } from './scheme.js';

/** A node identifier in the 26-character spelling, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');

/** Three components, by invented names. */
const ADA = '0b9a6c1e-2f3d-4a5b-8c7d-6e5f4a3b2c1d';
const GRACE = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ALICE = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

const positional = (matter: OutlineMatter, numbered: boolean) => ({
  numbered,
  matter,
  pageBreak: 'none' as const,
  values: {},
});

const section = (
  name: string,
  words: string,
  children: OutlineViewNode[] = [],
  { matter = 'body', numbered = true }: { matter?: OutlineMatter; numbered?: boolean } = {},
): OutlineViewNode => ({
  type: 'section',
  id: id(name),
  title: [{ type: 'text', value: words, marks: [] }],
  ...positional(matter, numbered),
  children,
});

/** An occurrence of `component`, or of one the reader may not read where it is `null`. */
const occurrence = (
  name: string,
  component: string | null,
  children: OutlineViewNode[] = [],
): OutlineViewNode => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  ...positional('body', true),
  children,
});

const figure = (block: string, caption: string): Contribution => ({
  block,
  sequence: 'figure',
  numbered: true,
  caption,
});
const table = (block: string, caption: string): Contribution => ({
  block,
  sequence: 'table',
  numbered: true,
  caption,
});
const footnote = (block: string): Contribution => ({ block, sequence: 'footnote', numbered: true });
const equation = (block: string): Contribution => ({ block, sequence: 'equation', numbered: true });

/**
 * What the document page holds - its outline, each occurrence's contributions by the occurrence's
 * node, and the numbering it computes from both - handed to `documentTargets` for the occurrence
 * named `editing` of Ada's component.
 */
const offered = (
  nodes: OutlineViewNode[],
  known: Record<string, readonly Contribution[]>,
  editing = 'ada',
): readonly ReferenceTarget[] => {
  const contributions = new Map(Object.entries(known).map(([name, list]) => [id(name), list]));
  const outline = { nodes };
  const numbering = number(conditions(resolve(outline, contributions)), defaultNumberingScheme);
  return documentTargets({
    outline,
    numbering,
    contributions,
    editing: { component: ADA, node: id(editing) },
  });
};

const toSection = (name: string) => ({ kind: 'node' as const, node: id(name) });

describe('what a document offers a reference', () => {
  it('offers every section in document order, by its number and its words, above or below the occurrence', () => {
    const targets = offered(
      [
        section('preface', 'Preface', [], { matter: 'front' }),
        section('method', 'Method', [
          section('scope', 'Scope'),
          occurrence('ada', ADA, [section('detail', 'In detail')]),
        ]),
        section('aside', 'An aside', [], { numbered: false }),
        section('glossary', 'Glossary', [], { matter: 'appendix' }),
      ],
      { ada: [] },
    );
    expect(targets).toEqual([
      // Front matter numbers in its own scheme, lower roman in the default one.
      {
        target: toSection('preface'),
        kind: 'section',
        label: 'i',
        title: 'Preface',
        relative: 'above',
      },
      // A section holding the occurrence is above it: its heading is printed first.
      {
        target: toSection('method'),
        kind: 'section',
        label: '1',
        title: 'Method',
        relative: 'above',
      },
      {
        target: toSection('scope'),
        kind: 'section',
        label: '1.1',
        title: 'Scope',
        relative: 'above',
      },
      // The occurrence is a heading, 1.2, so what it holds is 1.2.1, printed after its content.
      {
        target: toSection('detail'),
        kind: 'section',
        label: '1.2.1',
        title: 'In detail',
        relative: 'below',
      },
      // An unnumbered section is offered by its words alone.
      {
        target: toSection('aside'),
        kind: 'section',
        label: null,
        title: 'An aside',
        relative: 'below',
      },
      {
        target: toSection('glossary'),
        kind: 'section',
        label: 'A',
        title: 'Glossary',
        relative: 'below',
      },
    ]);
  });

  it("offers each occurrence's figures, tables, footnotes and numbered equations in its place, as the edited component would store them", () => {
    const targets = offered(
      [
        section('method', 'Method', [occurrence('alice', ALICE), occurrence('ada', ADA)]),
        section('results', 'Results', [occurrence('grace', GRACE)]),
      ],
      {
        alice: [figure('lf1', ''), footnote('ln1')],
        ada: [figure('af1', 'Readings'), footnote('an1')],
        // A numbered equation is offered by its number (equations 2, ruling R7); one the author left
        // unnumbered has no number to offer, and is not.
        grace: [
          table('gt1', 'Totals'),
          equation('ge1'),
          { block: 'ge2', sequence: 'equation', numbered: false },
        ],
      },
    );
    expect(targets).toEqual([
      {
        target: toSection('method'),
        kind: 'section',
        label: '1',
        title: 'Method',
        relative: 'above',
      },
      // Another component placed once is named by its component; a caption with no words is none.
      {
        target: { kind: 'component', component: ALICE, block: 'lf1' },
        kind: 'figure',
        label: 'Figure 1.1',
        title: null,
        relative: 'above',
      },
      {
        target: { kind: 'component', component: ALICE, block: 'ln1' },
        kind: 'footnote',
        label: '1',
        title: null,
        relative: 'above',
      },
      // The occurrence being edited is named by block alone, and its order is the editor's to say.
      {
        target: { kind: 'block', block: 'af1' },
        kind: 'figure',
        label: 'Figure 1.2',
        title: 'Readings',
        relative: null,
      },
      {
        target: { kind: 'block', block: 'an1' },
        kind: 'footnote',
        label: '2',
        title: null,
        relative: null,
      },
      {
        target: toSection('results'),
        kind: 'section',
        label: '2',
        title: 'Results',
        relative: 'below',
      },
      {
        target: { kind: 'component', component: GRACE, block: 'gt1' },
        kind: 'table',
        label: 'Table 2.1',
        title: 'Totals',
        relative: 'below',
      },
      {
        target: { kind: 'component', component: GRACE, block: 'ge1' },
        kind: 'equation',
        label: 'Equation 1',
        title: null,
        relative: 'below',
      },
    ]);
  });

  it('offers nothing of a component placed twice, of another occurrence of its own, or of one it cannot read', () => {
    const targets = offered(
      [
        occurrence('grace', GRACE),
        occurrence('ada', ADA),
        occurrence('graceagain', GRACE),
        // A second occurrence of the component being edited: its blocks are the ones offered above.
        occurrence('adaagain', ADA),
        // Withheld from this reader, and one whose content the page has not heard about.
        occurrence('withheld', null),
        occurrence('unread', ALICE),
      ],
      {
        grace: [table('gt1', 'Totals')],
        ada: [figure('af1', 'Readings')],
        graceagain: [table('gt1', 'Totals')],
        adaagain: [figure('af1', 'Readings')],
        withheld: [figure('wf1', 'Hidden')],
      },
    );
    // Grace's table could be either of two, and cannot resolve (STR-062); so it is not offered. Each
    // occurrence is a heading, so Ada's is chapter 2.
    expect(targets).toEqual([
      {
        target: { kind: 'block', block: 'af1' },
        kind: 'figure',
        label: 'Figure 2.1',
        title: 'Readings',
        relative: null,
      },
    ]);
  });

  it('offers a figure by its caption alone where its number is not known', () => {
    // An occurrence before it in its chapter that the page cannot read leaves every counter it could
    // move unknown until the next chapter restarts it.
    const targets = offered(
      [section('method', 'Method', [occurrence('unread', ALICE), occurrence('ada', ADA)])],
      { ada: [figure('af1', 'Readings'), footnote('an1')] },
    );
    expect(targets).toEqual([
      {
        target: toSection('method'),
        kind: 'section',
        label: '1',
        title: 'Method',
        relative: 'above',
      },
      {
        target: { kind: 'block', block: 'af1' },
        kind: 'figure',
        label: null,
        title: 'Readings',
        relative: null,
      },
      {
        target: { kind: 'block', block: 'an1' },
        kind: 'footnote',
        label: null,
        title: null,
        relative: null,
      },
    ]);
  });

  it("includes a title's own reference as the number the same numbering gives its target, never dropped as a caption's would be", () => {
    // A title's reference is always to a section, and always a number (the content model's rule), so
    // it resolves from the same numbering entries `labelOf` already reads for every other target.
    const results: OutlineViewNode = {
      type: 'section',
      id: id('results'),
      title: [
        { type: 'text', value: 'Results of ', marks: [] },
        { type: 'crossReference', id: 'xtitle', target: toSection('method'), display: 'number' },
      ],
      ...positional('body', true),
      children: [],
    };
    const targets = offered([section('method', 'Method'), results, occurrence('ada', ADA)], {
      ada: [],
    });
    expect(targets).toEqual([
      {
        target: toSection('method'),
        kind: 'section',
        label: '1',
        title: 'Method',
        relative: 'above',
      },
      {
        target: toSection('results'),
        kind: 'section',
        label: '2',
        title: 'Results of 1',
        relative: 'above',
      },
    ]);
  });

  it('names a section whose title holds an equation by its words, trimmed, and says its title is not printable as words', () => {
    // "Growth as " and then x squared: the words without the equation, which a reference cannot print.
    const growth: OutlineViewNode = {
      type: 'section',
      id: id('growth'),
      title: [
        { type: 'text', value: 'Growth as ', marks: [] },
        {
          type: 'equation',
          mathml:
            '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>',
          latex: 'x^2',
        },
      ],
      ...positional('body', true),
      children: [],
    };
    const targets = offered([growth, occurrence('ada', ADA)], { ada: [] });
    expect(targets).toEqual([
      {
        target: toSection('growth'),
        kind: 'section',
        label: '1',
        title: 'Growth as',
        relative: 'above',
        titleHoldsEquation: true,
      },
    ]);
  });

  it('says nothing is above or below where the occurrence being edited is not in the outline', () => {
    const targets = offered(
      [section('method', 'Method'), occurrence('grace', GRACE), occurrence('ada', ADA)],
      { grace: [table('gt1', 'Totals')], ada: [figure('af1', 'Readings')] },
      'elsewhere',
    );
    // And the component being edited, placed once elsewhere, is never offered as another component:
    // a reference naming its own component by a `component` target is not one it stores.
    expect(targets.map((each) => [each.target.kind, each.relative])).toEqual([
      ['node', null],
      ['component', null],
    ]);
  });
});

describe('the forms a reference offers', () => {
  it('offers all five for a section, a figure and a table, in the order the model declares them', () => {
    const all = crossReferenceNodeSchema.shape.display.options;
    for (const kind of ['section', 'figure', 'table'] as const) expect(formsFor(kind)).toEqual(all);
  });

  it('offers a footnote and an equation a number, a page and a place, and any other block a page and a place', () => {
    // A footnote and an equation have a number and no title; a paragraph, a list or a quotation has
    // neither.
    expect(formsFor('footnote')).toEqual(['number', 'page', 'relative']);
    expect(formsFor('equation')).toEqual(['number', 'page', 'relative']);
    expect(formsFor('block')).toEqual(['page', 'relative']);
  });
});

describe('the forms a target is offered in', () => {
  const target = (titleHoldsEquation: boolean): ReferenceTarget => ({
    target: toSection('growth'),
    kind: 'section',
    label: '1',
    title: 'Growth as',
    relative: null,
    ...(titleHoldsEquation ? { titleHoldsEquation: true as const } : {}),
  });

  it('offers every form its kind has, for a target whose title is words', () => {
    expect(targetForms(target(false))).toEqual(formsFor('section'));
  });

  it('offers no title form for a section whose title holds an equation, as the publish prints none', () => {
    // The publish refuses `title` and `numberAndTitle` of one (`cross_reference_form_unavailable`):
    // its words without the equation are not what the author wrote.
    expect(targetForms(target(true))).toEqual(['number', 'page', 'relative']);
  });
});

describe('what a reference prints', () => {
  const target = (
    kind: ReferenceKind,
    label: string | null,
    title: string | null,
  ): ReferenceTarget => ({
    target: { kind: 'block', block: 'b1' },
    kind,
    label,
    title,
    relative: null,
  });

  it('prints a number, a title, both, a page and a place, as a generated list sets them', () => {
    const method = target('section', '2.1', 'Method');
    expect(printed(method, 'number', null)).toBe('2.1');
    expect(printed(method, 'title', null)).toBe('Method');
    expect(printed(method, 'numberAndTitle', null)).toBe('2.1 Method');
    expect(printed(method, 'page', null)).toBe('page of 2.1');
    expect(printed(method, 'relative', 'above')).toBe('above');
    expect(printed(method, 'relative', 'below')).toBe('below');
    // Where the order is not known, both, rather than a guess.
    expect(printed(method, 'relative', null)).toBe('above or below');

    const readings = target('table', 'Table 1.1', 'Readings');
    expect(printed(readings, 'numberAndTitle', null)).toBe('Table 1.1 Readings');
    expect(printed(readings, 'page', null)).toBe('page of Table 1.1');
    // The target's own order is not the one asked: the caller says where it stands.
    expect(printed({ ...readings, relative: 'above' }, 'relative', 'below')).toBe('below');
  });

  it("prints a layout's own words for above and below where it is given them (cross-references 2, ruling R9), and English otherwise", () => {
    const method = target('section', '2.1', 'Method');
    const words = { above: 'ci-dessus', below: 'ci-dessous' };
    expect(printed(method, 'relative', 'above', words)).toBe('ci-dessus');
    expect(printed(method, 'relative', 'below', words)).toBe('ci-dessous');
    // Where the order is not known, both of the layout's own words, never a guess.
    expect(printed(method, 'relative', null, words)).toBe('ci-dessus or ci-dessous');
    // No words given: the English literal, exactly as before.
    expect(printed(method, 'relative', 'above')).toBe('above');
    expect(printed(method, 'relative', null)).toBe('above or below');
  });

  it('falls back to what the target has, and never prints nothing', () => {
    // No number known: the caption stands in for it.
    const unnumbered = target('figure', null, 'Readings');
    expect(printed(unnumbered, 'number', null)).toBe('Readings');
    expect(printed(unnumbered, 'numberAndTitle', null)).toBe('Readings');
    expect(printed(unnumbered, 'page', null)).toBe('page of Readings');
    // No caption: the number stands in for it.
    const uncaptioned = target('figure', 'Figure 3', null);
    expect(printed(uncaptioned, 'title', null)).toBe('Figure 3');
    expect(printed(uncaptioned, 'numberAndTitle', null)).toBe('Figure 3');
    // Neither: the kind of thing it is.
    const paragraph = target('block', null, null);
    for (const display of ['number', 'title', 'numberAndTitle'] as const) {
      expect(printed(paragraph, display, null)).toBe('Paragraph');
    }
    expect(printed(paragraph, 'page', null)).toBe('page of Paragraph');
    expect(printed(target('footnote', '3', null), 'number', null)).toBe('3');
  });

  it('names each kind in one word, for text a reference shows with no number', () => {
    expect(
      (['section', 'figure', 'table', 'footnote', 'equation', 'block'] as const).map((kind) =>
        kindWord(kind),
      ),
    ).toEqual(['Section', 'Figure', 'Table', 'Footnote', 'Equation', 'Paragraph']);
  });
});

describe('resolving a reference in the document that publishes it', () => {
  /** A section as an outline stores it. */
  const stored = (
    name: string,
    words: string,
    children: OutlineNode[] = [],
    numbered = true,
  ): OutlineNode => ({
    type: 'section',
    id: id(name),
    title: [{ type: 'text', value: words, marks: [] }],
    ...positional('body', numbered),
    children,
  });
  /** An occurrence of `component`, as an outline stores it. */
  const placed = (name: string, component: string): OutlineNode => ({
    type: 'reference',
    id: id(name),
    component,
    mode: { kind: 'latest' },
    ...positional('body', true),
    children: [],
  });

  const text = (value: string) => ({ type: 'text', value, marks: [] });
  const paragraph = (block: string, ...content: unknown[]) => ({
    type: 'paragraph',
    id: block,
    content,
  });
  const note = (block: string) => ({
    type: 'footnote',
    id: block,
    anchor: { kind: 'span' },
    content: [paragraph(`${block}p`, text('A note'))],
  });
  const MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi></math>';

  /**
   * Ada's component: a figure and a table with captions, a footnote, and a block of every kind that
   * takes no number - a paragraph at depth in a list's item among them.
   */
  const ada: ContentDocument = parseContentDocument({
    schemaVersion: 1,
    title: 'Readings taken',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      paragraph('p1', text('See the readings.'), note('n1')),
      {
        type: 'figure',
        id: 'f1',
        asset: '00000000-0000-4000-8000-00000000a551',
        imageStyle: 'figure',
        caption: [text('Readings')],
        alternative: { kind: 'decorative' },
      },
      {
        type: 'list',
        id: 'l1',
        kind: 'unordered',
        items: [
          {
            content: [
              paragraph('lp1', text('Outer')),
              {
                type: 'list',
                id: 'l2',
                kind: 'unordered',
                items: [{ content: [paragraph('lp2', text('Inner'))] }],
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        id: 't1',
        caption: [text('Totals')],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [paragraph('c1', text('12'))] }] }],
      },
      { type: 'blockquote', id: 'q1', content: [paragraph('qp1', text('Quoted'))] },
      { type: 'preformatted', id: 'x1', text: 'lpr -P office' },
      { type: 'equation', id: 'e1', mathml: MATHML, numbered: true },
      { type: 'equation', id: 'e2', mathml: MATHML, numbered: false },
      {
        type: 'figure',
        id: 'f2',
        asset: '00000000-0000-4000-8000-00000000a551',
        imageStyle: 'figure',
        caption: [],
        alternative: { kind: 'decorative' },
      },
    ],
  });

  /** Grace's component: one table. */
  const grace: ContentDocument = parseContentDocument({
    schemaVersion: 1,
    title: 'Totals',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'table',
        id: 'gt1',
        caption: [text('Grand totals')],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [paragraph('gc1', text('40'))] }] }],
      },
    ],
  });

  /**
   * What `assemble` holds when it walks a document - the stored outline, each readable occurrence's
   * content by its node, and the numbering `number` computes from both - handed to the resolver.
   */
  const resolving = (nodes: OutlineNode[], contents: Record<string, ContentDocument>) => {
    const outline = { nodes };
    const occurrences = new Map(Object.entries(contents).map(([name, held]) => [id(name), held]));
    const contributions = new Map(
      [...occurrences].map(([node, held]) => [node, contributionsOf(held)]),
    );
    const numbering = number(conditions(resolve(outline, contributions)), defaultNumberingScheme);
    return referenceResolver({ outline, occurrences, numbering });
  };

  const block = (name: string): CrossReferenceTarget => ({ kind: 'block', block: name });
  const bound = (target: BoundTarget) => ({ ok: true, target });
  const missing = { ok: false, reason: 'missing' };

  it('binds a block target to the occurrence it is read in, so a component placed twice resolves in each to its own', () => {
    const resolver = resolving(
      [
        stored('method', 'Method', [placed('first', ADA)]),
        stored('results', 'Results', [placed('again', ADA)]),
      ],
      { first: ada, again: ada },
    );
    const figureIn = (name: string, label: string) =>
      bound({ node: id(name), block: 'f1', kind: 'figure', label, title: 'Readings' });
    expect(resolver(block('f1'), { node: id('first') })).toEqual(figureIn('first', 'Figure 1.1'));
    expect(resolver(block('f1'), { node: id('again') })).toEqual(figureIn('again', 'Figure 2.1'));
    // The footnote sequence runs through the document, so the second occurrence's is the second.
    const noteIn = (name: string, label: string) =>
      bound({ node: id(name), block: 'n1', kind: 'footnote', label, title: null });
    expect(resolver(block('n1'), { node: id('first') })).toEqual(noteIn('first', '1'));
    expect(resolver(block('n1'), { node: id('again') })).toEqual(noteIn('again', '2'));
  });

  it("binds a component target to that component's one occurrence, from wherever it is read", () => {
    const resolver = resolving(
      [stored('method', 'Method', [placed('grace', GRACE)]), placed('ada', ADA)],
      { grace, ada },
    );
    const target: CrossReferenceTarget = { kind: 'component', component: GRACE, block: 'gt1' };
    const expected = bound({
      node: id('grace'),
      block: 'gt1',
      kind: 'table',
      label: 'Table 1.1',
      title: 'Grand totals',
    });
    expect(resolver(target, { node: id('ada') })).toEqual(expected);
    expect(resolver(target, { node: id('method') })).toEqual(expected);
  });

  it('fails a component target whose component the document holds twice, or never, rather than taking the first', () => {
    const resolver = resolving(
      [placed('grace', GRACE), placed('ada', ADA), placed('again', GRACE)],
      { grace, ada, again: grace },
    );
    const reading = { node: id('ada') };
    expect(resolver({ kind: 'component', component: GRACE, block: 'gt1' }, reading)).toEqual({
      ok: false,
      reason: 'componentRepeated',
    });
    expect(resolver({ kind: 'component', component: ALICE, block: 'gt1' }, reading)).toEqual({
      ok: false,
      reason: 'componentAbsent',
    });
  });

  it('binds a component target naming the component it is read in to that occurrence, as a block target', () => {
    // Pasted from another component into this one, a reference to this one's table keeps its
    // component target (admission's `repoint` leaves it standing), and names a block of its own.
    const resolver = resolving(
      [
        stored('method', 'Method', [placed('first', ADA)]),
        stored('results', 'Results', [placed('again', ADA)]),
      ],
      { first: ada, again: ada },
    );
    const own: CrossReferenceTarget = { kind: 'component', component: ADA, block: 'f1' };
    const figureIn = (name: string, label: string) =>
      bound({ node: id(name), block: 'f1', kind: 'figure', label, title: 'Readings' });
    expect(resolver(own, { node: id('first') })).toEqual(figureIn('first', 'Figure 1.1'));
    expect(resolver(own, { node: id('again') })).toEqual(figureIn('again', 'Figure 2.1'));
    // Read anywhere else, it is another component's block, and which occurrence was meant is unknown.
    expect(resolver(own, { node: id('method') })).toEqual({
      ok: false,
      reason: 'componentRepeated',
    });
  });

  it('binds a node target to the section, or the occurrence, it names', () => {
    const resolver = resolving(
      [
        stored('method', 'Method', [placed('ada', ADA)]),
        stored('aside', 'An aside', [], false),
        stored('blank', '   '),
      ],
      { ada },
    );
    const node = (name: string): CrossReferenceTarget => ({ kind: 'node', node: id(name) });
    const section = (name: string, label: string | null, title: string | null) =>
      bound({ node: id(name), block: null, kind: 'section', label, title });
    const reading = { node: id('ada') };
    expect(resolver(node('method'), reading)).toEqual(section('method', '1', 'Method'));
    // An occurrence is a heading: its number is the outline's, its title the component's.
    expect(resolver(node('ada'), { node: id('method') })).toEqual(
      section('ada', '1.1', 'Readings taken'),
    );
    // An unnumbered section has its words alone, and one of no words has its number alone.
    expect(resolver(node('aside'), reading)).toEqual(section('aside', null, 'An aside'));
    expect(resolver(node('blank'), reading)).toEqual(section('blank', '2', null));
    expect(resolver(node('elsewhere'), reading)).toEqual(missing);
  });

  it('STR-068 targets an outline node, a caption-bearing block and a footnote, each by its identity', () => {
    const resolver = resolving([stored('method', 'Method', [placed('ada', ADA)])], { ada });
    const reading = { node: id('ada') };
    const found = (name: string, kind: ReferenceKind, label: string | null, title: string | null) =>
      bound({ node: id('ada'), block: name, kind, label, title });

    // An outline node, by the node's identifier.
    expect(resolver({ kind: 'node', node: id('method') }, reading)).toEqual(
      bound({ node: id('method'), block: null, kind: 'section', label: '1', title: 'Method' }),
    );
    // Each kind of caption-bearing block, by the block's identifier.
    expect(resolver(block('f1'), reading)).toEqual(found('f1', 'figure', 'Figure 1.1', 'Readings'));
    expect(resolver(block('t1'), reading)).toEqual(found('t1', 'table', 'Table 1.1', 'Totals'));
    expect(resolver(block('e1'), reading)).toEqual(found('e1', 'equation', 'Equation 1', null));
    // A footnote, by the note's own identifier.
    expect(resolver(block('n1'), reading)).toEqual(found('n1', 'footnote', '1', null));
    // By identity alone: a caption's words, a printed number or a position names nothing.
    for (const name of ['Readings', 'Figure 1.1', '1', '0']) {
      expect(resolver(block(name), reading), name).toEqual(missing);
    }
  });

  it("CNT-125 finds a block that takes no number anywhere in the occurrence, a paragraph at depth in a list's item among them", () => {
    const resolver = resolving([placed('ada', ADA)], { ada });
    const reading = { node: id('ada') };
    const found = (name: string, kind: ReferenceKind, label: string | null, title: string | null) =>
      bound({ node: id('ada'), block: name, kind, label, title });
    // Every block the component holds, at any depth, is a place a page or a relative form can name.
    // A footnote's own paragraph among them: set in its note, on the page the note's text stands on.
    for (const name of ['p1', 'n1p', 'l1', 'lp1', 'l2', 'lp2', 'c1', 'q1', 'qp1', 'x1']) {
      expect(resolver(block(name), reading), name).toEqual(found(name, 'block', null, null));
    }
    // A table, and a figure whose caption has no words, whose title is none.
    expect(resolver(block('t1'), reading)).toEqual(found('t1', 'table', 'Table 1.1', 'Totals'));
    expect(resolver(block('f2'), reading)).toEqual(found('f2', 'figure', 'Figure 1.2', null));
    // An equation, by its number where it has one (equations 2, ruling R7): one left unnumbered has
    // none to print, and a page and a place alone, as a paragraph.
    expect(resolver(block('e1'), reading)).toEqual(found('e1', 'equation', 'Equation 1', null));
    expect(resolver(block('e2'), reading)).toEqual(found('e2', 'equation', null, null));
  });

  it('fails a target the occurrence it is bound to does not hold', () => {
    const resolver = resolving(
      [stored('method', 'Method'), placed('ada', ADA), placed('grace', GRACE)],
      { ada, grace },
    );
    const reading = { node: id('ada') };
    // No such block, and a block of another component named as the reading occurrence's own.
    expect(resolver(block('nothing'), reading)).toEqual(missing);
    expect(resolver(block('gt1'), reading)).toEqual(missing);
    // A block target read where no occurrence is: a section, or a node the outline does not hold.
    expect(resolver(block('p1'), { node: id('method') })).toEqual(missing);
    expect(resolver(block('p1'), { node: id('elsewhere') })).toEqual(missing);
  });

  it('fails a target in an occurrence whose content the publisher cannot read', () => {
    const resolver = resolving([placed('ada', ADA), placed('grace', GRACE)], { ada });
    expect(resolver(block('gc1'), { node: id('grace') })).toEqual(missing);
    expect(
      resolver({ kind: 'component', component: GRACE, block: 'gt1' }, { node: id('ada') }),
    ).toEqual(missing);
  });
});

describe('the forms a bound target can print', () => {
  const target = (
    kind: ReferenceKind,
    label: string | null,
    title: string | null,
  ): BoundTarget => ({ node: id('ada'), block: 'b1', kind, label, title });

  it('prints every form its kind offers that it has what to print for', () => {
    const all = crossReferenceNodeSchema.shape.display.options;
    expect(printableForms(target('figure', 'Figure 1.1', 'Readings'))).toEqual(all);
    expect(printableForms(target('section', '2.1', 'Method'))).toEqual(all);
    expect(printableForms(target('footnote', '3', null))).toEqual(['number', 'page', 'relative']);
    expect(printableForms(target('equation', 'Equation 1', null))).toEqual([
      'number',
      'page',
      'relative',
    ]);
    expect(printableForms(target('block', null, null))).toEqual(['page', 'relative']);
    // An unnumbered equation has a page and a place, as a paragraph has.
    expect(printableForms(target('equation', null, null))).toEqual(['page', 'relative']);
  });

  it('prints no number where the target has none, and no title where it has no words', () => {
    // An unnumbered section, and a figure whose caption says nothing.
    expect(printableForms(target('section', null, 'An aside'))).toEqual([
      'title',
      'page',
      'relative',
    ]);
    expect(printableForms(target('figure', 'Figure 1.2', null))).toEqual([
      'number',
      'page',
      'relative',
    ]);
  });
});
