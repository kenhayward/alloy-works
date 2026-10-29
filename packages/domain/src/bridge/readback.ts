import {
  gridForms,
  textForm,
  type Block,
  type DecomposedDocument,
  type Inline,
  type Section,
  type Table,
} from '@kenhayward/bridge-contract';

import type { BlockNode, ContentDocument, InlineNode } from '../content/model/index.js';
import type { OutlineDocument } from '../structure/outline.js';

import { sanitiseMathml } from '../content/admission/mathml.js';
import { componentIdFor, elementIdFor } from './ids.js';
import { noteMarkers } from './markers.js';
import type { CarryEntry } from './report.js';

/** The section key the lead component is named by, as document.ts names it. */
const LEAD = '~lead';
/** How much of a differing unit a detail quotes. */
const QUOTED = 80;

/** What a read-back says (the contract's `receipt.document.readBack`). */
export type ReadBack = { ok: boolean; at: string | null; detail: string | null };

/** What was stored, read back: the outline, and each component's content by its artifact. */
export type WrittenDocument = {
  persistentId: string;
  outline: OutlineDocument;
  components: ReadonlyMap<string, ContentDocument>;
  /** CT Studio's image id to the asset version it became. */
  assets: ReadonlyMap<string, string>;
  carried: readonly CarryEntry[];
};

type TableNode = Extract<BlockNode, { type: 'table' }>;
type Alternative = Extract<BlockNode, { type: 'figure' }>['alternative'];
type OutlineNode = OutlineDocument['nodes'][number];

const nfc = (value: string) => value.normalize('NFC');

/** The breaks a run of inlines holds, those inside a link too: a paragraph splits at each. */
function breaksIn(inlines: readonly Inline[]): number {
  return inlines.reduce(
    (count, inline) =>
      count + (inline.kind === 'break' ? 1 : inline.kind === 'link' ? breaksIn(inline.inlines) : 0),
    0,
  );
}

/** The superscript runs of a cell, at any depth of lists, in order. */
function superscriptsIn(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'list') return block.items.flatMap((item) => superscriptsIn(item.blocks));
    if (block.kind !== 'paragraph') return [];
    return block.inlines.flatMap((inline) =>
      inline.kind === 'text' && inline.marks.includes('superscript') ? [nfc(inline.text)] : [],
    );
  });
}

/**
 * What the identifiers the mapping derived stand for, worked out from the package by deriving them
 * again (ids.ts): which stored paragraph continues another (a break splits one), which footnote is
 * which note or which table note, which table and which equation each stored block was. Only
 * identities come from here; every word compared comes from what was stored.
 */
class Index {
  /** A paragraph made after a break, to the paragraph its text began in. */
  readonly continues = new Map<string, string>();
  /** A footnote made from a note reference, to the note. */
  readonly notes = new Map<string, string>();
  /** A footnote anchored to a cell, to its table and marker, and the superscript run it was read from. */
  readonly anchored = new Map<
    string,
    { table: string; marker: string; run: string | null; known: ReadonlySet<string> }
  >();
  readonly tables = new Map<string, Table>();
  /** A block that was an image-only equation, stored as a figure. */
  readonly equationBlocks = new Set<string>();
  /** The asset versions of image-only equations, with each one's alternative text. */
  readonly equationImages = new Map<string, Set<string>>();

  constructor(document: DecomposedDocument, persistentId: string) {
    const references = new Map<string, number>();
    const countRefs = (inlines: readonly Inline[]) => {
      for (const inline of inlines) {
        if (inline.kind === 'note_ref') {
          references.set(inline.noteId, (references.get(inline.noteId) ?? 0) + 1);
        }
        if (inline.kind === 'link') countRefs(inline.inlines);
      }
    };
    const owned: { section: string; blocks: readonly Block[] }[] = [
      { section: LEAD, blocks: document.blocks },
    ];
    const collect = (sections: readonly Section[]) => {
      for (const section of sections) {
        owned.push({ section: section.id, blocks: section.blocks });
        countRefs(section.title);
        collect(section.sections);
      }
    };
    collect(document.sections);
    const walkRefs = (blocks: readonly Block[]) => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') countRefs(block.inlines);
        if (block.kind === 'figure') countRefs(block.caption);
        if (block.kind === 'list') for (const item of block.items) walkRefs(item.blocks);
        if (block.kind === 'table') {
          countRefs(block.caption);
          for (const row of block.rows) for (const cell of row.cells) walkRefs(cell.blocks);
        }
      }
    };
    for (const { blocks } of owned) walkRefs(blocks);

    for (const { section, blocks } of owned) {
      const owner = componentIdFor(persistentId, section);
      const id = (key: string) => elementIdFor(owner, key);
      const paragraph = (key: string, inlines: readonly Inline[]) => {
        for (let index = 1; index <= breaksIn(inlines); index += 1) {
          this.continues.set(id(`${key}~${index}`), id(key));
        }
      };
      const walk = (items: readonly Block[], inCell: boolean) => {
        for (const block of items) {
          if (block.kind === 'paragraph') paragraph(block.id, block.inlines);
          if (block.kind === 'list') for (const item of block.items) walk(item.blocks, inCell);
          if (inCell) continue;
          if (block.kind === 'equation') this.equationBlocks.add(id(block.id));
          if (block.kind === 'table') this.table(block, id, paragraph, walk);
        }
      };
      walk(blocks, false);
      for (const note of document.notes) {
        for (let use = 1; use <= (references.get(note.id) ?? 0); use += 1) {
          const key = use === 1 ? `note:${note.id}` : `note:${note.id}#${use}`;
          this.notes.set(id(key), note.id);
          for (const block of note.blocks) {
            if (block.kind === 'paragraph') paragraph(`${key}/${block.id}`, block.inlines);
          }
        }
      }
    }
  }

  private table(
    table: Table,
    id: (key: string) => string,
    paragraph: (key: string, inlines: readonly Inline[]) => void,
    walk: (items: readonly Block[], inCell: boolean) => void,
  ): void {
    this.tables.set(id(table.id), table);
    const known = new Set(table.notes.map((note) => note.marker));
    // The cells naming each marker, and the first superscript run naming it in each.
    const named = new Map<string, Map<string, string>>();
    table.rows.forEach((row, r) =>
      row.cells.forEach((cell, c) => {
        for (const run of superscriptsIn(cell.blocks)) {
          for (const marker of noteMarkers(run, known) ?? []) {
            const cells = named.get(marker) ?? new Map<string, string>();
            if (!cells.has(`${r}.${c}`)) cells.set(`${r}.${c}`, run);
            named.set(marker, cells);
          }
        }
        walk(cell.blocks, true);
      }),
    );
    for (const note of table.notes) {
      const key = `${table.id}/note/${note.marker}`;
      const cells = named.get(note.marker);
      const run = cells?.size === 1 ? [...cells.values()][0]! : null;
      this.anchored.set(id(key), { table: table.id, marker: note.marker, run, known });
      paragraph(`${key}/p`, note.inlines);
    }
  }
}

/** A view of what was stored, in the decomposed shape, so the contract's forms read it as they read a package. */
class View {
  private readonly images: DecomposedDocument['images'] = [];
  private readonly equations: DecomposedDocument['equations'] = [];
  /** Each note's content as the first footnote of it stored holds it. */
  private readonly noteContent = new Map<string, Block[]>();
  /** Each anchored table note's content, by table and marker. */
  private readonly anchoredContent = new Map<string, Inline[]>();

  constructor(
    private readonly index: Index,
    private readonly stored: WrittenDocument,
    private readonly untitled: ReadonlySet<string>,
  ) {}

  document(package_: DecomposedDocument): DecomposedDocument {
    const blocks: Block[] = [];
    const sections: Section[] = [];
    for (const node of this.stored.outline.nodes) {
      if (node.type === 'reference') blocks.push(...this.component(node.component));
      else sections.push(this.section(node));
    }
    return {
      blocks,
      sections,
      images: this.images,
      equations: this.equations,
      notes: package_.notes.map((note) => ({
        id: note.id,
        blocks: this.noteContent.get(note.id) ?? [],
      })),
      properties: [],
      report: [],
    };
  }

  private section(node: Extract<OutlineNode, { type: 'section' }>): Section {
    const blocks: Block[] = [];
    const sections: Section[] = [];
    for (const child of node.children) {
      if (child.type === 'reference') blocks.push(...this.component(child.component));
      else sections.push(this.section(child));
    }
    return {
      id: node.id,
      title: this.untitled.has(node.id) ? [] : this.inlines(node.title),
      blocks,
      sections,
    };
  }

  private component(id: string): Block[] {
    const content = this.stored.components.get(id);
    return content === undefined ? [] : this.blocks(content.content);
  }

  private blocks(nodes: readonly BlockNode[]): Block[] {
    const out: Block[] = [];
    // The paragraph a break-split one continues, by the paragraph its text began in.
    let last = null as { base: string; inlines: Inline[] } | null;
    for (const node of nodes) {
      if (node.type === 'paragraph') {
        const base = this.index.continues.get(node.id);
        const inlines = this.inlines(node.content);
        if (base !== undefined && last?.base === base) {
          last.inlines.push({ kind: 'break' }, ...inlines);
          continue;
        }
        last = { base: base ?? node.id, inlines };
        out.push({ kind: 'paragraph', id: node.id, inlines });
        continue;
      }
      last = null;
      const block = this.block(node);
      if (block !== null) out.push(block);
    }
    return out;
  }

  private block(node: BlockNode): Block | null {
    switch (node.type) {
      case 'list':
        return {
          kind: 'list',
          id: node.id,
          ordered: node.kind === 'ordered',
          items: node.items.map((item) => ({ blocks: this.blocks(item.content) })),
        };
      case 'table':
        return this.table(node);
      case 'figure':
        if (this.index.equationBlocks.has(node.id)) {
          return { kind: 'equation', id: node.id, equationId: this.equation(null, node.asset) };
        }
        return {
          kind: 'figure',
          id: node.id,
          imageId: this.image(node.alternative),
          numbered: node.numbered !== false,
          caption: this.inlines(node.caption),
          captionPosition: 'below',
        };
      case 'equation':
        return { kind: 'equation', id: node.id, equationId: this.equation(node.mathml) };
      default:
        return null;
    }
  }

  private table(node: TableNode): Table {
    const source = this.index.tables.get(node.id);
    const rows = node.rows.map((row) => ({
      cells: row.cells.map((cell) => ({
        rowSpan: cell.rowspan,
        colSpan: cell.colspan,
        hAlign: 'left' as const,
        vAlign: 'top' as const,
        header: false,
        blocks: this.blocks(cell.content),
      })),
    }));
    return {
      kind: 'table',
      id: source?.id ?? node.id,
      numbered: node.numbered !== false,
      caption: this.inlines(node.caption),
      captionPosition: 'above',
      columnWidths: [],
      headerRows: node.headerRows,
      rows,
      notes: source === undefined ? [] : this.tableNotes(source, node.note ?? []),
      wide: node.wide !== undefined,
      key: null,
    };
  }

  /**
   * A table's notes in the package's order: an anchored one's words from its footnote, the others'
   * from the table's own note, which runs them on as marker, space, words.
   */
  private tableNotes(source: Table, note: readonly InlineNode[]): Table['notes'] {
    const inTable = source.notes.filter(
      (each) => !this.anchoredContent.has(`${source.id}\0${each.marker}`),
    );
    const text = this.text(note);
    const words = new Map<string, string>();
    let at = 0;
    inTable.forEach((each, position) => {
      const start = text.indexOf(`${each.marker} `, at);
      if (start < 0) return;
      const next = inTable[position + 1];
      const end = next === undefined ? -1 : text.indexOf(` ${next.marker} `, start);
      words.set(each.marker, text.slice(start + each.marker.length + 1, end < 0 ? undefined : end));
      at = end < 0 ? text.length : end + 1;
    });
    return source.notes.map((each) => ({
      marker: each.marker,
      inlines: this.anchoredContent.get(`${source.id}\0${each.marker}`) ?? [
        { kind: 'text', text: words.get(each.marker) ?? '', marks: [] },
      ],
    }));
  }

  private inlines(nodes: readonly InlineNode[]): Inline[] {
    const out: Inline[] = [];
    // The superscript runs given back for footnotes anchored to a cell, and the markers each named.
    const given = new Set<string>();
    let restored: ReadonlySet<string> | null = null;
    for (const node of nodes) {
      const after = restored;
      restored = null;
      switch (node.type) {
        case 'text': {
          // The markers the mapping kept beside the footnotes it placed: already in the run given back.
          if (after !== null && node.marks.some((mark) => mark.type === 'superscript')) {
            const kept = noteMarkers(node.value, after);
            if (kept !== undefined) break;
          }
          out.push({ kind: 'text', text: node.value, marks: [] });
          break;
        }
        case 'crossReference':
          out.push({ kind: 'xref', targetId: targetKey(node.target), text: '' });
          break;
        case 'equation':
          out.push({ kind: 'inline_equation', equationId: this.equation(node.mathml) });
          break;
        case 'image':
          if (this.isEquationImage(node.asset, node.alternative)) {
            out.push({ kind: 'inline_equation', equationId: this.equation(null, node.asset) });
          } else {
            out.push({ kind: 'inline_image', imageId: this.image(node.alternative) });
          }
          break;
        case 'footnote': {
          const anchored = this.index.anchored.get(node.id);
          if (node.anchor.kind === 'cellPosition' && anchored !== undefined) {
            this.anchoredContent.set(
              `${anchored.table}\0${anchored.marker}`,
              this.joined(this.blocks(node.content as BlockNode[])),
            );
            const run = anchored.run ?? anchored.marker;
            if (!given.has(run)) {
              given.add(run);
              out.push({ kind: 'text', text: run, marks: ['superscript'] });
            }
            restored = anchored.known;
            break;
          }
          const note = this.index.notes.get(node.id) ?? node.id;
          if (!this.noteContent.has(note)) {
            this.noteContent.set(note, this.blocks(node.content as BlockNode[]));
          }
          out.push({ kind: 'note_ref', noteId: note });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** A footnote's paragraphs as one run of inlines, a break between each. */
  private joined(blocks: readonly Block[]): Inline[] {
    return blocks.flatMap((block, index): Inline[] => {
      const inlines = block.kind === 'paragraph' ? block.inlines : [];
      return index === 0 ? inlines : [{ kind: 'break' }, ...inlines];
    });
  }

  /** Inline content as its text form reads it, for a table's own note. */
  private text(nodes: readonly InlineNode[]): string {
    return nodes.map((node) => (node.type === 'text' ? node.value : '')).join('');
  }

  private image(alternative: Alternative): string {
    const id = `view-image-${this.images.length}`;
    this.images.push({
      id,
      contentType: 'image/png',
      widthMm: 0,
      heightMm: 0,
      align: 'inline',
      alt: alternative.kind === 'own' ? alternative.text : null,
      origin: 'embedded',
      originalContentType: null,
    });
    return id;
  }

  /** An equation of the view: its MathML, or for an image-only one the asset version it shows. */
  private equation(mathml: string | null, asset?: string): string {
    const id = `view-equation-${this.equations.length}`;
    this.equations.push({
      id,
      mathml,
      latex: null,
      imageId: asset === undefined ? id : assetKey(asset),
    });
    return id;
  }

  /** An inline image that was an image-only equation: its asset is one, and its alternative the equation's text. */
  private isEquationImage(asset: string, alternative: Alternative): boolean {
    const texts = this.index.equationImages.get(asset);
    if (texts === undefined) return false;
    return texts.has(alternative.kind === 'own' ? alternative.text : '');
  }
}

const quote = (unit: string | undefined) =>
  unit === undefined
    ? 'nothing'
    : JSON.stringify(unit.length > QUOTED ? `${unit.slice(0, QUOTED)}...` : unit);

/** A cross-reference's target as the read-back names it, whichever way the model holds it. */
const targetKey = (target: Extract<InlineNode, { type: 'crossReference' }>['target']): string =>
  target.kind === 'node' ? `node:${target.node}` : `block:${'block' in target ? target.block : ''}`;

/** An image-only equation's image as the read-back names it: the asset version it became. */
const assetKey = (asset: string) => `asset:${asset}`;

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'list',
  'table',
  'figure',
  'equation',
]);

/** The block identifiers the stored components hold, and the lead's first in document order. */
function storedBlocks(stored: WrittenDocument): { all: Set<string>; leadFirst: string | null } {
  const walk = (value: unknown, into: string[]) => {
    if (Array.isArray(value)) {
      for (const each of value) walk(each, into);
    } else if (typeof value === 'object' && value !== null) {
      const node = value as { type?: unknown; id?: unknown };
      if (typeof node.id === 'string' && BLOCK_TYPES.has(String(node.type))) into.push(node.id);
      for (const each of Object.values(value)) walk(each, into);
    }
  };
  const all = new Set<string>();
  for (const content of stored.components.values()) {
    const ids: string[] = [];
    walk(content.content, ids);
    for (const id of ids) all.add(id);
  }
  const lead: string[] = [];
  walk(stored.components.get(componentIdFor(stored.persistentId, LEAD))?.content ?? [], lead);
  return { all, leadFirst: lead[0] ?? null };
}

/**
 * The package as the mapping meant to store it, for the forms to compare: each cross-reference's target
 * derived as the mapping derives it (document.ts) - a section its node, a block its derived id, a block
 * the mapping dropped or flattened its section's node or the lead's first block - and one with no
 * target there as its text (`xref_outside`); each equation's MathML as the model's reader keeps it, and
 * an image-only one by the asset version its image became.
 */
function asSent(document: DecomposedDocument, stored: WrittenDocument): DecomposedDocument {
  const { persistentId } = stored;
  const sections = new Set<string>();
  const home = new Map<string, string>();
  const blockIds = (blocks: readonly Block[], section: string) => {
    for (const block of blocks) {
      home.set(block.id, section);
      if (block.kind === 'list') for (const item of block.items) blockIds(item.blocks, section);
      if (block.kind === 'table') {
        for (const row of block.rows) for (const cell of row.cells) blockIds(cell.blocks, section);
      }
    }
  };
  blockIds(document.blocks, LEAD);
  const collect = (items: readonly Section[]) => {
    for (const each of items) {
      sections.add(each.id);
      blockIds(each.blocks, each.id);
      collect(each.sections);
    }
  };
  collect(document.sections);
  const made = storedBlocks(stored);
  const nodeOf = (section: string) => `node:${elementIdFor(persistentId, section)}`;
  // A title stands under no component, so it can only point at a section (document.ts).
  const keyFor = (targetId: string, title: boolean): string | null => {
    const at = title ? undefined : home.get(targetId);
    if (at === undefined) return sections.has(targetId) ? nodeOf(targetId) : null;
    const block = elementIdFor(componentIdFor(persistentId, at), targetId);
    if (made.all.has(block)) return `block:${block}`;
    if (at !== LEAD) return nodeOf(at);
    return made.leadFirst === null ? null : `block:${made.leadFirst}`;
  };

  const inlines = (items: readonly Inline[], title = false): Inline[] =>
    items.map((inline): Inline => {
      if (inline.kind === 'xref') {
        const key = keyFor(inline.targetId, title);
        return key === null
          ? { kind: 'text', text: inline.text, marks: [] }
          : { ...inline, targetId: key };
      }
      if (inline.kind === 'link') return { ...inline, inlines: inlines(inline.inlines, title) };
      return inline;
    });
  const blocks = (items: readonly Block[]): Block[] =>
    items.map((block): Block => {
      switch (block.kind) {
        case 'paragraph':
          return { ...block, inlines: inlines(block.inlines) };
        case 'list':
          return { ...block, items: block.items.map((item) => ({ blocks: blocks(item.blocks) })) };
        case 'figure':
          return { ...block, caption: inlines(block.caption) };
        case 'table':
          return {
            ...block,
            caption: inlines(block.caption),
            rows: block.rows.map((row) => ({
              cells: row.cells.map((cell) => ({ ...cell, blocks: blocks(cell.blocks) })),
            })),
            notes: block.notes.map((note) => ({ ...note, inlines: inlines(note.inlines) })),
          };
        default:
          return block;
      }
    });
  const section = (each: Section): Section => ({
    ...each,
    title: inlines(each.title, true),
    blocks: blocks(each.blocks),
    sections: each.sections.map(section),
  });
  return {
    ...document,
    blocks: blocks(document.blocks),
    sections: document.sections.map(section),
    notes: document.notes.map((note) => ({ ...note, blocks: blocks(note.blocks) })),
    equations: document.equations.map((equation) => {
      if (equation.mathml === null) {
        const asset = stored.assets.get(equation.imageId);
        return asset === undefined ? equation : { ...equation, imageId: assetKey(asset) };
      }
      const read = sanitiseMathml(equation.mathml);
      return read.ok ? { ...equation, mathml: read.mathml } : equation;
    }),
  };
}

/**
 * Reads a delivery back (docs/design/ct-studio-sink.md, "Versions, updates and the receipt"): what was
 * stored, seen in the decomposed shape, and the package, each through the contract's `textForm` and
 * `gridForms`, compared unit by unit and grid by grid. A cross-reference is compared by its target as
 * the mapping derives it, an equation by its MathML as the model's reader keeps it (`asSent`). What the
 * mapping reports it did on purpose is allowed for: a title made from the text is no title sent, a
 * cross-reference outside the document is its text, and a table flattened
 * into a cell is compared through that cell's text, its own grid left out. Anything else that differs
 * is a defect, and the first difference is what `at` and `detail` name.
 */
export function readBack(document: DecomposedDocument, stored: WrittenDocument): ReadBack {
  const index = new Index(document, stored.persistentId);
  for (const equation of document.equations) {
    const asset = stored.assets.get(equation.imageId);
    if (asset === undefined) continue;
    const texts = index.equationImages.get(asset) ?? new Set<string>();
    texts.add(nfc(equation.latex ?? '').trim());
    index.equationImages.set(asset, texts);
  }
  const codes = (code: CarryEntry['code']) => stored.carried.filter((entry) => entry.code === code);
  const untitled = new Set(
    codes('title_from_text').flatMap((entry) =>
      entry.element === null ? [] : [elementIdFor(stored.persistentId, entry.element)],
    ),
  );
  const flattened = new Set(codes('table_flattened').flatMap((entry) => entry.element ?? []));

  const view = new View(index, stored, untitled).document(document);
  const sent = asSent(document, stored);

  const [read, expected] = [textForm(view), textForm(sent)];
  for (let at = 0; at < Math.max(read.length, expected.length); at += 1) {
    if (read[at] !== expected[at]) {
      return {
        ok: false,
        at: `text[${at}]`,
        detail: `sent ${quote(expected[at])}, read ${quote(read[at])}`,
      };
    }
  }
  const grid = (forms: Record<string, string[][]>, id: string) => JSON.stringify(forms[id] ?? null);
  const [readGrids, sentGrids] = [gridForms(view), gridForms(sent)];
  for (const id of new Set([...Object.keys(sentGrids), ...Object.keys(readGrids)])) {
    if (flattened.has(id)) continue;
    if (grid(readGrids, id) !== grid(sentGrids, id)) {
      return { ok: false, at: `table ${id}`, detail: 'the table grid differs' };
    }
  }
  return { ok: true, at: null, detail: null };
}
