import CSL from 'citeproc';

import {
  PUBLISHED_MARK_ORDER,
  type PublishedMark,
  type PublishedRun,
} from '../publishing/published.js';
import { CSL_LOCALES } from './csl/files.js';
import { CSL_TYPES, type CslItem } from './entry.js';
import {
  CitationStyleRefused,
  parseCitationStyle,
  type CitationStyle,
  type Requires,
  type StyleProblem,
} from './style.js';

/**
 * **The citations module** (citations.md, "Rendering"; the CI plan, CI-A and CI-F): citeproc-js,
 * unmodified, given a style, a locale and the entries as data, never a file. It answers each
 * citation's in-text form and the bibliography's entries, in the style's order and with its
 * disambiguation, as runs a published document draws: citeproc's HTML output read into text and the
 * marks it can carry. Small capitals have no mark, so are set as plain text.
 *
 * Imported as `@alloy-works/domain/citations`, never from the package's root, so the processor stays
 * out of the renderer.
 */

/** A citation in reading order: the entry it cites, by the identity `entries` keys it under. */
export interface CitationIn {
  readonly entry: string;
  readonly locator?: string;
}

export interface RenderRequest {
  /** The style's CSL. */
  readonly style: string;
  /** The document's language; a locale not held falls back to `en-US`. */
  readonly language?: string;
  /** CSL locales by language tag: the bundled four unless given. */
  readonly locales?: Readonly<Record<string, string>>;
  readonly entries: Readonly<Record<string, CslItem>>;
  readonly citations: readonly CitationIn[];
}

/** One bibliography entry: its number or label where the style sets one apart, and its text. */
export interface RenderedEntry {
  readonly entry: string;
  readonly label?: readonly PublishedRun[];
  readonly runs: readonly PublishedRun[];
}

export interface Rendered {
  /** Each citation's in-text form, in reading order. */
  readonly citations: readonly (readonly PublishedRun[])[];
  /** The entries cited, in the style's order. */
  readonly bibliography: readonly RenderedEntry[];
}

const FALLBACK = 'en-US';

/** Renders every citation of a document and its bibliography. Throws on an entry not given. */
export function renderCitations(request: RenderRequest): Rendered {
  const tooLarge = expansionProblem(CSL.parseXml(request.style));
  if (tooLarge !== undefined) throw new Error(tooLarge);
  const locales: Readonly<Record<string, string>> = request.locales ?? CSL_LOCALES;
  const held = request.language !== undefined && locales[request.language] !== undefined;
  for (const citation of request.citations) {
    if (!Object.hasOwn(request.entries, citation.entry)) {
      throw new Error(`No entry ${citation.entry} was given to render`);
    }
  }
  const engine = new CSL.Engine(
    {
      retrieveLocale: (language) => locales[language],
      retrieveItem: (id) => ({ ...request.entries[id], id }),
    },
    request.style,
    held ? request.language : FALLBACK,
    held,
  );
  const answered = engine.rebuildProcessorState(
    request.citations.map((citation, n) => ({
      citationID: `c${n}`,
      citationItems: [
        citation.locator === undefined
          ? { id: citation.entry }
          : { id: citation.entry, locator: citation.locator, label: 'page' },
      ],
      properties: { noteIndex: 0 },
    })),
    'html',
  );
  const byId = new Map(answered.map(([id, , html]) => [id, html]));
  const citations = request.citations.map((_, n) => runsOf(byId.get(`c${n}`) ?? '').runs);
  const made = request.citations.length === 0 ? false : engine.makeBibliography();
  const bibliography = made
    ? made[1].map((html, n) => {
        const { label, runs } = runsOf(html);
        return { entry: made[0].entry_ids[n]![0]!, ...(label ? { label } : {}), runs };
      })
    : [];
  return { citations, bibliography };
}

/** Runs' text alone. */
export function plainText(runs: readonly PublishedRun[]): string {
  return runs.map((each) => each.text).join('');
}

type Mark = PublishedMark['kind'];
type State = { readonly marks: ReadonlySet<Mark>; readonly href?: string };

const ENTITY: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A character reference's code point, or the reference as written where it names none. */
const character = (whole: string, code: number) =>
  code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? whole : String.fromCodePoint(code);

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) =>
    name.startsWith('#x') || name.startsWith('#X')
      ? character(whole, parseInt(name.slice(2), 16))
      : name.startsWith('#')
        ? character(whole, parseInt(name.slice(1), 10))
        : (ENTITY[name] ?? whole),
  );

const with_ = (state: State, mark: Mark, on: boolean): State => {
  const marks = new Set(state.marks);
  if (on) marks.add(mark);
  else marks.delete(mark);
  return { ...state, marks };
};

/** What one of citeproc's HTML tags does to the marks inside it. */
function opened(state: State, tag: string, attributes: string): State {
  const style = /style="([^"]*)"/.exec(attributes)?.[1] ?? '';
  switch (tag) {
    case 'i':
    case 'em':
      return with_(state, 'emphasis', true);
    case 'b':
      return with_(state, 'strong', true);
    case 'sup':
      return with_(with_(state, 'subscript', false), 'superscript', true);
    case 'sub':
      return with_(with_(state, 'superscript', false), 'subscript', true);
    case 'a': {
      // An entry's URL or DOI is data: a link is carried only where it is http or https, so no
      // published run, PDF or Word, links to a script.
      const href = webAddress(decode(/href="([^"]*)"/.exec(attributes)?.[1] ?? ''));
      return href === undefined ? state : { ...with_(state, 'hyperlink', true), href };
    }
    case 'span':
      if (style.includes('font-style:normal')) return with_(state, 'emphasis', false);
      if (style.includes('font-weight:normal')) return with_(state, 'strong', false);
      if (style.includes('text-decoration:underline')) return with_(state, 'underline', true);
      if (style.includes('text-decoration:none')) return with_(state, 'underline', false);
      if (style === 'baseline') {
        return with_(with_(state, 'superscript', false), 'subscript', false);
      }
      // Small capitals, and anything else: no mark carries it.
      return state;
    default:
      return state;
  }
}

/** `text` as an http or https address, or undefined where it is anything else. */
export function webAddress(text: string): string | undefined {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const TAG = /<(\/?)([a-z]+)([^>]*)>|([^<]+)/gi;

/**
 * citeproc's HTML for one citation or one bibliography entry, read into runs: its text is escaped, so
 * every tag is citeproc's own. A numbered style's label (`csl-left-margin`) is kept apart.
 */
export function runsOf(html: string): { label?: PublishedRun[]; runs: PublishedRun[] } {
  const label: PublishedRun[] = [];
  const runs: PublishedRun[] = [];
  const stack: { tag: string; state: State; into: PublishedRun[] }[] = [];
  let state: State = { marks: new Set() };
  let into = runs;
  for (const match of html.matchAll(TAG)) {
    const [, closing, tag, attributes, text] = match;
    if (text !== undefined) {
      // Whitespace between citeproc's blocks is layout, not text.
      if (text.trim() === '' && /\n/.test(text)) continue;
      push(into, decode(text), state);
      continue;
    }
    const name = tag!.toLowerCase();
    if (!['i', 'em', 'b', 'sup', 'sub', 'span', 'a', 'div'].includes(name)) {
      throw new Error(`citeproc wrote a tag this module does not read: ${name}`);
    }
    if (closing) {
      const top = stack.pop();
      if (top?.tag !== name) throw new Error(`citeproc's HTML does not nest at </${name}>`);
      state = top.state;
      into = top.into;
      continue;
    }
    stack.push({ tag: name, state, into });
    if (name === 'div' && /class="csl-left-margin"/.test(attributes!)) into = label;
    else if (name === 'div' && /class="csl-right-inline"/.test(attributes!)) into = runs;
    state = opened(state, name, attributes!);
  }
  const trimmed = trim(runs);
  return label.length > 0 ? { label: trim(label), runs: trimmed } : { runs: trimmed };
}

function push(into: PublishedRun[], text: string, state: State) {
  if (text === '') return;
  const marks: PublishedMark[] = PUBLISHED_MARK_ORDER.filter((kind) => state.marks.has(kind)).map(
    (kind) => (kind === 'hyperlink' ? { kind, href: state.href! } : ({ kind } as PublishedMark)),
  );
  const last = into.at(-1);
  if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) {
    into[into.length - 1] = { text: last.text + text, marks };
  } else {
    into.push({ text, marks });
  }
}

function trim(runs: PublishedRun[]): PublishedRun[] {
  const out = [...runs];
  if (out[0]) out[0] = { ...out[0], text: out[0].text.trimStart() };
  const last = out.length - 1;
  if (out[last]) out[last] = { ...out[last], text: out[last].text.trimEnd() };
  return out.filter((each) => each.text !== '');
}

// ---------------------------------------------------------------------------------------------------
// Checking a style
// ---------------------------------------------------------------------------------------------------

const CSL_NAMESPACE = 'http://purl.org/net/xbiblio/csl';

const problem = (message: string, path = 'csl'): StyleProblem => ({
  rule: 'style_invalid',
  path,
  message,
});

/**
 * Whether `xml` is well formed as far as CSL needs: elements that nest and close, quoted attributes,
 * and no document type, so nothing is expanded. citeproc's own parser reads anything.
 */
function wellFormed(xml: string): string | undefined {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return 'A style declares no document type or entity';
  const body = xml
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^?]*\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const open: string[] = [];
  let roots = 0;
  for (const match of body.matchAll(/<([^>]*)>|([^<]+)|(<)/g)) {
    const [, tag, text, stray] = match;
    if (stray !== undefined) return 'A "<" opens no tag';
    if (text !== undefined) {
      if (open.length === 0 && text.trim() !== '') return 'Text stands outside the root element';
      continue;
    }
    const element =
      /^(\/)?([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/)?$/.exec(tag!);
    if (!element) return `<${tag}> is not a tag`;
    const [, closing, name, , empty] = element;
    if (closing) {
      if (open.pop() !== name) return `</${name}> closes nothing open`;
    } else {
      if (open.length === 0) roots += 1;
      if (!empty) open.push(name!);
    }
  }
  if (open.length > 0) return `<${open.at(-1)}> is never closed`;
  if (roots !== 1) return 'A style is one root element';
  return undefined;
}

const elements = (node: CslNode) =>
  node.children.filter((each): each is CslNode => typeof each !== 'string');

type CslNode = ReturnType<typeof CSL.parseXml>;

/** The most elements a style may expand to once its macros are followed: the seeded ones, a few thousand. */
const MOST_EXPANDED = 50_000;

/**
 * Why a style is too large to render, or undefined: citeproc expands every macro call in place, so
 * macros each calling the one before twice grow exponentially and hang it. Each macro's expanded size
 * is counted once, and a macro that calls itself is refused.
 */
function expansionProblem(root: CslNode): string | undefined {
  const macros = new Map(
    elements(root)
      .filter((each) => each.name === 'macro')
      .map((each) => [each.attrs.name, each]),
  );
  const sizes = new Map<string, number>();
  const open = new Set<string>();
  let recursive: string | undefined;
  const size = (node: CslNode): number => {
    let total = 1;
    const called = node.attrs.macro === undefined ? undefined : macros.get(node.attrs.macro);
    if (called !== undefined) {
      const name = node.attrs.macro!;
      if (open.has(name)) recursive ??= name;
      else {
        if (!sizes.has(name)) {
          open.add(name);
          sizes.set(name, size(called));
          open.delete(name);
        }
        total += sizes.get(name)!;
      }
    }
    for (const child of elements(node)) total += size(child);
    return total;
  };
  const expanded = elements(root)
    .filter((each) => each.name !== 'macro')
    .reduce((sum, each) => sum + size(each), 1);
  if (recursive !== undefined) return `The style's macro ${recursive} calls itself`;
  if (expanded > MOST_EXPANDED) {
    return `The style expands to more than ${MOST_EXPANDED} elements once its macros are followed`;
  }
  return undefined;
}

/**
 * Every way `xml` is not a CSL 1.0.2 style this processor renders (STY-023): well formed; its root a
 * `style` in CSL's namespace at version 1.0, with both forms (STY-020); and rendering the sample entries
 * without error. A dependent style is refused, naming the parent to upload instead.
 */
export function checkStyle(xml: string): StyleProblem[] {
  const malformed = wellFormed(xml);
  if (malformed) return [problem(`The file is not XML: ${malformed}`)];
  const root = CSL.parseXml(xml);
  if (root.name !== 'style' || root.attrs.xmlns !== CSL_NAMESPACE) {
    return [problem('The file is not a CSL style: its root is not a style in the CSL namespace')];
  }
  const problems: StyleProblem[] = [];
  if (root.attrs.version !== '1.0') {
    problems.push(problem(`The style is CSL ${root.attrs.version ?? 'of no version'}, not 1.0`));
  }
  const children = elements(root);
  const parent = children
    .find((each) => each.name === 'info')
    ?.children.find(
      (each): each is CslNode =>
        typeof each !== 'string' && each.name === 'link' && each.attrs.rel === 'independent-parent',
    );
  if (parent) {
    return [
      problem(
        `The style is a dependent style: upload its parent, ${parent.attrs.href ?? 'which it does not name'}`,
      ),
    ];
  }
  for (const form of ['citation', 'bibliography'] as const) {
    if (!children.some((each) => each.name === form)) {
      problems.push(problem(`The style declares no ${form} form`));
    }
  }
  if (problems.length > 0) return problems;
  const tooLarge = expansionProblem(root);
  if (tooLarge !== undefined) return [problem(tooLarge)];
  try {
    renderCitations({ style: xml, entries: SAMPLE_ENTRIES, citations: SAMPLE_CITATIONS });
  } catch (error) {
    return [
      problem(`The style does not render: ${error instanceof Error ? error.message : error}`),
    ];
  }
  return [];
}

/**
 * A style version as every write takes it: its shape, and its CSL checked by `checkStyle`. Throws
 * `CitationStyleRefused`.
 */
export function parseCitationStyleForWrite(value: unknown): CitationStyle {
  const style = parseCitationStyle(value);
  const problems = checkStyle(style.csl);
  if (problems.length > 0) throw new CitationStyleRefused(problems);
  return style;
}

/** The style's title, from its `info`, where it gives one. */
export function styleTitle(xml: string): string | undefined {
  const info = elements(CSL.parseXml(xml)).find((each) => each.name === 'info');
  const title = info && elements(info).find((each) => each.name === 'title');
  const text = title?.children
    .filter((each) => typeof each === 'string')
    .join('')
    .trim();
  return text ? decode(text) : undefined;
}

// ---------------------------------------------------------------------------------------------------
// What a style prints
// ---------------------------------------------------------------------------------------------------

/**
 * What a style's `requires` asks first: the variables a reader needs to find a source. Nothing in CSL
 * is required - a style prints what an entry holds - so a proposal names no more than these.
 */
const PROPOSED = new Set([
  'title',
  'container-title',
  'issued',
  'publisher',
  'volume',
  'page',
  'URL',
]);

/**
 * A proposal for a style's `requires` (CI-D): for each CSL type, those of `PROPOSED` its two layouts
 * always print for that type. Macros are followed; a `choose` is followed where its conditions test the
 * type alone, and given up at the first that tests anything else, since which branch runs is not known;
 * a `names` with a `substitute` requires none of its names. An administrator edits it before it is kept.
 */
export function variablesUsed(xml: string): Requires {
  const root = CSL.parseXml(xml);
  const children = elements(root);
  const macros = new Map(
    children.filter((each) => each.name === 'macro').map((each) => [each.attrs.name, each]),
  );
  const layouts = children
    .filter((each) => each.name === 'citation' || each.name === 'bibliography')
    .flatMap((each) => elements(each).filter((child) => child.name === 'layout'));
  const proposed: Partial<Record<CslItem['type'], string[]>> = {};
  for (const type of CSL_TYPES) {
    const found = new Set<string>();
    const seen = new Set<string>();
    const walk = (node: CslNode): void => {
      const { name, attrs } = node;
      if (name === 'text' && attrs.macro !== undefined) {
        const macro = macros.get(attrs.macro);
        if (macro && !seen.has(attrs.macro)) {
          seen.add(attrs.macro);
          elements(macro).forEach(walk);
          seen.delete(attrs.macro);
        }
        return;
      }
      if (name === 'names') {
        if (elements(node).some((each) => each.name === 'substitute')) return;
        attrs.variable?.split(/\s+/).forEach((each) => found.add(each));
        return;
      }
      if (['text', 'number', 'date'].includes(name ?? '') && attrs.variable !== undefined) {
        found.add(attrs.variable);
        return;
      }
      if (name === 'choose') {
        for (const branch of elements(node)) {
          if (branch.name === 'else') {
            elements(branch).forEach(walk);
            return;
          }
          const tests = Object.keys(branch.attrs).filter((each) => each !== 'match');
          if (tests.length !== 1 || tests[0] !== 'type') return;
          const types = branch.attrs.type!.split(/\s+/);
          const match = branch.attrs.match ?? 'all';
          const holds =
            match === 'none'
              ? !types.includes(type)
              : match === 'any'
                ? types.includes(type)
                : types.every((each) => each === type);
          if (holds) {
            elements(branch).forEach(walk);
            return;
          }
        }
        return;
      }
      elements(node).forEach(walk);
    };
    layouts.forEach(walk);
    const variables = [...found].filter((each) => PROPOSED.has(each)).sort();
    if (variables.length > 0) proposed[type] = variables;
  }
  return proposed;
}

// ---------------------------------------------------------------------------------------------------
// The sample entries a style is previewed and checked with
// ---------------------------------------------------------------------------------------------------

/**
 * Invented sources, one of each common type, two by one author in one year so a style's
 * disambiguation shows (STY-022). What a style's preview renders, and what `checkStyle` tries.
 */
export const SAMPLE_ENTRIES: Readonly<Record<string, CslItem>> = {
  'marlow-tides': {
    type: 'article-journal',
    title: 'Tidal patterns of the northern estuary',
    author: [{ family: 'Marlow', given: 'Ada' }],
    issued: { 'date-parts': [[2020, 3]] },
    'container-title': 'Journal of Coastal Studies',
    volume: '12',
    issue: '3',
    page: '45-67',
    DOI: '10.5555/jcs.2020.012',
  },
  'marlow-sediment': {
    type: 'book',
    title: 'Sediment and its movement',
    author: [{ family: 'Marlow', given: 'Ada' }],
    issued: { 'date-parts': [[2020]] },
    publisher: 'Harbour Press',
    'publisher-place': 'Bristol',
  },
  'penhallow-marshes': {
    type: 'chapter',
    title: 'Salt marshes',
    author: [
      { family: 'Penhallow', given: 'Grace' },
      { family: 'Ferreira', given: 'Tomas' },
    ],
    editor: [{ family: 'Duval', given: 'Ines' }],
    'container-title': 'Wetlands of Europe',
    issued: { 'date-parts': [[2018]] },
    publisher: 'Fenland Books',
    'publisher-place': 'Ely',
    page: '101-130',
  },
  'records-bulletin': {
    type: 'webpage',
    title: 'Annual flood bulletin',
    author: [{ literal: 'Coastal Records Office' }],
    issued: { 'date-parts': [[2023, 11, 2]] },
    URL: 'https://example.org/flood-bulletin',
    accessed: { 'date-parts': [[2024, 3, 1]] },
  },
};

/** The sample entries cited in reading order: one with a page, and one cited twice. */
export const SAMPLE_CITATIONS: readonly CitationIn[] = [
  { entry: 'penhallow-marshes', locator: '112' },
  { entry: 'marlow-tides' },
  { entry: 'marlow-sediment' },
  { entry: 'records-bulletin' },
  { entry: 'marlow-tides' },
];

export { CSL_LOCALES, SEEDED_STYLE_FILES } from './csl/files.js';
