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
    readonly fromElement?: (node: HTMLElement) => Attrs;
    readonly selector?: string;
  } = {},
): MarkSpec {
  const rule: TagParseRule = {
    tag: options.selector ?? tag,
    getAttrs: (node) => {
      const id = node.getAttribute('data-mark-id');
      if (id === null || id === '') return false;
      return { id, ...options.fromElement?.(node) };
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
 * The editor's schema for this slice: the content root, paragraphs, text, and the ten marks a T1
 * author or the mapping needs (docs/plans/2026-09-16-editor-01-open-edit-and-save.md, decision 5;
 * docs/plans/2026-09-20-editor-03-marks-and-links.md). Every other node in content-model.md arrives
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
      content: 'paragraph+',
      attrs: { title: {}, language: {}, direction: {} },
    },
    paragraph: {
      content: 'text*',
      marks: '_',
      attrs: { id: { default: null }, style: { default: 'body' } },
      // Typing is read back from the DOM through these rules, so a paragraph the browser makes is
      // still a paragraph - with no identifier, which the identity plugin then allocates.
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: {},
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
      fromElement: (node) => ({ term: node.getAttribute('data-term') }),
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
      fromElement: (node) => ({
        href: node.getAttribute('href'),
        title: node.getAttribute('title'),
      }),
    }),
    // CNT-147: a run in another language is not spell checked, so that a French phrase inside an
    // English component is never flagged as misspelt. A mark's `toDOM` is handed the mark and never
    // the component, so it cannot compare the tag with the base language (CNT-140) and turns the
    // checker off for every language run - stricter than CNT-147 asks, and never wrong in kind.
    language: markSpec('span', {
      selector: 'span.aw-language',
      attrs: { tag: {} },
      inclusive: false,
      toAttributes: (attrs) => ({
        lang: attrs.tag as string,
        spellcheck: 'false',
        class: 'aw-language',
      }),
      fromElement: (node) => ({ tag: node.getAttribute('lang') }),
    }),
  },
});
