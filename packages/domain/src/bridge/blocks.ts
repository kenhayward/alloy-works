import type {
  Block,
  Cell,
  DecomposedImage,
  Equation,
  Inline,
  Note,
  Table,
} from '@kenhayward/bridge-contract';

import { sanitiseMathml } from '../content/admission/mathml.js';
import {
  allowedLinkSchemes,
  type BlockNode,
  type CrossReferenceTarget,
  type InlineNode,
  type Mark,
} from '../content/model/index.js';

import { elementIdFor } from './ids.js';
import { noteMarkers } from './markers.js';
import { carry, type CarryEntry } from './report.js';

/** A decomposed block, as the contract's schema reads it. */
export type DecomposedBlock = Block;
/** A decomposed note: blocks, which a footnote holds as paragraphs. */
export type DecomposedNote = Note;
/** What a cross-reference points at, as the model stores it: the block, component or node a CT element became. */
export type CrossTarget = CrossReferenceTarget;

/**
 * What a mapping reads besides the blocks. `assets` is a CT Studio image id to the asset version it
 * became, `targets` a CT Studio element id to the model target a reference to it takes; `images` and
 * `equations` are the delivery's own lists by id, which a figure's alternative and an equation's MathML
 * are read from, and `notes` its notes.
 */
export type BlockContext = {
  owner: string;
  assets: ReadonlyMap<string, string>;
  targets: ReadonlyMap<string, CrossTarget>;
  notes: ReadonlyMap<string, DecomposedNote>;
  images: ReadonlyMap<string, DecomposedImage>;
  equations: ReadonlyMap<string, Equation>;
};

type Paragraph = Extract<BlockNode, { type: 'paragraph' }>;
type TableNode = Extract<BlockNode, { type: 'table' }>;
type Footnote = Extract<InlineNode, { type: 'footnote' }>;
type Alternative = Extract<BlockNode, { type: 'figure' }>['alternative'];

const BREAK = Symbol('break');
type Piece = InlineNode | typeof BREAK;

/** Strings in NFC, with the C0 controls but tab and newline removed. */
function clean(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code > 0x1f || code === 0x09 || code === 0x0a;
    })
    .join('')
    .normalize('NFC');
}

const MARKS = {
  bold: 'strong',
  italic: 'emphasis',
  underline: 'underline',
  superscript: 'superscript',
  subscript: 'subscript',
} as const;

/** What a superscript run in a cell is read against: the table's notes, and which cell each belongs to. */
type CellScope = {
  known: ReadonlySet<string>;
  /** The notes anchored to a cell, by marker: where they are, and whether they have been placed. */
  anchors: Map<string, { row: number; column: number; footnote: Footnote; placed: boolean }>;
  row: number;
  column: number;
};

type Options = {
  /** The CT Studio element a report names. */
  element: string;
  /** A break splits a paragraph; in a title or a caption it is a space. */
  breaks: 'split' | 'space';
  /** Inside a note, where an image and a note reference have no place. */
  note: boolean;
  /** The marks an enclosing link has put on every run inside it. */
  outer: Mark[];
  cell?: CellScope | undefined;
};

/** Where a mapping stands inside a table: its cell, if any. */
type Scope = { cell?: CellScope | undefined };

class Mapping {
  readonly carried: CarryEntry[] = [];
  private readonly noteUses = new Map<string, number>();

  constructor(private readonly context: BlockContext) {}

  private id(key: string): string {
    return elementIdFor(this.context.owner, key);
  }

  // --- Blocks -----------------------------------------------------------------------------

  blocks(blocks: readonly Block[], scope: Scope): BlockNode[] {
    const mapped = blocks.flatMap((block) => this.block(block, scope));
    // Two empty paragraphs together are refused by the model, and say nothing: one stands.
    return mapped.filter(
      (block, index) => !(isEmpty(block) && index > 0 && isEmpty(mapped[index - 1]!)),
    );
  }

  private block(block: Block, scope: Scope): BlockNode[] {
    switch (block.kind) {
      case 'paragraph':
        return this.paragraphs(block.id, block.inlines, {
          element: block.id,
          breaks: 'split',
          note: false,
          outer: [],
          cell: scope.cell,
        });
      case 'list':
        return [
          {
            type: 'list',
            id: this.id(block.id),
            kind: block.ordered ? 'ordered' : 'unordered',
            items: block.items.map((item, index) => ({
              content: this.within(`${block.id}/${index}`, this.blocks(item.blocks, scope)),
            })),
          },
        ];
      case 'table':
        return [this.table(block)];
      case 'figure': {
        const figure = this.figure(block.id, block.imageId, block.id, null);
        return [
          {
            type: 'figure',
            id: this.id(block.id),
            asset: figure.asset,
            imageStyle: 'figure',
            caption: this.inlines(`${block.id}/caption`, block.caption, 'space', block.id),
            alternative: figure.alternative,
            ...(block.numbered ? {} : { numbered: false as const }),
          },
        ];
      }
      case 'image': {
        const figure = this.figure(block.id, block.imageId, block.id, null);
        return [
          {
            type: 'figure',
            id: this.id(block.id),
            asset: figure.asset,
            imageStyle: 'figure',
            caption: [],
            alternative: figure.alternative,
            numbered: false,
          },
        ];
      }
      case 'equation':
        return [this.equation(block.id, block.equationId)];
      default:
        throw new Error(
          `Block ${(block as { id?: string }).id ?? '?'} is of a type, ${String((block as { kind?: unknown }).kind)}, that has no place in the content model`,
        );
    }
  }

  /** A sequence that must hold a block (a cell, a list item): an empty paragraph where it holds none. */
  private within(key: string, blocks: BlockNode[]): BlockNode[] {
    return blocks.length > 0
      ? blocks
      : [{ type: 'paragraph', id: this.id(`${key}/empty`), style: 'body', content: [] }];
  }

  private paragraphs(key: string, inlines: readonly Inline[], options: Options): Paragraph[] {
    const pieces = this.pieces(key, inlines, options);
    const segments: InlineNode[][] = [[]];
    for (const piece of pieces) {
      if (piece === BREAK) segments.push([]);
      else segments[segments.length - 1]!.push(piece);
    }
    const paragraphs = segments.flatMap((segment, index): Paragraph[] =>
      segment.length === 0
        ? []
        : [
            {
              type: 'paragraph',
              id: this.id(index === 0 ? key : `${key}~${index}`),
              style: 'body',
              content: joinRuns(segment),
            },
          ],
    );
    return paragraphs.length > 0
      ? paragraphs
      : [{ type: 'paragraph', id: this.id(key), style: 'body', content: [] }];
  }

  // --- Figures, equations -----------------------------------------------------------------

  private asset(owner: string, imageId: string): string {
    const asset = this.context.assets.get(imageId);
    if (asset === undefined) throw new Error(`${owner} names image ${imageId}, which has no asset`);
    return asset;
  }

  /** The alternative CT Studio's `alt` becomes: its own text, else inherited and reported. */
  private alternative(imageId: string, element: string, preferred: string | null): Alternative {
    const text = clean(preferred ?? this.context.images.get(imageId)?.alt ?? '').trim();
    if (text !== '') return { kind: 'own', text };
    this.carried.push(carry('alt_missing', element));
    return { kind: 'inherited' };
  }

  private figure(owner: string, imageId: string, element: string, preferred: string | null) {
    return {
      asset: this.asset(`Block ${owner}`, imageId),
      alternative: this.alternative(imageId, element, preferred),
    };
  }

  private equationOf(owner: string, equationId: string): Equation {
    const equation = this.context.equations.get(equationId);
    if (equation === undefined)
      throw new Error(`${owner} names equation ${equationId}, which is not there`);
    return equation;
  }

  /** MathML through the model's own strict reader: what it keeps, or a refusal naming the equation. */
  private mathml(equation: Equation): string | null {
    if (equation.mathml === null) return null;
    const read = sanitiseMathml(equation.mathml);
    if (!read.ok) {
      throw new Error(`Equation ${equation.id} is not MathML the model keeps: ${read.failure}`);
    }
    return read.mathml;
  }

  private equation(id: string, equationId: string): BlockNode {
    const equation = this.equationOf(`Block ${id}`, equationId);
    const mathml = this.mathml(equation);
    if (mathml !== null) {
      const latex = clean(equation.latex ?? '');
      return {
        type: 'equation',
        id: this.id(id),
        mathml,
        ...(latex === '' ? {} : { latex }),
        numbered: false,
      };
    }
    // An image only: a figure of that image, its alternative the equation's text where there is one.
    this.carried.push(carry('equation_image_only', id, equation.id));
    const figure = this.figure(`Block ${id}`, equation.imageId, id, equation.latex);
    return {
      type: 'figure',
      id: this.id(id),
      asset: figure.asset,
      imageStyle: 'figure',
      caption: [],
      alternative: figure.alternative,
      numbered: false,
    };
  }

  // --- Tables -----------------------------------------------------------------------------

  private table(table: Table): TableNode {
    const known = new Set<string>();
    for (const note of table.notes) {
      if (known.has(note.marker)) {
        throw new Error(`Table ${table.id} has two notes with the marker ${note.marker}`);
      }
      known.add(note.marker);
    }
    const starts = gridStarts(table);

    // Which cells name which note, read before any cell is mapped.
    const named = new Map<string, Map<string, { row: number; column: number }>>();
    table.rows.forEach((row, r) =>
      row.cells.forEach((cell, c) => {
        for (const marker of markersIn(cell.blocks, known)) {
          const cells = named.get(marker) ?? new Map();
          cells.set(`${r}.${c}`, { row: r, column: starts[r]![c]! });
          named.set(marker, cells);
        }
      }),
    );

    const anchors: CellScope['anchors'] = new Map();
    const tableNotes: InlineNode[] = [];
    for (const note of table.notes) {
      const cells = named.get(note.marker);
      const key = `${table.id}/note/${note.marker}`;
      if (cells?.size === 1) {
        const [only] = cells.values();
        anchors.set(note.marker, {
          ...only!,
          placed: false,
          footnote: this.footnote(
            key,
            { kind: 'cellPosition', row: only!.row, column: only!.column },
            note.inlines,
            table.id,
          ),
        });
      } else {
        // Plain text in the table's own note (CNT-038): the marker, a space, the note's words. A
        // footnote anchored to the table is one publish refuses.
        const words: Inline[] = [
          { kind: 'text', text: `${note.marker} `, marks: [] },
          ...note.inlines,
        ];
        tableNotes.push(
          ...(tableNotes.length > 0 ? this.text(' ', []) : []),
          ...this.inlines(key, words, 'space', table.id),
        );
        this.carried.push(carry('note_anchored_table', table.id, note.marker));
      }
    }

    const rows = table.rows.map((row, r) => ({
      cells: row.cells.map((cell, c) => {
        const scope: CellScope = { known, anchors, row: r, column: starts[r]![c]! };
        return {
          content: this.within(`${table.id}/${r}.${c}`, this.blocks(cell.blocks, { cell: scope })),
          colspan: cell.colSpan,
          rowspan: cell.rowSpan,
        };
      }),
    }));

    this.presentation(table);
    return {
      type: 'table',
      id: this.id(table.id),
      style: 'table',
      caption: this.inlines(`${table.id}/caption`, table.caption, 'space', table.id),
      headerRows: table.headerRows,
      headerColumns: this.headerColumns(table, starts),
      ...(tableNotes.length > 0 ? { note: joinRuns(tableNotes) } : {}),
      ...(table.numbered ? {} : { numbered: false as const }),
      ...(table.wide ? { wide: 'rotate' as const } : {}),
      rows,
    };
  }

  /** Report what a table carried that a theme owns here (CNT-094). */
  private presentation(table: Table): void {
    const cells = table.rows.flatMap((row) => row.cells);
    const dropped = [
      table.columnWidths.length > 0 ? 'columnWidths' : null,
      cells.some((cell) => cell.hAlign !== 'left') ? 'hAlign' : null,
      cells.some((cell) => cell.vAlign !== 'top') ? 'vAlign' : null,
      table.captionPosition !== 'above' ? 'captionPosition' : null,
    ].filter((name) => name !== null);
    if (dropped.length > 0) {
      this.carried.push(carry('presentation_dropped', table.id, dropped.join(' ')));
    }
  }

  /**
   * Header cells below the header rows are header columns when each leads its row; otherwise they are
   * ordinary cells, and the table says so once.
   */
  private headerColumns(table: Table, starts: number[][]): number {
    let width = 0;
    let stray = 0;
    let leads = true;
    table.rows.forEach((row, r) => {
      if (r < table.headerRows) return;
      let plain = false;
      row.cells.forEach((cell, c) => {
        if (!cell.header) {
          plain = true;
          return;
        }
        stray += 1;
        if (plain) leads = false;
        width = Math.max(width, starts[r]![c]! + cell.colSpan);
      });
    });
    if (stray === 0) return 0;
    if (leads) return width;
    this.carried.push(carry('cell_header_dropped', table.id, `${stray} cells`));
    return 0;
  }

  // --- Inlines ----------------------------------------------------------------------------

  /** Inline content with no paragraph around it (a caption, a title): a break is a space. */
  inlines(key: string, inlines: readonly Inline[], breaks: 'space', element: string): InlineNode[] {
    const pieces = this.pieces(key, inlines, { element, breaks, note: false, outer: [] });
    return joinRuns(pieces.filter((piece): piece is InlineNode => piece !== BREAK));
  }

  private pieces(key: string, inlines: readonly Inline[], options: Options): Piece[] {
    return mergeRuns(inlines, options.cell !== undefined).flatMap((inline, index) =>
      this.piece(`${key}.${index}`, inline, options),
    );
  }

  private text(value: string, marks: Mark[]): InlineNode[] {
    const text = clean(value);
    return text === '' ? [] : [{ type: 'text', value: text, marks }];
  }

  private run(path: string, inline: Extract<Inline, { kind: 'text' }>, options: Options): Piece[] {
    const own = [...new Set(inline.marks)].map((mark): Mark => ({
      type: MARKS[mark],
      id: this.id(`${path}/${MARKS[mark]}`),
    }));
    return this.text(inline.text, [...own, ...options.outer]);
  }

  private piece(path: string, inline: Inline, options: Options): Piece[] {
    switch (inline.kind) {
      case 'text': {
        const cell = options.cell;
        if (cell !== undefined && inline.marks.includes('superscript')) {
          const markers = noteMarkers(clean(inline.text), cell.known);
          if (markers !== undefined && markers.some((marker) => cell.anchors.has(marker))) {
            return this.placeNotes(markers, cell, inline, path, options);
          }
        }
        return this.run(path, inline, options);
      }
      case 'break':
        return options.breaks === 'split' ? [BREAK] : this.text(' ', options.outer);
      case 'note_ref': {
        if (options.note) {
          this.carried.push(carry('note_flattened', options.element, inline.noteId));
          return [];
        }
        return [this.reference(inline.noteId)];
      }
      case 'xref': {
        const target = this.context.targets.get(inline.targetId);
        if (target === undefined) {
          this.carried.push(carry('xref_outside', options.element, inline.targetId));
          return this.text(inline.text, options.outer);
        }
        return [
          {
            type: 'crossReference',
            id: this.id(`${path}/xref`),
            target,
            display: 'number',
          },
        ];
      }
      case 'link': {
        const href = clean(inline.href);
        const scheme = schemeOf(href);
        if (!allowed(scheme)) {
          this.carried.push(carry('link_scheme', options.element, scheme ?? 'none'));
          return this.pieces(path, inline.inlines, options);
        }
        const mark: Mark = { type: 'hyperlink', id: this.id(`${path}/hyperlink`), href };
        return this.pieces(path, inline.inlines, { ...options, outer: [...options.outer, mark] });
      }
      case 'inline_equation': {
        const equation = this.equationOf(`Element ${options.element}`, inline.equationId);
        const mathml = this.mathml(equation);
        if (mathml !== null) {
          const latex = clean(equation.latex ?? '');
          return [{ type: 'equation', mathml, ...(latex === '' ? {} : { latex }) }];
        }
        this.carried.push(carry('equation_image_only', options.element, equation.id));
        return this.image(equation.imageId, options, equation.latex);
      }
      case 'inline_image':
        return this.image(inline.imageId, options, null);
      default:
        throw new Error(
          `Element ${options.element} holds an inline, ${String((inline as { kind?: unknown }).kind)}, that has no place in the content model`,
        );
    }
  }

  private image(imageId: string, options: Options, preferred: string | null): Piece[] {
    if (options.note) {
      // A footnote holds no image (CNT-129): its words, if it has any, stand instead.
      this.carried.push(carry('note_flattened', options.element, imageId));
      const alt = clean(preferred ?? this.context.images.get(imageId)?.alt ?? '').trim();
      return this.text(alt, options.outer);
    }
    return [
      {
        type: 'image',
        asset: this.asset(`Element ${options.element}`, imageId),
        imageStyle: 'inline',
        alternative: this.alternative(imageId, options.element, preferred),
      },
    ];
  }

  // --- Footnotes --------------------------------------------------------------------------

  /** A note reference: the note's content as paragraphs, anything else in it flattened to its text. */
  private reference(noteId: string): Footnote {
    const note = this.context.notes.get(noteId);
    if (note === undefined) throw new Error(`A reference names note ${noteId}, which is not there`);
    const uses = (this.noteUses.get(noteId) ?? 0) + 1;
    this.noteUses.set(noteId, uses);
    const key = uses === 1 ? `note:${noteId}` : `note:${noteId}#${uses}`;
    const options: Options = { element: noteId, breaks: 'split', note: true, outer: [] };
    const content = note.blocks.flatMap((block): Paragraph[] => {
      if (block.kind === 'paragraph') {
        return this.paragraphs(`${key}/${block.id}`, block.inlines, options);
      }
      this.carried.push(carry('note_flattened', noteId, block.kind));
      const words = this.words(block);
      return words === ''
        ? []
        : [
            {
              type: 'paragraph',
              id: this.id(`${key}/${block.id}`),
              style: 'body',
              content: [{ type: 'text', value: words, marks: [] }],
            },
          ];
    });
    return {
      type: 'footnote',
      id: this.id(key),
      anchor: { kind: 'span' },
      content: content.length > 0 ? content : [this.emptyParagraph(key)],
    };
  }

  private footnote(
    key: string,
    anchor: Footnote['anchor'],
    inlines: readonly Inline[],
    element: string,
  ): Footnote {
    const content = this.paragraphs(`${key}/p`, inlines, {
      element,
      breaks: 'split',
      note: true,
      outer: [],
    });
    return { type: 'footnote', id: this.id(key), anchor, content };
  }

  private emptyParagraph(key: string): Paragraph {
    return { type: 'paragraph', id: this.id(`${key}/empty`), style: 'body', content: [] };
  }

  /**
   * A cell's note markers become the footnotes anchored there. A marker of a note the table carries in
   * its own note stays in the cell as the text it was, so a reader can match it to that note.
   */
  private placeNotes(
    markers: readonly string[],
    cell: CellScope,
    run: Extract<Inline, { kind: 'text' }>,
    path: string,
    options: Options,
  ): Piece[] {
    const placed: Piece[] = [];
    const kept: string[] = [];
    for (const marker of markers) {
      const anchored = cell.anchors.get(marker);
      if (anchored === undefined) kept.push(marker);
      else if (!anchored.placed) {
        anchored.placed = true;
        placed.push(anchored.footnote);
      }
    }
    if (kept.length === 0) return placed;
    return [...placed, ...this.run(path, { ...run, text: kept.join(',') }, options)];
  }

  /** A block's text, for a note that holds more than paragraphs. */
  private words(block: Block): string {
    const join = (parts: string[]) => parts.join(' ').replace(/\s+/gu, ' ').trim();
    const inlines = (list: readonly Inline[]): string =>
      join(
        list.map((inline) => {
          switch (inline.kind) {
            case 'text':
              return inline.text;
            case 'xref':
              return inline.text;
            case 'link':
              return inlines(inline.inlines);
            case 'inline_equation':
              return this.context.equations.get(inline.equationId)?.latex ?? '';
            case 'inline_image':
              return this.context.images.get(inline.imageId)?.alt ?? '';
            default:
              return '';
          }
        }),
      );
    switch (block.kind) {
      case 'paragraph':
        return clean(inlines(block.inlines));
      case 'list':
        return join(block.items.flatMap((item) => item.blocks.map((each) => this.words(each))));
      case 'table':
        return join([
          inlines(block.caption),
          ...block.rows.flatMap((row) =>
            row.cells.flatMap((cell) => cell.blocks.map((each) => this.words(each))),
          ),
        ]);
      case 'figure':
        return clean(inlines(block.caption));
      case 'image':
        return clean(this.context.images.get(block.imageId)?.alt ?? '');
      case 'equation':
        return clean(this.context.equations.get(block.equationId)?.latex ?? '');
      default:
        return '';
    }
  }
}

// --- Helpers ----------------------------------------------------------------------------

const isEmpty = (block: BlockNode): boolean =>
  block.type === 'paragraph' && block.content.length === 0;

/** The scheme of a link, or `undefined` where it is no URL. */
function schemeOf(href: string): string | undefined {
  try {
    return new URL(href).protocol;
  } catch {
    return undefined;
  }
}

const allowed = (scheme: string | undefined): boolean =>
  scheme !== undefined && (allowedLinkSchemes as readonly string[]).includes(scheme);

/** Adjacent text runs that carry the same marks are one run, before any identifier is derived. */
function mergeRuns(inlines: readonly Inline[], keepMarkers: boolean): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    const last = merged[merged.length - 1];
    if (
      inline.kind === 'text' &&
      last?.kind === 'text' &&
      !(keepMarkers && inline.marks.includes('superscript')) &&
      [...new Set(last.marks)].sort().join() === [...new Set(inline.marks)].sort().join()
    ) {
      merged[merged.length - 1] = { ...last, text: last.text + inline.text };
    } else {
      merged.push(inline);
    }
  }
  return merged;
}

/** Adjacent text runs with the same marks (identifiers included) are one run, as the model keeps them. */
function joinRuns(nodes: InlineNode[]): InlineNode[] {
  const joined: InlineNode[] = [];
  for (const node of nodes) {
    const last = joined[joined.length - 1];
    if (
      node.type === 'text' &&
      last?.type === 'text' &&
      JSON.stringify(last.marks) === JSON.stringify(node.marks)
    ) {
      joined[joined.length - 1] = { ...last, value: last.value + node.value };
    } else {
      joined.push(node);
    }
  }
  return joined;
}

/** The column each cell of each row starts in, a cell placing itself where no row above has spanned. */
function gridStarts(table: Table): number[][] {
  const covered: boolean[][] = table.rows.map(() => []);
  return table.rows.map((row, r) => {
    let column = 0;
    return row.cells.map((cell: Cell) => {
      while (covered[r]![column]) column += 1;
      const start = column;
      for (let down = 0; down < cell.rowSpan && r + down < table.rows.length; down += 1) {
        for (let across = 0; across < cell.colSpan; across += 1)
          covered[r + down]![start + across] = true;
      }
      column += cell.colSpan;
      return start;
    });
  });
}

/** The notes a cell's superscript runs name, at any depth of lists, in order. */
function markersIn(blocks: readonly Block[], known: ReadonlySet<string>): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'list') return block.items.flatMap((item) => markersIn(item.blocks, known));
    if (block.kind !== 'paragraph') return [];
    return block.inlines.flatMap((inline) =>
      inline.kind === 'text' && inline.marks.includes('superscript')
        ? [...(noteMarkers(clean(inline.text), known) ?? [])]
        : [],
    );
  });
}

// --- Entry points -----------------------------------------------------------------------

/**
 * Maps a sequence of decomposed blocks to content blocks, and says what it carried over (API-073).
 * Every identifier is derived (API-070); what the model refuses it refuses afterwards, in
 * `parseContentDocument`, and what only the mapping can see it refuses here with an `Error` naming the
 * element, for the caller to report as `content_rejected` (IMP-N03).
 */
export function mapBlocks(
  blocks: readonly DecomposedBlock[],
  context: BlockContext,
): { blocks: BlockNode[]; carried: CarryEntry[] } {
  const mapping = new Mapping(context);
  const mapped = mapping.blocks(blocks, {});
  return { blocks: mapped, carried: mapping.carried };
}

/** A section's title: inline content, a break a space. `key` is the CT Studio section id. */
export function mapTitle(
  title: readonly Inline[],
  context: BlockContext,
  key: string,
): { inlines: InlineNode[]; carried: CarryEntry[] } {
  const mapping = new Mapping(context);
  return {
    inlines: mapping.inlines(`${key}/title`, title, 'space', key),
    carried: mapping.carried,
  };
}
