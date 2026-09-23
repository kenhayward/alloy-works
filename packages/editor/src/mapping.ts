import {
  parseContentDocument,
  type BlockNode,
  type ContentDocument,
  type InlineNode,
  type Mark,
} from '@alloy-works/domain';
import type { Mark as EditorMark, Node } from 'prosemirror-model';

import { editorSchema } from './schema.js';
import { tableOf } from './tables.js';

/** A stored document opened for editing, or the names of what this editor cannot yet change. */
export type Opened =
  | { readonly editable: true; readonly doc: Node }
  | { readonly editable: false; readonly unsupported: readonly string[] };

/**
 * Every node type and mark in the blocks that the slice's schema has no counterpart for, once each.
 *
 * The marks are read off `editorSchema` rather than listed again here, so a mark the schema gains is
 * carried by the mapping the moment it is declared, and one it loses is refused by name rather than
 * dropped. Today that leaves `condition`, `suggestion` and `comment` - the three annotations nothing
 * in T1 can create (content-model.md).
 *
 * **A run carrying two marks of one type is refused by that type's name**, although the schema holds
 * the type. CNT-003 lets two annotations of one kind cover one range - two defined terms over one
 * phrase - and ProseMirror does not: a text node with two marks of one type is what `Node.check`
 * calls an invalid collection of marks, and the view's read-back of what it rendered keeps one of
 * the two. Opening such a component read-only keeps the promise `toEditor` makes below, that opening
 * never loses anything; opening it and saving would store the loss under the author's name.
 */
function unsupportedIn(blocks: readonly BlockNode[]): string[] {
  const found = new Set<string>();
  namesWithNoNode(blocks, found);
  return [...found];
}

/**
 * Walks every block sequence the model has a node for, so a block with no counterpart is named
 * **wherever it stands** - a table inside a list item, six levels down, is as much a reason to open
 * read-only as one at the top level, and a walk that stopped at the top would open the component and
 * drop the table on the next save.
 *
 * A block it has no node for is named and **not descended into**: the editor has nothing to hold it
 * with, so what is inside it is not a second thing to report.
 */
function namesWithNoNode(blocks: readonly BlockNode[], found: Set<string>): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        marksWithNoType(block.content, found);
        break;
      case 'list':
        // The editor's `definitionList` holds no `start` and no `format`, and loses neither: the
        // stored shape puts both on a list of any kind, and `checkBlock` refuses them on a list
        // that is not ordered, so no document reaching here can carry one. That rule is in the walk
        // rather than here on purpose - this path is for what the editor cannot **hold**, like a
        // table or a comment mark, and a definition list with a start number is not that. It is
        // content that should never have been storable, which is a different sentence to say to an
        // author and belongs where every producer meets it.
        for (const item of block.items) {
          // A term is inline content and is walked for the same reason a paragraph's is. Where a
          // term stands at all is the content model's rule, held in `checkBlock`, so a document
          // that has been parsed carries one only on a definition list's item.
          if (item.term !== undefined) marksWithNoType(item.term, found);
          namesWithNoNode(item.content, found);
        }
        break;
      case 'preformatted':
        // A string, not runs: nothing inside it can lack a node.
        break;
      case 'blockquote':
        // Its attribution is inline content, walked as a paragraph's is: a citation in one - which
        // no control writes yet - opens the component read-only by name rather than being dropped.
        namesWithNoNode(block.content, found);
        if (block.attribution !== undefined) marksWithNoType(block.attribution, found);
        break;
      case 'table':
        // The caption, every cell and the note, each for what it holds. The note is carried as it is
        // stored and not edited, so a footnote in it - which the editor has no node for - opens the
        // component read-only by name, exactly as one in a paragraph does.
        marksWithNoType(block.caption, found);
        for (const row of block.rows)
          for (const cell of row.cells) namesWithNoNode(cell.content, found);
        if (block.note !== undefined) marksWithNoType(block.note, found);
        break;
      case 'figure':
        // Its caption is inline content, walked as a table's is (figures 2).
        marksWithNoType(block.caption, found);
        break;
      default:
        found.add(block.type);
    }
  }
}

/** The inline nodes and the marks of one run sequence that this schema has no counterpart for. */
function marksWithNoType(content: readonly InlineNode[], found: Set<string>): void {
  for (const inline of content) {
    if (inline.type !== 'text') {
      found.add(inline.type);
      continue;
    }
    const types = new Set<string>();
    for (const mark of inline.marks) {
      if (!(mark.type in editorSchema.marks) || types.has(mark.type)) {
        found.add(`mark:${mark.type}`);
      }
      types.add(mark.type);
    }
  }
}

/**
 * One stored mark as the editor holds it: the same members, less the discriminator the editor keeps
 * in the mark's type. A member the stored form leaves out - a `hyperlink` with no `title` - takes the
 * schema's default of null, which `markOf` writes back out as absence rather than as null.
 */
function toMark(mark: Mark): EditorMark {
  const { type, ...attrs } = mark;
  return editorSchema.marks[type]!.create(attrs);
}

/**
 * One stored run as the editor holds it, or nothing where it has no text. ProseMirror refuses an
 * empty text node, and the stored form has no room for one either: `parseContentDocument` drops a
 * run with no value (issue #154), so nothing this mapping is handed after a parse can carry one and
 * the drop is an identity rather than a loss.
 */
function toRun(inline: InlineNode): Node[] {
  const text = inline as Extract<InlineNode, { type: 'text' }>;
  if (text.value === '') return [];
  return [editorSchema.text(text.value, text.marks.map(toMark))];
}

/**
 * The stored document as the editor holds it. Total over what it accepts and refuses the rest by name,
 * so opening never loses anything: a component holding a list, an equation or a mark this schema has
 * no counterpart for opens read-only, saying why, rather than being edited into something without them.
 */
export function toEditor(document: ContentDocument): Opened {
  const unsupported = unsupportedIn(document.content);
  if (unsupported.length > 0) return { editable: false, unsupported };
  return {
    editable: true,
    doc: editorSchema.node(
      'doc',
      { title: document.title, language: document.language, direction: document.direction },
      nodesOf(document.content),
    ),
  };
}

/** One stored block sequence as the editor holds it, and the recursion a list item opens. */
function nodesOf(blocks: readonly BlockNode[]): Node[] {
  return blocks.map(nodeOf);
}

function nodeOf(block: BlockNode): Node {
  switch (block.type) {
    case 'paragraph':
      return editorSchema.node(
        'paragraph',
        { id: block.id, style: block.style },
        block.content.flatMap(toRun),
      );
    case 'list':
      return block.kind === 'definition' ? definitionListOf(block) : countedListOf(block);
    case 'preformatted':
      // ProseMirror refuses an empty text node, so an empty block has no child at all.
      return editorSchema.node(
        'preformatted',
        { id: block.id, language: block.language ?? null },
        block.text === '' ? [] : [editorSchema.text(block.text)],
      );
    case 'blockquote':
      // **Always** an attribution node, empty where none is stored: it is where an author types one,
      // and `storedBlock` spells an empty one back as absence.
      return editorSchema.node('blockquote', { id: block.id }, [
        ...nodesOf(block.content),
        editorSchema.node('attribution', null, (block.attribution ?? []).flatMap(toRun)),
      ]);
    case 'table':
      // Two nodes for one (tables 1, ruling R1): the caption above a `prosemirror-tables` table. Key
      // columns and the note ride on the figure untouched, and absent is null here, as a list's start
      // is.
      return editorSchema.node(
        'tableFigure',
        {
          id: block.id,
          style: block.style,
          headerRows: block.headerRows,
          headerColumns: block.headerColumns,
          keyColumns: block.keyColumns ?? null,
          note: block.note ?? null,
        },
        [
          editorSchema.node('tableCaption', null, block.caption.flatMap(toRun)),
          tableOf(
            block.rows.map((row) => ({
              cells: row.cells.map((cell) => ({
                content: nodesOf(cell.content),
                colspan: cell.colspan,
                rowspan: cell.rowspan,
              })),
            })),
            block.headerRows,
            block.headerColumns,
          ),
        ],
      );
    case 'figure':
      // Two nodes for one (figures 2, ruling R1): the figure with its asset version, image style and
      // alternative text, and the caption below the image.
      return editorSchema.node(
        'figure',
        {
          id: block.id,
          asset: block.asset,
          imageStyle: block.imageStyle,
          alternative: block.alternative,
        },
        [editorSchema.node('figureCaption', null, block.caption.flatMap(toRun))],
      );
    default:
      // Unreachable: `toEditor` refuses a block with no node before it builds anything, and this is
      // what keeps it that way. A family given a node in the schema and forgotten here is named
      // rather than opened as something else.
      throw new Error(`Block ${block.id} is a ${block.type}, which this editor cannot open`);
  }
}

/**
 * A numbered or bulleted list. Its `start` and `format` are absent in the stored form and null in
 * the editor's, which is the same bargain `toMark` strikes with a hyperlink's title, and `fromEditor`
 * spells back as absence.
 */
function countedListOf(list: Extract<BlockNode, { type: 'list' }>): Node {
  return editorSchema.node(
    'list',
    {
      id: list.id,
      kind: list.kind,
      start: list.start ?? null,
      format: list.format ?? null,
    },
    list.items.map((item) => editorSchema.node('listItem', null, nodesOf(item.content))),
  );
}

/**
 * A definition list. The stored model holds one `list` node of three kinds and the editor holds two
 * node types, because a ProseMirror content expression is fixed per type and a definition item opens
 * with the term it defines (ADR-0025, "the editor schema is not the stored model one for one"). This is
 * where the two spellings meet, and `storedBlock` widens `definitionList` back to `kind: 'definition'`.
 *
 * An item whose term is absent gets the empty `term` node an author types into. The editor always
 * has the node, because that is where their cursor goes; what is optional is what reaches the store.
 */
function definitionListOf(list: Extract<BlockNode, { type: 'list' }>): Node {
  return editorSchema.node(
    'definitionList',
    { id: list.id },
    list.items.map((item) =>
      editorSchema.node('definitionItem', null, [
        editorSchema.node('term', null, (item.term ?? []).flatMap(toRun)),
        ...nodesOf(item.content),
      ]),
    ),
  );
}

/**
 * One editor mark as the stored model holds it.
 *
 * **An attribute reading null is omitted, never written.** Every mark schema is a `strictObject` and
 * an optional member - a `hyperlink`'s `title` - is `z.string().min(1).optional()`, which admits the
 * member's absence and refuses both null and the empty string; the editor has no absence to spell,
 * so a mark with no title carries `title: null` instead and this is where the two meet. Dropping
 * every null rather than `title` alone is the safe direction: a member the stored form requires is
 * refused by name by `markSchema` whether it arrives null or absent, while a member it only allows
 * is the one that has to be absent.
 *
 * A title typed as the empty string is a different case and is **not** turned into absence here: it
 * is refused, by the schema, when the document is saved. Refusing it when it is typed, in words the
 * author reads, belongs to the link prompt.
 */
function markOf(mark: EditorMark): unknown {
  const members: Record<string, unknown> = { type: mark.type.name };
  for (const [name, value] of Object.entries(mark.attrs)) {
    if (value !== null) members[name] = value;
  }
  return members;
}

/**
 * The runs of one paragraph as the stored model holds them: one run per text node, carrying its marks.
 *
 * It cannot read `textContent`, which joins every text node into one string: two adjacent runs whose
 * marks differ do not merge in ProseMirror, and joining them would throw the marks away. The runs
 * come back in the editor's order, and each run's marks in the **schema's** declaration order, which
 * `Mark.setFrom` sorts by; canonicalisation treats a run's marks as a set, so that order is never a
 * spurious version. `parseContentDocument` merges back any two adjacent runs the editor left split
 * carrying one mark set, so what this returns has one stored spelling (issue #154).
 *
 * A child that is not a text node is **refused by name**, as a block with no identifier is, rather
 * than coerced into a run with no text. Today the schema's `paragraph` holds `text*` and nothing
 * else can get in; the day it holds an image or a footnote, this says which node has no run yet
 * instead of storing a document quietly missing it.
 *
 * **`id` here is an identifier, where `storedBlock`'s identically worded message carries a path.**
 * The two cannot be merged: this one is raised from inside a block that is known to have an
 * identifier, and that one from a node that may have none and so has nothing but its position to be
 * named by. So `Block D1 holds a node this editor cannot store: x` is this message and
 * `Block 0.0.0 holds ...` is that one. For a term, `id` is the **list's**, because a term has no
 * identifier of its own and the list is the nearest real thing to point an author at - the same
 * answer publishing gives a failure inside a term.
 */
function runsOf(textblock: Node, id: string): unknown[] {
  const runs: unknown[] = [];
  textblock.forEach((child) => {
    if (child.type.name !== 'text') {
      throw new Error(`Block ${id} holds a node this editor cannot store: ${child.type.name}`);
    }
    runs.push({ type: 'text', value: child.text, marks: child.marks.map(markOf) });
  });
  return runs;
}

/**
 * The editor's document as the stored model holds it, through `parseContentDocument` - so what the
 * renderer sends has already met every rule the service will apply again (component-editor.md,
 * "Invariants the editor holds"). A block with no identifier is refused here, and never reaches storage.
 */
export function fromEditor(doc: Node): ContentDocument {
  return parseContentDocument({
    schemaVersion: 1,
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as string,
    content: storedBlocks(doc, ''),
  });
}

/**
 * The blocks of one parent as the stored model holds them, each labelled with where it stands: `2`
 * at the top level, `2.0.1` for the second block of the first item of the list at `2`. A block with
 * no identifier has no other name to be refused under, and at depth an index alone would say almost
 * nothing about which block an author should look at.
 *
 * `from` skips the children that are not blocks. A definition item opens with its term, so its body
 * starts at 1 - and the body's own labels start at 0, because the term is not a block and counting
 * it would make every message in a definition list one out.
 */
function storedBlocks(parent: Node, within: string, from = 0): unknown[] {
  const blocks: unknown[] = [];
  parent.forEach((child, _offset, index) => {
    if (index < from) return;
    const at = index - from;
    blocks.push(storedBlock(child, within === '' ? String(at) : `${within}.${at}`));
  });
  return blocks;
}

/** One block's identifier, or a refusal naming where the block with none stands. */
function identifierOf(node: Node, at: string): string {
  const id: unknown = node.attrs.id;
  if (typeof id !== 'string') throw new Error(`Block ${at} has no identifier`);
  return id;
}

/**
 * One editor block as the stored model holds it, and the recursion `toEditor` opened.
 *
 * A node type this mapping has no stored shape for is **refused by name**, exactly as a child a
 * paragraph cannot hold is in `runsOf`, rather than skipped. Skipping is the failure the whole
 * mapping is arranged against: it would save a component quietly missing what the author wrote.
 */
function storedBlock(node: Node, at: string): unknown {
  switch (node.type.name) {
    case 'paragraph': {
      const id = identifierOf(node, at);
      return {
        type: 'paragraph',
        id,
        style: node.attrs.style as string,
        content: runsOf(node, id),
      };
    }
    case 'list': {
      const id = identifierOf(node, at);
      const items: unknown[] = [];
      node.forEach((item, _offset, index) => {
        items.push({ content: storedBlocks(item, `${at}.${index}`) });
      });
      // **An attribute reading null is omitted, never written**, for the reason `markOf` gives: the
      // stored shape is strict and admits the member's absence rather than null. `start` is written
      // where it is 0, which is a start a decimal list may have (CNT-153) and not an absence.
      return {
        type: 'list',
        id,
        kind: node.attrs.kind as string,
        ...(node.attrs.start === null ? {} : { start: node.attrs.start }),
        ...(node.attrs.format === null ? {} : { format: node.attrs.format }),
        items,
      };
    }
    case 'definitionList': {
      const id = identifierOf(node, at);
      const items: unknown[] = [];
      node.forEach((item, _offset, index) => {
        const opening = item.child(0);
        if (opening.type.name !== 'term') {
          // The item's own path, not the list's: a list may hold many items and only one of them
          // is wrong, and an item carries no identifier of its own to be named by.
          throw new Error(`Item ${at}.${index} does not open with its term`);
        }
        // **Judged on what `runsOf` returned, never on what the term node holds.** A term the
        // author has not typed into is no term at all and its member is left out: `term: []` is a
        // second spelling of absent, which `listNodeSchema` refuses and one document may not have
        // two digests of. Absent rather than refused because an author who writes the definition
        // before the word is mid-edit, not in error, and the only message an iteration save can
        // give them names nothing (`checkBlock`, and CNT-124's empty paragraph before it).
        const term = runsOf(opening, id);
        items.push({
          ...(term.length === 0 ? {} : { term }),
          content: storedBlocks(item, `${at}.${index}`, 1),
        });
      });
      // One stored `list` of three kinds, out of the editor's two node types: this is the join.
      return { type: 'list', id, kind: 'definition', items };
    }
    case 'preformatted': {
      const id = identifierOf(node, at);
      // `textContent` is safe here where `runsOf` could not use it: the node admits no mark, so
      // there are no runs to lose by joining.
      return {
        type: 'preformatted',
        id,
        text: node.textContent,
        ...(node.attrs.language === null ? {} : { language: node.attrs.language }),
      };
    }
    case 'blockquote': {
      const id = identifierOf(node, at);
      const content: unknown[] = [];
      let attribution: unknown[] = [];
      node.forEach((child, _offset, index) => {
        if (child.type.name === 'attribution') attribution = runsOf(child, id);
        else content.push(storedBlock(child, `${at}.${index}`));
      });
      // **Judged on what `runsOf` returned**, as a term is: an attribution nobody has typed is no
      // attribution, and `attribution: []` is a second spelling of absent the walk refuses.
      return {
        type: 'blockquote',
        id,
        content,
        ...(attribution.length === 0 ? {} : { attribution }),
      };
    }
    case 'tableFigure': {
      const id = identifierOf(node, at);
      const rows: unknown[] = [];
      node.child(1).forEach((row, _offset, rowIndex) => {
        const cells: unknown[] = [];
        row.forEach((cell, _cellOffset, cellIndex) => {
          cells.push({
            content: storedBlocks(cell, `${at}.${rowIndex}.${cellIndex}`),
            colspan: cell.attrs.colspan as number,
            rowspan: cell.attrs.rowspan as number,
          });
        });
        rows.push({ cells });
      });
      // **The counts, never the cells' kinds** (ruling R2): what the model stores is two numbers.
      return {
        type: 'table',
        id,
        style: node.attrs.style as string,
        caption: runsOf(node.child(0), id),
        headerRows: node.attrs.headerRows as number,
        headerColumns: node.attrs.headerColumns as number,
        ...(node.attrs.keyColumns === null ? {} : { keyColumns: node.attrs.keyColumns }),
        ...(node.attrs.note === null ? {} : { note: node.attrs.note }),
        rows,
      };
    }
    case 'figure': {
      const id = identifierOf(node, at);
      return {
        type: 'figure',
        id,
        asset: node.attrs.asset as string,
        imageStyle: node.attrs.imageStyle as string,
        caption: runsOf(node.child(0), id),
        alternative: node.attrs.alternative as object,
      };
    }
    default:
      throw new Error(`Block ${at} holds a node this editor cannot store: ${node.type.name}`);
  }
}
