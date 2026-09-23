import type {
  BlockNode,
  ContentDocument,
  CrossReferenceDisplay,
  CrossReferenceTarget,
  InlineNode,
  ReferenceTarget,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import { ownTargets, referencesShown, type ReferenceContext } from './referenceText.js';

const SECTION = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = '00000000-0000-4000-8000-0000000a1ce0';
const ASSET = '00000000-0000-4000-8000-00000000a551';

const text = (value: string): InlineNode => ({ type: 'text', value, marks: [] });
const ref = (
  target: CrossReferenceTarget,
  display: CrossReferenceDisplay = 'number',
  id = 'x1',
): InlineNode => ({ type: 'crossReference', id, target, display }) as InlineNode;
const para = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const table = (id: string, caption: string): BlockNode =>
  ({
    type: 'table',
    id,
    style: 'table',
    caption: caption === '' ? [] : [text(caption)],
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [{ content: [para(`${id}c`, text('York'))], colspan: 1, rowspan: 1 }] }],
  }) as BlockNode;
const figure = (id: string, caption: string): BlockNode => ({
  type: 'figure',
  id,
  asset: ASSET,
  imageStyle: 'figure',
  caption: caption === '' ? [] : [text(caption)],
  alternative: { kind: 'decorative' },
});

const docOf = (...content: BlockNode[]): Node => {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content,
  } as ContentDocument);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  return opened.doc;
};

/** What each reference in the document shows, in document order, without its position. */
const shown = (doc: Node, context: ReferenceContext | null) =>
  referencesShown(doc, context).map(({ text, broken }) => ({ text, broken }));

const onlyText = (doc: Node, context: ReferenceContext | null) => shown(doc, context)[0]!.text;

const target = (
  of: CrossReferenceTarget,
  kind: ReferenceTarget['kind'],
  label: string | null,
  title: string | null,
  relative: ReferenceTarget['relative'] = null,
): ReferenceTarget => ({ target: of, kind, label, title, relative });

const readings = target({ kind: 'block', block: 't1' }, 'table', 'Table 1.1', 'Readings');

describe('what a cross-reference shows (cross-references 1, ruling R10)', () => {
  describe('a reference to a block of its own component', () => {
    it('is broken where the component no longer holds its target, in a document and on its own, with no kind to name, since that went with the block', () => {
      const doc = docOf(para('b1', text('See '), ref({ kind: 'block', block: 'gone' })));
      const broken = [{ text: 'Broken reference', broken: true }];
      expect(shown(doc, null)).toEqual(broken);
      expect(shown(doc, { targets: [readings] })).toEqual(broken);
    });

    it("is never held by another reference's identifier, which names no block", () => {
      const doc = docOf(
        para(
          'b1',
          ref({ kind: 'block', block: 't1' }, 'number', 'x1'),
          ref({ kind: 'block', block: 'x1' }, 'number', 'x2'),
        ),
      );
      expect(shown(doc, null)[1]).toEqual({ text: 'Broken reference', broken: true });
    });

    it('prints what the context says, in the form it asks for, where the page has numbered it', () => {
      const context = { targets: [readings] };
      const forms = (['number', 'title', 'numberAndTitle', 'page'] as const).map((display) =>
        onlyText(
          docOf(table('t1', 'Readings'), para('b1', ref({ kind: 'block', block: 't1' }, display))),
          context,
        ),
      );
      expect(forms).toEqual(['Table 1.1', 'Readings', 'Table 1.1 Readings', 'page of Table 1.1']);
      expect(
        shown(
          docOf(table('t1', 'Readings'), para('b1', ref({ kind: 'block', block: 't1' }))),
          context,
        ),
      ).toEqual([{ text: 'Table 1.1', broken: false }]);
    });

    it('says above or below by where the reference stands against its target in the component', () => {
      const context = { targets: [readings] };
      const relative = ref({ kind: 'block', block: 't1' }, 'relative');
      expect(onlyText(docOf(table('t1', 'Readings'), para('b1', relative)), context)).toBe('above');
      expect(onlyText(docOf(para('b1', relative), table('t1', 'Readings')), context)).toBe('below');
    });

    it("counts a target holding the reference as above it, as a section's heading is", () => {
      const doc = docOf({
        ...(table('t1', '') as object),
        caption: [text('Readings, as '), ref({ kind: 'block', block: 't1' }, 'relative')],
      } as BlockNode);
      expect(onlyText(doc, { targets: [readings] })).toBe('above');
    });

    it('shows its kind and caption, from the live document, where no context has it', () => {
      const doc = docOf(
        table('t1', 'Readings'),
        figure('g1', ''),
        figure('g2', 'Shapes at rest'),
        para(
          'b1',
          text('See '),
          ref({ kind: 'block', block: 't1' }),
          ref({ kind: 'block', block: 'g1' }),
          ref({ kind: 'block', block: 'g2' }),
          ref({ kind: 'block', block: 'f1' }),
          ref({ kind: 'block', block: 'b2' }),
          {
            type: 'footnote',
            id: 'f1',
            anchor: { kind: 'span' },
            content: [para('fp1', text('Once.'))],
          } as InlineNode,
        ),
        para('b2', text('Later.')),
      );
      const expected = [
        'Table: Readings',
        'Figure',
        'Figure: Shapes at rest',
        'Footnote',
        'Paragraph',
      ].map((words) => ({ text: words, broken: false }));
      // On its own, and in a document whose page has not numbered these yet.
      expect(shown(doc, null)).toEqual(expected);
      expect(shown(doc, { targets: [] })).toEqual(expected);
    });

    it("names a table by its caption's words, whatever else its caption holds", () => {
      const doc = docOf(
        {
          ...(table('t1', '') as object),
          caption: [text('  Readings '), ref({ kind: 'node', node: SECTION }), text(' taken ')],
        } as BlockNode,
        para('b1', ref({ kind: 'block', block: 't1' }, 'number', 'x2')),
      );
      expect(shown(doc, null)[1]).toEqual({ text: 'Table: Readings taken', broken: false });
    });
  });

  describe('a reference to a section or to another component', () => {
    const section = target({ kind: 'node', node: SECTION }, 'section', '2', 'Methods', 'below');
    const elsewhere = target(
      { kind: 'component', component: OTHER, block: 'g9' },
      'figure',
      'Figure 3.1',
      'Coastline',
      'above',
    );

    it('prints what the context says, above or below as the document orders them', () => {
      const context = { targets: [section, elsewhere] };
      const doc = docOf(
        para(
          'b1',
          ref({ kind: 'node', node: SECTION }, 'numberAndTitle', 'x1'),
          ref({ kind: 'node', node: SECTION }, 'relative', 'x2'),
          ref({ kind: 'component', component: OTHER, block: 'g9' }, 'number', 'x3'),
          ref({ kind: 'component', component: OTHER, block: 'g9' }, 'relative', 'x4'),
        ),
      );
      expect(shown(doc, context)).toEqual(
        ['2 Methods', 'below', 'Figure 3.1', 'above'].map((words) => ({
          text: words,
          broken: false,
        })),
      );
    });

    it('is broken in a document that does not offer its target, and says what it pointed at', () => {
      const doc = docOf(
        para(
          'b1',
          ref({ kind: 'node', node: SECTION }, 'number', 'x1'),
          ref({ kind: 'component', component: OTHER, block: 'g9' }, 'number', 'x2'),
        ),
      );
      expect(shown(doc, { targets: [readings] })).toEqual([
        { text: 'Broken reference to a section', broken: true },
        { text: 'Broken reference to another component', broken: true },
      ]);
    });

    it('cannot be judged on its own, so says what it points at and is not broken', () => {
      const doc = docOf(
        para(
          'b1',
          ref({ kind: 'node', node: SECTION }, 'number', 'x1'),
          ref({ kind: 'component', component: OTHER, block: 'g9' }, 'number', 'x2'),
        ),
      );
      expect(shown(doc, null)).toEqual([
        { text: 'Section', broken: false },
        { text: 'In another component', broken: false },
      ]);
    });
  });

  describe("a reference in a footnote's own document", () => {
    it('is judged against the component it stands in, at its place there', () => {
      const doc = docOf(
        para('b1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [para('fp1', text('See '), ref({ kind: 'block', block: 't1' }, 'relative'))],
        } as InlineNode),
        table('t1', 'Readings'),
      );
      let footnote: { node: Node; pos: number } | null = null;
      doc.descendants((node, pos) => {
        if (node.type.name === 'footnote') footnote = { node, pos };
        return footnote === null;
      });
      const { node, pos } = footnote!;
      const within = referencesShown(
        node,
        { targets: [readings] },
        {
          component: doc,
          offset: pos + 1,
        },
      );
      // The table stands after the footnote, and the reference's position is the footnote's own.
      expect(within).toHaveLength(1);
      expect(within[0]).toMatchObject({ text: 'below', broken: false });
      expect(node.nodeAt(within[0]!.pos)!.type.name).toBe('crossReference');
      // On its own, the table is held by the component, not by the footnote.
      expect(referencesShown(node, null, { component: doc, offset: pos + 1 })[0]!.text).toBe(
        'Table: Readings',
      );
    });
  });
});

describe('what a component offers a reference of its own (cross-references 1, ruling R11)', () => {
  const withEverything = () =>
    docOf(
      para('b1', text('Visited'), {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [para('fp1', text('Twice.'))],
      } as InlineNode),
      figure('g1', 'The site'),
      table('t1', 'Readings'),
      table('t2', ''),
    );

  it('offers its figures, tables and footnotes in document order, by kind and caption, with no label', () => {
    expect(ownTargets(withEverything())).toEqual([
      target({ kind: 'block', block: 'f1' }, 'footnote', null, null),
      target({ kind: 'block', block: 'g1' }, 'figure', null, 'The site'),
      target({ kind: 'block', block: 't1' }, 'table', null, 'Readings'),
      target({ kind: 'block', block: 't2' }, 'table', null, null),
    ]);
  });

  it('says which stand above and which below a place in it, where it is given one', () => {
    const doc = withEverything();
    let at = -1;
    doc.forEach((node, offset) => {
      if (node.attrs.id === 'g1') at = offset + node.nodeSize;
    });
    expect(ownTargets(doc, at).map((each) => [each.target, each.relative])).toEqual([
      [{ kind: 'block', block: 'f1' }, 'above'],
      [{ kind: 'block', block: 'g1' }, 'above'],
      [{ kind: 'block', block: 't1' }, 'below'],
      [{ kind: 'block', block: 't2' }, 'below'],
    ]);
  });

  it('offers no paragraph, list or cell, and nothing from a component that holds none', () => {
    expect(ownTargets(docOf(para('b1', text('Visited'))))).toEqual([]);
  });
});
