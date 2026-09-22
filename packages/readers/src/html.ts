import {
  createReport,
  CURRENT_SCHEMA_VERSION,
  isLanguageLabel,
  type ReaderResult,
} from '@alloy-works/domain';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import { LINE_BREAK, refuseOversized, reportControls, withoutControls } from './text.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

/** A mark as the pipeline takes one: no identifier yet, which re-identify gives it (CNT-133). */
type Mark = { readonly type: string; readonly href?: string };

/**
 * Event handler names found on an element, handed over **once**: to the first run of text the
 * element holds, or to the paragraph it is. Sanitise reports each one it removes, and an `onclick`
 * on a wrapper round fifty runs is one thing that arrived, not fifty.
 */
type Handlers = { readonly names: readonly string[]; spent: boolean };

interface Context {
  readonly marks: readonly Mark[];
  /** What the text looked like, in the pipeline's vocabulary: `typeface`, `size`, `colour` and others. */
  readonly presentation: Readonly<Record<string, string>>;
  readonly handlers: Handlers | null;
  readonly depth: number;
}

type Run = {
  readonly type: 'text';
  readonly value: string;
  readonly marks: readonly Mark[];
  readonly handlers?: readonly string[];
};

type Block = Record<string, unknown>;

/**
 * Past this depth nothing more is read, and what was left is reported. A browser nests as deep as
 * the markup says; a reader walking it recursively would run out of stack on a page built to make it.
 */
const DEEPEST = 256;

/** Never content: the head, and the parts of a form that hold no text an author wrote. */
const IGNORED = new Set([
  'head',
  'style',
  'title',
  'meta',
  'link',
  'base',
  'template',
  'noscript',
  'input',
  'select',
  'textarea',
  'option',
  'datalist',
]);

/** Handed to sanitise as `embeddedObject`, which removes and reports each. */
const EMBEDDED = new Set([
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'svg',
  'applet',
  'frame',
  'frameset',
  'portal',
]);

/** A block that holds other blocks and is nothing itself: its children are read in its place. */
const CONTAINERS = new Set([
  'address',
  'article',
  'aside',
  'body',
  'caption',
  'center',
  'details',
  'dialog',
  'div',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'header',
  'hgroup',
  'html',
  'legend',
  'main',
  'nav',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  // Outside the list that gives each a meaning, where invalid markup can leave one.
  'li',
  'dd',
  'dt',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const ELEMENT_MARKS: Readonly<Record<string, string>> = {
  b: 'strong',
  strong: 'strong',
  i: 'emphasis',
  em: 'emphasis',
  u: 'underline',
  ins: 'underline',
  sub: 'subscript',
  sup: 'superscript',
  code: 'inlineCode',
  kbd: 'inlineCode',
  samp: 'inlineCode',
  tt: 'inlineCode',
  q: 'quotedPhrase',
};

/** Style properties that are presentation, by the name the pipeline reports each under. */
const PRESENTATION: Readonly<Record<string, string>> = {
  'font-family': 'typeface',
  'font-size': 'size',
  color: 'colour',
  background: 'highlight',
  'background-color': 'highlight',
  'text-align': 'alignment',
};

/** Word's list paragraph: which list, and at what level. */
const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)/i;
/** Word's list marker, which the paragraph carries as text and a list carries by its kind. */
const MSO_MARKER = /mso-list:\s*ignore/i;

/** What was read that the report has to mention, counted as the walk goes. */
class Tally {
  headings = 0;
  tables = 0;
  images = 0;
  mathematics = 0;
  rules = 0;
  empties = 0;
  controls = 0;
  tooDeep = 0;
}

/**
 * Where a walk puts what it reads: blocks, and the runs of a paragraph not yet closed. A block
 * element closes the paragraph standing open before it, which is how text between two blocks
 * becomes a paragraph of its own.
 */
class Sink {
  readonly blocks: Block[] = [];
  private runs: Run[] = [];
  private presentation: Record<string, string> = {};

  constructor(private readonly tally: Tally) {}

  text(value: string, context: Context): void {
    const handlers = context.handlers && !context.handlers.spent ? context.handlers : null;
    if (handlers) handlers.spent = true;
    this.runs.push({
      type: 'text',
      value,
      marks: context.marks,
      ...(handlers ? { handlers: handlers.names } : {}),
    });
    Object.assign(this.presentation, context.presentation);
  }

  /**
   * Closes the open paragraph. `explicit` is for a `p` or a heading, whose emptiness is spacing an
   * author put there and is counted; whitespace standing between two blocks is not a paragraph at
   * all, and is not.
   */
  close(explicit: boolean, handlers: readonly string[] = []): boolean {
    const runs = tidy(this.runs, this.tally);
    const presentation = this.presentation;
    this.runs = [];
    this.presentation = {};
    if (runs.every((run) => /^\s*$/.test(run.value))) {
      if (explicit) this.tally.empties += 1;
      return false;
    }
    this.blocks.push({
      type: 'paragraph',
      content: runs,
      ...(Object.keys(presentation).length > 0 ? { presentation } : {}),
      ...(handlers.length > 0 ? { handlers } : {}),
    });
    return true;
  }

  finish(): Block[] {
    this.close(false);
    return this.blocks;
  }
}

/**
 * A paragraph's runs with HTML's whitespace collapsed as a browser collapses it, across element
 * boundaries; the control characters a paragraph may not hold removed and counted; and neighbours
 * carrying the same marks joined.
 */
function tidy(runs: readonly Run[], tally: Tally): Run[] {
  const out: Run[] = [];
  let spaceBefore = true;
  for (const run of runs) {
    const cleaned = withoutControls(run.value.replace(/[ \t\n\r\f]+/g, ' '), 'paragraph');
    tally.controls += cleaned.removed;
    const value: string = spaceBefore ? cleaned.text.replace(/^ /, '') : cleaned.text;
    if (value === '') continue;
    spaceBefore = value.endsWith(' ');
    const previous = out.at(-1);
    if (previous && !previous.handlers && !run.handlers && sameMarks(previous.marks, run.marks)) {
      out[out.length - 1] = { ...previous, value: previous.value + value };
    } else {
      out.push({ ...run, value });
    }
  }
  const last = out.at(-1);
  if (last?.value.endsWith(' ')) {
    const value = last.value.slice(0, -1);
    if (value === '') out.pop();
    else out[out.length - 1] = { ...last, value };
  }
  return out;
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  JSON.stringify(a) === JSON.stringify(b);

const attribute = (element: Element, name: string) =>
  element.attrs.find((each) => each.name === name)?.value;

function declarations(element: Element): [string, string][] {
  const style = attribute(element, 'style') ?? '';
  return style.split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return [];
    return [
      [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()],
    ];
  });
}

function withMark(marks: readonly Mark[], mark: Mark): Mark[] {
  // A link inside a link is the inner one; any other mark is on or off, so a second is nothing new.
  if (mark.type === 'hyperlink')
    return [...marks.filter((each) => each.type !== 'hyperlink'), mark];
  return marks.some((each) => each.type === mark.type) ? [...marks] : [...marks, mark];
}

const withoutMark = (marks: readonly Mark[], type: string) =>
  marks.filter((each) => each.type !== type);

/** The context an element's children are read in: its marks, its presentation and its handlers. */
function within(element: Element, context: Context): Context {
  let marks: readonly Mark[] = context.marks;
  const presentation: Record<string, string> = { ...context.presentation };

  const own = ELEMENT_MARKS[element.tagName];
  if (own) marks = withMark(marks, { type: own });
  if (element.tagName === 'a') {
    const href = attribute(element, 'href');
    // As it arrived: whether a target may be stored is sanitise's to decide, in one place.
    if (href !== undefined) marks = withMark(marks, { type: 'hyperlink', href });
  }
  if (['s', 'strike', 'del'].includes(element.tagName)) presentation.decoration = 'line-through';
  if (element.tagName === 'font') {
    const face = attribute(element, 'face');
    const size = attribute(element, 'size');
    const color = attribute(element, 'color');
    if (face !== undefined) presentation.typeface = face;
    if (size !== undefined) presentation.size = size;
    if (color !== undefined) presentation.colour = color;
  }

  for (const [property, value] of declarations(element)) {
    const lower = value.toLowerCase();
    if (property === 'font-weight') {
      const weight = Number(lower);
      if (lower === 'bold' || lower === 'bolder' || weight >= 600) {
        marks = withMark(marks, { type: 'strong' });
      } else if (lower === 'normal' || lower === 'lighter' || (weight > 0 && weight < 600)) {
        // Google Docs wraps a whole paste in a `b` that says it is not bold.
        marks = withoutMark(marks, 'strong');
      }
    } else if (property === 'font-style') {
      if (lower === 'italic' || lower.startsWith('oblique')) {
        marks = withMark(marks, { type: 'emphasis' });
      } else if (lower === 'normal') marks = withoutMark(marks, 'emphasis');
    } else if (property === 'text-decoration' || property === 'text-decoration-line') {
      if (lower.includes('underline')) marks = withMark(marks, { type: 'underline' });
      if (lower.includes('line-through')) presentation.decoration = value;
    } else if (property === 'vertical-align') {
      if (lower === 'super') marks = withMark(marks, { type: 'superscript' });
      if (lower === 'sub') marks = withMark(marks, { type: 'subscript' });
    } else {
      const name = PRESENTATION[property];
      if (name !== undefined) presentation[name] = value;
    }
  }

  const handlers = element.attrs
    .map((each) => each.name)
    .filter((name) => name.toLowerCase().startsWith('on'));
  return {
    marks,
    presentation,
    handlers: handlers.length > 0 ? { names: handlers, spent: false } : context.handlers,
    depth: context.depth + 1,
  };
}

const isElement = (node: ChildNode): node is Element => 'tagName' in node;

const isBlank = (node: ChildNode) =>
  node.nodeName === '#comment' || (node.nodeName === '#text' && /^\s*$/.test(textValue(node)));

const isText = (node: ChildNode): node is TextNode => node.nodeName === '#text';

const textValue = (node: ChildNode) => (isText(node) ? node.value : '');

const wordLevel = (node: ChildNode) =>
  isElement(node) ? MSO_LIST.exec(attribute(node, 'style') ?? '') : null;

/** Reads a run of siblings, gathering Word's consecutive list paragraphs into one list. */
function walkChildren(
  nodes: readonly ChildNode[],
  context: Context,
  sink: Sink,
  tally: Tally,
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (wordLevel(node)) {
      const paragraphs: Element[] = [];
      let end = index;
      for (let at = index; at < nodes.length; at += 1) {
        const each = nodes[at]!;
        if (wordLevel(each)) {
          paragraphs.push(each as Element);
          end = at;
        } else if (!isBlank(each)) break;
      }
      sink.close(false);
      sink.blocks.push(...wordLists(paragraphs, context, tally));
      index = end;
      continue;
    }
    walk(node, context, sink, tally);
  }
}

function walk(node: ChildNode, context: Context, sink: Sink, tally: Tally): void {
  if (node.nodeName === '#text') {
    sink.text(textValue(node), context);
    return;
  }
  if (!isElement(node)) return;
  if (context.depth >= DEEPEST) {
    tally.tooDeep += 1;
    return;
  }
  const name = node.tagName;
  if (IGNORED.has(name)) return;
  if (MSO_MARKER.test(attribute(node, 'style') ?? '')) return;
  if (name === 'script') {
    sink.blocks.push({ type: 'script', name });
    return;
  }
  if (EMBEDDED.has(name)) {
    sink.blocks.push({ type: 'embeddedObject', name });
    return;
  }
  if (name === 'img') {
    tally.images += 1;
    return;
  }
  if (name === 'math') {
    tally.mathematics += 1;
    return;
  }
  if (name === 'hr') {
    sink.close(false);
    tally.rules += 1;
    return;
  }
  if (name === 'br') {
    sink.close(false);
    return;
  }

  const inner = within(node, context);
  if (name === 'p' || HEADINGS.has(name)) {
    sink.close(false);
    const before = sink.blocks.length;
    const leftOut = tally.images + tally.mathematics;
    // The paragraph's own handlers are its own, not its first run's.
    walkChildren(node.childNodes, { ...inner, handlers: context.handlers }, sink, tally);
    const own = inner.handlers === context.handlers ? [] : (inner.handlers?.names ?? []);
    // Empty only if nothing at all came of it: a trailing `br` leaves an empty remainder that is
    // nobody's spacing, and a paragraph that held only an image is reported as the image.
    const spacing = sink.blocks.length === before && tally.images + tally.mathematics === leftOut;
    const made = sink.close(spacing, own);
    if (HEADINGS.has(name) && (made || sink.blocks.length > before)) tally.headings += 1;
    return;
  }
  if (name === 'ul' || name === 'ol') {
    sink.close(false);
    const list = readList(node, inner, tally);
    if (list) sink.blocks.push(list);
    return;
  }
  if (name === 'dl') {
    sink.close(false);
    const list = readDefinitionList(node, inner, tally);
    if (list) sink.blocks.push(list);
    return;
  }
  if (name === 'blockquote') {
    sink.close(false);
    const content = blocksOf(node.childNodes, inner, tally);
    if (content.length > 0) sink.blocks.push({ type: 'blockquote', content });
    return;
  }
  if (name === 'pre') {
    sink.close(false);
    const block = readPreformatted(node, tally);
    if (block) sink.blocks.push(block);
    return;
  }
  if (CONTAINERS.has(name)) {
    if (name === 'table') tally.tables += 1;
    sink.close(false);
    walkChildren(node.childNodes, inner, sink, tally);
    sink.close(false);
    return;
  }
  // Anything else is inline, or unknown: its children, in its context.
  walkChildren(node.childNodes, inner, sink, tally);
}

function blocksOf(nodes: readonly ChildNode[], context: Context, tally: Tally): Block[] {
  const sink = new Sink(tally);
  walkChildren(nodes, context, sink, tally);
  return sink.finish();
}

const EMPTY_PARAGRAPH: Block = { type: 'paragraph', content: [] };

function readList(element: Element, context: Context, tally: Tally): Block | undefined {
  const items: { content: Block[] }[] = [];
  for (const child of element.childNodes) {
    if (isBlank(child)) continue;
    if (isElement(child) && child.tagName === 'li') {
      const content = blocksOf(child.childNodes, within(child, context), tally);
      if (content.length === 0) tally.empties += 1;
      else items.push({ content });
      continue;
    }
    // A list or text standing directly in a list, which invalid markup makes common: it belongs
    // to the item before it.
    const content = blocksOf([child], context, tally);
    if (content.length === 0) continue;
    const last = items.at(-1);
    if (last) last.content.push(...content);
    else items.push({ content });
  }
  if (items.length === 0) return undefined;

  if (element.tagName === 'ul') return { type: 'list', kind: 'unordered', items };
  const start = Number(attribute(element, 'start') ?? '1');
  const type = attribute(element, 'type') ?? '1';
  const format = /^[aA]$/.test(type) ? 'alphabetic' : /^[iI]$/.test(type) ? 'roman' : undefined;
  return {
    type: 'list',
    kind: 'ordered',
    ...(Number.isInteger(start) && start >= 0 && start !== 1 ? { start } : {}),
    ...(format ? { format } : {}),
    items,
  };
}

function readDefinitionList(element: Element, context: Context, tally: Tally): Block | undefined {
  const items: { term?: unknown[]; content: Block[] }[] = [];
  const read = (nodes: readonly ChildNode[]) => {
    for (const child of nodes) {
      if (!isElement(child)) continue;
      if (child.tagName === 'div') {
        // HTML lets a definition list group its terms in `div`s.
        read(child.childNodes);
      } else if (child.tagName === 'dt') {
        const term = blocksOf(child.childNodes, within(child, context), tally).flatMap(
          (block) => (block.content as unknown[] | undefined) ?? [],
        );
        items.push({ ...(term.length > 0 ? { term } : {}), content: [] });
      } else if (child.tagName === 'dd') {
        const content = blocksOf(child.childNodes, within(child, context), tally);
        const last = items.at(-1);
        if (last) last.content.push(...content);
        else if (content.length > 0) items.push({ content });
      }
    }
  };
  read(element.childNodes);
  if (items.length === 0) return undefined;
  return {
    type: 'list',
    kind: 'definition',
    // An item holds at least one block, and a term typed with nothing under it yet has an empty one,
    // exactly as the editor makes it.
    items: items.map((item) =>
      item.content.length > 0 ? item : { ...item, content: [EMPTY_PARAGRAPH] },
    ),
  };
}

/** Every character a `pre` holds, a `br` as a line feed, kept exactly otherwise. */
function textOf(nodes: readonly ChildNode[]): string {
  return nodes
    .map((node) => {
      if (node.nodeName === '#text') return textValue(node);
      if (!isElement(node)) return '';
      if (node.tagName === 'br') return '\n';
      return textOf(node.childNodes);
    })
    .join('');
}

function readPreformatted(element: Element, tally: Tally): Block | undefined {
  const kept = withoutControls(
    textOf(element.childNodes).replace(LINE_BREAK, '\n'),
    'preformatted',
  );
  tally.controls += kept.removed;
  if (kept.text === '') return undefined;
  const code = element.childNodes.find(
    (child): child is Element => isElement(child) && child.tagName === 'code',
  );
  const classes = `${attribute(element, 'class') ?? ''} ${code ? (attribute(code, 'class') ?? '') : ''}`;
  const label = /(?:^|\s)(?:language|lang)-(\S+)/.exec(classes)?.[1];
  return {
    type: 'preformatted',
    text: kept.text,
    ...(label !== undefined && isLanguageLabel(label) ? { language: label } : {}),
  };
}

/** The marker Word writes before a list paragraph's text: `1.`, `a)`, `o`, a bullet. */
function markerOf(element: Element): string {
  for (const child of element.childNodes) {
    if (!isElement(child)) continue;
    if (MSO_MARKER.test(attribute(child, 'style') ?? '')) {
      return textOf(child.childNodes).replace(/\s+/g, '');
    }
    const found = markerOf(child);
    if (found !== '') return found;
  }
  return '';
}

const ROMAN: Readonly<Record<string, number>> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

/**
 * A list of the kind its first marker says: a number, a letter, a roman numeral, or a bullet.
 *
 * **Numbering ends in `.` or `)`, and anything else is a bullet.** Word draws its second-level bullet
 * as the letter `o` in Courier New, which read as a letter would make every nested bulleted list from
 * Word an alphabetic one starting at 15; its numbered markers are always `1.`, `a.` or `i.`.
 */
function listFor(marker: string): Block & { items: { content: Block[] }[] } {
  const numbered = /^\(?([0-9a-z]+)[.)]$/i.exec(marker);
  const bare = numbered?.[1] ?? '';
  const items: { content: Block[] }[] = [];
  const counted = (start: number, format?: string) => ({
    type: 'list',
    kind: 'ordered',
    ...(start !== 1 ? { start } : {}),
    ...(format ? { format } : {}),
    items,
  });
  if (/^\d+$/.test(bare)) return counted(Number(bare));
  const roman = ROMAN[bare.toLowerCase()];
  if (roman !== undefined) return counted(roman, 'roman');
  if (/^[a-z]$/i.test(bare)) return counted(bare.toLowerCase().charCodeAt(0) - 96, 'alphabetic');
  return { type: 'list', kind: 'unordered', items };
}

/**
 * Word's list paragraphs, as lists. Word writes a list as paragraphs, each naming its list and
 * level in its style and carrying its marker as text; there is no `ul` or `ol`. Consecutive ones are
 * one list, nested by level, and the kind comes from the marker.
 */
function wordLists(paragraphs: readonly Element[], context: Context, tally: Tally): Block[] {
  const roots: Block[] = [];
  const open: { level: number; list: ReturnType<typeof listFor> }[] = [];
  for (const paragraph of paragraphs) {
    const level = Number(wordLevel(paragraph)![2]);
    const content = blocksOf(paragraph.childNodes, within(paragraph, context), tally);
    const item = { content: content.length > 0 ? content : [EMPTY_PARAGRAPH] };
    while (open.length > 0 && open.at(-1)!.level > level) open.pop();
    const top = open.at(-1);
    if (!top || top.level < level) {
      const list = listFor(markerOf(paragraph));
      if (top) top.list.items.at(-1)!.content.push(list);
      else roots.push(list);
      open.push({ level, list });
    }
    open.at(-1)!.list.items.push(item);
  }
  return roots;
}

/**
 * HTML, as the pipeline's input (content-model.md, "The admission boundary"): what a browser, Word
 * or Google Docs puts on the clipboard.
 *
 * It reads what the editor can hold - paragraphs, the three kinds of list, quotations, preformatted
 * text and the marks - and says in the report what it kept differently or left out. It removes
 * nothing hostile itself: a script, an embedded object, an event handler, a style and a link's target
 * are handed over in the pipeline's own vocabulary, so sanitising happens once, in `admit`, on one
 * set of terms (CNT-130).
 *
 * **It reads no `lang` and no `dir`.** Word marks every run with the language of the keyboard it was
 * typed on, so reading them would put a language mark on most of what is pasted from it; the
 * receiving component's language stands.
 */
export function readHtml(html: string): ReaderResult {
  const refused = refuseOversized(html);
  if (refused) return refused;
  const tally = new Tally();
  const context: Context = { marks: [], presentation: {}, handlers: null, depth: 0 };
  const content = blocksOf(parse(html).childNodes, context, tally);

  const report = createReport();
  const say = (count: number, add: (extra: { count: number }) => void) => {
    if (count > 0) add({ count });
  };
  say(tally.headings, (extra) => report.add('read', 'rewritten', 'heading', extra));
  say(tally.tables, (extra) => report.add('read', 'rewritten', 'table', extra));
  say(tally.images, (extra) => report.add('read', 'discarded', 'image', extra));
  say(tally.mathematics, (extra) => report.add('read', 'discarded', 'mathematics', extra));
  say(tally.rules, (extra) => report.add('read', 'discarded', 'rule', extra));
  say(tally.empties, (extra) => report.add('read', 'discarded', 'emptyParagraph', extra));
  reportControls(report, tally.controls);
  say(tally.tooDeep, (extra) => report.add('read', 'discarded', 'unrepresentable', extra));

  return {
    ok: true,
    input: {
      candidate: { schemaVersion: CURRENT_SCHEMA_VERSION, content },
      report: report.entries,
    },
  };
}
