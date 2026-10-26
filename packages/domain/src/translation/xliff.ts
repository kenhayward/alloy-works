import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { Mark } from '../content/model/marks.js';

/**
 * **A component as XLIFF 2.1, and back** (docs/design/translation.md, "Translation jobs"; the XL plan,
 * XL-A to XL-C; LOC-018 to LOC-020). One `<unit>` a translatable text, keyed by its block's id and a
 * member: every paragraph wherever it stands (in a list item, a cell, a quotation, a footnote), a
 * definition list's term, a table's caption and note, a bound table's caption, empty and source
 * words, note and column headers and units, a figure's caption and own alternative text, a
 * quotation's attribution. Every inline node that is not text is a `<ph>`, by its place in the unit,
 * and comes back from the source, never from the file; so is text in code or in another language.
 * A mark is an `<sc>`/`<ec>` pair, overlapping and split as it likes, its attributes kept here by its
 * place. Pending insertions and comments are not sent: a variant has its own.
 */

/** One piece of a unit's text, as it is sent and as it comes back. */
export type XliffPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'ph'; readonly id: string }
  | { readonly kind: 'sc'; readonly id: string }
  | { readonly kind: 'ec'; readonly startRef: string };

type Path = readonly (string | number)[];

/** A unit as the source gives it: where its text stands, and the text, with what it holds apart. */
export interface XliffUnit {
  readonly id: string;
  /** Inline content, or words alone (a column's header, an alternative text). */
  readonly kind: 'inline' | 'words';
  readonly path: Path;
  readonly parts: readonly XliffPart[];
  /** Each placeholder's node, by its id; each pair's mark, by its start's id. */
  readonly placeholders: ReadonlyMap<string, InlineNode>;
  readonly marks: ReadonlyMap<string, Mark>;
  /** Each term its text uses, by the term's identity (XL-B). */
  readonly terms: readonly string[];
}

/** Marks a sent text never carries: a variant has its own suggestions and comments. */
const unsent = (mark: Mark) => mark.type === 'suggestion' || mark.type === 'comment';

/** Text held whole, as a placeholder: code, and words in another language (XL-A). */
const held = (node: InlineNode) =>
  node.type !== 'text' ||
  node.marks.some((mark) => mark.type === 'inlineCode' || mark.type === 'language');

/** A text another's suggestion inserts, pending: not sent, and not the variant's. */
const pending = (node: InlineNode) =>
  node.type === 'text' &&
  node.marks.some((mark) => mark.type === 'suggestion' && mark.operation === 'insert');

/** An inline array as a unit's parts. */
function encode(inlines: readonly InlineNode[]) {
  const parts: XliffPart[] = [];
  const placeholders = new Map<string, InlineNode>();
  const marks = new Map<string, Mark>();
  const terms = new Set<string>();
  let open: { readonly mark: Mark; readonly id: string }[] = [];
  const close = (keep: (mark: Mark) => boolean) => {
    for (const each of [...open].reverse()) {
      if (!keep(each.mark)) parts.push({ kind: 'ec', startRef: each.id });
    }
    open = open.filter((each) => keep(each.mark));
  };
  for (const node of inlines) {
    if (pending(node)) continue;
    if (held(node)) {
      const id = `p${placeholders.size + 1}`;
      placeholders.set(id, node);
      parts.push({ kind: 'ph', id });
      continue;
    }
    if (node.type !== 'text') continue;
    const wanted = node.marks.filter((mark) => !unsent(mark));
    for (const mark of wanted) if (mark.type === 'definedTerm') terms.add(mark.term);
    close((mark) => wanted.some((each) => each.id === mark.id));
    for (const mark of wanted) {
      if (open.some((each) => each.mark.id === mark.id)) continue;
      const id = `m${marks.size + 1}`;
      marks.set(id, mark);
      open.push({ mark, id });
      parts.push({ kind: 'sc', id });
    }
    if (node.value !== '') parts.push({ kind: 'text', text: node.value });
  }
  close(() => false);
  return { parts, placeholders, marks, terms: [...terms] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * **Every unit of a component** (XL-A), in reading order: each translatable text, inline or words,
 * with where it stands. A block equation, preformatted text and a bound table's rows send nothing.
 */
export function xliffUnits(content: ContentDocument): XliffUnit[] {
  const units: XliffUnit[] = [];
  const inline = (id: string, path: Path, inlines: unknown) => {
    if (!Array.isArray(inlines) || inlines.length === 0) return;
    const encoded = encode(inlines as InlineNode[]);
    // A text that is all a pending insertion sends nothing: nothing of it is the variant's.
    if (encoded.parts.length > 0) units.push({ id, kind: 'inline', path, ...encoded });
    // A footnote's paragraphs and an image's own alternative text are units of their own, after
    // the text they stand in.
    (inlines as InlineNode[]).forEach((node, index) => {
      if (node.type === 'footnote') blocks(node.content, [...path, index, 'content']);
      if (node.type === 'image' && node.alternative.kind === 'own') {
        words(
          `${id}.image.${index}`,
          [...path, index, 'alternative', 'text'],
          node.alternative.text,
        );
      }
    });
  };
  const words = (id: string, path: Path, text: unknown) => {
    if (typeof text !== 'string' || text === '') return;
    units.push({
      id,
      kind: 'words',
      path,
      parts: [{ kind: 'text', text }],
      placeholders: new Map(),
      marks: new Map(),
      terms: [],
    });
  };
  const blocks = (list: unknown, path: Path) => {
    if (!Array.isArray(list)) return;
    list.forEach((block: unknown, index) => {
      if (!isRecord(block) || typeof block.id !== 'string') return;
      const at = [...path, index];
      const b = `b.${block.id}`;
      switch (block.type) {
        case 'paragraph':
          inline(b, [...at, 'content'], block.content);
          break;
        case 'list':
          (block.items as Record<string, unknown>[]).forEach((item, k) => {
            inline(`${b}.term.${k}`, [...at, 'items', k, 'term'], item.term);
            blocks(item.content, [...at, 'items', k, 'content']);
          });
          break;
        case 'table':
          inline(`${b}.caption`, [...at, 'caption'], block.caption);
          (block.rows as { cells: { content: unknown }[] }[]).forEach((row, r) =>
            row.cells.forEach((cell, c) =>
              blocks(cell.content, [...at, 'rows', r, 'cells', c, 'content']),
            ),
          );
          inline(`${b}.note`, [...at, 'note'], block.note);
          break;
        case 'boundTable':
          inline(`${b}.caption`, [...at, 'caption'], block.caption);
          (block.columns as Record<string, unknown>[]).forEach((column, k) => {
            words(`${b}.column.${k}`, [...at, 'columns', k, 'header'], column.header);
            if (isRecord(column.unit)) {
              words(`${b}.unit.${k}`, [...at, 'columns', k, 'unit', 'text'], column.unit.text);
            }
          });
          inline(`${b}.empty`, [...at, 'empty'], block.empty);
          inline(`${b}.source`, [...at, 'source'], block.source);
          inline(`${b}.note`, [...at, 'note'], block.note);
          if (Array.isArray(block.notes)) {
            (block.notes as Record<string, unknown>[]).forEach((note, k) =>
              blocks(note.content, [...at, 'notes', k, 'content']),
            );
          }
          break;
        case 'figure':
          inline(`${b}.caption`, [...at, 'caption'], block.caption);
          if (isRecord(block.alternative) && block.alternative.kind === 'own') {
            words(`${b}.alternative`, [...at, 'alternative', 'text'], block.alternative.text);
          }
          break;
        case 'blockquote':
          blocks(block.content, [...at, 'content']);
          inline(`${b}.attribution`, [...at, 'attribution'], block.attribution);
          break;
        default:
          // A block equation and preformatted text are held whole.
          break;
      }
    });
  };
  blocks(content.content, ['content']);
  return units;
}

/** Why a unit's target cannot be read back. */
export interface XliffProblem {
  readonly unit: string;
  readonly problem:
    | 'missing'
    | 'unknown'
    | 'placeholder_missing'
    | 'placeholder_repeated'
    | 'placeholder_unknown'
    | 'pair_unknown'
    | 'not_words'
    | 'empty'
    /** Words the content model refuses where they stand: past a column header's length, say. */
    | 'invalid';
}

const at = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key as string] : undefined), root);

function put(root: unknown, path: Path, value: unknown) {
  const holder = at(root, path.slice(0, -1));
  if (isRecord(holder)) holder[path[path.length - 1] as string] = value;
}

/** A unit's target as inline nodes, its placeholders taken from `current` - the text as it stands. */
function decode(
  unit: XliffUnit,
  target: readonly XliffPart[],
  current: readonly InlineNode[],
): InlineNode[] | XliffProblem['problem'] {
  // The source's placeholders, in the order they were sent, read from the text as it stands now, so
  // a footnote whose paragraphs were translated already comes back translated.
  const now = encode(current).placeholders;
  const used = new Set<string>();
  const open: Mark[] = [];
  const nodes: InlineNode[] = [];
  for (const part of target) {
    if (part.kind === 'ph') {
      const node = now.get(part.id);
      if (node === undefined) return 'placeholder_unknown';
      if (used.has(part.id)) return 'placeholder_repeated';
      used.add(part.id);
      nodes.push(node);
    } else if (part.kind === 'sc') {
      const mark = unit.marks.get(part.id);
      if (mark === undefined) return 'pair_unknown';
      if (!open.some((each) => each.id === mark.id)) open.push(mark);
    } else if (part.kind === 'ec') {
      const mark = unit.marks.get(part.startRef);
      if (mark === undefined) return 'pair_unknown';
      const where = open.findIndex((each) => each.id === mark.id);
      if (where >= 0) open.splice(where, 1);
    } else if (part.text !== '') {
      const previous = nodes[nodes.length - 1];
      const marks = [...open];
      // One text node a run of one set of marks.
      if (
        previous?.type === 'text' &&
        previous.marks.length === marks.length &&
        previous.marks.every((mark) => marks.some((each) => each.id === mark.id))
      ) {
        nodes[nodes.length - 1] = { ...previous, value: previous.value + part.text };
      } else {
        nodes.push({ type: 'text', value: part.text, marks });
      }
    }
  }
  if (used.size !== now.size) return 'placeholder_missing';
  if (nodes.length === 0) return 'empty';
  return nodes;
}

/**
 * **A variant from a returned file** (XL-A): the source with each unit's text replaced by its
 * target, in `language`. Every unit must come back, and nothing else; a placeholder exactly once and
 * none invented; a pair's mark one the source sent. Structure is the source's: nothing the file holds
 * but its words reaches the content.
 */
export function xliffTarget(
  source: ContentDocument,
  targets: ReadonlyMap<string, readonly XliffPart[]>,
  language: string,
):
  | { readonly ok: true; readonly content: ContentDocument }
  | {
      readonly ok: false;
      readonly problems: readonly XliffProblem[];
    } {
  const units = xliffUnits(source);
  const problems: XliffProblem[] = [];
  const known = new Set(units.map((unit) => unit.id));
  for (const id of targets.keys()) {
    if (!known.has(id)) problems.push({ unit: id, problem: 'unknown' });
  }
  const working = structuredClone(source) as unknown;
  const applied: { readonly unit: string; readonly path: Path; readonly value: unknown }[] = [];
  const apply = (unit: XliffUnit, value: unknown) => {
    put(working, unit.path, value);
    applied.push({ unit: unit.id, path: unit.path, value });
  };
  // Deepest first, so a footnote's paragraphs are translated before the text it stands in reads it.
  const ordered = [...units].sort((a, b) => b.path.length - a.path.length);
  for (const unit of ordered) {
    const given = targets.get(unit.id);
    // Words as XML carries them may be decomposed; content holds them composed.
    const target = given?.map((part) =>
      part.kind === 'text' ? { ...part, text: part.text.normalize('NFC') } : part,
    );
    if (target === undefined) {
      problems.push({ unit: unit.id, problem: 'missing' });
      continue;
    }
    if (unit.kind === 'words') {
      if (target.some((part) => part.kind !== 'text')) {
        problems.push({ unit: unit.id, problem: 'not_words' });
        continue;
      }
      const text = target.map((part) => (part.kind === 'text' ? part.text : '')).join('');
      if (text.trim() === '') problems.push({ unit: unit.id, problem: 'empty' });
      else apply(unit, text);
      continue;
    }
    const current = (at(working, unit.path) ?? []) as InlineNode[];
    const decoded = decode(unit, target, current);
    if (typeof decoded === 'string') problems.push({ unit: unit.id, problem: decoded });
    else apply(unit, decoded);
  }
  if (problems.length > 0) return { ok: false, problems };
  try {
    return {
      ok: true,
      content: parseContentDocument({ ...(working as ContentDocument), language }),
    };
  } catch {
    // Refused, never thrown (the XL final review): each unit whose words alone the model refuses.
    const refused = applied.filter(({ path, value }) => {
      const alone = structuredClone(source) as unknown;
      put(alone, path, value);
      try {
        parseContentDocument(alone);
        return false;
      } catch {
        return true;
      }
    });
    return {
      ok: false,
      problems: (refused.length > 0 ? refused : applied.slice(0, 1)).map(({ unit }) => ({
        unit,
        problem: 'invalid' as const,
      })),
    };
  }
}

/** One component of a job's file: its identity, title and type, and its content as sent. */
export interface XliffFile {
  readonly component: string;
  readonly title: string;
  readonly type: string;
  readonly content: ContentDocument;
  /** Only these units, where a machine draft sends a component in pieces (XL-H); each still has its neighbours as context. */
  readonly units?: ReadonlySet<string> | undefined;
}

/** A term's labels for a job's glossary: its source label and, where given, its target's (XL-B). */
export interface XliffTerm {
  readonly source: string;
  readonly target?: string | undefined;
}

/** A character XML 1.0 cannot carry: a unit's text sends it as XLIFF's `<cp>`, anywhere else drops it. */
const uncarried = (code: number) =>
  code < 0x20
    ? code !== 0x09 && code !== 0x0a && code !== 0x0d
    : code === 0xfffe || code === 0xffff;

const escapeOne = (each: string) =>
  each === '&' ? '&amp;' : each === '<' ? '&lt;' : each === '>' ? '&gt;' : each;
const escape = (text: string) =>
  [...text].map((each) => (uncarried(each.charCodeAt(0)) ? '' : escapeOne(each))).join('');
const attribute = (text: string) => escape(text).replace(/"/g, '&quot;');
const withCodePoints = (text: string) =>
  [...text]
    .map((each) => {
      const code = each.charCodeAt(0);
      return uncarried(code)
        ? `<cp hex="${code.toString(16).toUpperCase().padStart(4, '0')}"/>`
        : escapeOne(each);
    })
    .join('');

/** A mark's pair, typed as XLIFF's core set reads it. */
function pairType(mark: Mark): string {
  switch (mark.type) {
    case 'strong':
      return ' type="fmt" subType="xlf:b"';
    case 'emphasis':
      return ' type="fmt" subType="xlf:i"';
    case 'underline':
      return ' type="fmt" subType="xlf:u"';
    case 'hyperlink':
      return ' type="link"';
    case 'quotedPhrase':
      return ' type="quote"';
    default:
      return ' type="other"';
  }
}

function partsXml(unit: XliffUnit): string {
  return unit.parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
          return withCodePoints(part.text);
        case 'ph':
          return `<ph id="${part.id}" canCopy="no" canDelete="no"/>`;
        case 'sc':
          return `<sc id="${part.id}"${pairType(unit.marks.get(part.id)!)} canCopy="no" canDelete="no"/>`;
        case 'ec':
          return `<ec startRef="${part.startRef}" canCopy="no" canDelete="no"/>`;
      }
    })
    .join('');
}

/** A unit's words alone, for its neighbours' context. */
const plain = (unit: XliffUnit | undefined) =>
  unit === undefined
    ? ''
    : unit.parts
        .map((part) => (part.kind === 'text' ? part.text : ' '))
        .join('')
        .trim();

/**
 * **A job's file** (XL-A, XL-B; LOC-018, LOC-019): XLIFF 2.1, one `<file>` a component, its title and
 * type as notes; one `<unit>` a translatable text, the text before and after as context, and the
 * terms it uses in a glossary with their target labels where the space gives them.
 */
export function writeXliff(input: {
  readonly job: string;
  readonly source: string;
  readonly target: string;
  readonly files: readonly XliffFile[];
  readonly terms: ReadonlyMap<string, XliffTerm>;
}): string {
  const files = input.files.map((file) => {
    const units = xliffUnits(file.content);
    const body = units.flatMap((unit, index) => {
      if (file.units !== undefined && !file.units.has(unit.id)) return [];
      const glossary = unit.terms.flatMap((term) => {
        const labels = input.terms.get(term);
        if (labels === undefined) return [];
        return [
          `<gls:glossEntry><gls:term>${escape(labels.source)}</gls:term>` +
            (labels.target === undefined
              ? ''
              : `<gls:translation>${escape(labels.target)}</gls:translation>`) +
            `</gls:glossEntry>`,
        ];
      });
      const context = [plain(units[index - 1]), plain(units[index + 1])]
        .filter((each) => each !== '')
        .map((each) => `<note category="context">${escape(each)}</note>`);
      return (
        `<unit id="${attribute(unit.id)}">` +
        (glossary.length === 0 ? '' : `<gls:glossary>${glossary.join('')}</gls:glossary>`) +
        (context.length === 0 ? '' : `<notes>${context.join('')}</notes>`) +
        `<segment><source>${partsXml(unit)}</source></segment></unit>`
      );
    });
    return (
      `<file id="f.${file.component}" original="component:${file.component}">` +
      `<notes><note category="title">${escape(file.title)}</note>` +
      `<note category="type">${escape(file.type)}</note></notes>` +
      body.join('') +
      `</file>`
    );
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" ` +
    `xmlns:gls="urn:oasis:names:tc:xliff:glossary:2.0" version="2.1" ` +
    `srcLang="${attribute(input.source)}" trgLang="${attribute(input.target)}">` +
    `<!-- Alloy Works translation job ${attribute(input.job)} -->` +
    files.join('') +
    `</xliff>\n`
  );
}
