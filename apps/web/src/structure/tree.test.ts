import {
  applyOutlineOperation,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import {
  dropMove,
  inverseOf,
  keyMove,
  plainTitle,
  sectionTitle,
  titleText,
  visibleOrder,
} from './tree.js';

const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
const SCOPE = 'ssssssssssssssssssssssssss';
const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
const RESULTS = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';
const NEW = 'nnnnnnnnnnnnnnnnnnnnnnnnnn';

function section(id: string, title: string, children: OutlineNode[] = []): OutlineNode {
  return {
    type: 'section',
    id,
    title: sectionTitle(title),
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children,
  };
}

function outline(nodes: OutlineNode[]): OutlineDocument {
  return {
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  };
}

/** The domain's own operation, so the convention the panel sends is the one the service applies. */
function applied(document: OutlineDocument, operation: OutlineOperation | null): OutlineDocument {
  if (operation === null) throw new Error('no operation');
  const result = applyOutlineOperation(document, operation, () => NEW);
  if (!result.applied) throw new Error(result.reason);
  return result.outline;
}

/** The tree as `title(children)`, so a whole shape is one string to compare. */
function shape(nodes: readonly OutlineNode[]): string {
  return nodes
    .map((node) => {
      const own = node.type === 'section' ? titleText(node.title) : 'ref';
      return node.children.length === 0 ? own : `${own}(${shape(node.children)})`;
    })
    .join(' ');
}

const three = () =>
  outline([
    section(INTRODUCTION, 'Introduction'),
    section(METHOD, 'Method'),
    section(RESULTS, 'Results'),
  ]);

describe('the panel reads a move position after the node has left its siblings', () => {
  it('moving the first of three to position 2 lands it last, as a drop at the end sends it', () => {
    const move = dropMove(three().nodes, INTRODUCTION, { kind: 'end', parent: null });
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 2 });
    expect(shape(applied(three(), move).nodes)).toBe('Method Results Introduction');
  });

  it('Alt+Down on the first of three sends position 1, and it lands second', () => {
    const move = keyMove(three().nodes, INTRODUCTION, 'down');
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 1 });
    expect(shape(applied(three(), move).nodes)).toBe('Method Introduction Results');
  });

  it('a drop before a later sibling counts that sibling after the removal', () => {
    const move = dropMove(three().nodes, INTRODUCTION, { kind: 'before', node: RESULTS });
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 1 });
    expect(shape(applied(three(), move).nodes)).toBe('Method Introduction Results');
  });

  it('a drop before an earlier sibling takes its index as it stands', () => {
    const move = dropMove(three().nodes, RESULTS, { kind: 'before', node: INTRODUCTION });
    expect(move).toEqual({ operation: 'move', node: RESULTS, parent: null, position: 0 });
    expect(shape(applied(three(), move).nodes)).toBe('Results Introduction Method');
  });

  it('Alt+Up and Alt+Down send nothing where there is no sibling to pass', () => {
    expect(keyMove(three().nodes, INTRODUCTION, 'up')).toBeNull();
    expect(keyMove(three().nodes, RESULTS, 'down')).toBeNull();
  });
});

describe('promoting and demoting', () => {
  it('Alt+Right makes a node the last child of the sibling before it, subtree and all', () => {
    const document = outline([
      section(METHOD, 'Method', [section(RESULTS, 'Results')]),
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
    ]);
    const move = keyMove(document.nodes, INTRODUCTION, 'demote');
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: METHOD, position: 1 });
    expect(shape(applied(document, move).nodes)).toBe('Method(Results Introduction(Scope))');
  });

  it('Alt+Left makes a node the next sibling of its parent', () => {
    const document = outline([
      section(METHOD, 'Method', [section(INTRODUCTION, 'Introduction'), section(SCOPE, 'Scope')]),
      section(RESULTS, 'Results'),
    ]);
    const move = keyMove(document.nodes, INTRODUCTION, 'promote');
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 1 });
    expect(shape(applied(document, move).nodes)).toBe('Method(Scope) Introduction Results');
  });

  it('sends nothing to demote a first sibling or promote a top-level node', () => {
    expect(keyMove(three().nodes, INTRODUCTION, 'demote')).toBeNull();
    expect(keyMove(three().nodes, METHOD, 'promote')).toBeNull();
  });
});

describe('dropping', () => {
  it('a drop onto a node makes the dragged node its last child', () => {
    const document = outline([
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      section(METHOD, 'Method', [section(RESULTS, 'Results')]),
    ]);
    const move = dropMove(document.nodes, INTRODUCTION, { kind: 'into', node: METHOD });
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: METHOD, position: 1 });
    expect(shape(applied(document, move).nodes)).toBe('Method(Results Introduction(Scope))');
  });

  it('a drop onto its own parent sends it to the end of those children', () => {
    const document = outline([
      section(METHOD, 'Method', [section(INTRODUCTION, 'Introduction'), section(SCOPE, 'Scope')]),
    ]);
    const move = dropMove(document.nodes, INTRODUCTION, { kind: 'into', node: METHOD });
    expect(move).toEqual({ operation: 'move', node: INTRODUCTION, parent: METHOD, position: 1 });
  });

  it('sends nothing for a drop inside its own subtree, onto itself, or back where it is', () => {
    const document = outline([
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      section(METHOD, 'Method'),
    ]);
    expect(dropMove(document.nodes, INTRODUCTION, { kind: 'into', node: SCOPE })).toBeNull();
    expect(dropMove(document.nodes, INTRODUCTION, { kind: 'into', node: INTRODUCTION })).toBeNull();
    expect(dropMove(document.nodes, INTRODUCTION, { kind: 'before', node: SCOPE })).toBeNull();
    expect(
      dropMove(document.nodes, INTRODUCTION, { kind: 'before', node: INTRODUCTION }),
    ).toBeNull();
    expect(dropMove(document.nodes, INTRODUCTION, { kind: 'before', node: METHOD })).toBeNull();
    expect(dropMove(document.nodes, METHOD, { kind: 'end', parent: null })).toBeNull();
    expect(dropMove(document.nodes, SCOPE, { kind: 'into', node: INTRODUCTION })).toBeNull();
  });
});

describe('the inverse of an act is one operation', () => {
  it('puts a moved node back where it was, subtree and all', () => {
    const before = outline([
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      section(METHOD, 'Method'),
    ]);
    const move: OutlineOperation = {
      operation: 'move',
      node: INTRODUCTION,
      parent: METHOD,
      position: 0,
    };
    const after = applied(before, move);
    const inverse = inverseOf(before, after, move);
    expect(inverse).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 0 });
    expect(applied(after, inverse)).toEqual(before);
  });

  it('puts a node moved among its own siblings back, counting the way the move did', () => {
    const before = three();
    const move: OutlineOperation = {
      operation: 'move',
      node: INTRODUCTION,
      parent: null,
      position: 2,
    };
    const after = applied(before, move);
    expect(shape(after.nodes)).toBe('Method Results Introduction');
    const inverse = inverseOf(before, after, move);
    expect(inverse).toEqual({ operation: 'move', node: INTRODUCTION, parent: null, position: 0 });
    expect(applied(after, inverse)).toEqual(before);

    const up = keyMove(before.nodes, RESULTS, 'up');
    const raised = applied(before, up);
    expect(applied(raised, inverseOf(before, raised, up!))).toEqual(before);
  });

  it('removes what an insert added, by the identifier the service allocated', () => {
    const before = three();
    const insert: OutlineOperation = {
      operation: 'insert',
      parent: METHOD,
      position: 0,
      node: { type: 'section', title: sectionTitle('Scope') },
    };
    const after = applied(before, insert);
    const inverse = inverseOf(before, after, insert);
    expect(inverse).toEqual({ operation: 'remove', node: NEW });
    expect(applied(after, inverse)).toEqual(before);
  });

  it('gives a retitled section its old title back', () => {
    const before = three();
    const retitle: OutlineOperation = {
      operation: 'retitle',
      node: METHOD,
      title: sectionTitle('Methods'),
    };
    const after = applied(before, retitle);
    expect(applied(after, inverseOf(before, after, retitle))).toEqual(before);
  });

  it('sets back only the switches an act named', () => {
    const before = three();
    const set: OutlineOperation = { operation: 'set', node: RESULTS, pageBreak: 'recto' };
    const after = applied(before, set);
    const inverse = inverseOf(before, after, set);
    expect(inverse).toEqual({ operation: 'set', node: RESULTS, pageBreak: 'none' });
    expect(applied(after, inverse)).toEqual(before);
  });

  it('has none for a removal, whose nodes no operation can bring back', () => {
    const before = outline([section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')])]);
    const remove: OutlineOperation = { operation: 'remove', node: INTRODUCTION };
    expect(inverseOf(before, applied(before, remove), remove)).toBeNull();
  });
});

describe('titles and order', () => {
  it('reads a title of unmarked text as plain text, and anything richer as not plain', () => {
    expect(plainTitle(sectionTitle('Method'))).toBe('Method');
    expect(
      plainTitle([{ type: 'text', value: 'Method', marks: [{ type: 'strong', id: 'm1' }] }]),
    ).toBeNull();
    expect(
      titleText([{ type: 'text', value: 'Method', marks: [{ type: 'strong', id: 'm1' }] }]),
    ).toBe('Method');
  });

  it('walks the nodes in document order, which is the order the arrow keys follow', () => {
    const document = outline([
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      section(METHOD, 'Method'),
    ]);
    expect(visibleOrder(document.nodes)).toEqual([INTRODUCTION, SCOPE, METHOD]);
  });
});
