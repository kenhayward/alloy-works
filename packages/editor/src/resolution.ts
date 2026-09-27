import type { Place, Role } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { paragraphPlaces } from './places.js';

/** Why a style will not resolve where it stands: the theme holds none of that name, or not for here. */
export type Unresolved = 'missing' | 'misplaced';

/**
 * What a surface asks of the theme it is set in, to mark what will not resolve (themes.md, "What will
 * not resolve", ET-I; STY-070): the page's, which holds the theme - the editor holds none.
 */
export interface StyleCheck {
  /** Whether a paragraph's stored style (never `body`, the default where it stands) resolves there. */
  paragraph(style: string, place: Place): Unresolved | null;
  table(style: string): Unresolved | null;
  image(style: string, target: 'figure' | 'inlineImage'): Unresolved | null;
  /**
   * The characters of `text` the face setting it cannot set, by code point: asked of the family that
   * sets the text where it stands - a paragraph's style by its place, a role's, or inline code's face -
   * and in the engine's setting, as the publish's own glyph check asks (STY-049).
   */
  uncovered(text: string, where: TextWhere): ReadonlySet<number>;
}

/** Where a run of text stands, as far as which face sets it. */
export interface TextWhere {
  /** A paragraph's stored style and its place, or null for text a role sets. */
  readonly paragraph: { readonly style: string; readonly place: Place } | null;
  readonly role: Role | null;
  /** In inline code or preformatted text: set as code, in inline code's face where the mark is. */
  readonly code: boolean;
  readonly inlineCode: boolean;
}

const LABELS: Record<Unresolved, (kind: string, style: string) => string> = {
  missing: (kind, style) => `${kind} ${style} is not in this theme`,
  misplaced: (kind, style) => `${kind} ${style} does not apply here`,
};

const marker = (status: Unresolved, kind: string, style: string) => ({
  'data-unresolved': status,
  'data-unresolved-label': LABELS[status](kind, style),
  title: LABELS[status](kind, style),
});

/** The role a text block's content is set in, where it is not a paragraph's. */
const ROLE_OF: Readonly<Record<string, Role>> = {
  figureCaption: 'caption',
  tableCaption: 'caption',
  tableNote: 'tableNote',
  attribution: 'attribution',
  preformatted: 'preformatted',
};

const hex = (codePoint: number) => codePoint.toString(16).toUpperCase().padStart(4, '0');

/**
 * Every mark of what will not resolve in a document: a paragraph's, a table's or an image's style the
 * theme does not hold or does not hold for where it stands, marked on the block and labelled with its
 * name - a paragraph is set meanwhile in its place's default, by the theme's own rules; and each
 * character the face setting it cannot set, marked and named on hover. `footnote` is a footnote's own
 * document, whose paragraphs stand in the footnote's place.
 */
export function unresolvedDecorations(
  doc: Node,
  check: StyleCheck,
  footnote = false,
): DecorationSet {
  const decorations: Decoration[] = [];
  const glyphs = (block: Node, pos: number, where: Omit<TextWhere, 'code' | 'inlineCode'>) => {
    block.forEach((child, offset) => {
      if (!child.isText || child.text === undefined) return;
      const inlineCode = child.marks.some((mark) => mark.type.name === 'inlineCode');
      const missing = check.uncovered(child.text, {
        ...where,
        code: inlineCode || where.role === 'preformatted',
        inlineCode,
      });
      if (missing.size === 0) return;
      let at = pos + 1 + offset;
      for (const character of child.text) {
        const codePoint = character.codePointAt(0)!;
        if (missing.has(codePoint)) {
          decorations.push(
            Decoration.inline(at, at + character.length, {
              class: 'aw-glyph-missing',
              title: `No glyph for U+${hex(codePoint)} in this typeface`,
            }),
          );
        }
        at += character.length;
      }
    });
  };

  const paragraphs = footnote
    ? (() => {
        const found: { pos: number; node: Node; place: Place }[] = [];
        doc.forEach((node, pos) => {
          if (node.type.name === 'footnoteParagraph') found.push({ pos, node, place: 'footnote' });
        });
        return found;
      })()
    : paragraphPlaces(doc);
  for (const { pos, node, place } of paragraphs) {
    const style = (node.attrs.style as string | undefined) ?? 'body';
    if (node.type.name !== 'term' && style !== 'body') {
      const status = check.paragraph(style, place);
      if (status !== null) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, marker(status, 'Style', style)));
      }
    }
    glyphs(node, pos, {
      paragraph:
        node.type.name === 'term' ? { style: 'body', place: 'listItem' } : { style, place },
      role: null,
    });
  }

  if (!footnote) {
    doc.descendants((node, pos) => {
      const role = ROLE_OF[node.type.name];
      if (role !== undefined) glyphs(node, pos, { paragraph: null, role });
      // A preformatted block's language label is drawn, not typed, so no character of it can carry a
      // mark: the block it labels is marked instead, naming the characters its role's face lacks.
      const label =
        node.type.name === 'preformatted' ? (node.attrs.language as string | null) : null;
      if (label) {
        const missing = check.uncovered(label, {
          paragraph: null,
          role: 'preformattedLabel',
          code: false,
          inlineCode: false,
        });
        if (missing.size > 0) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: 'aw-label-glyph-missing',
              title: `No glyph for ${[...missing].map((each) => `U+${hex(each)}`).join(', ')} in this typeface, in its label`,
            }),
          );
        }
      }
      if (node.type.name === 'tableFigure') {
        const style = node.attrs.style as string;
        const status = check.table(style);
        if (status !== null) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, marker(status, 'Table style', style)),
          );
        }
      }
      if (node.type.name === 'figure' || node.type.name === 'image') {
        const style = node.attrs.imageStyle as string;
        const status = check.image(style, node.type.name === 'figure' ? 'figure' : 'inlineImage');
        if (status !== null) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, marker(status, 'Image style', style)),
          );
        }
      }
      return true;
    });
  }

  return DecorationSet.create(doc, decorations);
}

interface CheckState {
  readonly check: StyleCheck | null;
  readonly marks: DecorationSet;
}

/** Where a surface's state keeps the theme's check, and the marks made by it for its document. */
const styleCheckKey = new PluginKey<CheckState>('styleCheck');

/**
 * Holds the page's check and the marks it makes, made again only when the document or the check
 * changes rather than on every draw.
 */
export function styleCheckPlugin(): Plugin {
  return new Plugin({
    key: styleCheckKey,
    state: {
      init: (): CheckState => ({ check: null, marks: DecorationSet.empty }),
      apply: (tr: Transaction, value: CheckState, _old, state: EditorState): CheckState => {
        const given = tr.getMeta(styleCheckKey) as StyleCheck | null | undefined;
        const check = given === undefined ? value.check : given;
        if (given === undefined && !tr.docChanged) return value;
        return {
          check,
          marks: check === null ? DecorationSet.empty : unresolvedDecorations(state.doc, check),
        };
      },
    },
  });
}

/** The marks a surface's state holds for what will not resolve, or none. */
export function unresolvedOf(state: EditorState): DecorationSet {
  return styleCheckKey.getState(state)?.marks ?? DecorationSet.empty;
}

/** The theme's check a surface holds, which a footnote's own editor asks of its own text. */
export function styleCheckOf(state: EditorState): StyleCheck | null {
  return styleCheckKey.getState(state)?.check ?? null;
}

/** Gives a surface the check of the theme it is set in, or takes it away; never part of its history. */
export function setStyleCheck(
  view: { readonly state: EditorState; dispatch: (tr: Transaction) => void },
  check: StyleCheck | null,
): void {
  view.dispatch(view.state.tr.setMeta(styleCheckKey, check).setMeta('addToHistory', false));
}
