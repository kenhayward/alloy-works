import { createReport, type ImportFlowItem, type ReportEntry } from '@alloy-works/domain';
import { reportControls, withoutControls } from '../text.js';
import { readXml, type XmlNode, type XmlRead } from './xml.js';
import { readZip, type ZipRead } from './zip.js';

/**
 * A Word document as an import reads it (the IM plan, IM-C): a guarded unzip, `saxes` over the few
 * parts it reads, and the body walked into what `proposeImport` breaks out - headings by their style
 * or outline level, paragraphs with bold, italic and underline, lists and tables - in the pipeline's
 * own vocabulary, so sanitising happens once, in `admit`. What it does not read yet is reported by
 * kind, never dropped in silence (IMP-007); macros, embedded objects, controls and outside files are
 * never read or fetched, and are reported (IMP-047).
 */

export type DocxRefusal = 'unreadable' | 'unsafe' | 'tooLarge';

export type DocxRead =
  | {
      readonly ok: true;
      readonly flow: readonly ImportFlowItem[];
      /** The first paragraph in Word's Title style, as the document's title; null where none. */
      readonly title: string | null;
      /** The document's default language, where it names a well-formed one. */
      readonly language: string | null;
      readonly report: readonly ReportEntry[];
    }
  | { readonly ok: false; readonly refusal: DocxRefusal; readonly failure: string };

/** The parts read, and nothing else: the rest is never inflated. */
const WANTED =
  /^(\[content_types\]\.xml|word\/(document|styles|numbering)\.xml|word\/_rels\/document\.xml\.rels)$/i;

const HYPERLINK = /\/hyperlink$/;

type Inline = { type: 'text'; value: string; marks: object[] };

type Style = {
  readonly name: string;
  readonly basedOn: string | undefined;
  readonly outline: number | undefined;
  readonly numId: string | undefined;
  readonly ilvl: number | undefined;
};

type Level = { readonly format: string; readonly start: number | undefined };

type Tally = {
  readonly notYetRead: Map<string, number>;
  readonly comments: Set<string>;
  appearance: number;
  empties: number;
  reshaped: number;
  nested: number;
  controls: number;
  pageSetup: boolean;
};

type Context = {
  readonly styles: ReadonlyMap<string, Style>;
  readonly numbering: ReadonlyMap<string, ReadonlyMap<number, Level>>;
  readonly links: ReadonlyMap<string, string>;
  readonly tally: Tally;
  /** The fields open, innermost last: each in its instruction or its result. */
  readonly fields: ('instruction' | 'result')[];
  title: string | null;
};

const elements = (node: XmlNode, name?: string): XmlNode[] =>
  node.children.filter(
    (each): each is XmlNode =>
      typeof each !== 'string' && (name === undefined || each.name === name),
  );
const first = (node: XmlNode | undefined, name: string) => node && elements(node, name)[0];
const val = (node: XmlNode | undefined) => node?.attributes['w:val'];
/** A toggle property: absent is off, present is on unless its value says otherwise. */
const on = (node: XmlNode | undefined) =>
  node !== undefined && !['0', 'false', 'off'].includes(val(node) ?? 'true');
const textOf = (node: XmlNode) =>
  node.children.filter((each): each is string => typeof each === 'string').join('');
const local = (name: string) => name.slice(name.indexOf(':') + 1);

function notYetRead(context: Context, kind: string, count = 1) {
  context.tally.notYetRead.set(kind, (context.tally.notYetRead.get(kind) ?? 0) + count);
}

function stylesOf(root: XmlNode | undefined): {
  styles: Map<string, Style>;
  language: string | null;
} {
  const styles = new Map<string, Style>();
  if (!root) return { styles, language: null };
  for (const style of elements(root, 'w:style')) {
    const id = style.attributes['w:styleId'];
    if (id === undefined) continue;
    const pPr = first(style, 'w:pPr');
    const numPr = first(pPr, 'w:numPr');
    const outline = Number(val(first(pPr, 'w:outlineLvl')));
    const ilvl = Number(val(first(numPr, 'w:ilvl')) ?? 0);
    styles.set(id, {
      name: val(first(style, 'w:name')) ?? id,
      basedOn: val(first(style, 'w:basedOn')),
      outline: Number.isInteger(outline) ? outline : undefined,
      numId: val(first(numPr, 'w:numId')),
      ilvl: Number.isInteger(ilvl) ? ilvl : undefined,
    });
  }
  const lang = first(first(first(first(root, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'), 'w:lang');
  const language = val(lang) ?? null;
  return {
    styles,
    language: language !== null && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(language) ? language : null,
  };
}

function numberingOf(root: XmlNode | undefined): Map<string, Map<number, Level>> {
  const numbering = new Map<string, Map<number, Level>>();
  if (!root) return numbering;
  const levelsOf = (node: XmlNode, into: Map<number, Level>) => {
    for (const lvl of elements(node, 'w:lvl')) {
      const ilvl = Number(lvl.attributes['w:ilvl']);
      const start = Number(val(first(lvl, 'w:start')));
      if (!Number.isInteger(ilvl)) continue;
      into.set(ilvl, {
        format: val(first(lvl, 'w:numFmt')) ?? 'decimal',
        start: Number.isInteger(start) ? start : undefined,
      });
    }
  };
  const abstracts = new Map<string, Map<number, Level>>();
  for (const abstract of elements(root, 'w:abstractNum')) {
    const levels = new Map<number, Level>();
    levelsOf(abstract, levels);
    abstracts.set(abstract.attributes['w:abstractNumId'] ?? '', levels);
  }
  for (const num of elements(root, 'w:num')) {
    const levels = new Map(abstracts.get(val(first(num, 'w:abstractNumId')) ?? '') ?? []);
    for (const override of elements(num, 'w:lvlOverride')) {
      const ilvl = Number(override.attributes['w:ilvl']);
      levelsOf(override, levels);
      const start = Number(val(first(override, 'w:startOverride')));
      const level = levels.get(ilvl);
      if (level && Number.isInteger(start)) levels.set(ilvl, { ...level, start });
    }
    numbering.set(num.attributes['w:numId'] ?? '', levels);
  }
  return numbering;
}

/** A style's heading level and the name its reason gives: by its name, else its outline level. */
function headingOf(styles: ReadonlyMap<string, Style>, id: string | undefined) {
  const own = id === undefined ? undefined : styles.get(id);
  let style = own;
  for (let hops = 0; style && hops < 20; hops += 1) {
    const named = /^heading ([1-9])$/i.exec(style.name);
    if (named) return { level: Number(named[1]), style: displayName(own!.name) };
    if (style.outline !== undefined && style.outline < 9) {
      return { level: style.outline + 1, style: displayName(own!.name) };
    }
    style = style.basedOn === undefined ? undefined : styles.get(style.basedOn);
  }
  return undefined;
}

/** Word's built-in names are stored in lower case and shown capitalised: `heading 1` is Heading 1. */
const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** A style's list numbering, through what it is based on. */
function styleNumbering(styles: ReadonlyMap<string, Style>, id: string | undefined) {
  let style = id === undefined ? undefined : styles.get(id);
  for (let hops = 0; style && hops < 20; hops += 1) {
    if (style.numId !== undefined) return { numId: style.numId, ilvl: style.ilvl ?? 0 };
    style = style.basedOn === undefined ? undefined : styles.get(style.basedOn);
  }
  return undefined;
}

/** Run properties the walk reads, or that carry nothing to see: the rest is formatting it removes. */
const RUN_READ = new Set([
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:u',
  'w:vertAlign',
  'w:lang',
  'w:noProof',
  'w:rStyle',
  'w:szCs',
  'w:webHidden',
  'w:specVanish',
  'w:rtl',
  'w:cs',
  'w:rPrChange',
]);
/** Paragraph properties that are formatting the theme decides. */
const PARAGRAPH_LOOKS = new Set(['w:jc', 'w:ind', 'w:spacing', 'w:shd', 'w:pBdr']);
/** Marks and ranges with nothing to read, kept out of every report. */
const SILENT = new Set([
  'w:pPr',
  'w:rPr',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
  'w:commentRangeEnd',
  'w:commentReference',
  'w:annotationRef',
  'w:lastRenderedPageBreak',
  'w:footnoteRef',
  'w:endnoteRef',
  'w:separator',
  'w:continuationSeparator',
  'w:softHyphen',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:customXmlInsRangeStart',
  'w:customXmlInsRangeEnd',
  'w:customXmlDelRangeStart',
  'w:customXmlDelRangeEnd',
  'w:tblPr',
  'w:tblGrid',
  'w:trPr',
  'w:tcPr',
  'w:tblPrEx',
  'w:sdtPr',
  'w:sdtEndPr',
]);

function marksOf(context: Context, rPr: XmlNode | undefined): object[] {
  if (!rPr) return [];
  const marks: object[] = [];
  if (on(first(rPr, 'w:b'))) marks.push({ type: 'strong' });
  if (on(first(rPr, 'w:i'))) marks.push({ type: 'emphasis' });
  const u = val(first(rPr, 'w:u'));
  if (first(rPr, 'w:u') && u !== 'none' && u !== '0') marks.push({ type: 'underline' });
  const vertical = val(first(rPr, 'w:vertAlign'));
  if (vertical === 'superscript') marks.push({ type: 'superscript' });
  if (vertical === 'subscript') marks.push({ type: 'subscript' });
  if (elements(rPr).some((each) => !RUN_READ.has(each.name))) context.tally.appearance += 1;
  return marks;
}

/** A paragraph's inline content, in the order the source has it. */
function inlinesOf(context: Context, nodes: readonly XmlNode[], link: object[]): Inline[] {
  const out: Inline[] = [];
  const push = (value: string, marks: object[]) => {
    if (value === '' || context.fields.includes('instruction')) return;
    const kept = withoutControls(value, 'paragraph');
    context.tally.controls += kept.removed;
    if (kept.text !== '') out.push({ type: 'text', value: kept.text, marks: [...marks, ...link] });
  };
  for (const node of nodes) {
    switch (node.name) {
      case 'w:r': {
        const marks = marksOf(context, first(node, 'w:rPr'));
        for (const part of elements(node)) runChild(context, part, marks, push, out, link);
        break;
      }
      case 'w:hyperlink': {
        const id = node.attributes['r:id'];
        const href = id === undefined ? undefined : context.links.get(id);
        if (href === undefined && node.attributes['w:anchor'] !== undefined) {
          notYetRead(context, 'internalLink');
        }
        out.push(
          ...inlinesOf(
            context,
            elements(node),
            href === undefined ? link : [{ type: 'hyperlink', href }],
          ),
        );
        break;
      }
      case 'w:ins':
      case 'w:moveTo':
        // Every change rejected (IM-G): what was inserted is left, and said.
        notYetRead(context, 'trackedChange');
        break;
      case 'w:del':
      case 'w:moveFrom':
        notYetRead(context, 'trackedChange');
        out.push(...inlinesOf(context, elements(node), link));
        break;
      case 'w:fldSimple':
        notYetRead(context, 'field');
        out.push(...inlinesOf(context, elements(node), link));
        break;
      case 'w:smartTag':
      case 'w:customXml':
      case 'w:dir':
      case 'w:bdo':
        out.push(...inlinesOf(context, elements(node), link));
        break;
      case 'w:sdt':
        out.push(...inlinesOf(context, elements(first(node, 'w:sdtContent') ?? node), link));
        break;
      case 'w:commentRangeStart':
        context.tally.comments.add(node.attributes['w:id'] ?? String(context.tally.comments.size));
        break;
      case 'm:oMath':
      case 'm:oMathPara':
        notYetRead(context, 'equation');
        break;
      case 'mc:AlternateContent':
        alternate(context, node, (fallback) => out.push(...inlinesOf(context, fallback, link)));
        break;
      default:
        if (!SILENT.has(node.name)) notYetRead(context, local(node.name));
    }
  }
  return out;
}

function runChild(
  context: Context,
  node: XmlNode,
  marks: object[],
  push: (value: string, marks: object[]) => void,
  out: Inline[],
  link: object[],
) {
  switch (node.name) {
    case 'w:t':
    case 'w:delText':
      push(textOf(node), marks);
      break;
    case 'w:instrText':
    case 'w:delInstrText':
      break;
    case 'w:tab':
    case 'w:ptab':
    case 'w:cr':
      push(' ', marks);
      break;
    case 'w:br':
      if (node.attributes['w:type'] === 'page' || node.attributes['w:type'] === 'column') {
        notYetRead(context, 'pageBreak');
      } else push(' ', marks);
      break;
    case 'w:noBreakHyphen':
      push('-', marks);
      break;
    case 'w:fldChar': {
      const type = node.attributes['w:fldCharType'];
      if (type === 'begin') {
        if (context.fields.length === 0) notYetRead(context, 'field');
        context.fields.push('instruction');
      } else if (type === 'separate' && context.fields.length > 0) {
        context.fields[context.fields.length - 1] = 'result';
      } else if (type === 'end') context.fields.pop();
      break;
    }
    case 'w:footnoteReference':
      notYetRead(context, 'footnote');
      break;
    case 'w:endnoteReference':
      notYetRead(context, 'endnote');
      break;
    case 'w:drawing':
    case 'w:pict':
      notYetRead(context, 'image');
      break;
    case 'w:object':
      notYetRead(context, 'embeddedObject');
      break;
    case 'mc:AlternateContent':
      alternate(context, node, (fallback) => {
        for (const each of fallback) runChild(context, each, marks, push, out, link);
      });
      break;
    default:
      if (!SILENT.has(node.name)) notYetRead(context, local(node.name));
  }
}

/** Markup compatibility: the fallback read, its choice never. */
function alternate(context: Context, node: XmlNode, read: (fallback: XmlNode[]) => void) {
  const fallback = first(node, 'mc:Fallback');
  if (fallback) read(elements(fallback));
  else notYetRead(context, 'alternateContent');
}

/** Adjacent runs with the same marks, as one. */
function merged(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const each of inlines) {
    const last = out.at(-1);
    if (last && JSON.stringify(last.marks) === JSON.stringify(each.marks)) {
      out[out.length - 1] = { ...last, value: last.value + each.value };
    } else out.push(each);
  }
  return out;
}

type Paragraph =
  | { kind: 'heading'; level: number; style: string; text: string }
  | { kind: 'item'; numId: string; ilvl: number; block: Block }
  | { kind: 'block'; block: Block }
  | { kind: 'empty' }
  | { kind: 'title' };

type Block = { block: object; source: string };

function paragraphOf(context: Context, node: XmlNode, inCell: boolean): Paragraph {
  const pPr = first(node, 'w:pPr');
  if (first(pPr, 'w:sectPr')) context.tally.pageSetup = true;
  if (pPr && elements(pPr).some((each) => PARAGRAPH_LOOKS.has(each.name))) {
    context.tally.appearance += 1;
  }
  const styleId = val(first(pPr, 'w:pStyle'));
  const inlines = merged(inlinesOf(context, elements(node), []));
  const text = inlines.map((each) => each.value).join('');
  const block = { block: { type: 'paragraph', content: inlines }, source: text };

  const direct = Number(val(first(pPr, 'w:outlineLvl')));
  const heading =
    Number.isInteger(direct) && direct < 9
      ? { level: direct + 1, style: `Outline level ${direct + 1}` }
      : Number.isInteger(direct)
        ? undefined
        : headingOf(context.styles, styleId);
  const style = styleId === undefined ? undefined : context.styles.get(styleId);
  if (!inCell && heading) {
    return text.trim() === ''
      ? { kind: 'empty' }
      : { kind: 'heading', ...heading, text: text.trim() };
  }
  if (
    !inCell &&
    style &&
    /^title$/i.test(style.name) &&
    context.title === null &&
    text.trim() !== ''
  ) {
    context.title = text.trim();
    return { kind: 'title' };
  }
  const numPr = first(pPr, 'w:numPr');
  const numbered =
    numPr === undefined
      ? styleNumbering(context.styles, styleId)
      : {
          numId: val(first(numPr, 'w:numId')) ?? '0',
          ilvl: Number(val(first(numPr, 'w:ilvl')) ?? 0),
        };
  if (numbered && numbered.numId !== '0') {
    return {
      kind: 'item',
      numId: numbered.numId,
      ilvl: Number.isInteger(numbered.ilvl) ? numbered.ilvl : 0,
      block,
    };
  }
  if (inlines.length === 0) return { kind: 'empty' };
  return { kind: 'block', block };
}

/** A list's kind, format and start, from its numbering's level. */
function listShape(context: Context, numId: string, ilvl: number) {
  const level = context.numbering.get(numId)?.get(ilvl);
  const format = level?.format ?? 'bullet';
  if (format === 'bullet' || format === 'none') return { kind: 'unordered' };
  const as = /letter/i.test(format) ? 'alphabetic' : /roman/i.test(format) ? 'roman' : 'decimal';
  if (as === 'decimal' && format !== 'decimal') notYetRead(context, 'numberFormat');
  const start = level?.start;
  // A list starts where its numbering says, but never at a zeroth letter or numeral (CNT-153).
  const kept = start !== undefined && start !== 1 && (start > 0 || as === 'decimal');
  return { kind: 'ordered', format: as, ...(kept ? { start } : {}) };
}

type ListBuild = { level: number; list: { items: { content: object[] }[] } & object };

/** Consecutive list paragraphs as one list, nested by their level. */
function listOf(context: Context, items: readonly Extract<Paragraph, { kind: 'item' }>[]): Block {
  const make = (item: (typeof items)[number]) => ({
    type: 'list',
    ...listShape(context, item.numId, item.ilvl),
    items: [] as { content: object[] }[],
  });
  const root: ListBuild = { level: items[0]!.ilvl, list: make(items[0]!) };
  const stack: ListBuild[] = [root];
  for (const item of items) {
    while (stack.length > 1 && item.ilvl < stack.at(-1)!.level) stack.pop();
    const top = stack.at(-1)!;
    const last = top.list.items.at(-1);
    if (item.ilvl > top.level && last) {
      const nested: ListBuild = { level: item.ilvl, list: make(item) };
      last.content.push(nested.list);
      stack.push(nested);
    }
    stack.at(-1)!.list.items.push({ content: [item.block.block] });
  }
  return { block: root.list, source: items.map((item) => item.block.source).join('\n') };
}

/** A container's blocks - the body's, a cell's - with its list paragraphs gathered into lists. */
function blocksOf(
  context: Context,
  nodes: readonly XmlNode[],
  inCell: boolean,
  emit: (item: ImportFlowItem) => void,
) {
  let pending: Extract<Paragraph, { kind: 'item' }>[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const { block, source } = listOf(context, pending);
    emit({ kind: 'block', block, source });
    pending = [];
  };
  const walk = (children: readonly XmlNode[]) => {
    for (const node of children) {
      switch (node.name) {
        case 'w:p': {
          const read = paragraphOf(context, node, inCell);
          if (read.kind === 'item') {
            // Another numbering at the list's own level starts another list.
            const base = pending[0];
            if (base && read.numId !== base.numId && read.ilvl <= base.ilvl) flush();
            pending.push(read);
            continue;
          }
          flush();
          if (read.kind === 'heading') emit(read);
          else if (read.kind === 'block') emit({ kind: 'block', ...read.block });
          else if (read.kind === 'empty') context.tally.empties += 1;
          break;
        }
        case 'w:tbl':
          flush();
          if (inCell) {
            // A table in a cell, kept as its text, one paragraph for each cell (as a paste is).
            context.tally.nested += 1;
            for (const row of rowsOf(node)) {
              for (const cell of cellsOf(row)) blocksOf(context, elements(cell), true, emit);
            }
          } else {
            const table = tableOf(context, node);
            if (table) emit({ kind: 'block', ...table });
          }
          break;
        case 'w:sdt':
          walk(elements(first(node, 'w:sdtContent') ?? node));
          break;
        case 'w:customXml':
          walk(elements(node));
          break;
        case 'w:sectPr':
          context.tally.pageSetup = true;
          break;
        case 'mc:AlternateContent':
          alternate(context, node, walk);
          break;
        default:
          if (!SILENT.has(node.name)) {
            flush();
            notYetRead(context, local(node.name));
          }
      }
    }
  };
  walk(nodes);
  flush();
}

const rowsOf = (table: XmlNode): XmlNode[] =>
  elements(table).flatMap((node) =>
    node.name === 'w:tr'
      ? [node]
      : node.name === 'w:sdt' || node.name === 'w:customXml'
        ? rowsOf(first(node, 'w:sdtContent') ?? node)
        : [],
  );
const cellsOf = (row: XmlNode): XmlNode[] =>
  elements(row).flatMap((node) =>
    node.name === 'w:tc'
      ? [node]
      : node.name === 'w:sdt' || node.name === 'w:customXml'
        ? cellsOf(first(node, 'w:sdtContent') ?? node)
        : [],
  );

type Cell = { content: object[]; colspan: number; rowspan: number; source: string };

const EMPTY_CELL = () => [{ type: 'paragraph', content: [] }];

/**
 * A table: its header rows, a cell's span across the grid and down it. Rows short of the grid's
 * width are made up with empty cells, and said; where merges do not fit the grid, they are left.
 */
function tableOf(context: Context, node: XmlNode): Block | undefined {
  const read = rowsOf(node).map((row) => {
    const header = on(first(first(row, 'w:trPr'), 'w:tblHeader'));
    let column = 0;
    const cells = cellsOf(row).map((tc) => {
      const tcPr = first(tc, 'w:tcPr');
      const span = Math.max(1, Number(val(first(tcPr, 'w:gridSpan')) ?? 1) || 1);
      const merge = first(tcPr, 'w:vMerge');
      const blocks: ImportFlowItem[] = [];
      const empties = context.tally.empties;
      blocksOf(context, elements(tc), true, (item) => blocks.push(item));
      const content = blocks.flatMap((item) =>
        item.kind === 'block' ? [item.block as object] : [],
      );
      // An empty paragraph is where a cell's cursor stands, not spacing.
      if (content.length === 0) context.tally.empties = empties;
      const cell = {
        at: column,
        span,
        merge: merge === undefined ? undefined : val(merge) === 'restart' ? 'restart' : 'continue',
        content: content.length > 0 ? content : EMPTY_CELL(),
        source: blocks.map((item) => (item.kind === 'block' ? item.source : '')).join(' '),
        empty: content.length === 0,
      };
      column += span;
      return cell;
    });
    return { header, cells };
  });
  if (read.length === 0) return undefined;

  const build = (merging: boolean): Cell[][] | undefined => {
    const rows: { cell: Cell; at: number }[][] = [];
    const open = new Map<number, { cell: Cell; span: number }>();
    for (const row of read) {
      const placed: { cell: Cell; at: number }[] = [];
      for (const each of row.cells) {
        const above = open.get(each.at);
        if (
          merging &&
          each.merge === 'continue' &&
          each.empty &&
          above &&
          above.span === each.span
        ) {
          above.cell.rowspan += 1;
          continue;
        }
        const cell = { content: each.content, colspan: each.span, rowspan: 1, source: each.source };
        placed.push({ cell, at: each.at });
        for (let column = each.at; column < each.at + each.span; column += 1) open.delete(column);
        if (each.merge === 'restart') open.set(each.at, { cell, span: each.span });
      }
      rows.push(placed);
    }
    // Every row across the grid's width: what a span from above covers left alone, the rest filled.
    const width = Math.max(
      ...read.map((row) => row.cells.reduce((sum, cell) => sum + cell.span, 0)),
    );
    const covered = rows.map(() => new Set<number>());
    const out: Cell[][] = [];
    for (const [index, row] of rows.entries()) {
      const cells: Cell[] = [];
      let column = 0;
      const starts = new Map(row.map((each) => [each.at, each.cell]));
      while (column < width) {
        if (covered[index]!.has(column)) {
          column += 1;
          continue;
        }
        const cell = starts.get(column);
        if (cell) {
          for (let down = 0; down < cell.rowspan; down += 1) {
            for (let across = 0; across < cell.colspan; across += 1) {
              const target = covered[index + down];
              if (!target || target.has(column + across)) return undefined;
              target.add(column + across);
            }
          }
          cells.push(cell);
          column += cell.colspan;
        } else {
          context.tally.reshaped += 1;
          cells.push({ content: EMPTY_CELL(), colspan: 1, rowspan: 1, source: '' });
          column += 1;
        }
      }
      if (row.some((each) => !cells.includes(each.cell))) return undefined;
      out.push(cells);
    }
    return out;
  };
  const before = context.tally.reshaped;
  let rows = build(true);
  if (!rows) {
    context.tally.reshaped = before + 1;
    rows = build(false) ?? [];
  }
  let headerRows = 0;
  while (headerRows < read.length && read[headerRows]!.header) headerRows += 1;
  return {
    block: {
      type: 'table',
      headerRows,
      headerColumns: 0,
      caption: [],
      rows: rows.map((cells) => ({
        cells: cells.map(({ content, colspan, rowspan }) => ({ content, colspan, rowspan })),
      })),
    },
    source: rows.map((cells) => cells.map((cell) => cell.source).join(' | ')).join('\n'),
  };
}

function refusalOfZip(read: Extract<ZipRead, { ok: false }>): DocxRead {
  const refusal =
    read.refusal === 'entryName'
      ? 'unsafe'
      : read.refusal === 'unreadable'
        ? 'unreadable'
        : 'tooLarge';
  return { ok: false, refusal, failure: read.failure };
}

function refusalOfXml(read: Extract<XmlRead, { ok: false }>): DocxRead {
  const refusal =
    read.refusal === 'doctype'
      ? 'unsafe'
      : read.refusal === 'malformed'
        ? 'unreadable'
        : 'tooLarge';
  return { ok: false, refusal, failure: read.failure };
}

/** The skipped: what is reported by kind and never walked. */
const SKIP = new Set(['w:drawing', 'w:pict', 'w:object', 'm:oMath', 'm:oMathPara', 'mc:Choice']);
const KEEP_TEXT = new Set(['w:t', 'w:delText']);

export function readDocx(bytes: Uint8Array): DocxRead {
  const zip = readZip(bytes, (name) => WANTED.test(name));
  if (!zip.ok) return refusalOfZip(zip);
  const document = zip.parts.get('word/document.xml');
  if (!document) return { ok: false, refusal: 'unreadable', failure: 'Not a Word document' };

  const xml = (name: string, text = KEEP_TEXT): XmlRead | undefined => {
    const part = zip.parts.get(name);
    return (
      part && readXml(part, { text: (each) => text.has(each), skip: (each) => SKIP.has(each) })
    );
  };
  const parsed: Record<string, XmlNode | undefined> = {};
  for (const name of [
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/_rels/document.xml.rels',
    '[content_types].xml',
  ]) {
    const read = xml(name);
    if (read && !read.ok) return refusalOfXml(read);
    parsed[name] = read?.root;
  }

  const report = createReport();
  const tally: Tally = {
    notYetRead: new Map(),
    comments: new Set(),
    appearance: 0,
    empties: 0,
    reshaped: 0,
    nested: 0,
    controls: 0,
    pageSetup: false,
  };

  // What the package holds that is never read (IMP-047): macros, embedded objects and controls.
  const types = parsed['[content_types].xml'];
  const macroType = types
    ? elements(types).some((each) =>
        /macroEnabled|vbaProject/i.test(each.attributes['ContentType'] ?? ''),
      )
    : false;
  if (macroType || zip.names.some((name) => /(^|\/)(vbaProject\.bin|vbaData\.xml)$/i.test(name))) {
    report.add('read', 'discarded', 'macro', { count: 1 });
  }
  const embedded = zip.names.filter(
    (name) => /^word\/(embeddings|activeX)\/[^/]+$/i.test(name) && !/\.rels$/i.test(name),
  ).length;
  if (embedded > 0) report.add('read', 'discarded', 'embeddedObject', { count: embedded });

  // A hyperlink's target, by its relationship; any other outside target is never fetched, and said.
  const links = new Map<string, string>();
  let external = 0;
  for (const relationship of elements(
    parsed['word/_rels/document.xml.rels'] ?? { name: '', attributes: {}, children: [] },
  )) {
    const { Id: id, Type: type = '', Target: target, TargetMode: mode } = relationship.attributes;
    if (mode !== 'External') continue;
    if (HYPERLINK.test(type) && id !== undefined && target !== undefined) links.set(id, target);
    else external += 1;
  }
  if (external > 0) report.add('read', 'discarded', 'externalRelationship', { count: external });

  const { styles, language } = stylesOf(parsed['word/styles.xml']);
  const context: Context = {
    styles,
    numbering: numberingOf(parsed['word/numbering.xml']),
    links,
    tally,
    fields: [],
    title: null,
  };
  const body = first(parsed['word/document.xml'], 'w:body');
  if (!body) return { ok: false, refusal: 'unreadable', failure: 'A Word document with no body' };
  const flow: ImportFlowItem[] = [];
  blocksOf(context, elements(body), false, (item) => flow.push(item));

  if (tally.comments.size > 0) notYetRead(context, 'comment', tally.comments.size);
  for (const [kind, count] of [...tally.notYetRead].sort(([a], [b]) => a.localeCompare(b))) {
    report.add('read', 'discarded', 'notYetRead', { detail: kind, count });
  }
  const say = (count: number, add: (extra: { count: number }) => void) => {
    if (count > 0) add({ count });
  };
  say(tally.appearance, (extra) => report.add('read', 'discarded', 'appearance', extra));
  say(tally.empties, (extra) => report.add('read', 'discarded', 'emptyParagraph', extra));
  say(tally.reshaped, (extra) => report.add('read', 'rewritten', 'tableShape', extra));
  say(tally.nested, (extra) => report.add('read', 'rewritten', 'table', extra));
  reportControls(report, tally.controls);
  if (tally.pageSetup) report.add('read', 'discarded', 'pageSetup');

  return { ok: true, flow, title: context.title, language, report: report.entries };
}
