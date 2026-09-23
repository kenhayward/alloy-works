import { describe, expect, it } from 'vitest';

import { crossReferenceNodeSchema } from '../content/model/inline.js';

import type { Contribution } from './contributions.js';
import { conditions, number, resolve } from './numbering.js';
import type { OutlineMatter, OutlineViewNode } from './outline.js';
import {
  documentTargets,
  formsFor,
  kindWord,
  printed,
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

  it("offers each occurrence's figures, tables and footnotes in its place, as the edited component would store them", () => {
    const targets = offered(
      [
        section('method', 'Method', [occurrence('alice', ALICE), occurrence('ada', ADA)]),
        section('results', 'Results', [occurrence('grace', GRACE)]),
      ],
      {
        alice: [figure('lf1', ''), footnote('ln1')],
        ada: [figure('af1', 'Readings'), footnote('an1')],
        // An equation is not offered: nothing in this slice points at one.
        grace: [table('gt1', 'Totals'), equation('ge1')],
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

  it('offers a footnote a number, a page and a place, and any other block a page and a place', () => {
    // A footnote has a number and no title; a paragraph, a list or a quotation has neither.
    expect(formsFor('footnote')).toEqual(['number', 'page', 'relative']);
    expect(formsFor('block')).toEqual(['page', 'relative']);
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
      (['section', 'figure', 'table', 'footnote', 'block'] as const).map((kind) => kindWord(kind)),
    ).toEqual(['Section', 'Figure', 'Table', 'Footnote', 'Paragraph']);
  });
});
