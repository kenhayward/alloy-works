import {
  conditions,
  defaultLayout,
  documentTargets,
  number,
  resolve,
  OUTLINE_SCHEMA_VERSION,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { referenceContexts } from './contexts.js';

const common = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

const section = (id: string, title: string, children: OutlineViewNode[] = []): OutlineViewNode => ({
  ...common,
  type: 'section',
  id,
  title: [{ type: 'text', value: title, marks: [] }],
  children,
});

const reference = (id: string, component: string): OutlineViewNode =>
  ({
    ...common,
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    children: [],
  }) as OutlineViewNode;

/** An identifier of the outline's shape, 26 characters, from a number. */
const id = (n: number, letter: string) => `${letter}${String(n).padStart(25, '0')}`;
const component = (n: number) => `6a0c1b8e-6f3e-4d2a-9d36-${String(n).padStart(12, '0')}`;

/** A section holding `count` references, each to a component of its own. */
const outline = (count: number): OutlineView => ({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'A long document',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    section(
      id(0, 's'),
      'Everything',
      Array.from({ length: count }, (_, n) => reference(id(n, 'r'), component(n))),
    ),
  ],
});

const scheme = defaultLayout.scheme;

describe('the reference contexts the document text is shown against', () => {
  it("computes no occurrence's targets until a reference in its text asks for them", () => {
    // Each occurrence's targets walk the whole outline, so computing all of them as the text is drawn
    // costs the square of the document's size, for components most of which hold no reference.
    let computed = 0;
    const counting: typeof documentTargets = (input) => {
      computed += 1;
      return documentTargets(input);
    };
    const contexts = referenceContexts(outline(400), scheme, new Map(), null, counting);
    expect(contexts.size).toBe(400);
    expect(computed).toBe(0);

    const asked = contexts.get(id(7, 'r'))!;
    expect(asked.targets.length).toBeGreaterThan(0);
    expect(computed).toBe(1);
    // Asked again, the same answer, not computed again.
    expect(asked.targets).toBe(asked.targets);
    expect(computed).toBe(1);
  });

  it("offers each occurrence exactly the targets documentTargets offers it, with the layout's words and its component", () => {
    const small = outline(3);
    const words = { above: 'oben', below: 'unten' };
    const contexts = referenceContexts(small, scheme, new Map(), words);
    for (let n = 0; n < 3; n++) {
      const context = contexts.get(id(n, 'r'))!;
      expect(context.component).toBe(component(n));
      expect(context.words).toEqual(words);
      expect(context.targets).toEqual(
        documentTargets({
          outline: small,
          numbering: number(conditions(resolve(small, new Map())), scheme),
          contributions: new Map(),
          editing: { component: component(n), node: id(n, 'r') },
        }),
      );
      // Numbered as the page numbers it: the section is 1, and each reference under it 1.n.
      expect(context.targets[0]!.label).toBe('1');
    }
  });
});
