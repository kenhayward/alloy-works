import {
  createReport,
  type ImportChangeMark,
  type ImportComment,
  type ImportFlowItem,
  type ImportIdentity,
  type ImportIdentityRole,
  type ImportReference,
  type ImportReply,
  type ReportEntry,
} from '@alloy-works/domain';
import { reportControls, withoutControls } from '../text.js';
import { readXml, type XmlNode, type XmlRead } from './xml.js';
import { readZip, type ZipRead } from './zip.js';

/**
 * A Word document as an import reads it (the IM plan, IM-C): a guarded unzip, `saxes` over the few
 * parts it reads, and the body walked into what `proposeImport` breaks out - headings by their style
 * or outline level, paragraphs with bold, italic and underline, lists by their numbering, tables,
 * footnotes, captions, figures and cross-references as structure (IMP-006) - in the pipeline's own
 * vocabulary, so sanitising happens once, in `admit`. Tracked changes stay on their text, by author,
 * for the proposal to make suggestions of; comments, the references whose bookmark is not in the file
 * and the identities it carries are read beside the flow (IMc). What it does not read is reported by
 * kind, never dropped in silence (IMP-007); macros, embedded objects, controls and outside files are
 * never read or fetched, and are reported (IMP-047).
 */

export type DocxRefusal = 'unreadable' | 'unsafe' | 'tooLarge';

/** An image inside the file, for asset ingest (IM-C): its figure names `placeholder` until then. */
export interface DocxImage {
  readonly placeholder: string;
  readonly format: 'png' | 'jpeg';
  readonly bytes: Uint8Array;
}

export type DocxRead =
  | {
      readonly ok: true;
      readonly flow: readonly ImportFlowItem[];
      /** The first paragraph in Word's Title style, as the document's title; null where none. */
      readonly title: string | null;
      /** The document's default language, where it names a well-formed one. */
      readonly language: string | null;
      readonly report: readonly ReportEntry[];
      /** Each cross-reference whose bookmark is not in the file (IMP-033). */
      readonly references: readonly ImportReference[];
      readonly comments: readonly ImportComment[];
      /** Every name the file carries (IMP-009), by name. */
      readonly identities: readonly ImportIdentity[];
      readonly images: readonly DocxImage[];
      /** The file's own properties (IM-J): never content, kept only where the tenant's policy keeps. */
      readonly properties: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly refusal: DocxRefusal; readonly failure: string };

/** The parts read, and nothing else: the rest is never inflated. */
const WANTED =
  /^(\[content_types\]\.xml|word\/(document|styles|numbering|footnotes|comments|commentsextended|people|settings)\.xml|word\/_rels\/(document|footnotes)\.xml\.rels|docprops\/(core|app|custom)\.xml|word\/media\/[^/]+)$/i;

const HYPERLINK = /\/hyperlink$/;
const IMAGE = /\/image$/;

type Inline = Record<string, unknown>;

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
  readonly fields: Map<string, number>;
  readonly formats: Map<string, number>;
  appearance: number;
  empties: number;
  reshaped: number;
  nested: number;
  controls: number;
  pageSetup: boolean;
  textBoxes: number;
  contentControls: number;
  captions: number;
  headingChanges: number;
  noteBlocks: number;
};

/** A field open in the text: its instruction as read, and what its result showed. */
type Field = {
  phase: 'instruction' | 'result';
  code: string;
  text: string;
  kind: 'reference' | 'sequence' | 'other' | undefined;
  /** Whether it stands inside another field's instruction, where nothing it says is shown. */
  readonly hidden: boolean;
};

/** The paragraph being read: what a bookmark or a comment in it names, and its text as rejected. */
type Open = { readonly id: string; text: string; source: string; image: boolean };

type Recorded = {
  readonly node: Inline;
  readonly bookmark: string;
  readonly field: ImportReference['field'];
  readonly switches: string;
  readonly text: string;
};

type Range = {
  readonly block: string;
  readonly start: number;
  readonly before: string;
  quote: string | null;
  crossed: boolean;
};

type Context = {
  readonly styles: ReadonlyMap<string, Style>;
  readonly numbering: ReadonlyMap<string, ReadonlyMap<number, Level>>;
  readonly links: ReadonlyMap<string, string>;
  readonly tally: Tally;
  /** The fields open, innermost last. */
  fields: Field[];
  title: string | null;
  readonly ids: { next: number };
  paragraph: Open | null;
  change: ImportChangeMark | undefined;
  /** The footnote being read, by the reader's identifier. */
  note: string | null;
  /** Each bookmark's name, by what it names. */
  readonly bookmarks: Map<string, string>;
  /** The bookmarks open, by Word's identifier, and those waiting for the next paragraph. */
  readonly open: Map<string, string>;
  readonly waiting: { bookmarks: string[]; comments: string[] };
  /** A caption's paragraph, by the table or figure it was placed on. */
  readonly aliases: Map<string, string>;
  readonly references: Recorded[];
  readonly ranges: Map<string, Range>;
  readonly footnotes: ReadonlyMap<string, XmlNode>;
  /** Each footnote read, or being read: one is read once, so none refers to itself without end. */
  readonly notesRead: Set<string>;
  readonly media: {
    readonly rels: ReadonlyMap<string, string>;
    readonly parts: ReadonlyMap<string, Uint8Array>;
    readonly placed: Map<string, string | null>;
    readonly images: DocxImage[];
  };
  readonly authors: Map<string, Set<ImportIdentityRole>>;
  /** Items a list's numbering has counted so far, so a list carrying it on starts after them. */
  readonly counted: Map<string, number>;
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
/** The first element of this name at any depth beneath a node. */
function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of elements(node)) {
    if (child.name === name) return child;
    const deeper = find(child, name);
    if (deeper) return deeper;
  }
  return undefined;
}
/** Every text beneath a node, in order. */
const allText = (node: XmlNode): string =>
  node.children.map((each) => (typeof each === 'string' ? each : allText(each))).join('');

const newId = (context: Context) => `wb-${(context.ids.next += 1)}`;

function notYetRead(context: Context, kind: string, count = 1) {
  context.tally.notYetRead.set(kind, (context.tally.notYetRead.get(kind) ?? 0) + count);
}
const tallied = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

function carries(context: Context, name: string | undefined, role: ImportIdentityRole) {
  const named = name?.trim();
  if (!named) return;
  const roles = context.authors.get(named) ?? new Set<ImportIdentityRole>();
  roles.add(role);
  context.authors.set(named, roles);
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
  'w:ins',
  'w:del',
]);
/** Paragraph properties that are formatting the theme decides. */
const PARAGRAPH_LOOKS = new Set(['w:jc', 'w:ind', 'w:spacing', 'w:shd', 'w:pBdr']);
/** Marks and ranges with nothing to read, kept out of every report. */
const SILENT = new Set([
  'w:pPr',
  'w:rPr',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
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
    if (value === '' || context.fields.some((each) => each.phase === 'instruction')) return;
    const field = context.fields.at(-1);
    if (field?.kind === 'reference' || field?.kind === 'sequence') {
      // What a reference or a number showed is the source's alone (IMP-006).
      field.text += value;
      return;
    }
    const kept = withoutControls(value, 'paragraph');
    context.tally.controls += kept.removed;
    if (kept.text === '') return;
    out.push({
      type: 'text',
      value: kept.text,
      marks: [...marks, ...link],
      ...(context.change === undefined ? {} : { change: context.change }),
    });
    const open = context.paragraph;
    if (open && context.change?.kind !== 'insert') {
      open.text += kept.text;
      open.source += kept.text;
    }
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
      case 'w:del':
      case 'w:moveFrom': {
        // Each change kept on its text, by its author (IM-G), for the proposal to suggest.
        const author = node.attributes['w:author']?.trim() || 'Unknown';
        carries(context, author, 'changes');
        const was = context.change;
        context.change = {
          kind: node.name === 'w:ins' || node.name === 'w:moveTo' ? 'insert' : 'delete',
          author,
          id: node.attributes['w:id'] ?? '',
        };
        out.push(...inlinesOf(context, elements(node), link));
        context.change = was;
        break;
      }
      case 'w:fldSimple': {
        const field = openField(context, node.attributes['w:instr'] ?? '');
        field.phase = 'result';
        decide(context, field);
        const inner = inlinesOf(context, elements(node), link);
        context.fields.pop();
        out.push(...inner);
        finish(context, field, out);
        break;
      }
      case 'w:smartTag':
      case 'w:customXml':
      case 'w:dir':
      case 'w:bdo':
        out.push(...inlinesOf(context, elements(node), link));
        break;
      case 'w:sdt':
        context.tally.contentControls += 1;
        out.push(...inlinesOf(context, elements(first(node, 'w:sdtContent') ?? node), link));
        break;
      case 'w:bookmarkStart':
        bookmarkStart(context, node);
        break;
      case 'w:bookmarkEnd':
        context.open.delete(node.attributes['w:id'] ?? '');
        break;
      case 'w:commentRangeStart':
        rangeStart(context, node.attributes['w:id'] ?? '');
        break;
      case 'w:commentRangeEnd':
        rangeEnd(context, node.attributes['w:id'] ?? '');
        break;
      case 'm:oMath':
      case 'm:oMathPara':
        // No reader of OMML yet: not read, its text kept in the source (IMP-007).
        notYetRead(context, 'equation');
        if (context.paragraph) context.paragraph.source += mathText(node);
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

const mathText = (node: XmlNode): string =>
  elements(node)
    .map((each) => (each.name === 'm:t' ? textOf(each) : mathText(each)))
    .join('');

function bookmarkStart(context: Context, node: XmlNode) {
  const name = node.attributes['w:name'];
  if (name === undefined || name === '' || /^_GoBack$/i.test(name)) return;
  context.open.set(node.attributes['w:id'] ?? name, name);
  const target = context.note ?? context.paragraph?.id;
  if (target === undefined) context.waiting.bookmarks.push(name);
  else if (!context.bookmarks.has(name)) context.bookmarks.set(name, target);
}

function rangeStart(context: Context, id: string) {
  const open = context.paragraph;
  if (!open) {
    context.waiting.comments.push(id);
    return;
  }
  if (context.ranges.has(id)) return;
  context.ranges.set(id, {
    block: open.id,
    start: open.text.length,
    before: open.text.slice(-200),
    quote: null,
    crossed: false,
  });
}

function rangeEnd(context: Context, id: string) {
  const range = context.ranges.get(id);
  const open = context.paragraph;
  if (!range || range.quote !== null || !open || range.block !== open.id) return;
  range.quote = open.text.slice(range.start);
}

function openField(context: Context, code: string): Field {
  const field: Field = {
    phase: 'instruction',
    code,
    text: '',
    kind: undefined,
    hidden: context.fields.some((each) => each.phase === 'instruction'),
  };
  context.fields.push(field);
  return field;
}

const REFERENCE = /^\s*(REF|NOTEREF|PAGEREF)\s+(\S+)(.*)$/i;
const SEQUENCE = /^\s*SEQ\s+(\S+)/i;

/** What a field is, once its instruction is read: a reference, a caption's number, or another. */
function decide(context: Context, field: Field) {
  if (field.kind !== undefined) return;
  if (REFERENCE.test(field.code)) field.kind = 'reference';
  else if (SEQUENCE.test(field.code)) field.kind = 'sequence';
  else {
    field.kind = 'other';
    if (field.hidden) return;
    const keyword = /^\s*([A-Za-z]{1,20})\b/.exec(field.code)?.[1]?.toUpperCase();
    tallied(context.tally.fields, keyword ?? '');
  }
}

/** A field ended: a reference as a cross-reference, a caption's number as where its words begin. */
function finish(context: Context, field: Field, out: Inline[]) {
  decide(context, field);
  if (field.hidden) return;
  const open = context.paragraph;
  if (field.kind === 'reference') {
    const [, name, bookmark, switches] = REFERENCE.exec(field.code)!;
    const node: Inline = {
      type: 'crossReference',
      id: `wr-${context.references.length + 1}`,
      target: { kind: 'block', block: '' },
      display: 'title',
    };
    out.push(node);
    context.references.push({
      node,
      bookmark: bookmark!,
      field: name!.toUpperCase() as ImportReference['field'],
      switches: switches ?? '',
      text: field.text,
    });
    if (open) open.source += field.text;
  } else if (field.kind === 'sequence') {
    out.push({ type: 'sequence', text: field.text, name: SEQUENCE.exec(field.code)![1] });
    if (open) open.source += field.text;
  }
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
    case 'w:delInstrText': {
      const field = context.fields.at(-1);
      if (field?.phase === 'instruction') field.code += textOf(node);
      break;
    }
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
      const top = context.fields.at(-1);
      if (type === 'begin') openField(context, '');
      else if (type === 'separate' && top) {
        top.phase = 'result';
        decide(context, top);
      } else if (type === 'end' && top) {
        context.fields.pop();
        finish(context, top, out);
      }
      break;
    }
    case 'w:footnoteReference':
      footnote(context, node.attributes['w:id'] ?? '', out);
      break;
    case 'w:endnoteReference':
      notYetRead(context, 'endnote');
      break;
    case 'w:drawing':
    case 'w:pict':
      drawing(context, node, out);
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

/** A footnote at its reference (IMP-006): its paragraphs, each read as the body's are. */
function footnote(context: Context, id: string, out: Inline[]) {
  const note = context.footnotes.get(id);
  if (!note || context.notesRead.has(id)) {
    notYetRead(context, 'footnote');
    return;
  }
  context.notesRead.add(id);
  const noteId = `wf-${id}`;
  // A bookmark around the mark is the note's, as NOTEREF reads it.
  for (const name of context.open.values()) context.bookmarks.set(name, noteId);
  const saved = {
    paragraph: context.paragraph,
    fields: context.fields,
    change: context.change,
    note: context.note,
  };
  Object.assign(context, { fields: [], change: undefined, note: noteId });
  const items: ImportFlowItem[] = [];
  blocksOf(context, elements(note), true, (item) => items.push(item));
  Object.assign(context, saved);
  const paragraphs: Inline[] = [];
  const gather = (block: Inline, top: boolean) => {
    if (block.type === 'paragraph') {
      paragraphs.push(block);
      return;
    }
    if (top) context.tally.noteBlocks += 1;
    if (block.type === 'list') {
      for (const item of block.items as { content: Inline[] }[]) {
        for (const each of item.content) gather(each, false);
      }
    } else if (block.type === 'table') {
      for (const row of block.rows as { cells: { content: Inline[] }[] }[]) {
        for (const cell of row.cells) for (const each of cell.content) gather(each, false);
      }
    }
  };
  for (const item of items) if (item.kind === 'block') gather(item.block as Inline, true);
  const lead = (paragraphs[0]?.content as Inline[] | undefined)?.[0];
  if (lead?.type === 'text' && typeof lead.value === 'string') {
    const trimmed = lead.value.replace(/^\s+/, '');
    if (trimmed === '') (paragraphs[0]!.content as Inline[]).shift();
    else lead.value = trimmed;
  }
  out.push({
    type: 'footnote',
    id: noteId,
    anchor: { kind: 'span' },
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }],
  });
}

/** A drawing: its image, by asset ingest, with its alternative text; a text box left out, and said. */
function drawing(context: Context, node: XmlNode, out: Inline[]) {
  if (find(node, 'w:txbxContent') || find(node, 'wps:txbx') || find(node, 'v:textbox')) {
    context.tally.textBoxes += 1;
    return;
  }
  const blip = find(node, 'a:blip') ?? find(node, 'v:imagedata');
  const id = blip?.attributes['r:embed'] ?? blip?.attributes['r:id'];
  const target = id === undefined ? undefined : context.media.rels.get(id);
  if (target === undefined) {
    notYetRead(context, 'image');
    return;
  }
  if (context.paragraph) context.paragraph.image = true;
  const placeholder = imageOf(context, target);
  if (placeholder === null) return;
  const docPr = find(node, 'wp:docPr');
  const shape = find(node, 'v:shape');
  const described = (
    docPr?.attributes['descr'] ??
    docPr?.attributes['title'] ??
    shape?.attributes['alt'] ??
    ''
  ).trim();
  out.push({
    type: 'image',
    asset: placeholder,
    imageStyle: 'figure',
    alternative: described === '' ? { kind: 'inherited' } : { kind: 'own', text: described },
  });
}

/** An image's placeholder, the same for each use of one part; null where its format is not taken. */
function imageOf(context: Context, target: string): string | null {
  const segments: string[] = [];
  for (const segment of `word/${target}`.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  const name = segments.join('/').toLowerCase();
  const { media } = context;
  if (media.placed.has(name)) return media.placed.get(name)!;
  const bytes = media.parts.get(name);
  const format =
    bytes === undefined
      ? undefined
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        ? ('png' as const)
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? ('jpeg' as const)
          : undefined;
  if (bytes === undefined || format === undefined) {
    tallied(context.tally.formats, /\.([a-z0-9]{1,8})$/.exec(name)?.[1] ?? '');
    media.placed.set(name, null);
    return null;
  }
  const placeholder = `00000000-0000-4000-8000-${(media.images.length + 1).toString(16).padStart(12, '0')}`;
  media.images.push({ placeholder, format, bytes });
  media.placed.set(name, placeholder);
  return placeholder;
}

/** Markup compatibility: the fallback read, its choice never. */
function alternate(context: Context, node: XmlNode, read: (fallback: XmlNode[]) => void) {
  const fallback = first(node, 'mc:Fallback');
  if (fallback) read(elements(fallback));
  else notYetRead(context, 'alternateContent');
}

/** Adjacent runs of text with the same marks and change, as one. */
function merged(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  const key = (each: Inline) => JSON.stringify([each.marks, each.change]);
  for (const each of inlines) {
    const last = out.at(-1);
    if (last?.type === 'text' && each.type === 'text' && key(last) === key(each)) {
      out[out.length - 1] = { ...last, value: `${last.value as string}${each.value as string}` };
    } else out.push(each);
  }
  return out;
}

/** A caption's number, where it is not a caption's: the text it showed. */
const unsequenced = (inlines: readonly Inline[]): Inline[] =>
  inlines.map((each) =>
    each.type === 'sequence' ? { type: 'text', value: each.text as string, marks: [] } : each,
  );

type Paragraph =
  | { kind: 'heading'; level: number; style: string; text: string; id: string }
  | { kind: 'item'; numId: string; ilvl: number; block: Block }
  | { kind: 'block'; block: Block }
  | { kind: 'caption'; sequence: string | null; caption: Inline[]; id: string; block: Block }
  | { kind: 'empty' }
  | { kind: 'title' }
  /** What held only an image left out: nothing, and no spacing either. */
  | { kind: 'none' };

type Block = { block: Inline; source: string };

function paragraphOf(context: Context, node: XmlNode, inCell: boolean): Paragraph {
  const pPr = first(node, 'w:pPr');
  if (first(pPr, 'w:sectPr')) context.tally.pageSetup = true;
  if (pPr && elements(pPr).some((each) => PARAGRAPH_LOOKS.has(each.name))) {
    context.tally.appearance += 1;
  }
  const id = newId(context);
  const open: Open = { id, text: '', source: '', image: false };
  context.paragraph = open;
  for (const name of context.waiting.bookmarks.splice(0)) {
    if (!context.bookmarks.has(name)) context.bookmarks.set(name, context.note ?? id);
  }
  for (const comment of context.waiting.comments.splice(0)) rangeStart(context, comment);
  const read = merged(inlinesOf(context, elements(node), []));
  context.paragraph = null;
  // A comment still open here runs past its paragraph: clamped to where it starts (IM-G).
  for (const range of context.ranges.values()) {
    if (range.block === id && range.quote === null) {
      range.quote = open.text.slice(range.start);
      range.crossed = true;
    }
  }
  const styleId = val(first(pPr, 'w:pStyle'));
  const style = styleId === undefined ? undefined : context.styles.get(styleId);
  const text = open.text;
  const inlines = unsequenced(read);
  const block = { block: { type: 'paragraph', id, content: inlines }, source: open.source };

  const direct = Number(val(first(pPr, 'w:outlineLvl')));
  const heading =
    Number.isInteger(direct) && direct < 9
      ? { level: direct + 1, style: `Outline level ${direct + 1}` }
      : Number.isInteger(direct)
        ? undefined
        : headingOf(context.styles, styleId);
  if (!inCell && heading) {
    // A heading becomes a title: its changes are rejected, and said.
    if (inlines.some((each) => each.change !== undefined)) context.tally.headingChanges += 1;
    return text.trim() === ''
      ? { kind: 'empty' }
      : { kind: 'heading', ...heading, text: text.trim(), id };
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
  if (style && /^caption$/i.test(style.name)) {
    // A caption's words, after its label and number, which the theme prints (IMP-006).
    const at = read.findLastIndex((each) => each.type === 'sequence');
    const words = read.slice(at + 1).map((each) => ({ ...each }));
    const lead = words[0];
    if (lead?.type === 'text') {
      const trimmed = (lead.value as string).replace(/^[\s:.\-–—]+/, '');
      if (trimmed === '') words.shift();
      else lead.value = trimmed;
    }
    return {
      kind: 'caption',
      sequence: at === -1 ? null : (read[at]!.name as string),
      caption: unsequenced(words),
      id,
      block,
    };
  }
  // An image standing alone is a figure (IMP-006).
  const images = inlines.filter((each) => each.type === 'image');
  const others = inlines.filter(
    (each) =>
      each.type !== 'image' && !(each.type === 'text' && (each.value as string).trim() === ''),
  );
  if (images.length === 1 && others.length === 0) {
    const image = images[0]!;
    return {
      kind: 'block',
      block: {
        block: {
          type: 'figure',
          id,
          asset: image.asset,
          imageStyle: image.imageStyle,
          caption: [],
          alternative: image.alternative,
        },
        source: open.source,
      },
    };
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
  if (inlines.length === 0) {
    return open.image ? { kind: 'none' } : { kind: 'empty' };
  }
  return { kind: 'block', block };
}

/** A list's kind, format and start, from its numbering's level and what it has counted already. */
function listShape(context: Context, numId: string, ilvl: number, before: number) {
  const level = context.numbering.get(numId)?.get(ilvl);
  const format = level?.format ?? 'bullet';
  if (format === 'bullet' || format === 'none') return { kind: 'unordered' };
  const as = /letter/i.test(format) ? 'alphabetic' : /roman/i.test(format) ? 'roman' : 'decimal';
  if (as === 'decimal' && format !== 'decimal') notYetRead(context, 'numberFormat');
  const start = (level?.start ?? 1) + before;
  // A list starts where its numbering says, but never at a zeroth letter or numeral (CNT-153).
  const kept = start !== 1 && (start > 0 || as === 'decimal');
  return { kind: 'ordered', format: as, ...(kept ? { start } : {}) };
}

type ListBuild = { level: number; list: { items: { content: object[] }[] } & object };

/**
 * Consecutive list paragraphs as one list, nested by their level; a list using numbering an earlier
 * one used carries it on, as Word numbers it.
 */
function listOf(context: Context, items: readonly Extract<Paragraph, { kind: 'item' }>[]): Block {
  const head = items[0]!;
  const key = `${head.numId}:${head.ilvl}`;
  const make = (item: (typeof items)[number], before = 0) => ({
    type: 'list',
    id: newId(context),
    ...listShape(context, item.numId, item.ilvl, before),
    items: [] as { content: object[] }[],
  });
  const root: ListBuild = { level: head.ilvl, list: make(head, context.counted.get(key) ?? 0) };
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
  context.counted.set(key, (context.counted.get(key) ?? 0) + root.list.items.length);
  return { block: root.list, source: items.map((item) => item.block.source).join('\n') };
}

const captionFits = (block: Inline | undefined, sequence: string | null) =>
  block !== undefined &&
  Array.isArray(block.caption) &&
  block.caption.length === 0 &&
  (sequence === null || /^(table|figure)$/i.test(sequence)) &&
  (block.type === 'table'
    ? sequence === null || /^table$/i.test(sequence)
    : block.type === 'figure' && (sequence === null || /^figure$/i.test(sequence)));

/** A container's blocks - the body's, a cell's - with its list paragraphs gathered into lists. */
function blocksOf(
  context: Context,
  nodes: readonly XmlNode[],
  inCell: boolean,
  emit: (item: ImportFlowItem) => void,
) {
  let pending: Extract<Paragraph, { kind: 'item' }>[] = [];
  let caption: Extract<Paragraph, { kind: 'caption' }> | undefined;
  let last: Inline | undefined;
  const place = (item: Extract<Paragraph, { kind: 'caption' }>, onto: Inline) => {
    onto.caption = item.caption;
    context.aliases.set(item.id, onto.id as string);
  };
  /** A caption waiting for what follows: on it if it fits, else on what it followed, else a paragraph. */
  const settle = (next: Inline | undefined) => {
    if (!caption) return;
    const waiting = caption;
    caption = undefined;
    if (captionFits(next, waiting.sequence)) place(waiting, next!);
    else if (captionFits(last, waiting.sequence)) place(waiting, last!);
    else {
      context.tally.captions += 1;
      emit({ kind: 'block', ...waiting.block });
    }
  };
  const put = (item: ImportFlowItem) => {
    const block = item.kind === 'block' ? (item.block as Inline) : undefined;
    settle(block);
    emit(item);
    last = block;
  };
  const flush = () => {
    if (pending.length === 0) return;
    const { block, source } = listOf(context, pending);
    pending = [];
    put({ kind: 'block', block, source });
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
          if (read.kind === 'caption') {
            settle(undefined);
            // A figure's caption is below it, a table's above: each tried first where it usually is.
            if (
              read.sequence !== null &&
              /^figure$/i.test(read.sequence) &&
              captionFits(last, read.sequence)
            ) {
              place(read, last!);
            } else caption = read;
          } else if (read.kind === 'heading') {
            settle(undefined);
            emit({
              kind: 'heading',
              level: read.level,
              style: read.style,
              text: read.text,
              anchor: read.id,
            });
            last = undefined;
          } else if (read.kind === 'block') put({ kind: 'block', ...read.block });
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
            if (table) put({ kind: 'block', ...table });
          }
          break;
        case 'w:sdt':
          context.tally.contentControls += 1;
          walk(elements(first(node, 'w:sdtContent') ?? node));
          break;
        case 'w:customXml':
          walk(elements(node));
          break;
        case 'w:sectPr':
          context.tally.pageSetup = true;
          break;
        case 'w:bookmarkStart':
          bookmarkStart(context, node);
          break;
        case 'w:bookmarkEnd':
          context.open.delete(node.attributes['w:id'] ?? '');
          break;
        case 'w:commentRangeStart':
          rangeStart(context, node.attributes['w:id'] ?? '');
          break;
        case 'w:commentRangeEnd':
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
  settle(undefined);
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
      id: newId(context),
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
const SKIP = new Set(['w:object', 'mc:Choice']);
const KEEP_TEXT = new Set(['w:t', 'w:delText', 'w:instrText', 'w:delInstrText', 'm:t']);
/** The file's own properties, by the name each is kept as, and which say who or where (IM-J). */
const PROPERTIES: Readonly<Record<string, string>> = {
  'dc:title': 'title',
  'dc:subject': 'subject',
  'dc:description': 'description',
  'cp:keywords': 'keywords',
  'cp:category': 'category',
  'dc:creator': 'creator',
  'cp:lastModifiedBy': 'lastModifiedBy',
  'cp:lastPrinted': 'lastPrinted',
  'ep:Template': 'template',
  'ep:Company': 'company',
  'ep:Manager': 'manager',
  'ep:HyperlinkBase': 'hyperlinkBase',
};
const PERSONAL = new Set([
  'creator',
  'lastModifiedBy',
  'lastPrinted',
  'template',
  'company',
  'manager',
  'hyperlinkBase',
]);

/** The identifiers a reader gave that nothing names, removed: admission gives every block its own. */
function unnamed(value: unknown, needed: ReadonlySet<string>): void {
  if (Array.isArray(value)) {
    for (const each of value) unnamed(each, needed);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === 'string' &&
    /^w[bf]-/.test(record.id) &&
    !needed.has(record.id) &&
    record.type !== 'crossReference'
  ) {
    delete record.id;
  }
  for (const each of Object.values(record)) unnamed(each, needed);
}

export function readDocx(bytes: Uint8Array): DocxRead {
  const zip = readZip(bytes, (name) => WANTED.test(name));
  if (!zip.ok) return refusalOfZip(zip);
  const document = zip.parts.get('word/document.xml');
  if (!document) return { ok: false, refusal: 'unreadable', failure: 'Not a Word document' };

  const parsed: Record<string, XmlNode | undefined> = {};
  for (const name of [
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/footnotes.xml',
    'word/comments.xml',
    'word/commentsextended.xml',
    'word/people.xml',
    'word/settings.xml',
    'word/_rels/document.xml.rels',
    '[content_types].xml',
    'docprops/core.xml',
    'docprops/app.xml',
    'docprops/custom.xml',
  ]) {
    const part = zip.parts.get(name);
    const properties = name.startsWith('docprops/');
    const read =
      part &&
      readXml(part, {
        text: (each) => properties || KEEP_TEXT.has(each),
        skip: (each) => SKIP.has(each),
      });
    if (read && !read.ok) return refusalOfXml(read);
    parsed[name] = read?.root;
  }

  const report = createReport();
  const tally: Tally = {
    notYetRead: new Map(),
    fields: new Map(),
    formats: new Map(),
    appearance: 0,
    empties: 0,
    reshaped: 0,
    nested: 0,
    controls: 0,
    pageSetup: false,
    textBoxes: 0,
    contentControls: 0,
    captions: 0,
    headingChanges: 0,
    noteBlocks: 0,
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
  const images = new Map<string, string>();
  let external = 0;
  for (const relationship of elements(
    parsed['word/_rels/document.xml.rels'] ?? { name: '', attributes: {}, children: [] },
  )) {
    const { Id: id, Type: type = '', Target: target, TargetMode: mode } = relationship.attributes;
    if (mode !== 'External') {
      if (IMAGE.test(type) && id !== undefined && target !== undefined) images.set(id, target);
      continue;
    }
    if (HYPERLINK.test(type) && id !== undefined && target !== undefined) links.set(id, target);
    else external += 1;
  }
  if (external > 0) report.add('read', 'discarded', 'externalRelationship', { count: external });

  const footnotes = new Map<string, XmlNode>();
  for (const note of elements(
    parsed['word/footnotes.xml'] ?? { name: '', attributes: {}, children: [] },
    'w:footnote',
  )) {
    const type = note.attributes['w:type'];
    if (type === undefined || type === 'normal') footnotes.set(note.attributes['w:id'] ?? '', note);
  }

  const { styles, language } = stylesOf(parsed['word/styles.xml']);
  const context: Context = {
    styles,
    numbering: numberingOf(parsed['word/numbering.xml']),
    links,
    tally,
    fields: [],
    title: null,
    ids: { next: 0 },
    paragraph: null,
    change: undefined,
    note: null,
    bookmarks: new Map(),
    open: new Map(),
    waiting: { bookmarks: [], comments: [] },
    aliases: new Map(),
    references: [],
    ranges: new Map(),
    footnotes,
    notesRead: new Set(),
    media: { rels: images, parts: zip.parts, placed: new Map(), images: [] },
    authors: new Map(),
    counted: new Map(),
  };
  const body = first(parsed['word/document.xml'], 'w:body');
  if (!body) return { ok: false, refusal: 'unreadable', failure: 'A Word document with no body' };
  const flow: ImportFlowItem[] = [];
  blocksOf(context, elements(body), false, (item) => flow.push(item));

  // Each reference pointed at what its bookmark is in, or listed as outside the file (IMP-033).
  const needed = new Set<string>();
  const references: ImportReference[] = [];
  for (const each of context.references) {
    const found = context.bookmarks.get(each.bookmark);
    const target = found === undefined ? undefined : (context.aliases.get(found) ?? found);
    const numbered = target !== undefined && (target !== found || target.startsWith('wf-'));
    const display =
      each.field === 'NOTEREF'
        ? 'number'
        : each.field === 'PAGEREF'
          ? 'page'
          : /\\p\b/i.test(each.switches)
            ? 'relative'
            : /\\[rnw]\b/i.test(each.switches) || numbered
              ? 'number'
              : 'title';
    let block = target;
    if (block === undefined) {
      block = `wx-${references.length + 1}`;
      references.push({ key: block, bookmark: each.bookmark, field: each.field, text: each.text });
    } else needed.add(block);
    Object.assign(each.node, {
      target: { kind: 'block', block },
      display,
      ...(display === 'page' ? { withoutPages: 'number' } : {}),
    });
  }

  const comments = commentsOf(context, parsed);
  for (const comment of comments) needed.add(comment.block);
  unnamed(flow, needed);
  for (const [index, item] of flow.entries()) {
    if (item.kind !== 'heading') continue;
    const { anchor, ...rest } = item;
    flow[index] = anchor !== undefined && needed.has(anchor) ? item : rest;
  }

  const properties = propertiesOf(parsed);
  for (const role of ['creator', 'lastModifiedBy'] as const)
    carries(context, properties[role], role);
  const emails = new Map<string, string>();
  for (const person of elements(
    parsed['word/people.xml'] ?? { name: '', attributes: {}, children: [] },
    'w15:person',
  )) {
    const user = first(person, 'w15:presenceInfo')?.attributes['w15:userId'] ?? '';
    const email = /[^\s:@]+@[^\s:@]+\.[^\s:@]+/.exec(user)?.[0];
    const name = person.attributes['w15:author']?.trim();
    if (email && name) emails.set(name, email.toLowerCase());
  }
  const ORDER: readonly ImportIdentityRole[] = ['changes', 'comments', 'creator', 'lastModifiedBy'];
  const identities: ImportIdentity[] = [...context.authors]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, roles]) => ({
      name,
      email: emails.get(name) ?? null,
      carries: ORDER.filter((role) => roles.has(role)),
    }));

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
  say(tally.textBoxes, (extra) => report.add('read', 'discarded', 'textBox', extra));
  say(tally.contentControls, (extra) => report.add('read', 'rewritten', 'contentControl', extra));
  say(tally.captions, (extra) => report.add('read', 'rewritten', 'caption', extra));
  say(tally.noteBlocks, (extra) => report.add('read', 'rewritten', 'footnoteBlocks', extra));
  say(tally.headingChanges, (extra) => report.add('read', 'discarded', 'trackedChange', extra));
  for (const [keyword, count] of tally.fields) {
    report.add('read', 'rewritten', 'field', {
      ...(keyword === '' ? {} : { detail: keyword }),
      count,
    });
  }
  for (const [format, count] of tally.formats) {
    report.add('read', 'discarded', 'imageFormat', {
      ...(format === '' ? {} : { detail: format }),
      count,
    });
  }
  reportControls(report, tally.controls);
  if (tally.pageSetup) report.add('read', 'discarded', 'pageSetup');
  // The file's own properties are never content (IM-J): those saying who or where, said by name.
  const personal = [
    ...Object.keys(properties).filter((name) => PERSONAL.has(name)),
    ...(Object.keys(properties).some((name) => name.startsWith('custom:')) ? ['custom'] : []),
    ...(first(parsed['word/settings.xml'], 'w:rsids') ? ['rsid'] : []),
  ].sort();
  for (const name of personal)
    report.add('read', 'discarded', 'fileProperty', { detail: name, count: 1 });

  return {
    ok: true,
    flow,
    title: context.title,
    language,
    report: report.entries,
    references,
    comments,
    identities,
    images: context.media.images,
    properties,
  };
}

/** The file's own properties by name, from its core, extended and custom parts. */
function propertiesOf(parsed: Record<string, XmlNode | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of ['docprops/core.xml', 'docprops/app.xml']) {
    for (const each of elements(parsed[part] ?? { name: '', attributes: {}, children: [] })) {
      const name = PROPERTIES[each.name];
      const value = allText(each).trim();
      if (name !== undefined && value !== '') out[name] = value;
    }
  }
  for (const each of elements(
    parsed['docprops/custom.xml'] ?? { name: '', attributes: {}, children: [] },
    'op:property',
  )) {
    const name = each.attributes['name'];
    const value = allText(each).trim();
    if (name !== undefined && value !== '') out[`custom:${name}`] = value;
  }
  return out;
}

/**
 * The file's comments (IM-G), each with the span it covers where it starts, in the order the text
 * meets them; a reply, by the comment it answers, among that comment's replies.
 */
function commentsOf(
  context: Context,
  parsed: Record<string, XmlNode | undefined>,
): ImportComment[] {
  const root = parsed['word/comments.xml'];
  if (!root) return [];
  const byId = new Map<string, { reply: ImportReply; paraId: string | undefined }>();
  const byParagraph = new Map<string, string>();
  for (const comment of elements(root, 'w:comment')) {
    const id = comment.attributes['w:id'] ?? '';
    const paragraphs = elements(comment, 'w:p');
    const paraId = paragraphs.at(-1)?.attributes['w14:paraId'];
    const text = paragraphs
      .map((paragraph) => allText(paragraph))
      .join('\n')
      .trim();
    const author = comment.attributes['w:author']?.trim() || 'Unknown';
    carries(context, author, 'comments');
    byId.set(id, {
      reply: {
        author,
        initials: comment.attributes['w:initials'] ?? null,
        date: comment.attributes['w:date'] ?? null,
        text,
      },
      paraId,
    });
    if (paraId !== undefined) byParagraph.set(paraId, id);
  }
  const parents = new Map<string, string>();
  for (const each of elements(
    parsed['word/commentsextended.xml'] ?? { name: '', attributes: {}, children: [] },
    'w15:commentEx',
  )) {
    const child = byParagraph.get(each.attributes['w15:paraId'] ?? '');
    const parent = byParagraph.get(each.attributes['w15:paraIdParent'] ?? '');
    if (child !== undefined && parent !== undefined) parents.set(child, parent);
  }
  const out: ImportComment[] = [];
  for (const [id, range] of context.ranges) {
    const found = byId.get(id);
    if (!found || parents.has(id)) continue;
    const replies = [...byId]
      .filter(([other]) => parents.get(other) === id)
      .map(([, each]) => each.reply);
    out.push({
      id,
      block: range.block,
      quote: range.quote ?? '',
      before: range.before,
      crossed: range.crossed,
      ...found.reply,
      replies,
    });
  }
  return out;
}
