import {
  characterProblems,
  type Place,
  type ResolvedParagraphStyle,
  type ResolvedTheme,
} from '@alloy-works/domain';
import type { StyleCheck, TextWhere, Unresolved } from '@alloy-works/editor';
import { covers } from '@alloy-works/fonts';
import { useEffect, type RefObject } from 'react';
import { usePresentation } from './presentation.js';

/** Whether a style of one of the theme's catalogues resolves for this target. */
function resolves(
  style: { readonly appliesTo: readonly string[] } | undefined,
  target: string,
): Unresolved | null {
  if (style === undefined) return 'missing';
  return style.appliesTo.includes(target) ? null : 'misplaced';
}

/**
 * The paragraph style a run of text is set in: a paragraph's stored style by its place, the default
 * there where it is `body` or will not resolve - as the canvas sets it - or the style a role is set in.
 */
function settingStyle(theme: ResolvedTheme, where: TextWhere): ResolvedParagraphStyle | undefined {
  if (where.role !== null) return theme.paragraphStyles.get(theme.roles[where.role]);
  const { style, place } = where.paragraph ?? { style: 'body', place: 'text' as Place };
  const fallback = theme.paragraphStyles.get(theme.places[place]);
  if (style === 'body') return fallback;
  const chosen = theme.paragraphStyles.get(style);
  return chosen && chosen.appliesTo.includes(place) ? chosen : fallback;
}

/**
 * The check a surface marks what will not resolve by (themes.md, "What will not resolve", ET-I;
 * STY-070), from the theme the page is set in: the reader's own rules for a style's applicability
 * (STY-006), and the publish's own glyph check (STY-049) asked of the family that sets the text in the
 * setting it is set in, over the coverage generated from the pinned files. A character of a family the
 * renderer does not hold is not marked: the canvas says the face itself is missing.
 */
export function styleCheckFor(theme: ResolvedTheme, unheld: readonly string[]): StyleCheck {
  return {
    paragraph: (style, place) => resolves(theme.paragraphStyles.get(style), place),
    table: (style) => resolves(theme.tableStyles.get(style), 'table'),
    image: (style, target) => resolves(theme.imageStyles.get(style), target),
    uncovered: (text, where) => {
      const paragraph = settingStyle(theme, where);
      const family = where.inlineCode
        ? (theme.characterStyles.inlineCode.typeface?.family ?? paragraph?.typeface.family)
        : paragraph?.typeface.family;
      if (family === undefined || unheld.includes(family)) return new Set();
      return new Set(
        characterProblems(text, covers, family, where.code ? 'code' : 'body').map(
          (each) => each.codePoint,
        ),
      );
    },
  };
}

const LABEL = {
  missing: (kind: string, style: string) => `${kind} ${style} is not in this theme`,
  misplaced: (kind: string, style: string) => `${kind} ${style} does not apply here`,
};

function mark(element: Element, status: Unresolved | null, kind: string, style: string): void {
  if (status === null) {
    element.removeAttribute('data-unresolved');
    return;
  }
  const label = LABEL[status](kind, style);
  element.setAttribute('data-unresolved', status);
  element.setAttribute('data-unresolved-label', label);
  element.setAttribute('title', label);
}

/**
 * The same marks on a document's read text, which is serialized rather than viewed: a paragraph's, a
 * table's or an image's style that will not resolve where it stands (STY-070). Characters are marked
 * on the surface alone, where they can be fixed.
 */
export function markUnresolved(root: ParentNode, check: StyleCheck): void {
  for (const element of root.querySelectorAll('p[data-style]')) {
    const style = element.getAttribute('data-style')!;
    if (style === 'body') continue;
    const place = (
      element.classList.contains('aw-footnote-paragraph')
        ? 'footnote'
        : (element.getAttribute('data-place') ?? 'text')
    ) as Place;
    mark(element, check.paragraph(style, place), 'Style', style);
  }
  for (const element of root.querySelectorAll('[data-table-style]')) {
    const style = element.getAttribute('data-table-style')!;
    mark(element, check.table(style), 'Table style', style);
  }
  for (const element of root.querySelectorAll('[data-image-style]')) {
    const style = element.getAttribute('data-image-style')!;
    const target = element.tagName === 'FIGURE' ? 'figure' : 'inlineImage';
    mark(element, check.image(style, target), 'Image style', style);
  }
}

/** Keeps the read text under `ref` marked while the presentation holds, marking again as it is drawn. */
export function useUnresolvedMarks(ref: RefObject<HTMLElement | null>): void {
  const presentation = usePresentation();
  useEffect(() => {
    const root = ref.current;
    if (!root || presentation?.state !== 'ready') return undefined;
    const check = styleCheckFor(presentation.theme, presentation.unheld);
    markUnresolved(root, check);
    const observer = new MutationObserver(() => markUnresolved(root, check));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, presentation]);
}
