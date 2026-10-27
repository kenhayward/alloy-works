import type { HtmlInput } from '../publishing/assemble.js';
import type { PublishFailure } from '../publishing/failures.js';
import { speaksFor, type SlotPart } from '../publishing/layout.js';
import { textMeasure } from '../publishing/measure.js';
import type { OutputReport } from '../publishing/outputs.js';
import {
  PUBLISHED_MARK_ORDER,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedInline,
  type PublishedLanguage,
  type PublishedList,
  type PublishedMark,
  type PublishedNode,
  type PublishedParagraph,
  type PublishedPreformatted,
  type PublishedQuotation,
  type PublishedRun,
  type PublishedTitleRun,
} from '../publishing/published.js';
import { projectCss } from '../theme/css.js';
import { projectFontFaces } from '../theme/faces.js';
import type { ResolvedTheme } from '../theme/read.js';
import type { Place, Role, StyledMark } from '../theme/schema.js';

/**
 * The HTML writer's version (the HT plan, HT-A), recorded on each output it makes as Word's is: it
 * moves whenever what the writer writes does. `html/1` is HTa's, which writes text, headings, lists,
 * marks, quotations, preformatted text and passages in other languages, and refuses every other kind
 * `html_not_yet`.
 */
export const HTML_WRITER_VERSION = 'html/1';

/** What the writer is given: `assemble`'s answer for HTML, and the faces it embeds. */
export interface HtmlWriting {
  readonly document: PublishedDocument;
  readonly html: HtmlInput;
  /**
   * Every face file the theme names, by its SHA-256, as the worker reads them: the domain reads no
   * file. Only those the document's text is set in, and their fallbacks, are embedded (HT-B).
   */
  readonly faces: ReadonlyMap<string, Uint8Array>;
}

/**
 * One HTML file and its report, or every kind it does not write yet, refused `html_not_yet` by name
 * (HTa), so nothing is made of a document it would write in part.
 */
export type WrittenHtml =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: OutputReport }
  | { readonly ok: false; readonly failures: readonly PublishFailure[] };

/**
 * The file's own policy (HT-L), the first thing in its head so it governs all after it: nothing
 * fetched, styles only inline, images and faces only as data, no base and no form to send.
 */
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "base-uri 'none'; form-action 'none'";

/** Text as HTML's character data: the one escape for words a reader is shown (HT-L). */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A value as a double-quoted attribute's: the one escape for every attribute the writer writes. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** An element's attributes, in the order given, each value escaped; an absent one written not at all. */
type Attributes = readonly (readonly [string, string | null | undefined])[];

const attributes = (given: Attributes): string =>
  given
    .filter((pair): pair is readonly [string, string] => pair[1] !== null && pair[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');

const element = (tag: string, given: Attributes, content: string): string =>
  `<${tag}${attributes(given)}>${content}</${tag}>`;

/** A language as an attribute's value: the tag the published document carries it as. */
const tagOf = (language: PublishedLanguage): string =>
  language.region === null ? language.lang : `${language.lang}-${language.region}`;

/** Each mark's element, as the editor renders the mark (`packages/editor/src/schema.ts`). */
const MARK_TAGS: Readonly<Record<StyledMark, string>> = {
  language: 'span',
  hyperlink: 'a',
  quotedPhrase: 'q',
  emphasis: 'em',
  strong: 'strong',
  underline: 'u',
  subscript: 'sub',
  superscript: 'sup',
  inlineCode: 'code',
};

/** Base64, written here since the domain is platform-free: what a face is embedded as (HT-B). */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out.push(
      BASE64[a >> 2]!,
      BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!,
      b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!,
      c === undefined ? '=' : BASE64[c & 63]!,
    );
  }
  return out.join('');
}

/** A face file's media type, by its first four bytes: OpenType's `OTTO`, else TrueType. */
const fontType = (bytes: Uint8Array): string =>
  bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f
    ? 'font/otf'
    : 'font/ttf';

/**
 * **A publication as one HTML file to read on a screen** (the HT plan; ADR-0070): written from the
 * published document the PDF and Word are made from, and the `HtmlInput` beside it, pure, as
 * `writeDocx` is. One file (HT-A): its policy first in its head (HT-L), the faces the text is set in
 * and their fallbacks as data (HT-B), and the theme's projection, `projectCss` with the faces' cap
 * heights, beside the canvas's own rules, a column at most the PDF's measure that reflows below it
 * (HT-C). The markup is the editor's for each kind it writes - a paragraph's `data-style` and
 * `data-place`, a role's `data-role`, each mark's three boxes - so the projection's rules reach it.
 *
 * A `<header>` holds the title, the notice's sentence once, and the revision as the running matter
 * says it; a `<nav>` the contents, to the layout's depth, without pages; each node a `<section>`,
 * its heading `h1` to `h6` by depth and a heading by role and level deeper (HT-J), in its own
 * language and direction where they differ. Nothing has pages (STR-050): a page break and an
 * appendix's new page set nothing.
 *
 * **HTa writes text, headings, lists, marks, quotations, preformatted text and languages**; every
 * other kind - a table, a figure, an equation, an image, a footnote, a cross-reference, a table's mark,
 * a citation, a term, and the generated lists, bibliography, glossary and abbreviations - is refused
 * `html_not_yet`, naming where it stands, through switches that fail the typecheck when a kind is
 * added unwritten. HTb writes them.
 */
export function writeHtml(input: HtmlWriting): WrittenHtml {
  const { document } = input;
  const theme = input.html.theme;
  const failures: PublishFailure[] = [];
  /** Every face a style the text is set in names, its fallbacks with it (HT-B). */
  const faces = new Set<string>();

  const notYet = (node: string | null, block: string | null, detail: string) => {
    failures.push({ stage: 'compose', code: 'html_not_yet', node, block, detail });
  };
  const setIn = (id: string | undefined) => {
    for (const face of (id === undefined ? undefined : theme.paragraphStyles.get(id))?.chain ??
      []) {
      faces.add(face.id);
    }
  };
  const role = (name: Role) => setIn(theme.roles[name]);
  const place = (name: Place) => setIn(theme.places[name]);
  /** Where the layout's words do not serve the document's language, they say their own (TRb). */
  const wordsLanguage = speaksFor(tagOf(document.words.language), tagOf(document.language))
    ? null
    : tagOf(document.words.language);

  const markElement = (mark: PublishedMark, inner: string): string => {
    for (const face of theme.characterStyles[mark.kind].chain ?? []) faces.add(face.id);
    const boxes = `<span class="aw-mark-below"><span class="aw-mark-run">${inner}</span></span>`;
    const own: Attributes =
      mark.kind === 'hyperlink'
        ? [
            ['href', mark.href],
            ['rel', 'noopener noreferrer'],
          ]
        : mark.kind === 'language'
          ? [
              ['lang', tagOf(mark.language)],
              ['dir', 'auto'],
            ]
          : [];
    const kind = mark.kind === 'language' ? 'aw-language aw-mark-language' : `aw-mark-${mark.kind}`;
    return element(MARK_TAGS[mark.kind], [...own, ['class', kind]], boxes);
  };

  /** A run's text inside its marks, the first in the published order outermost, as the editor nests. */
  const run = (each: PublishedRun): string =>
    [...each.marks]
      .sort((a, b) => PUBLISHED_MARK_ORDER.indexOf(a.kind) - PUBLISHED_MARK_ORDER.indexOf(b.kind))
      .reduceRight((inner, mark) => markElement(mark, inner), escapeText(each.text));

  /** Which kind of inline a published one is. */
  const inlineKind = (each: PublishedInline) =>
    'text' in each
      ? ('run' as const)
      : 'image' in each
        ? ('image' as const)
        : 'footnote' in each
          ? ('footnote' as const)
          : 'reference' in each
            ? ('reference' as const)
            : 'equation' in each
              ? ('equation' as const)
              : 'tableMark' in each
                ? ('tableMark' as const)
                : 'citation' in each
                  ? ('citation' as const)
                  : ('term' as const);

  const inlines = (runs: readonly PublishedInline[], node: string, block: string): string =>
    runs
      .map((each) => {
        const kind = inlineKind(each);
        switch (kind) {
          case 'run':
            return run(each as PublishedRun);
          case 'image':
          case 'footnote':
          case 'reference':
          case 'equation':
          case 'tableMark':
          case 'citation':
          case 'term':
            notYet(node, block, kind);
            return '';
          default: {
            const unreachable: never = kind;
            throw new Error(`No HTML for an inline of kind ${String(unreachable)}`);
          }
        }
      })
      .join('');

  const paragraph = (each: PublishedParagraph, node: string, at: Place): string => {
    setIn(each.style);
    return element(
      'p',
      [
        ['id', each.anchor],
        ['data-style', each.style],
        ['data-place', at],
      ],
      inlines(each.runs, node, each.id),
    );
  };

  const list = (each: PublishedList, node: string): string => {
    place('listItem');
    if (each.kind === 'definition') {
      const items = each.items.map((item) =>
        element(
          'div',
          [],
          element('dt', [['data-place', 'listItem']], inlines(item.term ?? [], node, each.id)) +
            element('dd', [], blocks(item.blocks, node, 'listItem')),
        ),
      );
      return element('dl', [['id', each.anchor]], `\n${items.join('\n')}\n`);
    }
    const items = each.items.map((item) =>
      element('li', [], blocks(item.blocks, node, 'listItem')),
    );
    return element(
      each.kind === 'ordered' ? 'ol' : 'ul',
      [
        ['id', each.anchor],
        ['start', each.kind === 'ordered' && each.start !== null ? String(each.start) : null],
        ['data-format', each.kind === 'ordered' ? each.format : null],
      ],
      `\n${items.join('\n')}\n`,
    );
  };

  const preformatted = (each: PublishedPreformatted): string => {
    role('preformatted');
    if (each.label !== null) role('preformattedLabel');
    return element(
      'pre',
      [
        ['id', each.anchor],
        ['data-role', 'preformatted'],
        ['data-language', each.label],
      ],
      element('code', [], escapeText(each.lines.join('\n'))),
    );
  };

  const quotation = (each: PublishedQuotation, node: string): string => {
    place('quotation');
    const attribution =
      each.attribution === null
        ? ''
        : (role('attribution'),
          `\n${element(
            'footer',
            [
              ['class', 'aw-attribution'],
              ['data-role', 'attribution'],
            ],
            inlines(each.attribution, node, each.id),
          )}`);
    return element(
      'blockquote',
      [['id', each.anchor]],
      `\n${blocks(each.blocks, node, 'quotation')}${attribution}\n`,
    );
  };

  /** A block, in the place it stands in, which a paragraph stored `body` is set in the default of. */
  const block = (each: PublishedBlock, node: string, at: Place): string => {
    switch (each.type) {
      case 'paragraph':
        return paragraph(each, node, at);
      case 'list':
        return list(each, node);
      case 'preformatted':
        return preformatted(each);
      case 'blockquote':
        return quotation(each, node);
      case 'marker':
        // What a block publishing nothing leaves where a reference names it: its anchor alone.
        return element('div', [['id', each.anchor]], '');
      case 'table':
      case 'figure':
      case 'equation':
        notYet(node, each.id, each.type);
        return '';
      default: {
        const unreachable: never = each;
        throw new Error(`No HTML for a block of kind ${(unreachable as PublishedBlock).type}`);
      }
    }
  };

  const blocks = (each: readonly PublishedBlock[], node: string, at: Place): string =>
    each
      .map((one) => block(one, node, at))
      .filter((written) => written !== '')
      .join('\n');

  /** A title's words, its number before them, as its heading and the contents print it. */
  const title = (node: PublishedNode): string => {
    const words = node.title
      .map((each: PublishedTitleRun) => {
        if ('equation' in each) {
          notYet(node.id, null, 'equation');
          return '';
        }
        return run(each);
      })
      .join('');
    return node.number === null
      ? words
      : `${element('span', [['class', 'aw-number']], escapeText(node.number))} ${words}`;
  };

  const section = (node: PublishedNode): string => {
    const depth = Math.min(node.depth, 6);
    role(`heading${depth}` as Role);
    const anchor = `n-${node.id}`;
    const heading =
      node.depth <= 6
        ? element(
            `h${node.depth}`,
            [
              ['id', anchor],
              ['data-role', `heading${depth}`],
            ],
            title(node),
          )
        : element(
            'p',
            [
              ['id', anchor],
              ['role', 'heading'],
              ['aria-level', String(node.depth)],
              ['data-role', 'heading6'],
            ],
            title(node),
          );
    // Published in its source language for want of a translation, it says so first (LOC-037).
    const untranslated =
      node.untranslated === null
        ? ''
        : (place('text'),
          `\n${element('p', [['data-place', 'text']], escapeText(node.untranslated))}`);
    const content = blocks(node.blocks, node.id, 'text');
    const children = node.children.map(section).join('');
    return (
      element(
        'section',
        [
          ['lang', node.language === null ? null : tagOf(node.language)],
          ['dir', node.direction],
        ],
        `\n${heading}${untranslated}${content === '' ? '' : `\n${content}`}\n${children}`,
      ) + '\n'
    );
  };

  // The header: the title, the notice's sentence once, and the revision (HT-J).
  role('title');
  const header: string[] = [element('p', [['data-role', 'title']], escapeText(document.title))];
  if (document.words.noticeSentence !== null) {
    role('noticeSentence');
    header.push(
      element(
        'p',
        [
          ['lang', wordsLanguage],
          ['data-role', 'noticeSentence'],
        ],
        escapeText(document.words.noticeSentence),
      ),
    );
  }
  role('running');
  header.push(element('p', [['data-role', 'running']], escapeText(revisionLine(document))));

  // The approval page, on an approved publication whose layout sets one (PUB-089).
  const front: string[] = [];
  const approvals = document.front.approvals;
  if (approvals !== null) {
    role('contents');
    role('contentsEntry');
    front.push(
      element(
        'section',
        [['aria-labelledby', 'aw-approvals']],
        `\n${[
          element(
            'p',
            [
              ['id', 'aw-approvals'],
              ['lang', wordsLanguage],
              ['data-role', 'contents'],
            ],
            escapeText(approvals.title),
          ),
          ...approvals.entries.map((each) =>
            element(
              'p',
              [['data-role', 'contentsEntry']],
              escapeText(`${each.by}, ${each.at}, ${each.gate}`),
            ),
          ),
        ].join('\n')}\n`,
      ),
    );
  }
  // The contents, a list of links to each heading to the layout's depth, with no page (HT-J).
  const contents = document.front.contents;
  if (contents !== null) {
    role('contents');
    role('contentsEntry');
    const entries: string[] = [];
    const walk = (nodes: readonly PublishedNode[]) => {
      for (const node of nodes) {
        if (node.depth > contents.depth) continue;
        const words = node.title.flatMap((each) => ('text' in each ? [each.text] : [])).join('');
        const said = node.number === null ? words : `${node.number} ${words}`;
        entries.push(
          element(
            'p',
            [['data-role', 'contentsEntry']],
            element('a', [['href', `#n-${node.id}`]], escapeText(said)),
          ),
        );
        walk(node.children);
      }
    };
    walk(document.nodes);
    front.push(
      element(
        'nav',
        [['aria-labelledby', 'aw-contents']],
        `\n${[
          element(
            'p',
            [
              ['id', 'aw-contents'],
              ['lang', wordsLanguage],
              ['data-role', 'contents'],
            ],
            escapeText(document.words.contents),
          ),
          ...entries,
        ].join('\n')}\n`,
      ),
    );
  }
  for (const each of document.front.lists) notYet(null, null, `listOf:${each.sequence}`);

  const sections = document.nodes.map(section).join('');

  for (const matter of ['bibliography', 'glossary', 'abbreviations'] as const) {
    if (document.back[matter] !== null) notYet(null, null, matter);
  }
  if (failures.length > 0) return { ok: false, failures };

  const held = projectFontFaces(
    {
      ...theme,
      typefaces: new Map([...theme.typefaces].filter(([, face]) => faces.has(face.id))),
    },
    (sha256) => {
      const bytes = input.faces.get(sha256);
      return bytes === undefined ? undefined : `data:${fontType(bytes)};base64,${base64(bytes)}`;
    },
  );
  const capHeights = input.html.capHeights;
  const css =
    held.css +
    canvasCss(theme, textMeasure(document.format)) +
    projectCss(theme, { capHeight: (face) => capHeights.get(face.id) });

  const html = [
    '<!DOCTYPE html>',
    `<html${attributes([
      ['lang', tagOf(document.language)],
      ['dir', document.direction],
    ])}>`,
    '<head>',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    element('title', [], escapeText(document.title)),
    // Safe inside a style element: the theme's identifiers are class-safe and its colours hex, and a
    // face's URL is data the projection checks (STY-N03).
    `<style>\n${css}</style>`,
    '</head>',
    '<body>',
    '<div class="aw-canvas aw-text">',
    element('header', [], `\n${header.join('\n')}\n`),
    ...front,
    element('main', [], `\n${sections}`),
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { ok: true, bytes: new TextEncoder().encode(html), report: [] };
}

/**
 * The revision as the PDF's running matter says it: the first slot of its head or foot holding the
 * revision, its words and the document's title and revision where it prints them, and nothing of a
 * page or a section, which HTML has not; the revision alone where no slot holds it.
 */
function revisionLine(document: PublishedDocument): string {
  const slots = [...document.format.head, ...document.format.foot];
  const slot = slots.find((parts) =>
    parts.some((part: SlotPart) => part.kind === 'field' && part.field === 'revision'),
  );
  if (slot === undefined) return document.revision;
  return slot
    .map((part) =>
      part.kind === 'words'
        ? part.text
        : part.field === 'revision'
          ? document.revision
          : part.field === 'title'
            ? document.title
            : '',
    )
    .join('')
    .trim();
}

/**
 * The canvas's own rules (HT-C), beside the theme's projection: the page in the theme's paper, the
 * text a column at most the PDF's measure that reflows below it at any width (WCAG 1.4.10), at the
 * printed size; spaces kept as the author typed them in a block's text, as the editor keeps them;
 * a quoted phrase's own characters its only quotes; a definition and preformatted text without a
 * browser's own indent, the latter scrolling sideways in its own box, under its label.
 */
function canvasCss(theme: ResolvedTheme, measure: number): string {
  return [
    `html { background: ${theme.paper}; }`,
    'body { margin: 0; }',
    `.aw-canvas { --aw-zoom: 1; box-sizing: border-box; max-width: calc(${Math.round(measure * 100) / 100}pt + 32px); ` +
      'margin-inline: auto; padding: 16px; overflow-wrap: break-word; }',
    '.aw-canvas :is(p, dt, h1, h2, h3, h4, h5, h6, footer) { white-space: break-spaces; }',
    '.aw-canvas q { quotes: none; }',
    '.aw-canvas :is(dl, dd) { margin: 0; }',
    '.aw-canvas pre { white-space: pre; tab-size: 8; overflow-x: auto; }',
    '.aw-canvas pre[data-language]::before { content: attr(data-language); display: block; }',
    '',
  ].join('\n');
}
