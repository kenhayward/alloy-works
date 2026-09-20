import { Schema, type Attrs, type MarkSpec, type TagParseRule } from 'prosemirror-model';

/**
 * Renders a mark's element, always carrying `data-mark-id`, so that the view can read its own output
 * back (see `markSpec`). `attributes` is written after the identifier only for the reader's sake; the
 * order of a DOM output spec's attributes has no meaning.
 */
const render =
  (tag: string, attributes: (attrs: Attrs) => Record<string, string> = () => ({})) =>
  (mark: { attrs: Attrs }) =>
    [tag, { ...attributes(mark.attrs), 'data-mark-id': mark.attrs.id as string }, 0] as const;

/**
 * One mark of the content model, in the editor's terms.
 *
 * `parseDOM` is not decoration. `prosemirror-view` reads **typed** input back out of the DOM through
 * `DOMParser.fromSchema`, so a mark with no rule is invisible to that parser and the diff it computes
 * can drop the mark the author was typing inside. The rule is gated on `data-mark-id`: it matches the
 * elements the view itself rendered and nothing else, so the browser can never manufacture a mark
 * without an identifier (CNT-004). Paste and drop are refused outright in `view.ts`, so the clipboard
 * parser never runs at all.
 */
function markSpec(
  tag: string,
  options: {
    readonly attrs?: Record<string, { default?: null }>;
    readonly inclusive?: false;
    readonly toAttributes?: (attrs: Attrs) => Record<string, string>;
    /** The mark's own attributes, or `false` where one it cannot do without is missing. */
    readonly fromElement?: (node: HTMLElement) => Attrs | false;
    readonly selector?: string;
  } = {},
): MarkSpec {
  const rule: TagParseRule = {
    tag: options.selector ?? tag,
    getAttrs: (node) => {
      const id = node.getAttribute('data-mark-id');
      if (id === null || id === '') return false;
      const rest = options.fromElement?.(node);
      if (rest === false) return false;
      return { id, ...rest };
    },
  };
  return {
    attrs: { id: {}, ...options.attrs },
    ...(options.inclusive === false ? { inclusive: false } : {}),
    parseDOM: [rule],
    toDOM: render(tag, options.toAttributes),
  };
}

/**
 * The editor's schema for this slice: the content root, paragraphs, text, lists in three kinds, and
 * the ten marks a T1 author or the mapping needs
 * (docs/plans/2026-09-16-editor-01-open-edit-and-save.md, decision 5;
 * docs/plans/2026-09-20-editor-03-marks-and-links.md;
 * docs/plans/2026-09-21-editor-04-lists-and-quotations.md). Every other node in content-model.md arrives
 * with the plan that makes it editable; until then `toEditor` refuses to open a component holding one
 * for editing, so the mapping is never lossy.
 *
 * The three marks the content model holds and this schema does not - `condition`, `suggestion` and
 * `comment` - are annotations nothing in T1 can create, and publishing refuses them.
 *
 * **The marks are declared in `markTypes`' own order, minus those three, and that order is
 * load-bearing.** `Mark.setFrom` sorts a mark array by the rank a mark was declared with, so the
 * editor emits a run's marks in this order whatever order they were stored in; canonicalisation
 * treats a run's marks as a set, so this is never a spurious version. Publishing pins its own literal
 * order, which is not this one.
 *
 * The root's title, language and direction are attributes of `doc`, so a later plan that edits them
 * does so as steps (component-editor.md, "The surface"). A block's `id` defaults to null because
 * ProseMirror must be able to make a paragraph on its own; the identity plugin fills it, and
 * `fromEditor` refuses one it did not (ADR-0023). A mark's `id` has no default: a mark is only ever
 * made by a command that mints one, or read back from an element that already carries one.
 */
export const editorSchema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
      attrs: { title: {}, language: {}, direction: {} },
    },
    // **Declared first among the block group, and that order is load-bearing.** ProseMirror fills an
    // empty document from the first type in the group that its content expression admits, so a
    // component opened with nothing in it gets a paragraph for the cursor to stand in and never a
    // list (CNT-124, held by the content model).
    paragraph: {
      group: 'block',
      content: 'text*',
      marks: '_',
      attrs: { id: { default: null }, style: { default: 'body' } },
      // Typing is read back from the DOM through these rules, so a paragraph the browser makes is
      // still a paragraph - with no identifier, which the identity plugin then allocates.
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: {},
    /**
     * A counted list - numbered or bulleted. The stored model holds one `list` node carrying a
     * `kind` of `'ordered' | 'unordered' | 'definition'`; the editor holds two node types, because a
     * ProseMirror content expression is fixed per type and a definition item must open with its term
     * (ADR, "the editor schema is not the stored model one for one"). `kind` here is therefore two
     * of the stored three, and the mapping widens it back.
     *
     * `start` and `format` reach the rendered element. They are not decoration: the stylesheet takes
     * an `ol`'s marker from `data-format` and the browser takes its first number from `start`, so
     * without them an author who sets **Start at 5, a b c** would see `1.` on the surface and `e.`
     * in the published PDF. The parse rule reads both back for the same reason the mark rules exist
     * (see `markSpec`) - `prosemirror-view` reads typed input out of the DOM, and a rule that
     * dropped them would reset the author's numbering as they typed.
     */
    list: {
      group: 'block',
      content: 'listItem+',
      attrs: {
        id: { default: null },
        kind: { default: 'unordered' },
        start: { default: null },
        format: { default: null },
      },
      parseDOM: [
        { tag: 'ul' },
        {
          tag: 'ol',
          // **Both are judged, not read.** `Number('')` is 0 and `Number('five')` is `NaN`, and a
          // `data-format` of anything at all would come straight through - so an element the editor
          // did not render, which is what a command that writes these attributes and any future
          // paste path both make reachable, could put a `NaN` start or an unknown numbering into the
          // document. `listNodeSchema` refuses both, and the author meets that refusal as
          // `saveIteration`'s fixed message, which names nothing. Anything the schema would refuse
          // reads as absent instead, which is a list with no numbering of its own and is always
          // storable.
          getAttrs: (node: HTMLElement) => {
            const start = Number(node.getAttribute('start'));
            const format = node.getAttribute('data-format');
            return {
              kind: 'ordered',
              start:
                node.hasAttribute('start') && Number.isInteger(start) && start >= 0 ? start : null,
              format:
                format === 'decimal' || format === 'alphabetic' || format === 'roman'
                  ? format
                  : null,
            };
          },
        },
      ],
      toDOM: (node) => [
        node.attrs.kind === 'ordered' ? 'ol' : 'ul',
        {
          ...(node.attrs.start === null ? {} : { start: String(node.attrs.start) }),
          ...(node.attrs.format === null ? {} : { 'data-format': node.attrs.format as string }),
        },
        0,
      ],
    },
    /**
     * No attributes at all: the stored model's item is `{ term?, content }` and carries no
     * identifier, so there is nothing for one to hold and nothing for the identity plugin to
     * allocate. The blocks inside it carry their own.
     *
     * `block+` is what makes a list the first family that nests: an item holds paragraphs and lists
     * of either kind, to whatever depth the content model's admission limit allows.
     */
    listItem: {
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    definitionList: {
      group: 'block',
      content: 'definitionItem+',
      attrs: { id: { default: null } },
      parseDOM: [{ tag: 'dl' }],
      toDOM: () => ['dl', 0],
    },
    /**
     * `term block+`, not `block+`: a definition item's first child is the term it defines, and that
     * is the whole reason a definition list is its own node type here rather than a third `kind` of
     * `list`. Relaxing this to `block+` or `term? block+` would make the item representable without
     * its term and is the one change this shape exists to forbid.
     *
     * A term that has not been typed yet is still a `term` node, empty - an author who writes the
     * definition before the word must be able to. What is optional is what reaches the store: the
     * stored item omits `term` entirely when it is empty (`checkBlock` in `packages/domain`), which
     * is the same bargain the content model strikes for an empty paragraph under CNT-124.
     *
     * `div` rather than `dt`+`dd` siblings, because an item is one node and `dl` admits no wrapper
     * in HTML that carries both - the surface is styled, and the published structure is the
     * template's business, not this schema's.
     */
    definitionItem: { content: 'term block+', defining: true, toDOM: () => ['div', 0] },
    /**
     * The term is a textblock, so it is an editable region of its own carrying its own marks - which
     * is what makes a term inline content rather than a string.
     */
    term: {
      content: 'text*',
      marks: '_',
      defining: true,
      parseDOM: [{ tag: 'dt' }],
      toDOM: () => ['dt', 0],
    },
  },
  marks: {
    emphasis: markSpec('em'),
    strong: markSpec('strong'),
    underline: markSpec('u'),
    subscript: markSpec('sub'),
    superscript: markSpec('sup'),
    inlineCode: markSpec('code'),
    definedTerm: markSpec('dfn', {
      attrs: { term: {} },
      toAttributes: (attrs) => ({ 'data-term': attrs.term as string }),
      fromElement: (node) => {
        const term = node.getAttribute('data-term');
        return term === null || term === '' ? false : { term };
      },
    }),
    quotedPhrase: markSpec('q'),
    // Not inclusive: typing at the end of a link or a language run makes ordinary text, because the
    // author who reaches the end of a link is almost never still writing it (CNT-126, CNT-140).
    hyperlink: markSpec('a', {
      selector: 'a[href]',
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      toAttributes: (attrs) => ({
        href: attrs.href as string,
        ...(typeof attrs.title === 'string' ? { title: attrs.title } : {}),
      }),
      fromElement: (node) => {
        const href = node.getAttribute('href');
        return href === null || href === '' ? false : { href, title: node.getAttribute('title') };
      },
    }),
    // The mark carries the run's language and nothing about spelling. CNT-147 turns the checker off
    // only over a run whose language *differs* from the component's base language (CNT-140), and a
    // mark's `toDOM` is handed the mark and never the component, so it cannot tell. That rule is a
    // decoration recomputed from the document in `state.ts`, which is also what makes it follow a
    // change of base language (component-editor.md, "Title, base language and base direction").
    language: markSpec('span', {
      selector: 'span.aw-language',
      attrs: { tag: {} },
      inclusive: false,
      toAttributes: (attrs) => ({ lang: attrs.tag as string, class: 'aw-language' }),
      fromElement: (node) => {
        const tag = node.getAttribute('lang');
        return tag === null || tag === '' ? false : { tag };
      },
    }),
  },
});
