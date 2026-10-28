import { allowedLinkSchemes } from '../content/model/marks.js';
import {
  figureImageKey,
  inlineImageKey,
  inlineReferenceKey,
  type HtmlInput,
  type ReferenceSite,
  type RunsSite,
} from '../publishing/assemble.js';
import type { PublishFailure } from '../publishing/failures.js';
import { settingFaces } from '../publishing/glyphs.js';
import { speaksFor, type SlotPart } from '../publishing/layout.js';
import { textMeasure } from '../publishing/measure.js';
import type { OutputReport, OutputReportEntry } from '../publishing/outputs.js';
import {
  PUBLISHED_MARK_ORDER,
  type PublishedBlock,
  type PublishedCell,
  type PublishedDocument,
  type PublishedEquation,
  type PublishedEquationBlock,
  type PublishedFigure,
  type PublishedFootnoteRun,
  type PublishedImageRun,
  type PublishedIndexHeading,
  type PublishedInline,
  type PublishedLanguage,
  type PublishedList,
  type PublishedMark,
  type PublishedNode,
  type PublishedParagraph,
  type PublishedPreformatted,
  type PublishedQuotation,
  type PublishedRun,
  type PublishedTable,
} from '../publishing/published.js';
import { projectCss } from '../theme/css.js';
import { projectFontFaces } from '../theme/faces.js';
import type { ResolvedTheme } from '../theme/read.js';
import type { Place, Role, StyledMark, Typeface } from '../theme/schema.js';
import type { WideTable } from '../word/write.js';

import { mathml } from './mathml.js';

/**
 * The HTML writer's version (the HT plan, HT-A), recorded on each output it makes as Word's is: it
 * moves whenever what the writer writes does. `html/1` was HTa's, which wrote text, headings, lists,
 * marks, quotations, preformatted text and passages in other languages and refused every other kind
 * `html_not_yet`; `html/2` is HTb's, which writes every kind, and subsets each face it embeds; `html/3` is IXb's,
 * which writes an index marker as an empty span and the index after the abbreviations.
 */
export const HTML_WRITER_VERSION = 'html/3';

/** What the writer is given: `assemble`'s answer for HTML, and the files it embeds. */
export interface HtmlWriting {
  readonly document: PublishedDocument;
  readonly html: HtmlInput;
  /**
   * Every face file the theme names, by its SHA-256, as the worker reads them: the domain reads no
   * file. Only those the document's text is set in are embedded, each subset (HT-B).
   */
  readonly faces: ReadonlyMap<string, Uint8Array>;
  /** Every image the request resolved, by the path the published document names it at, as Word's. */
  readonly images: ReadonlyMap<string, Uint8Array>;
  /** How the PDF set each table too wide for its measure (TB3-J): a scaled one HTML reflows instead. */
  readonly wide?: readonly WideTable[];
  /**
   * **A face file kept to these characters** (HT-B), their shaping and maths tables closed over them:
   * the worker's HarfBuzz, since the domain is platform-free. The code points are ascending.
   */
  readonly subset: (bytes: Uint8Array, codePoints: readonly number[]) => Uint8Array;
}

/**
 * One HTML file and its report. Since HTb the writer writes every kind, so it refuses nothing; the
 * failures stay for a kind added to the published document before the writer learns it.
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

/** Where a block's anchor is where a reference names none: `assemble`'s own spelling, so none meet. */
const blockAnchor = (node: string, block: string) => `b-${node}-${block}`;

/** The layout's word for a wide table's region, written once, which each region's name begins with. */
const SCROLL_REGION = 'aw-scroll-region';

/** A hyperlink's address, where its scheme is one the model allows (HT-L): checked again here. */
const LINKABLE = new RegExp(`^(${allowedLinkSchemes.join('|')})`, 'i');

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

/** Base64, written here since the domain is platform-free: what a face and an image are embedded as. */
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

/** An image's media type, by the extension `publishedImagePath` gave it. */
const imageType = (path: string): string => (path.endsWith('.png') ? 'image/png' : 'image/jpeg');

/** A list's markers as the projection's counters and bullets draw them, so their faces hold them. */
const MARKER_CHARACTERS = '0123456789.abcdefghijklmnopqrstuvwxyz•◦▪';

/** A length in points at the canvas's zoom, to thousandths, as `sizeImages` sets an image's. */
const zoomedWidth = (points: number) =>
  `width: calc(${Number(points.toFixed(3))}pt * var(--aw-zoom)); height: auto;`;

const ALIGN = { start: 'start', center: 'center', end: 'end' } as const;

/** Where a run of inlines stands: what a reference's key and its face are read by. */
interface Where {
  readonly node: string;
  readonly site: RunsSite;
  readonly chain: readonly Typeface[];
  /** Whether a reference, a citation, a term or a hyperlink may be a link here: not in a title. */
  readonly links: boolean;
}

/**
 * **A publication as one HTML file to read on a screen** (the HT plan; ADR-0070): written from the
 * published document the PDF and Word are made from, and the `HtmlInput` beside it, pure, as
 * `writeDocx` is. One file (HT-A): its policy first in its head (HT-L), the faces its text is set in
 * as data, each subset to the characters it sets (HT-B), and the theme's projection, `projectCss`
 * with the faces' cap heights, beside the canvas's own rules, a column at most the PDF's measure that
 * reflows below it (HT-C). The markup is the editor's for each kind - a paragraph's `data-style` and
 * `data-place`, a role's `data-role`, each mark's three boxes - so the projection's rules reach it.
 *
 * A `<header>` holds the title, the notice's sentence once, and the revision as the running matter
 * says it; a `<nav>` the contents, to the layout's depth, and one each list after it, without pages
 * (HT-J); each node a `<section>`, its heading `h1` to `h6` by depth and a heading by role and level
 * deeper, in its own language and direction where they differ, its footnotes at the end of its
 * top-level section (HT-I); then the bibliography, the glossary and the abbreviations. A table scrolls
 * in its own labelled region, its notes under it; an image is its own bytes as data, sized as the PDF
 * sets it; an equation MathML Core from the maths tree (HT-H); a reference, a citation and a term a
 * link to the anchor the document carries. Nothing has pages (STR-050): a page break and an appendix's
 * new page set nothing, and a page reference prints its form without pages (STR-055). The report says
 * what the PDF prints that HTML does not: pages, running matter, and a table scaled to fit (HT-K).
 *
 * Every kind is written through a switch that fails the typecheck when one is added unwritten.
 */
export function writeHtml(input: HtmlWriting): WrittenHtml {
  const { document } = input;
  const { theme, covers } = input.html;
  /** Each typeface's characters, as the face that sets each one is chosen (HT-B; UF-D's rule). */
  const used = new Map<string, Set<number>>();
  const report: OutputReportEntry[] = [];
  /** Whether the PDF prints a page number that HTML has none of: a reference's, the contents'. */
  let paged = false;

  const styleChain = (id: string | undefined) =>
    (id === undefined ? undefined : theme.paragraphStyles.get(id))?.chain ?? [];
  const roleChain = (name: Role) => styleChain(theme.roles[name]);
  const placeChain = (name: Place) => styleChain(theme.places[name]);
  /** A paragraph's style, a stored `body` its place's default (TH-E). */
  const styleIn = (id: string, at: Place) => (id === 'body' ? theme.places[at] : id);

  /** Each character of `text` given to the face of the chain that sets it, as the PDF chooses one. */
  const sets = (text: string, chain: readonly Typeface[], marks: readonly StyledMark[] = []) => {
    let own = chain;
    let code = false;
    for (const mark of marks) {
      const style = theme.characterStyles[mark];
      if (style?.typeface !== undefined) own = style.chain ?? [style.typeface];
      if (mark === 'inlineCode') code = true;
    }
    // Code is set in its first face alone (UF-C).
    const faces = code ? own.slice(0, 1) : own;
    if (faces.length === 0) return;
    const families = settingFaces(
      text,
      covers,
      faces.map((face) => face.family),
    );
    let at = 0;
    for (const character of text) {
      const face = faces.find((each) => each.family === families[at]) ?? faces[0]!;
      at += 1;
      let held = used.get(face.id);
      if (held === undefined) used.set(face.id, (held = new Set()));
      held.add(character.codePointAt(0)!);
    }
  };

  /** Where the layout's words do not serve the document's language, they say their own (TRb). */
  const wordsLanguage = speaksFor(tagOf(document.words.language), tagOf(document.language))
    ? null
    : tagOf(document.words.language);
  const documentLanguage = tagOf(document.language);
  /** A language attribute where an alternative's differs from the document's. */
  const ownLanguage = (language: PublishedLanguage) =>
    tagOf(language) === documentLanguage ? null : tagOf(language);

  const markElement = (mark: PublishedMark, inner: string, links: boolean): string => {
    const boxes = `<span class="aw-mark-below"><span class="aw-mark-run">${inner}</span></span>`;
    const linked = mark.kind === 'hyperlink' && links && LINKABLE.test(mark.href);
    const own: Attributes =
      mark.kind === 'hyperlink'
        ? linked
          ? [
              ['href', mark.href],
              ['rel', 'noopener noreferrer'],
            ]
          : []
        : mark.kind === 'language'
          ? [
              ['lang', tagOf(mark.language)],
              ['dir', 'auto'],
            ]
          : [];
    const kind = mark.kind === 'language' ? 'aw-language aw-mark-language' : `aw-mark-${mark.kind}`;
    // A link where none may stand - inside another, or in a title - is its words in a span.
    const tag = mark.kind === 'hyperlink' && !linked ? 'span' : MARK_TAGS[mark.kind];
    return element(tag, [...own, ['class', kind]], boxes);
  };

  /** A run's text inside its marks, the first in the published order outermost, as the editor nests. */
  const run = (each: PublishedRun, chain: readonly Typeface[], links: boolean): string => {
    sets(
      each.text,
      chain,
      each.marks.map((mark) => mark.kind),
    );
    return [...each.marks]
      .sort((a, b) => PUBLISHED_MARK_ORDER.indexOf(a.kind) - PUBLISHED_MARK_ORDER.indexOf(b.kind))
      .reduceRight((inner, mark) => markElement(mark, inner, links), escapeText(each.text));
  };

  /** An equation as MathML Core, its alternative its `alttext` and its name (HT-H). */
  const maths = (equation: PublishedEquation, display: boolean): string => {
    const markup = mathml(equation.tree, display);
    // Its characters are the maths face's, which sets them with no fallback (equations 2, R1).
    const characters = markup
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    sets(characters, [theme.maths]);
    const alternative = equation.alternative.text;
    return element(
      'math',
      [
        ['display', display ? 'block' : null],
        ['alttext', alternative],
        ['aria-label', alternative],
        ['lang', ownLanguage(equation.alternative.language)],
      ],
      markup,
    );
  };

  /** An image as its own bytes, sized as the PDF sets it, as `sizeImages` sizes the editor's. */
  const image = (
    path: string,
    width: number,
    alternative: PublishedFigure['alternative'],
    own: Attributes,
  ): string => {
    const bytes = input.images.get(path);
    if (bytes === undefined) throw new Error(`No bytes for the image at ${path}`);
    return `<img${attributes([
      ['src', `data:${imageType(path)};base64,${base64(bytes)}`],
      ['alt', alternative?.text ?? ''],
      ['lang', alternative === null ? null : ownLanguage(alternative.language)],
      ...own,
      ['style', zoomedWidth(width)],
    ])} />`;
  };

  /** Whether a table is written, whose region names itself by the layout's word (HT-C). */
  let tabled = false;

  // Footnotes, gathered for the top-level section they stand in (HT-I).
  let notes: string[] = [];
  let noteCount = 0;
  let notesCount = 0;
  const footnote = (each: PublishedFootnoteRun['footnote'], where: Where): string => {
    noteCount += 1;
    const reference = `aw-noteref-${noteCount}`;
    const target = each.anchor ?? `aw-note-${noteCount}`;
    const chain = placeChain('footnote');
    sets(each.label, where.chain, ['superscript']);
    sets(each.label, chain);
    const paragraphs = each.paragraphs.map((paragraph, at) => {
      const style = styleIn(paragraph.style, 'footnote');
      const back =
        at === 0
          ? element(
              'a',
              [
                ['role', 'doc-backlink'],
                ['href', `#${reference}`],
                ['aria-label', input.html.words.backToReference],
              ],
              escapeText(each.label),
            ) + ' '
          : '';
      return element(
        'p',
        [
          ['id', paragraph.anchor],
          ['class', 'aw-footnote-paragraph'],
          ['data-style', paragraph.style],
          ['data-block', paragraph.id],
          ['data-place', 'footnote'],
        ],
        back +
          inlines(paragraph.runs, {
            node: where.node,
            site: { kind: 'paragraph', block: paragraph.id },
            chain: styleChain(style),
            links: true,
          }),
      );
    });
    notes.push(element('li', [['id', target]], paragraphs.join('')));
    return element(
      'sup',
      [['class', 'aw-footnote']],
      element(
        'a',
        [
          ['role', 'doc-noteref'],
          ['id', reference],
          ['href', `#${target}`],
        ],
        escapeText(each.label),
      ),
    );
  };

  const inlines = (runs: readonly PublishedInline[], where: Where): string =>
    runs.map((each, index) => inline(each, index, where)).join('');

  const inline = (each: PublishedInline, index: number, where: Where): string => {
    if ('text' in each) return run(each, where.chain, where.links);
    if ('image' in each) return inlineImage(each, inlineImageKey(where.node, where.site, index));
    if ('footnote' in each) return footnote(each.footnote, where);
    if ('reference' in each) {
      const { reference } = each;
      if (reference.page) paged = true;
      const key = inlineReferenceKey(where.node, where.site as ReferenceSite, index);
      const said = input.html.references.get(key) ?? reference.text ?? '';
      sets(said, where.chain);
      return reference.link && where.links
        ? element(
            'a',
            [
              ['class', 'aw-reference'],
              ['href', `#${reference.anchor}`],
            ],
            escapeText(said),
          )
        : element('span', [['class', 'aw-reference']], escapeText(said));
    }
    if ('equation' in each) {
      return element(
        'span',
        [
          ['class', 'aw-equation'],
          ['data-equation', ''],
        ],
        maths(each.equation, false),
      );
    }
    if ('tableMark' in each) {
      const { letter, link } = each.tableMark;
      sets(letter, where.chain, ['superscript']);
      const said =
        link === null || !where.links
          ? escapeText(letter)
          : element('a', [['href', `#${link}`]], escapeText(letter));
      return element('sup', [['class', 'aw-table-mark']], said);
    }
    if ('citation' in each) {
      const { runs, link } = each.citation;
      // Its runs carry no link of their own inside the one it is.
      const body = runs.map((one) => run(one, where.chain, false)).join('');
      return link !== null && where.links
        ? element(
            'a',
            [
              ['class', 'aw-citation'],
              ['href', `#${link}`],
            ],
            body,
          )
        : element('span', [['class', 'aw-citation']], body);
    }
    // An index marker prints nothing: an empty span its locators link to, where it is anchored (IX-L).
    if ('indexMark' in each) {
      const { anchor } = each.indexMark;
      return anchor === null ? '' : element('span', [['id', anchor]], '');
    }
    const kind: 'term' = 'term' in each ? 'term' : (each satisfies never);
    const { text, marks, link } = each[kind];
    const body = run({ text, marks }, where.chain, false);
    return link !== null && where.links
      ? element(
          'a',
          [
            ['class', 'aw-term'],
            ['href', `#${link}`],
          ],
          body,
        )
      : element('span', [['class', 'aw-term']], body);
  };

  const inlineImage = (each: PublishedImageRun, key: string): string =>
    element(
      'span',
      [['class', 'aw-inline-image-holder']],
      image(each.image.path, each.image.width, each.image.alternative, [
        ['class', 'aw-inline-image'],
        ['data-image-style', input.html.imageStyles.get(key) ?? null],
      ]),
    );

  const paragraph = (each: PublishedParagraph, node: string, at: Place): string =>
    element(
      'p',
      [
        ['id', each.anchor],
        ['data-style', each.style],
        ['data-block', each.id],
        ['data-place', at],
      ],
      inlines(each.runs, {
        node,
        site: { kind: 'paragraph', block: each.id },
        chain: styleChain(styleIn(each.style, at)),
        links: true,
      }),
    );

  const list = (each: PublishedList, node: string): string => {
    const chain = placeChain('listItem');
    if (each.kind === 'definition') {
      const items = each.items.map((item, at) =>
        element(
          'div',
          [],
          element(
            'dt',
            [['data-place', 'listItem']],
            inlines(item.term ?? [], {
              node,
              site: { kind: 'term', block: each.id, item: at },
              chain,
              links: true,
            }),
          ) + element('dd', [], blocks(item.blocks, node, 'listItem')),
        ),
      );
      return element(
        'dl',
        [
          ['id', each.anchor],
          ['data-block', each.id],
        ],
        `\n${items.join('\n')}\n`,
      );
    }
    sets(MARKER_CHARACTERS, chain);
    const items = each.items.map((item) =>
      element('li', [], blocks(item.blocks, node, 'listItem')),
    );
    return element(
      each.kind === 'ordered' ? 'ol' : 'ul',
      [
        ['id', each.anchor],
        ['start', each.kind === 'ordered' && each.start !== null ? String(each.start) : null],
        ['data-format', each.kind === 'ordered' ? each.format : null],
        ['data-block', each.id],
      ],
      `\n${items.join('\n')}\n`,
    );
  };

  const preformatted = (each: PublishedPreformatted): string => {
    const text = each.lines.join('\n');
    sets(text, roleChain('preformatted'), ['inlineCode']);
    if (each.label !== null) sets(each.label, roleChain('preformattedLabel'));
    return element(
      'pre',
      [
        ['id', each.anchor],
        ['data-role', 'preformatted'],
        ['data-language', each.label],
        ['data-block', each.id],
      ],
      element('code', [], escapeText(text)),
    );
  };

  const quotation = (each: PublishedQuotation, node: string): string => {
    const attribution =
      each.attribution === null
        ? ''
        : `\n${element(
            'footer',
            [
              ['class', 'aw-attribution'],
              ['data-role', 'attribution'],
            ],
            inlines(each.attribution, {
              node,
              site: { kind: 'attribution', block: each.id },
              chain: roleChain('attribution'),
              links: true,
            }),
          )}`;
    return element(
      'blockquote',
      [
        ['id', each.anchor],
        ['data-block', each.id],
      ],
      `\n${blocks(each.blocks, node, 'quotation')}${attribution}\n`,
    );
  };

  /** What each list after the contents lists, in document order: a link and its words (HT-J). */
  const listed: Record<string, { readonly href: string; readonly said: () => string }[]> = {};
  const enlist = (sequence: string, href: string, said: () => string) =>
    (listed[sequence] ??= []).push({ href, said });

  /** The anchors of a table's or a figure's copies' index markers, each an empty span (IX-L). */
  const indexSpans = (anchors: readonly string[] | undefined): string =>
    (anchors ?? []).map((anchor) => element('span', [['id', anchor]], '')).join('');

  /** A caption: its label, as the PDF prints it, and its runs. */
  const caption = (
    each: PublishedTable | PublishedFigure,
    node: string,
    chain: readonly Typeface[],
    links: boolean,
  ): string => {
    if (each.label !== null) sets(`${each.label} `, chain);
    const label = each.label === null ? '' : `${escapeText(each.label)} `;
    return (
      label +
      inlines(each.caption, { node, site: { kind: 'caption', block: each.id }, chain, links })
    );
  };

  const table = (each: PublishedTable, node: string): string => {
    tabled = true;
    const id = each.anchor ?? blockAnchor(node, each.id);
    const captionId = `${id}-caption`;
    const bound = each.bound;
    const cell = (one: PublishedCell, x: number, first: boolean): string => {
      const tag = one.scope === null ? 'td' : 'th';
      const scope = one.scope === null ? null : one.scope === 'row' ? 'row' : 'col';
      const align = one.align ?? bound?.align[x];
      const wraps = bound === undefined || ((bound.wrap[x] ?? true) && one.nowrap !== true);
      const width = first && one.colspan === 1 ? each.widths?.[x] : undefined;
      const style = [
        align === undefined
          ? ''
          : `text-align: ${align === 'centre' ? 'center' : align === 'decimal' ? 'end' : align};`,
        wraps ? '' : 'white-space: nowrap;',
        one.colour === undefined ? '' : `color: ${one.colour};`,
        width === undefined ? '' : `width: ${Number((width * 100).toFixed(3))}%;`,
      ]
        .filter((part) => part !== '')
        .join(' ');
      return element(
        tag,
        [
          ['scope', scope],
          ['colspan', one.colspan > 1 ? String(one.colspan) : null],
          ['rowspan', one.rowspan > 1 ? String(one.rowspan) : null],
          ['style', style === '' ? null : style],
        ],
        blocks(one.blocks, node, 'tableCell'),
      );
    };
    const rows = each.rows.map((row, y) => {
      const group = y < each.headerRows ? null : (bound?.groups?.[y - each.headerRows] ?? null);
      if (group?.kind === 'heading') {
        const [heading] = row.cells;
        return element(
          'tr',
          [['class', 'aw-bound-table-group']],
          element(
            'th',
            [
              ['scope', 'rowgroup'],
              ['colspan', heading!.colspan > 1 ? String(heading!.colspan) : null],
            ],
            blocks(heading!.blocks, node, 'tableCell'),
          ),
        );
      }
      return element(
        'tr',
        [['class', group?.kind === 'subtotal' ? 'aw-bound-table-subtotal' : null]],
        row.cells.map((one, x) => cell(one, x, y === 0)).join(''),
      );
    });
    const said = caption(each, node, roleChain('caption'), true);
    if (each.listed) enlist('table', id, () => caption(each, node, roleChain('listEntry'), false));
    const under: string[] = [];
    if (each.note !== null) {
      under.push(
        element(
          'p',
          [
            ['class', 'aw-table-note'],
            ['data-role', 'tableNote'],
          ],
          inlines(each.note, {
            node,
            site: { kind: 'note', block: each.id },
            chain: roleChain('tableNote'),
            links: true,
          }),
        ),
      );
    }
    // Its lettered notes stay under it (HT-I), each its letter before its words, where its mark links.
    for (const lettered of each.notes) {
      const paragraphs = lettered.paragraphs.map((one, at) => {
        const chain = styleChain(styleIn(one.style, 'text'));
        if (at === 0) sets(lettered.letter, chain, ['superscript']);
        const letter = at === 0 ? `${element('sup', [], escapeText(lettered.letter))} ` : '';
        return element(
          'p',
          [
            ['id', one.anchor],
            ['data-style', one.style],
            ['data-place', 'text'],
          ],
          letter +
            inlines(one.runs, {
              node,
              site: { kind: 'paragraph', block: one.id },
              chain,
              links: true,
            }),
        );
      });
      under.push(
        element(
          'div',
          [
            ['id', lettered.anchor],
            ['class', 'aw-table-note'],
          ],
          paragraphs.join(''),
        ),
      );
    }
    if (bound?.source !== null && bound?.source !== undefined) {
      under.push(
        element(
          'p',
          [
            ['class', 'aw-table-note aw-bound-table-source'],
            ['data-role', 'tableNote'],
          ],
          inlines(bound.source, {
            node,
            site: { kind: 'source', block: each.id },
            chain: roleChain('tableNote'),
            links: true,
          }),
        ),
      );
    }
    // A table the PDF scaled is reflowed here, as Word reflows it, and scrolls where it still does not
    // fit; one it turned is set on a landscape page of its own, which neither has, and is said nothing of.
    if (
      input.wide?.some(
        (wide) => wide.node === node && wide.block === each.id && wide.set === 'scaled',
      )
    ) {
      report.push({ kind: 'table_reflowed', node, block: each.id, label: each.label });
    }
    return element(
      'figure',
      [
        ['id', id],
        ['data-block', each.id],
        ['data-table', ''],
        ['class', 'aw-table'],
        ['data-table-style', each.style],
      ],
      [
        indexSpans(each.indexAnchors),
        element(
          'figcaption',
          [
            ['id', captionId],
            ['class', 'aw-table-caption'],
            ['data-role', 'caption'],
          ],
          said,
        ),
        // A wide table scrolls in its own region, reached by the keyboard, so the page reflows (HT-C):
        // named by the layout's word and its caption, so no two regions share a name.
        element(
          'div',
          [
            ['class', 'aw-table-region'],
            ['role', 'region'],
            ['aria-labelledby', `${SCROLL_REGION} ${captionId}`],
            ['tabindex', '0'],
          ],
          element('table', [['aria-labelledby', captionId]], `\n${rows.join('\n')}\n`),
        ),
        ...under,
        '',
      ].join('\n'),
    );
  };

  const figure = (each: PublishedFigure, node: string): string => {
    const id = each.anchor ?? blockAnchor(node, each.id);
    const shown = element(
      'div',
      [
        ['class', 'aw-figure-image'],
        ['style', `text-align: ${ALIGN[each.alignment]};`],
      ],
      image(each.path, each.width, each.alternative, []),
    );
    const said = caption(each, node, roleChain('caption'), true);
    if (each.listed) enlist('figure', id, () => caption(each, node, roleChain('listEntry'), false));
    const body =
      said === ''
        ? ''
        : element(
            'div',
            [['class', 'aw-figure-body']],
            element(
              'figcaption',
              [
                ['class', 'aw-figure-caption'],
                ['data-figure-caption', ''],
                ['data-role', 'caption'],
              ],
              said,
            ),
          );
    return element(
      'figure',
      [
        ['id', id],
        ['data-block', each.id],
        ['data-figure', ''],
        ['data-image-style', input.html.imageStyles.get(figureImageKey(node, each.id)) ?? null],
        ['class', 'aw-figure'],
      ],
      indexSpans(each.indexAnchors) +
        (each.captionPosition === 'top' ? body + shown : shown + body),
    );
  };

  const equation = (each: PublishedEquationBlock, node: string, at: Place): string => {
    const id = each.anchor ?? (each.label === null ? null : blockAnchor(node, each.id));
    if (each.label !== null) {
      const label = each.label;
      sets(label, placeChain(at));
      enlist('equation', id!, () => {
        sets(label, roleChain('listEntry'));
        return escapeText(label);
      });
    }
    const number =
      each.label === null
        ? ''
        : element('span', [['class', 'aw-equation-number']], escapeText(each.label));
    return element(
      'div',
      [
        ['id', id],
        ['data-block', each.id],
        ['class', 'aw-equation-block'],
        ['data-equation-block', ''],
        ['data-place', at],
      ],
      maths(each, true) + number,
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
        return table(each, node);
      case 'figure':
        return figure(each, node);
      case 'equation':
        return equation(each, node, at);
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

  /** A title's words and equations, its number before them, as its heading and the contents print it. */
  const title = (node: PublishedNode, chain: readonly Typeface[]): string => {
    const words = node.title
      .map((each) => ('equation' in each ? maths(each.equation, false) : run(each, chain, false)))
      .join('');
    if (node.number === null) return words;
    sets(`${node.number} `, chain);
    return `${element('span', [['class', 'aw-number']], escapeText(node.number))} ${words}`;
  };

  const section = (node: PublishedNode, top: boolean): string => {
    const depth = Math.min(node.depth, 6);
    const role = `heading${depth}` as Role;
    if (top) notes = [];
    const anchor = `n-${node.id}`;
    const said = title(node, roleChain(role));
    const heading =
      node.depth <= 6
        ? element(
            `h${node.depth}`,
            [
              ['id', anchor],
              ['data-role', role],
            ],
            said,
          )
        : element(
            'p',
            [
              ['id', anchor],
              ['role', 'heading'],
              ['aria-level', String(node.depth)],
              ['data-role', 'heading6'],
            ],
            said,
          );
    // Published in its source language for want of a translation, it says so first (LOC-037).
    const untranslated =
      node.untranslated === null
        ? ''
        : (sets(node.untranslated, placeChain('text')),
          `\n${element('p', [['data-place', 'text']], escapeText(node.untranslated))}`);
    const content = blocks(node.blocks, node.id, 'text');
    const children = node.children.map((child) => section(child, false)).join('');
    // Its notes, and every section's beneath it, at its end (HT-I).
    let endnotes = '';
    if (top && notes.length > 0) {
      notesCount += 1;
      const heading = `aw-notes-${notesCount}`;
      sets(input.html.words.notes, placeChain('footnote'));
      endnotes =
        element(
          'section',
          [
            ['role', 'doc-endnotes'],
            ['aria-labelledby', heading],
          ],
          `\n${element(
            'p',
            [
              ['id', heading],
              ['lang', wordsLanguage],
              ['data-style', 'body'],
              ['data-place', 'footnote'],
            ],
            escapeText(input.html.words.notes),
          )}\n${element('ol', [['class', 'aw-notes']], `\n${notes.join('\n')}\n`)}\n`,
        ) + '\n';
      notes = [];
    }
    return (
      element(
        'section',
        [
          ['lang', node.language === null ? null : tagOf(node.language)],
          ['dir', node.direction],
        ],
        `\n${heading}${untranslated}${content === '' ? '' : `\n${content}`}\n${children}${endnotes}`,
      ) + '\n'
    );
  };

  const sections = document.nodes.map((node) => section(node, true)).join('');

  // The bibliography, the glossary and the abbreviations, after the last node, each headed as the
  // template heads it and each entry an item of a list, labelled where it begins (CIc, TMb).
  const back: string[] = [];
  const backList = (
    name: string,
    heading: string,
    entries: readonly { readonly anchor: string | null; readonly said: string }[],
  ) => {
    const id = `aw-${name}`;
    const chain = roleChain('heading1');
    sets(heading, chain);
    back.push(
      element(
        'section',
        [['aria-labelledby', id]],
        `\n${element(
          'h1',
          [
            ['id', id],
            ['lang', wordsLanguage],
            ['data-role', 'heading1'],
          ],
          escapeText(heading),
        )}\n${element(
          'ul',
          [['class', 'aw-entries']],
          `\n${entries
            .map((entry) =>
              element(
                'li',
                [['id', entry.anchor]],
                element(
                  'p',
                  [
                    ['data-style', 'body'],
                    ['data-place', 'text'],
                  ],
                  entry.said,
                ),
              ),
            )
            .join('\n')}\n`,
        )}\n`,
      ) + '\n',
    );
  };
  const text = placeChain('text');
  const strong = (words: string) => run({ text: words, marks: [{ kind: 'strong' }] }, text, false);
  const plain = (words: string) => run({ text: words, marks: [] }, text, false);
  const { bibliography, glossary, abbreviations } = document.back;
  if (bibliography !== null) {
    backList(
      'bibliography',
      bibliography.title,
      bibliography.entries.map((entry) => ({
        anchor: entry.anchor,
        said:
          (entry.label === null
            ? ''
            : `${entry.label.map((each) => run(each, text, false)).join('')}${plain(' ')}`) +
          entry.runs.map((each) => run(each, text, true)).join(''),
      })),
    );
  }
  if (glossary !== null) {
    backList(
      'glossary',
      glossary.title,
      glossary.entries.map((entry) => ({
        anchor: entry.anchor,
        said: strong(entry.label) + plain(` ${entry.definition}`),
      })),
    );
  }
  if (abbreviations !== null) {
    backList(
      'abbreviations',
      abbreviations.title,
      abbreviations.entries.map((entry) => ({
        anchor: null,
        said: strong(entry.abbreviation) + plain(` ${entry.label}`),
      })),
    );
  }

  // The index after them (IX-L): its title as theirs, each entry an item of a list and its sub-entries
  // a list in it, each locator its section's number, or title where unnumbered, a link to the first
  // marker the section holds (IX-D); a "see" and a "see also" in the layout's words, emphasised.
  const index = document.back.index;
  if (index !== null) {
    const emphasised = (words: string) => {
      const said = run({ text: words, marks: [{ kind: 'emphasis' }] }, text, false);
      return wordsLanguage === null ? said : element('span', [['lang', wordsLanguage]], said);
    };
    const line = (name: string, heading: PublishedIndexHeading): string => {
      const parts = [plain(name)];
      const sections = new Set<string | null>();
      for (const locator of heading.locators) {
        if (sections.has(locator.node)) continue;
        sections.add(locator.node);
        parts.push(element('a', [['href', `#${locator.anchor}`]], plain(locator.words)));
      }
      for (const [word, targets] of [
        [index.see, heading.see],
        [index.seeAlso, heading.seeAlso],
      ] as const) {
        if (targets.length > 0) parts.push(`${emphasised(word)}${plain(` ${targets.join('; ')}`)}`);
      }
      return element(
        'p',
        [
          ['data-style', 'body'],
          ['data-place', 'text'],
        ],
        parts.join(plain(', ')),
      );
    };
    const items = index.entries.map((entry) => {
      const subs =
        entry.subEntries.length === 0
          ? ''
          : element(
              'ul',
              [],
              `\n${entry.subEntries.map((sub) => element('li', [], line(sub.sub, sub))).join('\n')}\n`,
            );
      return element('li', [], line(entry.term, entry) + subs);
    });
    sets(index.title, roleChain('heading1'));
    back.push(
      element(
        'section',
        [['aria-labelledby', 'aw-index']],
        `\n${element(
          'h1',
          [
            ['id', 'aw-index'],
            ['lang', wordsLanguage],
            ['data-role', 'heading1'],
          ],
          escapeText(index.title),
        )}\n${element('ul', [['class', 'aw-entries aw-index']], `\n${items.join('\n')}\n`)}\n`,
      ) + '\n',
    );
  }

  // The header: the title, the notice's sentence once, and the revision (HT-J).
  sets(document.title, roleChain('title'));
  const header: string[] = [element('p', [['data-role', 'title']], escapeText(document.title))];
  if (document.words.noticeSentence !== null) {
    sets(document.words.noticeSentence, roleChain('noticeSentence'));
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
  const revision = revisionLine(document);
  sets(revision, roleChain('running'));
  header.push(element('p', [['data-role', 'running']], escapeText(revision)));

  // The approval page, on an approved publication whose layout sets one (PUB-089).
  const front: string[] = [];
  const approvals = document.front.approvals;
  if (approvals !== null) {
    sets(approvals.title, roleChain('contents'));
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
          ...approvals.entries.map((each) => {
            const said = `${each.by}, ${each.at}, ${each.gate}`;
            sets(said, roleChain('contentsEntry'));
            return element('p', [['data-role', 'contentsEntry']], escapeText(said));
          }),
        ].join('\n')}\n`,
      ),
    );
  }
  /** The contents or a list after it: its title, then each entry a link with no page (HT-J). */
  const navigation = (
    id: string,
    heading: string,
    roles: readonly [Role, Role],
    entries: readonly string[],
  ) => {
    sets(heading, roleChain(roles[0]));
    front.push(
      element(
        'nav',
        [['aria-labelledby', id]],
        `\n${[
          element(
            'p',
            [
              ['id', id],
              ['lang', wordsLanguage],
              ['data-role', roles[0]],
            ],
            escapeText(heading),
          ),
          ...entries.map((entry) => element('p', [['data-role', roles[1]]], entry)),
        ].join('\n')}\n`,
      ),
    );
  };
  const contents = document.front.contents;
  if (contents !== null) {
    paged = true;
    const entries: string[] = [];
    const walk = (nodes: readonly PublishedNode[]) => {
      for (const node of nodes) {
        if (node.depth > contents.depth) continue;
        entries.push(
          element('a', [['href', `#n-${node.id}`]], title(node, roleChain('contentsEntry'))),
        );
        walk(node.children);
      }
    };
    walk(document.nodes);
    navigation('aw-contents', document.words.contents, ['contents', 'contentsEntry'], entries);
  }
  for (const each of document.front.lists) {
    paged = true;
    navigation(
      `aw-list-${each.sequence}`,
      each.title,
      ['list', 'listEntry'],
      (listed[each.sequence] ?? []).map((entry) =>
        element('a', [['href', `#${entry.href}`]], entry.said()),
      ),
    );
  }

  // What the PDF prints that HTML has no place for, each said once (HT-K).
  const slots = [...document.format.head, ...document.format.foot].flat();
  if (
    slots.some((part) => part.kind === 'field' && (part.field === 'page' || part.field === 'pages'))
  ) {
    paged = true;
  }
  const said: OutputReportEntry[] = [];
  if (paged) said.push({ kind: 'pages_not_carried' });
  if (slots.length > 0) said.push({ kind: 'running_matter_not_carried' });

  // Each face the text is set in, each file kept to the characters it sets (HT-B).
  const characters = new Map<string, Set<number>>();
  for (const typeface of theme.typefaces.values()) {
    const held = used.get(typeface.id);
    if (held === undefined) continue;
    for (const file of typeface.files) {
      const all = characters.get(file.sha256) ?? new Set<number>();
      for (const codePoint of held) all.add(codePoint);
      characters.set(file.sha256, all);
    }
  }
  const urls = new Map<string, string>();
  for (const [sha256, codePoints] of characters) {
    const bytes = input.faces.get(sha256);
    if (bytes === undefined) continue;
    const kept = input.subset(
      bytes,
      [...codePoints].sort((a, b) => a - b),
    );
    urls.set(sha256, `data:${fontType(kept)};base64,${base64(kept)}`);
  }
  const held = projectFontFaces(
    {
      ...theme,
      typefaces: new Map([...theme.typefaces].filter(([, face]) => used.has(face.id))),
    },
    (sha256) => urls.get(sha256),
    { uprightOnce: true },
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
    ...(tabled
      ? [
          element(
            'span',
            [
              ['id', SCROLL_REGION],
              ['lang', wordsLanguage],
              ['hidden', ''],
            ],
            escapeText(input.html.words.scrollRegion),
          ),
        ]
      : []),
    ...front,
    element('main', [], `\n${sections}${back.join('')}`),
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { ok: true, bytes: new TextEncoder().encode(html), report: [...said, ...report] };
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

/** Above the projection's own rules for a list, which the doubled canvas class scopes. */
const ENTRIES = '.aw-canvas.aw-canvas.aw-canvas :is(ol.aw-notes, ul.aw-entries)';

/**
 * The canvas's own rules (HT-C), beside the theme's projection: the page in the theme's paper, the
 * text a column at most the PDF's measure that reflows below it at any width (WCAG 1.4.10), at the
 * printed size; spaces kept as the author typed them in a block's text, as the editor keeps them;
 * a quoted phrase's own characters its only quotes; a definition and preformatted text without a
 * browser's own indent, the latter scrolling sideways in its own box, under its label; an image no
 * wider than the column and a table scrolling in its region; notes and entries without markers, their
 * labels their own; and a face with no italic set upright, as the engine sets it (UF-E).
 */
function canvasCss(theme: ResolvedTheme, measure: number): string {
  return [
    `html, .aw-canvas { background: ${theme.paper}; }`,
    'body { margin: 0; }',
    `.aw-canvas { --aw-zoom: 1; box-sizing: border-box; max-width: calc(${Math.round(measure * 100) / 100}pt + 32px); ` +
      'margin-inline: auto; padding: 16px; overflow-wrap: break-word; font-synthesis-style: none; }',
    '.aw-canvas :is(p, dt, h1, h2, h3, h4, h5, h6, footer) { white-space: break-spaces; }',
    '.aw-canvas q { quotes: none; }',
    '.aw-canvas :is(dl, dd) { margin: 0; }',
    '.aw-canvas pre { white-space: pre; tab-size: 8; overflow-x: auto; }',
    '.aw-canvas pre[data-language]::before { content: attr(data-language); display: block; }',
    '.aw-canvas img { max-width: 100%; }',
    '.aw-canvas .aw-figure-image img { display: block; height: auto; }',
    '.aw-canvas figure { margin-inline: 0; }',
    '.aw-canvas table { border-collapse: collapse; table-layout: fixed; width: 100%; }',
    '.aw-canvas :is(td, th) { vertical-align: top; }',
    // A contents entry and a list's are links standing alone, each a finger's height from the next
    // (WCAG 2.5.8): padded, which also keeps a trimmed line from drawing the next over it.
    '.aw-canvas nav a { display: block; padding-block: 6px; }',
    '.aw-canvas .aw-table-region { max-width: 100%; overflow-x: auto; }',
    '.aw-canvas .aw-equation-block { display: flex; align-items: center; gap: 1em; overflow-x: auto; }',
    '.aw-canvas .aw-equation-block > math { flex: 1; }',
    `${ENTRIES} { display: block; padding: 0; margin: 0; list-style: none; }`,
    `${ENTRIES} > li { display: block; }`,
    `${ENTRIES} > li::before { content: none; }`,
    '',
  ].join('\n');
}
