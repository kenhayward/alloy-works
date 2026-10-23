import type { OutlineDocument, OutlineNode } from '../structure/outline.js';

/** Whether one language tag serves another: equal, or either a range of the other (TR-I). */
const serves = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
};

/** The title given in a language serving `language`, its exact tag first. */
function titleIn(titles: Readonly<Record<string, string>> | undefined, language: string) {
  const entries = Object.entries(titles ?? {}).filter(([tag]) => serves(tag, language));
  return (entries.find(([tag]) => tag.toLowerCase() === language.toLowerCase()) ?? entries[0])?.[1];
}

/**
 * **An outline read in a language** (the TR plan, TR-L): the document's title and each section's in
 * that language where it is given one, a translated title one run of its words; and each section,
 * and whether the document, given none, so the publish reports it. Itself where its own serves.
 */
export function titlesIn(
  outline: OutlineDocument,
  language: string,
): {
  readonly outline: OutlineDocument;
  /** Each section given no title in the language. */
  readonly missing: readonly string[];
  /** Whether the document's own title is given none. */
  readonly untitled: boolean;
} {
  if (serves(outline.language, language)) return { outline, missing: [], untitled: false };
  const missing: string[] = [];
  const title = titleIn(outline.titles, language);
  const translate = (node: OutlineNode): OutlineNode => {
    const children = node.children.map(translate);
    if (node.type !== 'section') return { ...node, children };
    const words = titleIn(node.titles, language);
    if (words === undefined) missing.push(node.id);
    return {
      ...node,
      ...(words === undefined ? {} : { title: [{ type: 'text', value: words, marks: [] }] }),
      children,
    } as OutlineNode;
  };
  const nodes = outline.nodes.map(translate);
  return {
    outline: { ...outline, title: title ?? outline.title, nodes },
    missing,
    untitled: title === undefined,
  };
}
