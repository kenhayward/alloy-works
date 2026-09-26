import {
  inlineReferenceKey,
  type NumberingEntry,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedInline,
  type PublishedNode,
  type WordInput,
} from '@alloy-works/domain';

// What a published document asks of Word for footnotes and cross-references (Word 3, ruling R6), read
// from the document and what `assemble` kept for Word beside it, and never from what the writer wrote:
// the Word check holds Word's updated fields to it, and PUB-035's test the fields the writer wrote.

/**
 * A cross-reference's field as the published document asks Word for it (Word 3, ruling R4): in which
 * story, by which instruction - `REF` with `r` for a heading's number, `p` for above or below - linked
 * or not, and what the PDF prints, or null where a page is asked for, which only Word can know.
 */
export interface Asked {
  readonly story: 'text' | 'footnotes' | 'box';
  readonly field: 'REF' | 'REF r' | 'REF p' | 'NOTEREF' | 'PAGEREF';
  readonly link: boolean;
  readonly text: string | null;
  readonly anchor: string;
  /** The language of the passage it stands in, without its region. */
  readonly language: string;
}

/** A footnote as the numbering table labels it, in the order Word numbers them. */
export interface Noted {
  readonly label: string;
}

/**
 * Where Word sets a target: the heading, the caption, the footnote or the displayed equation so many in
 * (Word 4), or a paragraph by its words.
 */
export type Target =
  | {
      readonly kind: 'heading' | 'caption' | 'footnote' | 'note' | 'equation';
      readonly index: number;
    }
  | { readonly kind: 'paragraph'; readonly text: string };

/** Every node in document order, the outline's depth first. */
export const walk = (nodes: readonly PublishedNode[]): PublishedNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children)]);

/** Every block a node publishes, in order, those inside a list, a quotation and a table's cell too. */
export function blocksOf(blocks: readonly PublishedBlock[]): PublishedBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === 'list'
      ? block.items.flatMap((item) => blocksOf(item.blocks))
      : block.type === 'blockquote'
        ? blocksOf(block.blocks)
        : block.type === 'table'
          ? block.rows.flatMap((row) => row.cells.flatMap((each) => blocksOf(each.blocks)))
          : []),
  ]);
}

/** Runs' words as the PDF prints them, a reference's among them; a page's is Word's alone. */
export const wordsOf = (runs: readonly PublishedInline[]) =>
  runs
    .map((run) => ('text' in run ? run.text : 'reference' in run ? (run.reference.text ?? '') : ''))
    .join('');

type ReferenceRun = Extract<PublishedInline, { reference: unknown }>['reference'];
type ReferenceSite = Parameters<typeof inlineReferenceKey>[1];

/**
 * What the published document asks of Word for Word 3 (ruling R6), from the document and what
 * `assemble` kept for Word beside it: every reference's fields, in the order the writer meets them in
 * each story - a section's title before its blocks, a table's caption before its cells and its note
 * after them, a figure's caption after its image, a floated one's in its text box, and a note's in the
 * notes - each with what the PDF prints; every footnote by the numbering table's label, in the order
 * its mark stands; and every target a reference names, by where Word sets it.
 */
export function askedOf(
  document: PublishedDocument,
  word: WordInput,
  entries: readonly NumberingEntry[],
): { asked: Asked[]; footnotes: Noted[]; targets: Record<string, Target> } {
  const targets: Record<string, Target> = {};
  walk(document.nodes).forEach((node, index) => {
    if (node.anchor !== null) targets[node.anchor] = { kind: 'heading', index };
  });
  const captioned = walk(document.nodes).flatMap((node) =>
    blocksOf(node.blocks).filter(
      (block) =>
        (block.type === 'figure' || block.type === 'table') &&
        entries.some((each) => each.node === node.id && each.block === block.id && each.label),
    ),
  );
  captioned.forEach((block, index) => {
    if (block.anchor !== null) targets[block.anchor] = { kind: 'caption', index };
  });
  // Every equation that stands on its own, numbered or not, in the order Word displays them.
  const displayed = walk(document.nodes).flatMap((node) =>
    blocksOf(node.blocks).filter((block) => block.type === 'equation'),
  );
  displayed.forEach((block, index) => {
    if (block.anchor !== null) targets[block.anchor] = { kind: 'equation', index };
  });
  const asked: Asked[] = [];
  const footnotes: Noted[] = [];
  const fields = (
    run: ReferenceRun,
    key: string,
    story: Asked['story'],
    language: string,
  ): Asked[] => {
    const form = word.references.get(key);
    if (form === undefined) throw new Error(`No form for ${key}`);
    const base = { story, link: run.link, anchor: run.anchor, language };
    // Targets are named before they are met only where they stand earlier; the rest are named here.
    const kind = targets[run.anchor]?.kind;
    const number: Asked = {
      ...base,
      field: kind === 'footnote' ? 'NOTEREF' : kind === 'heading' ? 'REF r' : 'REF',
      text: form.label,
    };
    const title: Asked = { ...base, field: 'REF', text: form.title };
    switch (form.display) {
      case 'number':
        return [number];
      case 'title':
        return [title];
      case 'numberAndTitle':
        return [number, title];
      case 'relative':
        return [{ ...base, field: 'REF p', text: run.text }];
      case 'page':
        return [{ ...base, field: 'PAGEREF', text: null }];
    }
  };
  // Every target first, so that a reference before its target knows what it names.
  const later: (() => void)[] = [];
  const runs = (
    node: PublishedNode,
    inlines: readonly PublishedInline[],
    site: ReferenceSite,
    story: Asked['story'],
    language: string,
  ) => {
    inlines.forEach((run, index) => {
      if ('reference' in run) {
        const key = inlineReferenceKey(node.id, site, index);
        later.push(() => asked.push(...fields(run.reference, key, story, language)));
      }
      if ('footnote' in run) {
        const note = footnotes.length;
        footnotes.push({ label: run.footnote.label });
        if (run.footnote.anchor !== null) {
          targets[run.footnote.anchor] = { kind: 'footnote', index: note };
        }
        for (const each of run.footnote.paragraphs) {
          if (each.anchor !== null) targets[each.anchor] = { kind: 'note', index: note };
          runs(node, each.runs, { kind: 'paragraph', block: each.id }, 'footnotes', language);
        }
      }
    });
  };
  const blocks = (
    node: PublishedNode,
    list: readonly PublishedBlock[],
    story: Asked['story'],
    language: string,
  ) => {
    for (const block of list) {
      switch (block.type) {
        case 'paragraph':
          if (block.anchor !== null) {
            targets[block.anchor] = { kind: 'paragraph', text: wordsOf(block.runs) };
          }
          runs(node, block.runs, { kind: 'paragraph', block: block.id }, story, language);
          break;
        case 'list':
          block.items.forEach((item, at) => {
            const term = { kind: 'term', block: block.id, item: at } as const;
            if (item.term !== null) runs(node, item.term, term, story, language);
            blocks(node, item.blocks, story, language);
          });
          break;
        case 'blockquote':
          blocks(node, block.blocks, story, language);
          if (block.attribution !== null) {
            const site = { kind: 'attribution', block: block.id } as const;
            runs(node, block.attribution, site, story, language);
          }
          break;
        case 'table':
          runs(node, block.caption, { kind: 'caption', block: block.id }, story, language);
          for (const row of block.rows) {
            for (const each of row.cells) blocks(node, each.blocks, story, language);
          }
          if (block.note !== null) {
            runs(node, block.note, { kind: 'note', block: block.id }, story, language);
          }
          break;
        case 'figure':
          runs(
            node,
            block.caption,
            { kind: 'caption', block: block.id },
            block.placement === 'float' ? 'box' : story,
            language,
          );
          break;
        default:
          break;
      }
    }
  };
  for (const node of walk(document.nodes)) {
    const language = (node.language ?? document.language).lang;
    const title = word.titles.get(node.id);
    if (title !== undefined) runs(node, title, { kind: 'title' }, 'text', language);
    blocks(node, node.blocks, 'text', language);
  }
  for (const each of later) each();
  return { asked, footnotes, targets };
}
