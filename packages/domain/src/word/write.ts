import { strToU8, zipSync, type Zippable } from 'fflate';

import { ADMITTED_FORMATS } from '../assets/header.js';
import { escapeXml } from '../content/ooxml/xml.js';
import {
  figureImageKey,
  inlineImageKey,
  inlineReferenceKey,
  type ReferenceSite,
  type RunsSite,
  type WordImage,
  type WordInput,
  type WordReference,
  type WordTitleRun,
} from '../publishing/assemble.js';
import type { PageFormat, PublishingFormat, SlotPart } from '../publishing/layout.js';
import { columnsOf } from '../publishing/measure.js';
import {
  parseOutputReport,
  type OutputReport,
  type OutputReportEntry,
} from '../publishing/outputs.js';
import type {
  PublishedBlock,
  PublishedCell,
  PublishedDocument,
  PublishedFigure,
  PublishedGeneratedList,
  PublishedInline,
  PublishedLanguage,
  PublishedList,
  PublishedNode,
  PublishedPreformatted,
  PublishedQuotation,
  PublishedReferenceRun,
  PublishedTable,
  PublishedTitleRun,
} from '../publishing/published.js';
import { sectionNumbers, type NumberingTable } from '../structure/numbering.js';
import type { OutlineMatter } from '../structure/outline.js';
import { formatCounter, type NumberingScheme } from '../structure/scheme.js';
import {
  headingDepths,
  hex,
  markStyleId,
  panelInset,
  projectStylesXml,
  rFonts,
  shading,
  size,
  tableRule,
  tableStyleId,
  toggle,
  wordFamily,
  wordLanguage,
} from '../theme/ooxml.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from '../theme/read.js';
import { runFormat, wordRun, type WordRun } from '../theme/runs.js';
import type { Role, StyledMark, TableStyle, Typeface } from '../theme/schema.js';

import { faceAdvances, type FaceAdvances } from './advances.js';
import { fontKey, obfuscateFont } from './fonts.js';
import {
  BODY_INDENT,
  DEFINITION_HANG,
  LIST_INDENT,
  listNumberingXml,
  markerWidth,
  type WordList,
} from './lists.js';
import {
  captionField,
  footnoteProperties,
  HEADING_LISTS,
  numberingXml,
  sequenceName,
  WORD_FORMATS,
  WORD_LEVELS,
  type CaptionField,
} from './numbering.js';
import { panelsApart } from './panels.js';
import { spacingOverrides, type SpacingOverride } from './spacing.js';

/**
 * **The Word writer** (Word 1, rulings R6 to R10 and R13; docs/design/word-output.md, "How a
 * publication reaches Word"): the published document, its numbering and what `assemble` carries for
 * Word beside it, as the parts of a `.docx` Word treats as its own, zipped. It decides nothing about
 * appearance - every paragraph is in the theme's style, every run's formatting is `wordRun`'s - and
 * nothing about pagination: the layout's structure starts pages, and every number only Word can know
 * is a field.
 *
 * Pure and **deterministic**: no clock, no randomness. The same inputs make the same bytes - a fixed
 * time on every zip entry, the parts in a fixed order, relationships numbered in the order they are
 * met, and each embedded face's key taken from its own hash (`fontKey`).
 *
 * Word 1 wrote paragraphs, headings, marks, links and languages, and the page around them: the
 * cover, the notice, the contents and the running heads and feet. Word 2 writes lists, quotations and
 * preformatted text, each stood in and spaced as the PDF sets it (rulings R4 to R6), tables in
 * their table styles, captioned by Word's fields (R1, R7), and figures and images in a line, each
 * drawn from its own image's bytes at the size `assemble` gave it against the Word page (R3, R8).
 * Word 3 writes footnotes as Word's own, numbered by Word (ruling R2), and every cross-reference as a
 * field Word updates, at a hidden bookmark on its target named Word's way (rulings R3 and R4).
 * `assemble` refuses equations by name for Word (`word_not_yet`), so meeting one here throws.
 */

/**
 * What the job records as the output's producer version (R12). A version names the writer that made
 * the file, so it moves whenever what the writer writes does: `word/2` is Word 2's, which writes lists,
 * quotations, preformatted text, tables and figures where `word/1` refused them.
 */
export const WORD_WRITER_VERSION = 'word/2';

/** What the writer is given: `assemble`'s answer for Word, the formats asked for, and the faces. */
export interface WordWriting {
  readonly document: PublishedDocument;
  readonly numbering: NumberingTable;
  readonly word: WordInput;
  /** Every format the request named: the report says whether a PDF stands beside this. */
  readonly formats: readonly PublishingFormat[];
  /**
   * Every face file the theme names, by its SHA-256 as the theme records it: the worker reads them,
   * since the domain reads no file. Only those the document's text is set in are embedded.
   */
  readonly faces: ReadonlyMap<string, Uint8Array>;
  /**
   * Every image the request resolved, by the path the published document names it at -
   * `assets/<sha256>.<extension>` - as the worker reads them for the PDF's compile root (Word 2,
   * ruling R3). Only those the document places are written into the package.
   */
  readonly images: ReadonlyMap<string, Uint8Array>;
}

export interface WrittenDocx {
  readonly bytes: Uint8Array;
  /** What Word could not carry, and what a reader of it should know (R13). */
  readonly report: OutputReport;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NAMESPACES = `xmlns:w="${W_NS}" xmlns:r="${R_NS}"`;
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
/** A shape of Word's own, since Word 2010: a floated figure's text box (Word 2, ruling R8). */
const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
/** The document part's: its text's, and its drawings' (Word 2, ruling R8). */
const DOCUMENT_NAMESPACES =
  `${NAMESPACES} xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}"` +
  ` xmlns:wps="${WPS_NS}"`;

/** English Metric Units, which a drawing states its extent in, to the point. */
const EMU_PER_POINT = 12_700;

/**
 * How far text stands clear of a floated figure, in ems of the text: the pinned Typst's `place`
 * clearance, which template 13's figure takes as it is (`floatBox`).
 */
const FLOAT_CLEARANCE = 1.5;

/**
 * **Word's decorative flag** (measured, M7): the extension Word reads as the picture's `Decorative`,
 * with no description beside it, so that a screen reader passes it over as it passes over the PDF's
 * artifact.
 */
const DECORATIVE =
  '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">' +
  '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>' +
  '</a:ext></a:extLst>';

// Written by code point, so that no escape in this file has to survive being typed.
const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const LINE_FEED = String.fromCharCode(10);
const RIGHT_TO_LEFT_EMBEDDING = String.fromCharCode(0x202b);
const POP_DIRECTIONAL_FORMATTING = String.fromCharCode(0x202c);

/**
 * The time on every entry of the zip: the first a zip can hold. Built from local fields, as fflate
 * reads them back into the entry's DOS date, so the bytes are the same in every time zone.
 */
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * The level-1 heading style's name, which a running head's section field finds its heading by: Word's
 * own "Heading 1", which `projectStylesXml` names the heading role's style whatever the catalogue calls
 * it (measured, M2 and M8).
 */
const LEVEL_ONE = 'Heading 1';

/** The heading roles, the first level's first: a node deeper than the sixth is set as the sixth's. */
const HEADINGS = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
] as const satisfies readonly Role[];

/**
 * The footnote reference style, by its identifier: Word's own, as Word names it, so that a footnote a
 * recipient adds is marked in it too (Word 3, ruling R2; M5).
 */
const FOOTNOTE_REFERENCE = 'FootnoteReference';

/**
 * What stands between a note's number and its text, in ems of the note: the pinned Typst's footnote
 * entry's gap, measured in template 13's PDF (0.47pt at the default theme's 9.35pt note) - narrower
 * than a space, which is a quarter of an em in Liberation Serif, and wider than nothing.
 */
const NOTE_NUMBER_GAP = 0.05;

/** The parts the text is written into, each relating its own links and images (Word 3, ruling R2). */
type Story = 'document' | 'footnotes';

/** What a part relates to: its links by target, and its images by path, each with its identifier. */
interface Related {
  readonly links: Map<string, string>;
  readonly media: Map<string, string>;
}

/** A heading or a paragraph taken off every list, where its style would number it. */
const NO_NUMBER = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>';

/**
 * Where text is set: its language, as `w:lang` spells it, and whether it runs right to left. A node's
 * heading and blocks are in its own where it differs from the document's; the layout's words are in
 * the layout's language, left to right, as the PDF sets them.
 */
interface Passage {
  readonly tag: string;
  readonly rtl: boolean;
}

/** A paragraph before it is written: its style, what it holds, and what is stated on it directly. */
interface Paragraph {
  readonly style: string;
  /** The theme's style its spaces are read from: its own, or the one a style of the writer's is based on. */
  readonly theme: string;
  /** What it holds; a bookmark of a target that publishes nothing is added to it (Word 3, R3). */
  content: string;
  /**
   * Kept on the page with what follows it, over its style: a table's caption (Word 2, ruling R7), and a
   * figure's image, whose caption stands below it (R8).
   */
  readonly keepNext?: boolean;
  /** Its alignment over its style's, as Word spells it: a figure's image's, its image style's (R8). */
  readonly justify?: 'left' | 'center' | 'right';
  /** Its list and level, where it carries a heading's or an item's number (Word 2, ruling R4). */
  numbering?: string;
  readonly tabs?: string;
  readonly bidi?: boolean;
  /** Its indents, where a container stands it in from its style's or a panel is kept apart (Word 2). */
  indent?: Indent;
  /** The panel it belongs to, where its lines are one block's (Word 2, ruling R5): else its own. */
  readonly panel?: object;
  /** An appendix's heading where each starts a page, after the first, which its section starts. */
  readonly pageBreakBefore?: boolean;
  /** The first paragraph of a section writes no space before, which Word keeps there (M16). */
  firstOfSection?: boolean;
  /** The space the PDF puts on each side of it, where a container decides it (Word 2, ruling R6). */
  wanted?: { before?: number; after?: number };
  /**
   * The leading the PDF puts above its line, which Word does not: a figure's image fills its line, and
   * Word sets no leading above it, where the PDF spaces a figure from what is above it by its caption
   * style's leading as it spaces any block (measured, Word 2, ruling R8). Added to whatever space it is
   * wanted before.
   */
  readonly lead?: number;
  /**
   * The spaces it is set with whatever the flow wants: a floated figure's anchor's, and its box's
   * paragraphs', which stand out of the flow as the PDF's band does, so that the flow's spaces reach
   * none of them (Word 2, ruling R8).
   */
  readonly held?: { readonly before: number; readonly after: number };
  /**
   * The text box it anchors, where it is a floated figure's anchor (`floatBox`): the drawing around
   * the box's paragraphs, which are written inside it. The paragraph itself holds nothing else and is a
   * tenth of a point high, so that it takes no room in the flow.
   */
  readonly box?: FloatBox;
  /** What it states over its style for Word to space it so (`spacingOverrides`). */
  spacing?: SpacingOverride;
  /**
   * The empty paragraph a point high after a table that ends a section, which carries the section's
   * properties or closes the body, since Word ends each with a paragraph (Word 2, ruling R7).
   */
  readonly closing?: boolean;
}

/**
 * **A floated figure's text box before it is written** (Word 2, ruling R8): its image's paragraph and
 * its caption's, and the drawing written either side of them, up to the box's content and after it.
 */
interface FloatBox {
  readonly paragraphs: readonly Paragraph[];
  readonly open: string;
  readonly close: string;
}

/**
 * **A table before it is written** (Word 2, ruling R7): its `w:tblPr` and grid, and its rows, each its
 * `w:trPr` and its cells, each its `w:tcPr` and its paragraphs.
 */
interface WordTable {
  readonly kind: 'table';
  readonly properties: string;
  readonly rows: readonly {
    readonly properties: string;
    readonly cells: readonly { readonly properties: string; readonly paragraphs: Paragraph[] }[];
  }[];
  /**
   * The space the PDF puts below it, where it ends in its cells: the paragraph after it carries it, as
   * no paragraph of its own can.
   */
  wanted?: { before?: number; after?: number };
}

/** What a body, a section and a block are made of: paragraphs, and tables. */
type Body = Paragraph | WordTable;

const isTable = (item: Body): item is WordTable => 'kind' in item && item.kind === 'table';

/**
 * Where blocks stand (Word 2): the place template 13 sets them in - running text, a list's item, a
 * quotation or a table's cell - how far in from the start and end edges of the text block, or of the
 * cell, their containers stand them, in points, and how many lists, and unordered lists, they stand in;
 * and whether a header sets their text bold, as template 13 does whatever their style says.
 */
interface Place {
  readonly at: 'text' | 'listItem' | 'quotation' | 'tableCell';
  readonly start: number;
  readonly end: number;
  readonly lists: number;
  readonly bullets: number;
  readonly strong?: boolean;
}

const TOP_LEVEL: Place = { at: 'text', start: 0, end: 0, lists: 0, bullets: 0 };

/**
 * A block as Word paragraphs and tables, and how it meets its neighbours, as template 13's `ends` and
 * `container` say: the theme's style whose space before its top takes and whose space after its foot
 * gives, and whether it holds blocks of its own - a list, a quotation or a table - across whose edge
 * contextual spacing never reaches.
 */
interface WrittenBlock {
  readonly body: Body[];
  readonly top: string;
  readonly bottom: string;
  readonly container: boolean;
}

/**
 * The last block a flow wrote - or what it follows, before it writes any - which the next is spaced
 * from: its last paragraph, or the table it ends in.
 */
interface Last {
  readonly paragraph: Body;
  readonly style: string;
  readonly container: boolean;
}

/**
 * A paragraph's `w:ind`, in twips: its start and end, and either how far its first line hangs - an
 * item's, from its number - or how far it stands in.
 */
interface Indent {
  readonly left: number;
  readonly right: number;
  readonly hanging?: number;
  readonly firstLine?: number;
}

/** The first `w:numId` a list takes: after the headings' (Word 2, ruling R4). */
const FIRST_LIST = Math.max(...Object.values(HEADING_LISTS)) + 1;

/** Which of a section's pages its header and footer parts are for. */
interface Furniture {
  readonly header: string;
  readonly footer: string;
}

interface Section {
  readonly body: Body[];
  /** The cover's, set apart by `w:titlePg`; every other section's are its default. */
  readonly cover: boolean;
  readonly furniture: Furniture;
  /** `w:pgNumType`, or none: the cover carries no number (M16). */
  readonly pageNumbering: string | null;
  /**
   * The matter whose footnotes Word numbers in it (`footnoteProperties`); none for the cover's and the
   * contents', which hold no footnote.
   */
  readonly footnotes: OutlineMatter | null;
}

/** A hidden bookmark: its name, Word's way, and its identifier, the number the name ends in. */
interface Bookmark {
  readonly id: number;
  readonly name: string;
}

/**
 * **The bookmarks a target a reference names is given** (Word 3, ruling R3; M4), by what it is: a
 * heading's around its title's words, whose number `REF \r` reads from the heading's list; a footnote's
 * around its mark, which `NOTEREF` reads; a block's where its first paragraph begins, holding nothing;
 * and a caption's two, around its label - where it has one - and around its words, so a number and a
 * title are each a field of their own.
 */
type Bookmarked =
  | { readonly kind: 'heading' | 'footnote' | 'block'; readonly at: Bookmark }
  | { readonly kind: 'caption'; readonly label: Bookmark | null; readonly words: Bookmark };

/**
 * **Every target's bookmarks, by the anchor the published document gives it** (Word 3, ruling R3):
 * `_Ref` and nine digits, numbered in the order the document holds them - a node where its heading
 * stands, before its blocks and its children; a block where it begins, before what it holds; a
 * footnote where its mark stands, before its paragraphs - which is the order the writer writes them in.
 * Deterministic, so the same document makes the same names, and 13 characters, inside the 40 Word keeps
 * (M4). The published document carries an anchor exactly where a reference names it, so every target
 * is named once however many references name it, and nothing else is.
 */
function bookmarksOf(document: PublishedDocument): Map<string, Bookmarked> {
  const named = new Map<string, Bookmarked>();
  let count = 0;
  const next = (): Bookmark => {
    count += 1;
    return { id: count, name: `_Ref${String(count).padStart(9, '0')}` };
  };
  const add = (anchor: string | null, kind: 'heading' | 'footnote' | 'block') => {
    if (anchor !== null) named.set(anchor, { kind, at: next() });
  };
  const runs = (inlines: readonly PublishedInline[]) => {
    for (const run of inlines) {
      if (!('footnote' in run)) continue;
      add(run.footnote.anchor, 'footnote');
      run.footnote.paragraphs.forEach(block);
    }
  };
  const block = (each: PublishedBlock): void => {
    switch (each.type) {
      case 'paragraph':
        add(each.anchor, 'block');
        runs(each.runs);
        return;
      case 'list':
        add(each.anchor, 'block');
        for (const item of each.items) item.blocks.forEach(block);
        return;
      case 'blockquote':
        add(each.anchor, 'block');
        each.blocks.forEach(block);
        return;
      case 'table':
      case 'figure':
        if (each.anchor !== null) {
          const label = each.label === null ? null : next();
          named.set(each.anchor, { kind: 'caption', label, words: next() });
        }
        if (each.type === 'table') {
          for (const row of each.rows) for (const cell of row.cells) cell.blocks.forEach(block);
        }
        return;
      case 'preformatted':
      case 'equation':
      case 'marker':
        add(each.anchor, 'block');
        return;
    }
  };
  const node = (each: PublishedNode) => {
    add(each.anchor, 'heading');
    each.blocks.forEach(block);
    each.children.forEach(node);
  };
  document.nodes.forEach(node);
  return named;
}

/** Content inside a bookmark, where there is one. */
function bookmarked(bookmark: Bookmark | null | undefined, content: string): string {
  if (bookmark === null || bookmark === undefined) return content;
  return (
    `<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/>` +
    content +
    `<w:bookmarkEnd w:id="${bookmark.id}"/>`
  );
}

/** Where a page or a relative reference finds a target: a caption's label, or its words without one. */
function placeOf(target: Bookmarked): Bookmark {
  return target.kind === 'caption' ? (target.label ?? target.words) : target.at;
}

export function writeDocx(input: WordWriting): WrittenDocx {
  const { document, word } = input;
  const theme = word.theme;
  const format = word.format;
  const writer = new Writer(document, theme, input.faces, {
    numbering: input.numbering,
    scheme: word.scheme,
    format,
    images: word.images,
    references: word.references,
    titles: word.titles,
  });

  // The page's furniture: the cover's header and footer, the running ones, and the contents' where its
  // pages must leave the section out, each part named in the order it is made.
  const headerParts = new PartNames();
  const noticeParagraph = writer.paragraph(
    theme.roles.notice,
    writer.runs(document.words.notice, writer.words),
  );
  const coverFurniture: Furniture | null = document.front.cover
    ? {
        header: headerParts.add('header', noticeParagraph.xml),
        footer: headerParts.add('footer', writer.paragraph(theme.roles.running, '').xml),
      }
    : null;
  const header = (withSection: boolean) =>
    headerParts.add(
      'header',
      noticeParagraph.xml + (writer.slots(format, format.head, withSection)?.xml ?? ''),
    );
  const footer = (withSection: boolean) =>
    headerParts.add(
      'footer',
      (writer.slots(format, format.foot, withSection) ?? writer.paragraph(theme.roles.running, ''))
        .xml,
    );
  const runningFurniture: Furniture = { header: header(true), footer: footer(true) };
  // The contents stands before any heading a running head's section could name, where Word's field
  // would print an error rather than the nothing the PDF prints: its pages carry the slots without it,
  // in a header or a footer of their own where the slots hold a section.
  const generated = document.front.lists;
  const contentsFurniture: Furniture =
    document.front.contents === null && generated.length === 0
      ? runningFurniture
      : {
          header: holdsSection(format.head) ? header(false) : runningFurniture.header,
          footer: holdsSection(format.foot) ? footer(false) : runningFurniture.footer,
        };

  // The sections: the cover, the contents, and each run of top-level nodes of one matter, each
  // starting a page (R8), as the PDF's segments do.
  const entered = new Set<OutlineMatter>();
  /** A matter's page numbering: restarted at one where its rule says so, the first time it begins. */
  const pageNumbering = (matter: OutlineMatter): string => {
    const rule = format.pageNumbering[matter];
    const restart = rule.restart && !entered.has(matter);
    entered.add(matter);
    return `<w:pgNumType w:fmt="${WORD_FORMATS[rule.format]}"${restart ? ' w:start="1"' : ''}/>`;
  };
  const sections: Section[] = [];
  let opened = false;
  /** The title and the notice's sentence beneath it, which open the document wherever it opens. */
  const opening = (): Paragraph[] => {
    if (opened) return [];
    opened = true;
    return [
      writer.paragraph(theme.roles.title, writer.runs(document.title, writer.document)),
      writer.paragraph(
        theme.roles.noticeSentence,
        writer.runs(document.words.noticeSentence, writer.words),
      ),
    ];
  };
  if (coverFurniture !== null) {
    sections.push({
      body: opening(),
      cover: true,
      furniture: coverFurniture,
      pageNumbering: null,
      footnotes: null,
    });
  }
  const contents = document.front.contents;
  // The contents and the lists after it, in one section, as the PDF sets them in its front segment;
  // the lists' entries are written once the nodes are, being the captions Word's fields number.
  let front: Body[] | null = null;
  if (contents !== null || generated.length > 0) {
    front = [
      ...opening(),
      ...(contents === null
        ? []
        : [
            writer.paragraph(
              theme.roles.contents,
              writer.runs(document.words.contents, writer.words),
            ),
            ...writer.contents(document.nodes, contents.depth, sectionNumbers(input.numbering)),
          ]),
    ];
    sections.push({
      body: front,
      cover: false,
      furniture: contentsFurniture,
      pageNumbering: pageNumbering('front'),
      footnotes: null,
    });
  }
  for (const segment of segmentsOf(document.nodes)) {
    const body: Body[] = opening();
    segment.nodes.forEach((node, index) => {
      const [heading, ...rest] = writer.node(node);
      // Each later appendix starts a page where the layout says so (PUB-088), by a page break before
      // its heading, where Word drops the heading's space before as the PDF does (M16). Not a break in
      // a paragraph of its own: that takes a line after the appendix before, which where it fills its
      // last page flows onto a page the break leaves blank (the final review of Word 1, M2).
      const breaks = index > 0 && segment.matter === 'appendix' && document.appendices.newPage;
      body.push(breaks ? { ...heading, pageBreakBefore: true } : heading, ...rest);
    });
    sections.push({
      body,
      cover: false,
      furniture: runningFurniture,
      pageNumbering: pageNumbering(segment.matter),
      footnotes: segment.matter,
    });
  }
  if (front !== null) front.push(...writer.listsAfterContents(generated, front.length > 0));

  const notes = writer.notes;
  const relationships = new Relationships();
  relationships.add('styles', 'styles.xml');
  relationships.add('numbering', 'numbering.xml');
  relationships.add('settings', 'settings.xml');
  relationships.add('fontTable', 'fontTable.xml');
  if (notes.length > 0) relationships.add('footnotes', 'footnotes.xml');
  const partIds = new Map(
    headerParts.parts.map((part) => [part.name, relationships.add(part.kind, part.name)]),
  );
  // Over the whole body in order, since Word asks a paragraph's neighbours across a section's break as
  // it does within one.
  const inOrder = sections.flatMap((section) => section.body);
  // The space the PDF puts below a table that ends in its cells, on the paragraph after it, which Word
  // spaces from the table by its own space before alone (Word 2, ruling R7).
  inOrder.forEach((item, index) => {
    const next = inOrder[index + 1];
    const after = isTable(item) ? item.wanted?.after : undefined;
    if (after === undefined || next === undefined || isTable(next)) return;
    const own = writer.properties(next.theme).spaceBefore;
    next.wanted = { ...next.wanted, before: (next.wanted?.before ?? own) + after };
  });
  /** A run of paragraphs Word reads as neighbours, spaced and parted as the PDF sets them. */
  const settle = (run: Paragraph[]) => {
    // The spaces a container decides, stated over the styles where Word would read them otherwise
    // (Word 2, ruling R6), among paragraphs Word reads as neighbours: a table stands between the
    // paragraphs either side of it, and a cell's are its own.
    spacingOverrides(
      run.map((paragraph) => {
        const own = writer.properties(paragraph.theme);
        return {
          style: paragraph.style,
          own: {
            before: own.spaceBefore,
            after: own.spaceAfter,
            contextual: own.contextualSpacing,
          },
          wanted:
            paragraph.held !== undefined
              ? paragraph.held
              : paragraph.lead === undefined
                ? (paragraph.wanted ?? {})
                : {
                    ...paragraph.wanted,
                    before: (paragraph.wanted?.before ?? own.spaceBefore) + paragraph.lead,
                  },
        };
      }),
    ).forEach((override, index) => {
      run[index]!.spacing = override;
    });
    // Each panel its own, as the PDF's are (Word 2, ruling R5): Word joins paragraphs of one border
    // and one indent into one panel.
    panelsApart(
      run.map((paragraph) => {
        const own = writer.properties(paragraph.theme);
        const indent = paragraph.indent ?? writer.ownIndent(paragraph.theme);
        return {
          look: own.background === 'none' ? null : `${own.background} ${own.padding}`,
          left: indent.left,
          right: indent.right,
          panel: paragraph.panel ?? paragraph,
        };
      }),
    ).forEach((moved, index) => {
      const paragraph = run[index]!;
      if (!moved) return;
      const indent = paragraph.indent ?? writer.ownIndent(paragraph.theme);
      paragraph.indent = { ...indent, left: indent.left + 1, right: indent.right + 1 };
    });
  };
  for (const run of paragraphRuns(inOrder)) settle(run);
  // Two notes stand apart as two blocks of the footnote place's style do, two containers, whose
  // spaces add whether or not the style asks for contextual spacing (template 13's `apart`, the gap
  // between its footnote entries); a note's own paragraphs as its flow spaced them. The footnotes part
  // is a run of its own, its notes' paragraphs one after another as Word reads them.
  const noteStyle = writer.properties(theme.places.footnote);
  notes.forEach((note, index) => {
    const next = notes[index + 1]?.paragraphs[0];
    const last = note.paragraphs[note.paragraphs.length - 1]!;
    if (next === undefined) return;
    last.wanted = { ...last.wanted, after: noteStyle.spaceAfter };
    next.wanted = { ...next.wanted, before: noteStyle.spaceBefore };
  });
  settle(notes.flatMap((note) => note.paragraphs));
  const body = sections
    .map((section, index) => {
      const numbered = section.footnotes;
      const properties = sectionProperties(
        section,
        format,
        partIds,
        notes.length === 0 || numbered === null ? '' : footnoteProperties(word.scheme, numbered),
      );
      const last = index === sections.length - 1;
      const items = section.body;
      // Word ends a section, and the body, with a paragraph: after a table, one a point high.
      if (isTable(items[items.length - 1]!)) {
        const text = theme.places.text;
        items.push({ style: text, theme: text, content: '', closing: true });
      }
      (items[0] as Paragraph).firstOfSection = true;
      return items
        .map((item, at) =>
          isTable(item)
            ? tableXml(item)
            : paragraphXml(item, !last && at === items.length - 1 ? properties : undefined),
        )
        .join('')
        .concat(last ? properties : '');
    })
    .join('');
  // The images the text places, each once, in the order the text first meets them; then the text's
  // links, each named in the order the text first meets its target. The notes' likewise, related from
  // the footnotes part, and an image placed in both written once.
  const media = new Map<string, { name: string; bytes: Uint8Array; extension: string }>();
  const relate = (related: Related, from: Relationships) => {
    for (const [path, id] of related.media) {
      const bytes = input.images.get(path);
      if (bytes === undefined) throw new Error(`No bytes for the image ${path}`);
      const name = path.slice(path.lastIndexOf('/') + 1);
      from.add('image', `media/${name}`, id);
      media.set(path, { name, bytes, extension: name.slice(name.lastIndexOf('.') + 1) });
    }
    for (const [href, id] of related.links) from.external(id, 'hyperlink', href);
  };
  relate(writer.related.document, relationships);
  const noteRelationships = new Relationships();
  relate(writer.related.footnotes, noteRelationships);

  const fonts = fontParts(theme, writer.used, input.faces);
  const files: Zippable = {};
  const put = (name: string, content: string | Uint8Array) => {
    files[name] = typeof content === 'string' ? strToU8(content) : content;
  };
  const overrides: [string, string][] = [
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/word/document.xml', `${WML}document.main+xml`],
    ['/word/styles.xml', `${WML}styles+xml`],
    ['/word/numbering.xml', `${WML}numbering+xml`],
    ['/word/settings.xml', `${WML}settings+xml`],
    ['/word/fontTable.xml', `${WML}fontTable+xml`],
    ...(notes.length === 0
      ? []
      : [['/word/footnotes.xml', `${WML}footnotes+xml`] satisfies [string, string]]),
    ...headerParts.parts.map((part): [string, string] => [
      `/word/${part.name}`,
      `${WML}${part.kind}+xml`,
    ]),
  ];
  put(
    '[Content_Types].xml',
    DECLARATION +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (fonts.files.length === 0
        ? ''
        : '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>') +
      imageTypes([...media.values()].map((each) => each.extension)) +
      overrides
        .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
        .join('') +
      '</Types>',
  );
  put(
    '_rels/.rels',
    relationshipsXml([
      `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>`,
      `<Relationship Id="rId2" Type="${PACKAGE_RELATIONSHIPS}/metadata/core-properties" Target="docProps/core.xml"/>`,
    ]),
  );
  put('docProps/core.xml', coreXml(document));
  put(
    'word/document.xml',
    `${DECLARATION}<w:document ${DOCUMENT_NAMESPACES}><w:body>${body}</w:body></w:document>`,
  );
  put('word/_rels/document.xml.rels', relationshipsXml(relationships.xml));
  for (const each of media.values()) put(`word/media/${each.name}`, each.bytes);
  put(
    'word/styles.xml',
    projectStylesXml(
      theme,
      { language: document.language, direction: document.direction },
      {
        headingList: HEADING_LISTS.body,
        extraStyles: [
          ...ownHeadingStyles(theme),
          ...(contents === null ? [] : contentsStyles(theme, contents.depth)),
          ...(generated.length === 0 ? [] : [listEntryStyle(theme)]),
          ...(notes.length === 0 ? [] : [FOOTNOTE_REFERENCE_STYLE]),
        ],
      },
    ),
  );
  put(
    'word/numbering.xml',
    numberingXml(word.scheme, headingLinks(theme), writer.lists.map(listNumberingXml)),
  );
  put('word/settings.xml', settingsXml(document, theme, format, notes.length > 0));
  if (notes.length > 0) {
    put('word/footnotes.xml', footnotesXml(notes, theme.places.footnote));
    if (noteRelationships.xml.length > 0) {
      put('word/_rels/footnotes.xml.rels', relationshipsXml(noteRelationships.xml));
    }
  }
  put('word/fontTable.xml', fonts.table);
  if (fonts.files.length > 0) {
    put(
      'word/_rels/fontTable.xml.rels',
      relationshipsXml(
        fonts.files.map(
          (file) =>
            `<Relationship Id="${file.id}" Type="${R_NS}/font" Target="fonts/${file.name}"/>`,
        ),
      ),
    );
    for (const file of fonts.files) put(`word/fonts/${file.name}`, file.bytes);
  }
  for (const part of headerParts.parts) put(`word/${part.name}`, part.xml);

  const report = parseOutputReport([
    ...fonts.substituted.map((face) => ({ kind: 'face_substituted' as const, ...face })),
    // Word 2, ruling R7: each table Word could not set as its style asks, in the order they stand.
    ...writer.reported,
    // PUB-074: a Word-only publication carries nothing a page number could cite.
    ...(input.formats.includes('pdf') ? [] : [{ kind: 'no_page_cited_output' as const }]),
    // PUB-065: Word paginates for itself, so a page number cites the PDF, never this.
    { kind: 'pages_cite_the_pdf' as const },
  ]);
  return { bytes: zipSync(files, { mtime: ZIP_TIME }), report };
}

/**
 * The text of the document as Word paragraphs and runs, and what writing it met: the faces its text is
 * set in, and its links. One per document.
 */
class Writer {
  /** Each face the text is set in, by its identifier, with every weight and posture it is set at. */
  readonly used = new Map<string, Set<string>>();
  /**
   * What each part the text is written into relates to, the document's and the footnotes' (Word 3,
   * ruling R2), since a link or an image in a note is related from the part the note is in: each link's
   * target with its relationship's identifier, in the order the text meets them; and each image the
   * text places, by its path, with its relationship's identifier, in the order the text first meets it,
   * one part however often it is placed (Word 2, ruling R8).
   */
  readonly related: Readonly<Record<Story, Related>> = {
    document: { links: new Map(), media: new Map() },
    footnotes: { links: new Map(), media: new Map() },
  };
  /** The part the text is being written into: a note's is the footnotes part. */
  private story: Story = 'document';
  /**
   * Each footnote, in the order the text meets its mark, which is the order Word numbers them in: its
   * identifier, from 1, and its paragraphs (Word 3, ruling R2).
   */
  readonly notes: { readonly id: number; readonly paragraphs: Paragraph[] }[] = [];
  /** How many drawings the text has placed: each one's number is the next, in document order. */
  private drawings = 0;
  /** Each list Word numbers, in the order the text meets them (Word 2, ruling R4). */
  readonly lists: WordList[] = [];
  readonly document: Passage;
  readonly words: Passage;
  private readonly headings: ReadonlyMap<number, HeadingStyle>;
  /**
   * Each caption Word's fields number, in the order the text meets them, by its sequence's `SEQ`
   * name: what a list after the contents lists, and Word's update rebuilds it from (Word 2, M9).
   */
  private readonly captioned: {
    sequence: string;
    label: string;
    words: string;
    passage: Passage;
    floated: boolean;
  }[] = [];
  /** What the report says of each table, in the order the text meets them (Word 2, ruling R7). */
  readonly reported: OutputReportEntry[] = [];
  /** Each face file's advances, read once, by its hash. */
  private readonly advances = new Map<string, FaceAdvances>();
  /** The node whose blocks are being written: a caption's number and a report's place are by it. */
  private at = '';
  /** Every target's bookmarks, by its anchor (Word 3, ruling R3). */
  private readonly bookmarks: ReadonlyMap<string, Bookmarked>;

  constructor(
    private readonly published: PublishedDocument,
    private readonly theme: ResolvedTheme,
    private readonly faces: ReadonlyMap<string, Uint8Array>,
    private readonly numbers: {
      readonly numbering: NumberingTable;
      readonly scheme: NumberingScheme;
      readonly format: PageFormat;
      readonly images: ReadonlyMap<string, WordImage>;
      readonly references: ReadonlyMap<string, WordReference>;
      readonly titles: ReadonlyMap<string, readonly WordTitleRun[]>;
    },
  ) {
    this.bookmarks = bookmarksOf(published);
    this.document = {
      tag: wordLanguage(published.language),
      rtl: published.direction === 'rtl',
    };
    // The layout's words are set left to right in the layout's language, as the PDF's `words` sets
    // them, whatever the document's direction.
    this.words = { tag: wordLanguage(published.words.language), rtl: false };
    this.headings = headingStyles(theme);
  }

  /**
   * A paragraph in a style of the theme's, by its identifier; the style's face is set, if only by its
   * mark. `wordStyle` is the Word style it is written in where that is not the theme's own: a heading's
   * of the writer's, based on it.
   */
  paragraph(
    styleId: string,
    content: string,
    stated: Omit<Paragraph, 'style' | 'theme' | 'content'> = {},
    wordStyle: string = styleId,
  ): Paragraph & { readonly xml: string } {
    const style = this.style(styleId);
    this.use(style.typeface, style.properties.bold, style.properties.italic);
    const paragraph = { style: wordStyle, theme: styleId, content, ...stated };
    return { ...paragraph, xml: paragraphXml(paragraph) };
  }

  /** A theme's paragraph style's properties, by its identifier. */
  properties(styleId: string): ResolvedParagraphStyle['properties'] {
    return this.style(styleId).properties;
  }

  /** Plain words as one run, in the paragraph's style, where they are set. */
  runs(text: string, passage: Passage): string {
    return runXml(text, languageProperties(passage, null, this.document.tag));
  }

  /** A node's heading, its blocks and every node beneath it, each in its own language. */
  node(node: PublishedNode): [Paragraph, ...Body[]] {
    this.at = node.id;
    const passage = this.passageOf(node);
    const depth = node.depth;
    // In the style Word names for its depth, whose outline level places it in the contents and the
    // navigation where the PDF's outline does; Word's deepest is the ninth.
    const style = this.headings.get(Math.min(depth, WORD_LEVELS))!;
    let numbering: string | undefined;
    if (node.number === null) {
      numbering = NO_NUMBER;
    } else if (depth > WORD_LEVELS) {
      // `assemble` refuses a number past the ninth level (`numbering_not_in_word`).
      throw new Error(`A heading numbered at depth ${depth}`);
    } else if (node.matter !== 'body') {
      // Front matter and appendices number from lists of their own (M2); the body's is its style's.
      numbering =
        `<w:numPr><w:ilvl w:val="${depth - 1}"/>` +
        `<w:numId w:val="${HEADING_LISTS[node.matter]}"/></w:numPr>`;
    }
    // A title holding a reference is carried beside the document as runs, each reference a field
    // (Word 3); a heading a reference names is bookmarked around its words (R3).
    const title = this.numbers.titles.get(node.id);
    const words =
      title === undefined
        ? this.titleRuns(node.title, style.theme, passage)
        : this.inlineRuns(title, style.theme, passage, { kind: 'title' });
    const heading = this.paragraph(
      style.theme,
      bookmarked(this.bookmarkOf(node.anchor, 'heading'), words),
      { ...(numbering === undefined ? {} : { numbering }), bidi: passage.rtl },
      style.id,
    );
    const blocks = this.flow(node.blocks, TOP_LEVEL, passage, {
      paragraph: heading,
      style: style.theme,
      container: false,
    });
    // What follows is a heading, spaced from the style the last block ends in, as template 13's
    // `node` spaces it from `last-of`: an attribution's, a list item's.
    const last = blocks[blocks.length - 1];
    if (last !== undefined) {
      last.paragraph.wanted = {
        ...last.paragraph.wanted,
        after: this.properties(last.style).spaceAfter,
      };
    }
    return [
      heading,
      ...blocks.flatMap((block) => block.body),
      ...node.children.flatMap((child) => this.node(child)),
    ];
  }

  /**
   * **Blocks one after another, as template 13's `block-of` sets a flow** (Word 2, ruling R6): each
   * spaced from the one before - or from `above`, the heading they follow - by what the PDF puts
   * between them, which `spacingOverrides` then holds Word to. Two paragraphs of one flow stand as
   * their styles say, contextual spacing and all; a container, or anything beside one, stands apart by
   * both spaces, whatever the styles ask. Each block written, with its last paragraph.
   */
  private flow(
    blocks: readonly PublishedBlock[],
    place: Place,
    passage: Passage,
    above: Last | null = null,
  ): (WrittenBlock & Last)[] {
    const written: (WrittenBlock & Last)[] = [];
    let last = above;
    /** Bookmarks of targets that publish nothing, waiting for the next paragraph to hold them. */
    let pending = '';
    for (const block of blocks) {
      if (block.type === 'marker') {
        // A target that publishes nothing (XR-D) keeps its place as a bookmark holding nothing: at the
        // end of the paragraph before it, else at the start of the next (Word 3, ruling R3).
        const at = this.bookmarkOf(block.anchor, 'block');
        const marker = bookmarked(at, '');
        if (last !== null && !isTable(last.paragraph)) last.paragraph.content += marker;
        else pending += marker;
        continue;
      }
      const each = this.block(block, place, passage);
      // A table begins with its caption: a block's top is always a paragraph.
      const top = each.body[0] as Paragraph | undefined;
      if (top === undefined) continue;
      top.content = pending + top.content;
      pending = '';
      if (last !== null) {
        this.space(last.paragraph, last.style, top, each.top, !last.container && !each.container);
      }
      last = {
        paragraph: each.body[each.body.length - 1]!,
        style: each.bottom,
        container: each.container,
      };
      written.push({ ...each, ...last });
    }
    if (pending !== '') {
      // Nothing else in the flow to hold them: an empty paragraph of the place's does, as a cell's
      // empty paragraph would.
      const style = this.theme.places[place.at];
      const holder = this.paragraph(style, pending, { bidi: passage.rtl });
      written.push({
        body: [holder],
        top: style,
        bottom: style,
        container: false,
        paragraph: holder,
        style,
      });
    }
    return written;
  }

  /**
   * The space between two blocks, template 13's `gap`: the first's style's space after and the
   * second's space before, or neither where both are one style asking for contextual spacing within
   * one flow (`between`).
   */
  private space(
    above: Body,
    aboveStyle: string,
    below: Paragraph,
    belowStyle: string,
    within: boolean,
  ) {
    const a = this.properties(aboveStyle);
    const b = this.properties(belowStyle);
    const close = within && aboveStyle === belowStyle && a.contextualSpacing && b.contextualSpacing;
    above.wanted = { ...above.wanted, after: close ? 0 : a.spaceAfter };
    below.wanted = { ...below.wanted, before: close ? 0 : b.spaceBefore };
  }

  /** Two paragraphs the PDF sets a line apart and no more: two items, two lines of one block. */
  private adjoin(above: Body, below: Paragraph) {
    above.wanted = { ...above.wanted, after: 0 };
    below.wanted = { ...below.wanted, before: 0 };
  }

  private block(block: PublishedBlock, place: Place, passage: Passage): WrittenBlock {
    const written = this.unmarked(block, place, passage);
    // A block a reference names is bookmarked where its first paragraph begins, holding nothing (R3):
    // a page and above or below are all a block is named for, and Word refuses a relative field
    // inside the bookmark it names, which one in the block's own first paragraph would be (measured
    // in Word 16: "Error! Not a valid bookmark self-reference"). A table and a figure are bookmarked
    // around their caption's label and words, where the caption is written.
    if (block.type !== 'table' && block.type !== 'figure' && block.type !== 'marker') {
      const at = this.bookmarkOf(block.anchor, 'block');
      const opening = written.body.find((each): each is Paragraph => !isTable(each));
      if (at !== null && opening !== undefined) {
        opening.content = bookmarked(at, '') + opening.content;
      }
    }
    return written;
  }

  private unmarked(block: PublishedBlock, place: Place, passage: Passage): WrittenBlock {
    switch (block.type) {
      case 'paragraph':
        return {
          body: [
            this.paragraph(
              block.style,
              this.inlineRuns(
                block.runs,
                block.style,
                passage,
                { kind: 'paragraph', block: block.id },
                place.strong === true,
              ),
              { bidi: passage.rtl, ...this.indented(block.style, place) },
            ),
          ],
          top: block.style,
          bottom: block.style,
          container: false,
        };
      case 'list':
        return this.list(block, place, passage);
      case 'blockquote':
        return this.quotation(block, place, passage);
      case 'preformatted':
        return this.preformatted(block, place, passage);
      case 'table':
        return this.table(block, place, passage);
      case 'figure':
        return this.figure(block, place, passage);
      default:
        // A block equation is Word 4's, which `assemble` refuses for Word until then; a marker is
        // written by the flow it stands in.
        throw new Error(`The Word writer does not write a ${block.type} yet`);
    }
  }

  /**
   * **A list** (Word 2, ruling R4; `lists.ts`): an ordered or unordered one numbered by a definition
   * of its own, at the level of how many lists it stands in; each item's first paragraph carrying its
   * number, standing where the PDF's engine puts the item, its number ending where the engine ends its
   * marker, and its later paragraphs standing where the first does. An item that opens with anything
   * but a paragraph - a nested list, a quotation, preformatted text - or holds nothing carries its
   * number on an empty paragraph of its own, since a Word paragraph carries one number and a panel
   * would take it inside: where the PDF sets two markers on one line, or a marker beside a panel, Word
   * takes a line more. A definition list is each item's term, in the list item's style and bold as
   * the engine sets a term, and its definitions hung beneath it; an item with no term yet has none, as
   * the engine prints none. Items stand a line apart, as the engine stands them, whatever the style
   * would put between them, and a term a line above its definition, where the engine sets it an em.
   */
  private list(list: PublishedList, place: Place, passage: Passage): WrittenBlock {
    if (place.lists >= WORD_LEVELS) {
      // `assemble` refuses a list nested past Word's ninth level for Word (`list_too_deep`).
      throw new Error('A list nested past the ninth level');
    }
    const itemStyle = this.theme.places.listItem;
    const item = this.style(itemStyle);
    const { bold, italic, colour } = item.properties;
    const points = item.properties.size;
    const inner = (start: number, unordered: boolean): Place => ({
      at: 'listItem',
      start,
      end: place.end,
      lists: place.lists + 1,
      bullets: place.bullets + (unordered ? 1 : 0),
      strong: place.strong === true,
    });
    let numbered: WordList | null = null;
    let within: Place;
    if (list.kind === 'definition') {
      within = inner(place.start + DEFINITION_HANG * points, false);
    } else {
      const width = markerWidth(list, place.bullets, this.advancesOf(item), points);
      const gap = BODY_INDENT * points;
      this.use(item.typeface, bold, italic);
      numbered = {
        id: FIRST_LIST + this.lists.length,
        level: place.lists,
        kind: list.kind,
        format: list.format ?? 'decimal',
        start: list.start ?? 1,
        bullets: place.bullets,
        marker: place.start + LIST_INDENT + width,
        step: LIST_INDENT + width + gap,
        gap,
        markerProperties:
          rFonts(item.typeface) +
          toggle('b', bold || place.strong === true) +
          toggle('i', italic) +
          `<w:color w:val="${hex(colour)}"/>` +
          size(points),
      };
      this.lists.push(numbered);
      within = inner(numbered.marker + gap, list.kind === 'unordered');
    }
    const paragraphs: Body[] = [];
    list.items.forEach((each, index) => {
      const own: Paragraph[] = [];
      if (each.term !== null) {
        const term: RunsSite = { kind: 'term', block: list.id, item: index };
        own.push(
          this.paragraph(itemStyle, this.inlineRuns(each.term, itemStyle, passage, term, true), {
            bidi: passage.rtl,
            ...this.indented(itemStyle, place),
          }),
        );
      }
      const body = this.flow(each.blocks, within, passage).flatMap((block) => block.body);
      // A block's top is always a paragraph, a table's its caption.
      const opening = body[0] as Paragraph | undefined;
      if (numbered !== null) {
        const numbering =
          `<w:numPr><w:ilvl w:val="${numbered.level}"/>` +
          `<w:numId w:val="${numbered.id}"/></w:numPr>`;
        // What the item opens with, a target that publishes nothing aside: its bookmark stands in
        // the paragraph after it, or in one of its own where nothing follows.
        const first = each.blocks.find((block) => block.type !== 'marker');
        if (opening !== undefined && (first === undefined || first.type === 'paragraph')) {
          opening.numbering = numbering;
          opening.indent = this.indent(opening.theme, within, numbered.marker);
        } else {
          own.push(
            this.paragraph(itemStyle, '', {
              bidi: passage.rtl,
              numbering,
              indent: this.indent(itemStyle, within, numbered.marker),
            }),
          );
        }
      } else if (own.length === 0 && opening === undefined) {
        // An item with neither a term nor a definition yet, kept as the engine keeps it.
        own.push(
          this.paragraph(itemStyle, '', { bidi: passage.rtl, ...this.indented(itemStyle, within) }),
        );
      }
      // A term, or the empty paragraph carrying a number, stands a line above what follows it.
      if (own.length > 0 && opening !== undefined) this.adjoin(own[own.length - 1]!, opening);
      const whole: Body[] = [...own, ...body];
      const previous = paragraphs[paragraphs.length - 1];
      if (previous !== undefined) this.adjoin(previous, whole[0] as Paragraph);
      paragraphs.push(...whole);
    });
    return { body: paragraphs, top: itemStyle, bottom: itemStyle, container: true };
  }

  /**
   * **A quotation** (Word 2, ruling R5): its blocks in the flow of a quotation - stood in by the
   * quotation style's indents, which its own paragraphs, in that style, state already - and its
   * attribution a paragraph after them in the attribution role's style, stood in as they are.
   */
  private quotation(quotation: PublishedQuotation, place: Place, passage: Passage): WrittenBlock {
    const quoted = this.theme.places.quotation;
    const { startIndent, endIndent } = this.properties(quoted);
    const within: Place = {
      ...place,
      at: 'quotation',
      start: place.start + startIndent,
      end: place.end + endIndent,
    };
    const body = this.flow(quotation.blocks, within, passage);
    const paragraphs = body.flatMap((block) => block.body);
    if (quotation.attribution === null) {
      return { body: paragraphs, top: quoted, bottom: quoted, container: true };
    }
    const role = this.theme.roles.attribution;
    const attribution = this.paragraph(
      role,
      this.inlineRuns(quotation.attribution, role, passage, {
        kind: 'attribution',
        block: quotation.id,
      }),
      { bidi: passage.rtl, ...this.indented(role, within) },
    );
    const last = body[body.length - 1];
    if (last !== undefined) {
      this.space(last.paragraph, last.style, attribution, role, !last.container);
    }
    return { body: [...paragraphs, attribution], top: quoted, bottom: role, container: true };
  }

  /**
   * **Preformatted text** (Word 2, ruling R5): its label, where it has one, in the preformatted label
   * role's style; then each line a paragraph of the preformatted role's, its spaces kept exactly -
   * `assemble` has expanded its tabs - and the lines a line apart, as the PDF sets them in one
   * paragraph, on the role's panel.
   */
  private preformatted(block: PublishedPreformatted, place: Place, passage: Passage): WrittenBlock {
    const role = this.theme.roles.preformatted;
    // One panel, however many lines: `panelsApart` keeps it apart from a panel beside it.
    const panel = {};
    const closer = this.closer(block, role, place);
    // The engine drops one line feed that ends its raw text (measured: "x\n" as tall as "x", and "\n"
    // one empty line), which `assemble` keeps as a last empty line: Word writes what the PDF sets.
    const ended = block.lines.length > 1 && block.lines[block.lines.length - 1] === '';
    const lines = (ended ? block.lines.slice(0, -1) : block.lines).map((line) =>
      this.paragraph(role, this.textRun(line, [], role, passage, null, false, closer), {
        bidi: passage.rtl,
        panel,
        ...this.indented(role, place),
      }),
    );
    lines.forEach((line, index) => {
      if (index > 0) this.adjoin(lines[index - 1]!, line);
    });
    if (block.label === null) {
      return { body: lines, top: role, bottom: role, container: false };
    }
    const labelRole = this.theme.roles.preformattedLabel;
    const label = this.paragraph(labelRole, this.runs(block.label, passage), {
      bidi: passage.rtl,
      ...this.indented(labelRole, place),
    });
    this.space(label, labelRole, lines[0]!, role, true);
    return { body: [label, ...lines], top: labelRole, bottom: role, container: false };
  }

  /**
   * **How much closer a preformatted block's characters are set in Word** than its face sets them, in
   * twentieths of a point (Word 2, task 5; measured in the Word check): none where its widest line fits
   * its panel. `assemble` holds a line to the columns the PDF's measure has room for, and refuses a
   * longer one, so the PDF never wraps one; but Word sets the text at the nearest half point - 8.8pt
   * at 9 - in a panel 4pt narrower than the PDF's, its fill reaching 2pt past its border's spacing
   * each side (`panelInset`), and of the 83 columns the default's PDF holds, Word set 80 and wrapped
   * the rest. So a block whose widest line Word would wrap has every character of every line set the
   * least whole twentieths closer that fits it, alike so its columns stay columns - 4 under the
   * default - counting its columns and their advance as `assemble` counts them. No closer than the
   * next half point down would set it: a line wanting more is left for Word to wrap, as it would have,
   * rather than set with its characters over each other. A twip each side is kept for `panelsApart`.
   */
  private closer(block: PublishedPreformatted, role: string, place: Place): number {
    const style = this.style(role);
    const advance = style.typeface.advance;
    if (advance === undefined) return 0;
    const column = (Math.round(style.properties.size * 2) / 2) * advance;
    const indent = this.indent(role, place);
    const room = textBlockWidth(this.numbers.format) - (indent.left + indent.right + 2) / 20;
    const columns = Math.max(...block.lines.map(columnsOf));
    const over = columns * column - room;
    if (over <= 0) return 0;
    const closer = Math.ceil((over / columns) * 20);
    return closer > (advance / 2) * 20 ? 0 : closer;
  }

  /**
   * **A table** (Word 2, ruling R7; WO-F): its caption, a paragraph above it in the caption role's
   * style kept with it, numbered by Word's fields (R1); the table in its table style (`tableStyle` in
   * the projection), the measure wide - or what is left of it where a list or a quotation stands it in
   * - its columns equal and fixed, as template 13 gives them; and its note, a paragraph after it in
   * the table note role's style. Each header row is marked one, which is how Word repeats it too; each
   * body row is kept whole where the style keeps rows whole; a cell is its blocks, paragraphs and
   * lists, in the table cell place's style, standing in from its edges by its padding alone, as the
   * PDF sets a cell's flow. What Word cannot set as the style asks is reported.
   */
  private table(table: PublishedTable, place: Place, passage: Passage): WrittenBlock {
    const style = this.theme.tableStyles.get(table.style);
    // `assemble` refuses a table whose style is missing or is not a table's.
    if (style === undefined) throw new Error(`No table style ${table.style} in the theme`);
    const captionRole = this.theme.roles.caption;
    const noteRole = this.theme.roles.tableNote;
    const cellStyle = this.theme.places.tableCell;
    const cell = this.properties(cellStyle);
    const caption = this.paragraph(captionRole, this.captionRuns(table, captionRole, passage), {
      keepNext: true,
      bidi: passage.rtl,
      ...this.indented(captionRole, place),
    });
    // Template 13's caption stands its space after, the cells' space before and their leading above
    // the table (`apart`), and a cell's first line at the cell's padding. Word sets a cell's first line
    // with its leading above its text, so the table's top padding gives the leading up
    // (`tableProperties`) and the caption's space after takes it, measured.
    caption.wanted = {
      after: this.properties(captionRole).spaceAfter + cell.spaceBefore + leading(cell),
    };
    // Its cells before its note, so that the drawings in them are numbered in the order they stand.
    const written: WordTable = {
      kind: 'table',
      properties: this.tableProperties(table, style, place, passage),
      rows: this.rows(table, style, place, passage),
    };
    const note =
      table.note === null
        ? null
        : this.paragraph(
            noteRole,
            this.inlineRuns(table.note, noteRole, passage, { kind: 'note', block: table.id }),
            { bidi: passage.rtl, ...this.indented(noteRole, place) },
          );
    if (note !== null) {
      note.wanted = { before: cell.spaceAfter + this.properties(noteRole).spaceBefore };
    }
    this.report(table, style);
    return {
      body: note === null ? [caption, written] : [caption, written, note],
      top: captionRole,
      bottom: note === null ? cellStyle : noteRole,
      container: true,
    };
  }

  /**
   * A table's `w:tblPr` and its grid: its style; its width, the measure's as a whole where it stands at
   * the text block's edges, and otherwise what is left of it, stood in from the start; columns fixed,
   * so Word does not size them by what they hold as the PDF never does; its cells' padding, the
   * style's, but at the top less the leading of the table cell place's style - Word sets a cell's
   * first line with its leading above the text, where the PDF sets it at the padding, so each row
   * stood that much taller (measured, 24.84pt against the PDF's 21.00 at 5pt and a 14.35
   * line; 21.48 with the leading given up, the rest Word's half-point rule); the style's conditions each
   * turned on where the table has what it applies to - Word's first column is one column, so a table
   * of more header columns has them drawn by its cells (`cellFormat`); and its caption's words, which
   * Word reads as its title (TAB-039). Right to left, its columns run right to left, as the PDF's do.
   */
  private tableProperties(
    table: PublishedTable,
    style: TableStyle,
    place: Place,
    passage: Passage,
  ): string {
    const inset = place.start > 0 || place.end > 0;
    const column = this.columnWidth(table, place);
    const firstRow = table.headerRows > 0;
    const firstColumn = table.headerColumns === 1;
    const banded = style.banding.fill !== 'none';
    // The look's bits, as Word 2007 read them, beside the attributes that name each (M6, M14).
    const look = (firstRow ? 0x20 : 0) + (firstColumn ? 0x80 : 0) + (banded ? 0 : 0x200) + 0x400;
    return (
      '<w:tblPr>' +
      `<w:tblStyle w:val="${tableStyleId(table.style)}"/>` +
      (passage.rtl ? '<w:bidiVisual/>' : '') +
      (inset
        ? `<w:tblW w:w="${column * table.columns}" w:type="dxa"/>` +
          `<w:tblInd w:w="${twips(place.start)}" w:type="dxa"/>`
        : '<w:tblW w:w="5000" w:type="pct"/>') +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar>' +
      `<w:top w:w="${twips(Math.max(0, style.padding - leading(this.properties(this.theme.places.tableCell))))}" w:type="dxa"/>` +
      ['left', 'bottom', 'right']
        .map((side) => `<w:${side} w:w="${twips(style.padding)}" w:type="dxa"/>`)
        .join('') +
      '</w:tblCellMar>' +
      `<w:tblLook w:val="${look.toString(16).toUpperCase().padStart(4, '0')}" ` +
      `w:firstRow="${firstRow ? 1 : 0}" w:lastRow="0" w:firstColumn="${firstColumn ? 1 : 0}" ` +
      `w:lastColumn="0" w:noHBand="${banded ? 0 : 1}" w:noVBand="1"/>` +
      `<w:tblCaption w:val="${escapeXml(captionText(table))}"/>` +
      '</w:tblPr>' +
      `<w:tblGrid>${`<w:gridCol w:w="${column}"/>`.repeat(table.columns)}</w:tblGrid>`
    );
  }

  /** A column's width, in twips: an equal share of the room the table stands in. */
  private columnWidth(table: PublishedTable, place: Place): number {
    const room = textBlockWidth(this.numbers.format) - place.start - place.end;
    return Math.round(twips(room) / table.columns);
  }

  /**
   * A table's rows. The published rows hold the cells that start in them; Word's hold a cell at every
   * place of the grid, so a place a cell above spans into is a cell that continues it (`w:vMerge`), as
   * wide as it; a cell spanning columns is one cell over them (`w:gridSpan`).
   */
  private rows(
    table: PublishedTable,
    style: TableStyle,
    place: Place,
    passage: Passage,
  ): WordTable['rows'] {
    const column = this.columnWidth(table, place);
    // What continues into each row: at each column where a cell above spans into it, that cell's
    // properties with the merge continued, and its width in columns.
    const continued = table.rows.map(() => new Map<number, { properties: string; span: number }>());
    return table.rows.map((row, at) => {
      const cells: { properties: string; paragraphs: Paragraph[] }[] = [];
      let x = 0;
      const next = [...row.cells];
      while (x < table.columns) {
        const spanned = continued[at]!.get(x);
        if (spanned !== undefined) {
          cells.push({ properties: spanned.properties, paragraphs: [this.emptyCell()] });
          x += spanned.span;
          continue;
        }
        const each = next.shift();
        if (each === undefined) break;
        const own = this.cellFormat(table, style, at, x, each);
        const merge = each.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : '';
        const tcPr = (merge: string) =>
          `<w:tcPr><w:tcW w:w="${column * each.colspan}" w:type="dxa"/>` +
          (each.colspan > 1 ? `<w:gridSpan w:val="${each.colspan}"/>` : '') +
          merge +
          own +
          '</w:tcPr>';
        for (let below = 1; below < each.rowspan; below += 1) {
          continued[at + below]?.set(x, { properties: tcPr('<w:vMerge/>'), span: each.colspan });
        }
        cells.push({ properties: tcPr(merge), paragraphs: this.cell(each, style, place, passage) });
        x += each.colspan;
      }
      const heading = at < table.headerRows;
      const properties =
        (!heading && style.breaks.keepRowsWhole ? '<w:cantSplit/>' : '') +
        (heading ? '<w:tblHeader/>' : '');
      return { properties: properties === '' ? '' : `<w:trPr>${properties}</w:trPr>`, cells };
    });
  }

  /**
   * What a cell states over its table style, as template 13 draws it: nothing, but where a table has
   * more header columns than Word's one first column - the header column's fill behind every cell of
   * them the header row's does not fill, and its rule after the last of them.
   */
  private cellFormat(
    table: PublishedTable,
    style: TableStyle,
    row: number,
    x: number,
    cell: PublishedCell,
  ): string {
    if (table.headerColumns < 2 || x >= table.headerColumns) return '';
    const { headerRow, headerColumn } = style;
    const rule =
      x + cell.colspan === table.headerColumns && headerColumn.rule !== 'none'
        ? `<w:tcBorders>${tableRule('right', headerColumn.rule)}</w:tcBorders>`
        : '';
    const filledByRow = row < table.headerRows && headerRow.fill !== 'none';
    const fill = headerColumn.fill === 'none' || filledByRow ? '' : shading(headerColumn.fill);
    return rule + fill;
  }

  /**
   * A cell's paragraphs: its blocks' flow, set bold where a header sets it so, standing at the cell's
   * edges - the first with no space before it and the last none after it, as the PDF sets a cell - and
   * an empty paragraph where it has nothing, since Word's cell holds one at least.
   */
  private cell(
    cell: PublishedCell,
    style: TableStyle,
    place: Place,
    passage: Passage,
  ): Paragraph[] {
    const strong =
      cell.scope === 'column'
        ? style.headerRow.bold
        : cell.scope === 'row'
          ? style.headerColumn.bold
          : cell.scope === 'both'
            ? style.headerRow.bold || style.headerColumn.bold
            : false;
    const within: Place = {
      at: 'tableCell',
      start: 0,
      end: 0,
      lists: 0,
      bullets: place.bullets,
      strong,
    };
    // A cell holds paragraphs and lists alone, so all it writes is paragraphs.
    const paragraphs = this.flow(cell.blocks, within, passage).flatMap(
      (block) => block.body as Paragraph[],
    );
    if (paragraphs.length === 0) return [this.emptyCell()];
    const first = paragraphs[0]!;
    const last = paragraphs[paragraphs.length - 1]!;
    first.wanted = { ...first.wanted, before: 0 };
    last.wanted = { ...last.wanted, after: 0 };
    return paragraphs;
  }

  /** An empty paragraph in the table cell place's style, at the cell's edges. */
  private emptyCell(): Paragraph {
    const style = this.theme.places.tableCell;
    return this.paragraph(style, '', { wanted: { before: 0, after: 0 } });
  }

  /**
   * A caption's runs: its label, where the layout's numbering gives it one, as Word's fields exactly
   * as `captionField` says (R1; measured, M3) - the label's word, then where the scheme prefixes the
   * number, `STYLEREF` and the separator, then `SEQ` - each prefilled with the numbering table's label,
   * so a reader who never updates them sees the PDF's number; then a space and the caption's own runs,
   * as template 13 sets them. A caption the scheme gives no number has no field. The label is the
   * layout's words, set left to right in the layout's language as the running head is, whatever the
   * caption's direction: measured, in a right-to-left caption Word printed a label right to left in
   * the component's language after the caption's words, each field's result an island of its own
   * (M2 of Word 2's final review). `floated`, where it is a floated figure's, which stands in a text
   * box.
   */
  private captionRuns(
    captioned: Captioned,
    role: string,
    passage: Passage,
    floated = false,
  ): string {
    const entry = this.numbers.numbering.entries.find(
      (each) => each.node === this.at && each.block === captioned.id,
    );
    const field = entry === undefined ? null : captionField(this.numbers.scheme, entry);
    // Where a reference names it, its label and its words each inside a bookmark (Word 3, R3).
    const target = this.bookmarkOf(captioned.anchor, 'caption');
    // A caption holds no image: `assemble` refuses one (`image_in_caption`).
    const own = bookmarked(
      target?.words,
      this.inlineRuns(captioned.caption, role, passage, { kind: 'caption', block: captioned.id }),
    );
    if (entry === undefined || field === null || entry.number === null || entry.value === null) {
      // No number of Word's to compute: the label as the PDF prints it, where there is one.
      return (
        (captioned.label === null
          ? ''
          : bookmarked(target?.label, this.runs(captioned.label, this.words)) +
            this.runs(' ', passage)) + own
      );
    }
    const rule = this.numbers.scheme.sequences[entry.sequence]![entry.matter];
    const counter = formatCounter(entry.value, rule.format[rule.format.length - 1]!);
    this.captioned.push({
      sequence: field.sequence,
      label: captioned.label ?? '',
      words: captionText({ ...captioned, label: null }),
      passage,
      floated,
    });
    return (
      bookmarked(
        target?.label,
        captionLabel(field, entry.number, counter, (text) => this.runs(text, this.words)),
      ) +
      this.runs(' ', passage) +
      own
    );
  }

  /**
   * What the report says of a table (R7): a header column, which Word cannot mark as one (TAB-049); a
   * header its style does not repeat, which Word repeats, since it marks header rows only by
   * repeating them; a continuation label, which Word cannot set. Each by its place and its label.
   */
  private report(table: PublishedTable, style: TableStyle) {
    const named = { node: this.at, block: table.id, label: table.label };
    if (table.headerColumns > 0) this.reported.push({ kind: 'header_column_lost', ...named });
    if (table.headerRows > 0 && !style.breaks.repeatHeader) {
      this.reported.push({ kind: 'header_repeated', ...named });
    }
    if (style.breaks.continuationLabel) {
      this.reported.push({ kind: 'continuation_label_omitted', ...named });
    }
  }

  /**
   * **A figure** (Word 2, ruling R8; WO-G): its image, drawn at the size `assemble` gave it against the
   * Word page, in a paragraph of its own in the caption role's style - as the figure's top is spaced by
   * that style's space before - aligned as its image style says and kept on the page with its caption,
   * as the PDF's figure is never parted from it; and its caption a paragraph below it in the caption
   * role's style, numbered by Word's fields (R1), the caption kept, number and all, where the image is
   * decorative (decision F-M). As a block, the image stands across what its place leaves of the
   * measure. Floated, image and caption are one text box (`floatBox`) at the head of the text area of
   * the page it falls on, the measure wide, as the PDF's band is: measured, Word keeps them together
   * there, where an anchored image left its caption in the text, and keeps two such boxes on one page
   * apart, where two frames stood on each other.
   */
  private figure(figure: PublishedFigure, place: Place, passage: Passage): WrittenBlock {
    const role = this.theme.roles.caption;
    const size = this.imageSize(figureImageKey(this.at, figure.id));
    const properties = this.properties(role);
    const common = { bidi: passage.rtl, justify: justification(figure.alignment) };
    if (figure.placement === 'float') {
      // The box is numbered before the image it holds, as the document holds them.
      const number = (this.drawings += 1);
      const drawn = `<w:r>${this.drawing(figure.path, size, figure.alternative)}</w:r>`;
      const image = this.paragraph(role, drawn, {
        ...common,
        // The band's image at its head; its caption its style's space before below it, and nothing
        // after it but the box's clearance, measured against the PDF's band.
        held: { before: 0, after: 0 },
        ...this.across(role, TOP_LEVEL),
      });
      const caption = this.paragraph(role, this.captionRuns(figure, role, passage, true), {
        bidi: passage.rtl,
        held: { before: properties.spaceBefore, after: 0 },
        ...this.indented(role, TOP_LEVEL),
      });
      const height = size.height + properties.spaceBefore + properties.lineSpacing;
      const box = this.floatBox(number, height, [image, caption]);
      const anchor = this.paragraph(role, '', {
        bidi: passage.rtl,
        held: { before: 0, after: 0 },
        box,
      });
      return { body: [anchor], top: role, bottom: role, container: true };
    }
    const drawn = `<w:r>${this.drawing(figure.path, size, figure.alternative)}</w:r>`;
    const image = this.paragraph(role, drawn, {
      ...common,
      keepNext: true,
      lead: leading(properties),
      ...this.across(role, place),
    });
    const caption = this.paragraph(role, this.captionRuns(figure, role, passage), {
      bidi: passage.rtl,
      ...this.indented(role, place),
    });
    // Template 13's `figure` sets its caption the style's space before and its leading below the
    // image, which has no space of its own; Word sets the leading above the caption's text itself.
    // Measured: each gap within a tenth of a point of the PDF's.
    image.wanted = { after: 0 };
    caption.wanted = { before: properties.spaceBefore };
    return { body: [image, caption], top: role, bottom: role, container: true };
  }

  /**
   * An image's paragraph's indents: across what its place leaves of the measure, with no first line,
   * where that differs from its style's.
   */
  private across(styleId: string, place: Place): { indent?: Indent } {
    const measure: Indent = { left: twips(place.start), right: twips(place.end), firstLine: 0 };
    const style = this.ownIndent(styleId);
    return measure.left === style.left && measure.right === style.right && style.firstLine === 0
      ? {}
      : { indent: measure };
  }

  /**
   * **A floated figure's text box** (Word 2, ruling R8; measured, I1 of Word 2's final review): the
   * measure wide, at the head of the text area (`margin`, `top`) of the page its anchor falls on, the
   * text above and below it and never beside it (`wrapTopAndBottom`), and never over another float
   * (`allowOverlap="0"`), which Word honours by standing a second box on the page below the first.
   * Its paragraphs are clear of its edges but at its foot, where the engine's clearance stands - an em
   * and a half of the text, less the leading Word sets above the text's first line, where the PDF sets
   * none - inside the box, so that a box below it stands clear of it as the text does. Word fits the
   * box to what it holds (`spAutoFit`), so `height`, what the writer can know of it, is only where it
   * starts. `number` is its drawing's.
   */
  private floatBox(number: number, height: number, paragraphs: readonly Paragraph[]): FloatBox {
    const text = this.properties(this.theme.places.text);
    const clearance = FLOAT_CLEARANCE * text.size - leading(text);
    const emu = (points: number) => Math.round(points * EMU_PER_POINT);
    const cx = emu(twips(textBlockWidth(this.numbers.format)) / 20);
    const cy = emu(height + clearance);
    return {
      paragraphs,
      open:
        '<w:drawing>' +
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
        `relativeHeight="${number}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="margin"><wp:align>top</wp:align></wp:positionV>' +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
        '<wp:wrapTopAndBottom/>' +
        `<wp:docPr id="${number}" name="Text Box ${number}"/><wp:cNvGraphicFramePr/>` +
        `<a:graphic><a:graphicData uri="${WPS_NS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
        `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>' +
        '</wps:spPr><wps:txbx><w:txbxContent>',
      close:
        '</w:txbxContent></wps:txbx>' +
        '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" ' +
        `bIns="${emu(clearance)}" anchor="t" anchorCtr="0"><a:spAutoFit/></wps:bodyPr>` +
        '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>',
    };
  }

  /** A paragraph's indents where its place moves it from its style's, as `indent` gives them. */
  private indented(styleId: string, place: Place): { indent?: Indent } {
    const indent = this.indent(styleId, place);
    const own = this.ownIndent(styleId);
    return indent.left === own.left && indent.right === own.right ? {} : { indent };
  }

  /**
   * **Where a paragraph stands** (Word 2), as template 13's `styled` stands it: its style's indents
   * inside what its place already stands in - a quotation's own paragraphs are not given the
   * quotation's indents twice - and a panel's padding inside those, as the projection writes it
   * (`panelInset`). `marker`, for an item's first paragraph, is where its number ends: it hangs from
   * there to the paragraph's start.
   */
  private indent(styleId: string, place: Place, marker?: number): Indent {
    const own = this.properties(styleId);
    const inset = panelInset(own);
    const quotation = this.properties(this.theme.places.quotation);
    const [startWithin, endWithin] =
      place.at === 'quotation' ? [quotation.startIndent, quotation.endIndent] : [0, 0];
    const start = place.start + Math.max(0, own.startIndent - startWithin) + inset;
    const end = place.end + Math.max(0, own.endIndent - endWithin) + inset;
    return {
      left: twips(start),
      right: twips(end),
      ...(marker === undefined
        ? { firstLine: twips(own.firstLineIndent) }
        : { hanging: twips(start - marker) }),
    };
  }

  /** The indents a style states, as the projection writes them. */
  ownIndent(styleId: string): Indent {
    const own = this.properties(styleId);
    const inset = panelInset(own);
    return {
      left: twips(own.startIndent + inset),
      right: twips(own.endIndent + inset),
      firstLine: twips(own.firstLineIndent),
    };
  }

  /** How a style's face sets its characters, read from the file its weight and posture are set in. */
  private advancesOf(style: ResolvedParagraphStyle): FaceAdvances {
    const { typeface } = style;
    const key = fileKey(
      style.properties.bold ? 'bold' : 'regular',
      style.properties.italic ? 'italic' : 'normal',
    );
    const file =
      typeface.files.find((each) => fileKey(each.weight, each.posture) === key) ??
      typeface.files.find((each) => each.weight === 'regular' && each.posture === 'normal') ??
      typeface.files[0]!;
    let advances = this.advances.get(file.sha256);
    if (advances === undefined) {
      const bytes = this.faces.get(file.sha256);
      const read = bytes === undefined ? null : faceAdvances(bytes);
      if (read === null) throw new Error(`The face file ${file.sha256} cannot be read`);
      advances = read;
      this.advances.set(file.sha256, advances);
    }
    return advances;
  }

  /**
   * The contents' entries, prefilled: each node to the layout's depth, its number and its title with a
   * space between - the level's suffix, as the PDF prints an entry and Word rebuilds one (the final
   * review of Word 1, M3) - in the contents entry style of its level, and no page, which only Word can
   * know (M9).
   * One `TOC` field over them all, begun in the first and ended in the last, which Word rebuilds -
   * entries, numbers and pages - when it updates its fields (R8).
   */
  contents(
    nodes: readonly PublishedNode[],
    depth: number,
    numbers: ReadonlyMap<string, string>,
  ): Paragraph[] {
    const levels = Math.min(depth, WORD_LEVELS);
    const listed: PublishedNode[] = [];
    const walk = (node: PublishedNode) => {
      if (node.depth > depth) return;
      listed.push(node);
      node.children.forEach(walk);
    };
    nodes.forEach(walk);
    const code = ['TOC', `o "1-${levels}"`, 'h', 'z', 'u'].join(` ${BACKSLASH}`);
    const entryStyle = this.theme.roles.contentsEntry;
    return listed.map((node, index) => {
      const passage = this.passageOf(node);
      const number = numbers.get(node.id);
      const content =
        (index === 0 ? fieldBegin(code) : '') +
        (number === undefined ? '' : runXml(`${number} `, '')) +
        this.titleRuns(node.title, entryStyle, passage) +
        (index === listed.length - 1 ? FIELD_END : '');
      const style = this.style(entryStyle);
      this.use(style.typeface, style.properties.bold, style.properties.italic);
      const paragraph: Paragraph = {
        style: `TOC${Math.min(node.depth, WORD_LEVELS)}`,
        theme: entryStyle,
        content,
        bidi: passage.rtl,
      };
      return paragraph;
    });
  }

  /**
   * **The lists after the contents** (Word 2; measured, M9): each under its title in the list role's
   * style, starting a page where anything stands before it in the section, as the PDF's weak page break
   * does; then one `TOC \h \z \c` field over the captions its sequence's `SEQ` name numbers - one
   * name for the sequence in every matter, as `captionField` writes it - begun in its first entry and
   * ended in its last, prefilled with each caption paragraph's words, label included, which is what
   * Word rebuilds, and no page, which only Word can know. The entries are in the style Word rebuilds
   * them in, `table of figures`, based on the list entry role's (`listEntryStyle`). A caption the
   * scheme gives no number carries no field, so Word lists it neither before an update nor after.
   */
  listsAfterContents(lists: readonly PublishedGeneratedList[], opened: boolean): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    for (const list of lists) {
      const name = sequenceName(list.sequence);
      // `assemble` refuses the list of equations for Word (`word_not_yet`) until Word 4.
      if (name === null)
        throw new Error(`The Word writer does not write a list of ${list.sequence}`);
      paragraphs.push(
        this.paragraph(this.theme.roles.list, this.runs(list.title, this.words), {
          pageBreakBefore: opened || paragraphs.length > 0,
        }),
      );
      const entries = this.captioned.filter((each) => each.sequence === name);
      // Linked to each caption (`\h`), but where one of them stands in a floated figure's text box:
      // Word then lists that one with no page (measured), and a page is what a list is for.
      const linked = !entries.some((each) => each.floated);
      const code = ['TOC', ...(linked ? ['h'] : []), 'z', `c "${name}"`].join(` ${BACKSLASH}`);
      const shown = entries.length === 0 ? [null] : entries;
      shown.forEach((entry, index) => {
        paragraphs.push(
          this.paragraph(
            this.theme.roles.listEntry,
            (index === 0 ? fieldBegin(code) : '') +
              (entry === null
                ? ''
                : this.runs(entry.label, this.words) +
                  this.runs(` ${entry.words}`, entry.passage)) +
              (index === shown.length - 1 ? FIELD_END : ''),
            {},
            LIST_ENTRY_STYLE,
          ),
        );
      });
    }
    return paragraphs;
  }

  /**
   * A running head or foot (R8): the notice's paragraph stands above it, in the header. One paragraph
   * in the running role's style, its three slots at its start, at a centre tab stop at the middle of
   * the text block and at a right tab stop at its end. The section is the level-1 heading's number and
   * title, as the PDF prints the heading, by `STYLEREF` - the first on the page, else the last before
   * it (M8) - and left out where `withSection` is false. Null where the slots hold nothing.
   */
  slots(
    format: PageFormat,
    slots: readonly (readonly SlotPart[])[],
    withSection: boolean,
  ): (Paragraph & { readonly xml: string }) | null {
    if (slots.every((slot) => slot.length === 0)) return null;
    const content = slots
      .map((slot) => slot.map((part) => this.slotPart(part, withSection)).join(''))
      .join('<w:r><w:tab/></w:r>');
    const block = textBlockWidth(format);
    const tabs =
      '<w:tabs>' +
      `<w:tab w:val="center" w:pos="${Math.round(block * 10)}"/>` +
      `<w:tab w:val="right" w:pos="${Math.round(block * 20)}"/>` +
      '</w:tabs>';
    return this.paragraph(this.theme.roles.running, content, { tabs, bidi: this.document.rtl });
  }

  private slotPart(part: SlotPart, withSection: boolean): string {
    if (part.kind === 'words') return this.runs(part.text, this.words);
    switch (part.field) {
      case 'title':
        return this.runs(this.published.title, this.document);
      // A revision is a token in no language, as a page's number is: written with no direction of its
      // own, so the bidi algorithm places it as the PDF's does. Written right to left in a right-to-left
      // document, Word set "Revision 0.7" as "0.7Revision" (the Word check).
      case 'revision':
        return runXml(this.published.revision, '');
      // Numbers only Word knows, left empty until Word lays out the page: copying the PDF's would be
      // wrong the moment Word reflows (PUB-065).
      case 'page':
        return fieldBegin('PAGE') + FIELD_END;
      // Every physical page, as the PDF's `pages` counts them (M8, M16).
      case 'pages':
        return fieldBegin('NUMPAGES') + FIELD_END;
      case 'section':
        return withSection ? sectionFields(this.document.rtl) : '';
    }
  }

  /** A title's words, each a run carrying no mark; an equation in one is Word 4's, refused till then. */
  private titleRuns(
    title: readonly PublishedTitleRun[],
    styleId: string,
    passage: Passage,
  ): string {
    return title
      .map((run) => {
        if (!('text' in run)) {
          throw new Error('Word 1 does not write an equation, which assemble refuses for Word');
        }
        return this.textRun(run.text, [], styleId, passage, null);
      })
      .join('');
  }

  /**
   * A paragraph's runs: each by `wordRun` - one character style and what Word's reading would lose
   * pinned (R9) - its language where it differs, and consecutive runs linked to one target as one
   * `w:hyperlink` to an external relationship. A quoted phrase adds nothing but its style: its text is
   * what the author wrote, marks and all. An image among them is a drawing in a run of its own, at the
   * size `assemble` gave it for the Word page under its place among `site`'s runs (Word 2, ruling R8);
   * a cross-reference a field, in the form `assemble` kept for it there (Word 3, ruling R4).
   */
  private inlineRuns(
    runs: readonly PublishedInline[],
    styleId: string,
    passage: Passage,
    site: ReferenceSite | null,
    strong = false,
  ): string {
    let xml = '';
    let linking: string | null = null;
    for (const [index, run] of runs.entries()) {
      if ('image' in run && site !== null && site.kind !== 'title') {
        if (linking !== null) xml += '</w:hyperlink>';
        linking = null;
        const size = this.imageSize(inlineImageKey(this.at, site, index));
        xml += `<w:r>${this.drawing(run.image.path, size, run.image.alternative)}</w:r>`;
        continue;
      }
      if ('footnote' in run) {
        // The mark is no part of a link before it, as in the PDF it links to its note alone.
        if (linking !== null) xml += '</w:hyperlink>';
        linking = null;
        xml += this.footnote(run.footnote, passage, strong);
        continue;
      }
      if ('reference' in run) {
        // A field of its own, no part of a link before it: where it links, it links to its target.
        if (linking !== null) xml += '</w:hyperlink>';
        linking = null;
        const form =
          site === null
            ? undefined
            : this.numbers.references.get(inlineReferenceKey(this.at, site, index));
        if (form === undefined)
          throw new Error(`No form for a reference to ${run.reference.anchor}`);
        xml += this.reference(run.reference, form, styleId, passage, strong);
        continue;
      }
      if (!('text' in run)) {
        // An equation is Word 4's.
        throw new Error('The Word writer does not write this run, which assemble refuses for Word');
      }
      let href: string | null = null;
      let language: PublishedLanguage | null = null;
      for (const mark of run.marks) {
        if (mark.kind === 'hyperlink') href = mark.href;
        if (mark.kind === 'language') language = mark.language;
      }
      if (href !== linking) {
        if (linking !== null) xml += '</w:hyperlink>';
        if (href !== null) xml += `<w:hyperlink r:id="${this.link(href)}" w:history="1">`;
        linking = href;
      }
      const kinds = run.marks.map((mark) => mark.kind);
      xml += this.textRun(run.text, kinds, styleId, passage, language, strong);
    }
    if (linking !== null) xml += '</w:hyperlink>';
    return xml;
  }

  /**
   * **A footnote** (Word 3, ruling R2; measured, M5): a real Word footnote, numbered by Word, whose
   * mark is a `w:footnoteReference` run in the footnote reference style where the footnote stands -
   * bold in a header row, as template 13 sets a header's text and its mark with it - and whose note is
   * written into the footnotes part, its identifier the next in the order the text meets them. The
   * note's paragraphs are written as the text's are - their styles, which `assemble` resolved to the
   * `footnote` place's, their runs, marks, links and images - in the language and direction where the
   * mark stands, as template 13 sets a note at the foot of the page (footnotes 2), and spaced as its
   * flow spaces them. Its first opens with Word's number, `w:footnoteRef`, in the same style, as the
   * engine sets the note: an em of the footnote place's style in, then the number, then a twentieth of
   * an em before the text - a space, scaled to that width by the face's own advance (`w:w`), since
   * Word set the text straight after the number where the number's run asked for character spacing
   * (measured against the PDF in Word 16).
   */
  private footnote(
    footnote: Extract<PublishedInline, { footnote: unknown }>['footnote'],
    passage: Passage,
    strong: boolean,
  ): string {
    const id = this.notes.length + 1;
    const story = this.story;
    this.story = 'footnotes';
    const paragraphs = this.flow(footnote.paragraphs, TOP_LEVEL, passage).flatMap(
      (block) => block.body as Paragraph[],
    );
    this.story = story;
    const place = this.theme.places.footnote;
    // A note holds a paragraph at least: `assemble` refuses one with nothing in it.
    const [opening = this.paragraph(place, '', { bidi: passage.rtl }), ...rest] = paragraphs;
    const style = this.style(place);
    const em = style.properties.size;
    // Word sets the note at the nearest half point, and its space by the face's advance.
    const space = this.advancesOf(style).width(' ') * (Math.round(em * 2) / 2);
    const scale = Math.min(600, Math.max(1, Math.round((100 * NOTE_NUMBER_GAP * em) / space)));
    const number =
      `<w:r><w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE}"/></w:rPr><w:footnoteRef/></w:r>` +
      `<w:r><w:rPr><w:w w:val="${scale}"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>`;
    const indent = opening.indent ?? this.ownIndent(opening.theme);
    this.notes.push({
      id,
      paragraphs: [
        {
          ...opening,
          content: number + opening.content,
          indent: { left: indent.left, right: indent.right, firstLine: twips(em) },
        },
        ...rest,
      ],
    });
    // A footnote a reference names is bookmarked around its mark, which `NOTEREF` reads (R3).
    return bookmarked(
      this.bookmarkOf(footnote.anchor, 'footnote'),
      `<w:r><w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE}"/>${strong ? toggle('b', true) : ''}` +
        `</w:rPr><w:footnoteReference w:id="${id}"/></w:r>`,
    );
  }

  /**
   * **A cross-reference as a field Word updates** (Word 3, ruling R4; M4), at its target's bookmark and
   * prefilled with what the PDF prints, so a reader who never updates sees the PDF's words and one who
   * does sees Word's: a number a heading's `REF \r` - the number of the heading's list, which is the
   * number it prints - a caption's `REF` on its label and a footnote's `NOTEREF`; a title `REF` on the
   * heading's or the caption's words; both, the two fields a space apart, as the PDF joins them; a
   * relative one `REF \p`, prefilled with the layout's word, which Word's update replaces with its own
   * in the language of the passage the field stands in (WO-C); and a page `PAGEREF`, left empty until
   * Word lays the page out, since a page copied from the PDF would be wrong the moment Word reflows
   * (PUB-066). Each is a link to its target, `\h`, where the PDF's is one - a paragraph's text - and
   * the same field without it anywhere else (XR-D). Its runs are set as the text around it.
   */
  private reference(
    run: PublishedReferenceRun['reference'],
    form: WordReference,
    styleId: string,
    passage: Passage,
    strong: boolean,
  ): string {
    const target = this.bookmarks.get(run.anchor);
    if (target === undefined) throw new Error(`No bookmark for the target ${run.anchor}`);
    const properties = this.runProperties([], styleId, passage, null, strong);
    const field = (code: string, result: string) =>
      referenceField(`${code}${run.link ? ` ${BACKSLASH}h` : ''}`, result, properties);
    const place = placeOf(target);
    const number = () =>
      target.kind === 'footnote'
        ? field(`NOTEREF ${place.name}`, form.label ?? '')
        : target.kind === 'heading'
          ? field(`REF ${place.name} ${BACKSLASH}r`, form.label ?? '')
          : field(`REF ${place.name}`, form.label ?? '');
    const title = () =>
      field(`REF ${(target.kind === 'caption' ? target.words : place).name}`, form.title ?? '');
    switch (form.display) {
      case 'number':
        return number();
      case 'title':
        return title();
      case 'numberAndTitle':
        return number() + runXml(' ', properties) + title();
      case 'relative':
        return field(`REF ${place.name} ${BACKSLASH}p`, run.text ?? '');
      case 'page':
        return field(`PAGEREF ${place.name}`, '');
    }
  }

  /**
   * A target's bookmarks, where a reference names it, as the kind of thing it was named as; a caption's
   * as a caption's. Named by the same walk the writer makes, so a target's kind cannot differ.
   */
  private bookmarkOf(
    anchor: string | null,
    kind: 'heading' | 'footnote' | 'block',
  ): Bookmark | null;
  private bookmarkOf(
    anchor: string | null,
    kind: 'caption',
  ): Extract<Bookmarked, { kind: 'caption' }> | null;
  private bookmarkOf(
    anchor: string | null,
    kind: Bookmarked['kind'],
  ): Bookmark | Extract<Bookmarked, { kind: 'caption' }> | null {
    const named = anchor === null ? undefined : this.bookmarks.get(anchor);
    if (named === undefined) return null;
    if (named.kind !== kind) throw new Error(`The target ${anchor} is a ${named.kind}`);
    return named.kind === 'caption' ? named : named.at;
  }

  /** An image's size against the Word page, as `assemble` gave it (Word 2, ruling R3). */
  private imageSize(key: string): WordImage {
    const size = this.numbers.images.get(key);
    if (size === undefined) throw new Error(`No size for the image ${key} against the Word page`);
    return size;
  }

  /**
   * **A drawing of an image** (Word 2, ruling R8; measured, M7): the picture of its image's part - the
   * part related once however often the image is placed - in the line (`wp:inline`), its extent the size
   * given, and numbered, in `wp:docPr`, in the order the document holds its drawings, its description
   * there, or Word's decorative flag where it has none.
   */
  private drawing(
    path: string,
    size: WordImage,
    alternative: PublishedFigure['alternative'],
  ): string {
    const { media } = this.related[this.story];
    let relationship = media.get(path);
    if (relationship === undefined) {
      relationship = `rIdImage${media.size + 1}`;
      media.set(path, relationship);
    }
    this.drawings += 1;
    const number = this.drawings;
    const cx = Math.round(size.width * EMU_PER_POINT);
    const cy = Math.round(size.height * EMU_PER_POINT);
    return (
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${number}" name="Picture ${number}"` +
      (alternative === null
        ? `>${DECORATIVE}</wp:docPr>`
        : ` descr="${escapeAttribute(alternative.text)}"/>`) +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${number}" name="${escapeXml(path.slice(path.lastIndexOf('/') + 1))}"/>` +
      '<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing>'
    );
  }

  private textRun(
    text: string,
    marks: readonly StyledMark[],
    styleId: string,
    passage: Passage,
    language: PublishedLanguage | null,
    strong = false,
    closer = 0,
  ): string {
    return runXml(text, this.runProperties(marks, styleId, passage, language, strong, closer));
  }

  /** What a run of text states over its paragraph's style, the face it is set in counted as used. */
  private runProperties(
    marks: readonly StyledMark[],
    styleId: string,
    passage: Passage,
    language: PublishedLanguage | null,
    strong = false,
    closer = 0,
  ): string {
    const style = this.style(styleId);
    const rendered = runFormat(this.theme, style, marks);
    this.use(rendered.typeface, rendered.bold || strong, rendered.italic);
    // A definition list's term, which the engine sets bold whatever its style and marks say.
    const run = wordRun(this.theme, style, marks);
    return (
      pinned(strong ? { ...run, pins: { ...run.pins, bold: true } } : run, closer) +
      languageProperties(
        passage,
        language === null ? null : wordLanguage(language),
        this.document.tag,
      )
    );
  }

  /** A link's relationship from the part being written, one per target however often it is linked. */
  private link(href: string): string {
    const { links } = this.related[this.story];
    let id = links.get(href);
    if (id === undefined) {
      id = `rIdLink${links.size + 1}`;
      links.set(href, id);
    }
    return id;
  }

  private passageOf(node: PublishedNode): Passage {
    return {
      tag: node.language === null ? this.document.tag : wordLanguage(node.language),
      rtl: (node.direction ?? this.published.direction) === 'rtl',
    };
  }

  private style(id: string): ResolvedParagraphStyle {
    const style = this.theme.paragraphStyles.get(id);
    if (style === undefined) throw new Error(`No paragraph style ${id} in the theme`);
    return style;
  }

  private use(face: Typeface, bold: boolean, italic: boolean) {
    const at = this.used.get(face.id) ?? new Set<string>();
    at.add(fileKey(bold ? 'bold' : 'regular', italic ? 'italic' : 'normal'));
    this.used.set(face.id, at);
  }
}

/** The header and footer parts, named in the order they are made, each kind counted on its own. */
class PartNames {
  readonly parts: { kind: 'header' | 'footer'; name: string; xml: string }[] = [];

  add(kind: 'header' | 'footer', content: string): string {
    const name = `${kind}${this.parts.filter((part) => part.kind === kind).length + 1}.xml`;
    const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
    this.parts.push({
      kind,
      name,
      xml: `${DECLARATION}<${root} ${NAMESPACES}>${content}</${root}>`,
    });
    return name;
  }
}

/** Whether a running head's or foot's slots print the section anywhere. */
function holdsSection(slots: readonly (readonly SlotPart[])[]): boolean {
  return slots.some((slot) =>
    slot.some((part) => part.kind === 'field' && part.field === 'section'),
  );
}

/** The document's relationships, numbered in the order they are added. */
class Relationships {
  readonly xml: string[] = [];

  add(type: string, target: string, named?: string): string {
    const id = named ?? `rId${this.xml.length + 1}`;
    this.xml.push(`<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`);
    return id;
  }

  external(id: string, type: string, target: string) {
    this.xml.push(
      `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${escapeXml(target)}" TargetMode="External"/>`,
    );
  }
}

/** Consecutive top-level nodes of one matter: each starts a page, as the PDF's segments do. */
function segmentsOf(
  nodes: readonly PublishedNode[],
): { matter: OutlineMatter; nodes: PublishedNode[] }[] {
  const segments: { matter: OutlineMatter; nodes: PublishedNode[] }[] = [];
  for (const node of nodes) {
    const last = segments[segments.length - 1];
    if (last !== undefined && last.matter === node.matter) last.nodes.push(node);
    else segments.push({ matter: node.matter, nodes: [node] });
  }
  return segments;
}

/**
 * Paragraphs Word reads as each other's neighbours, in order, each run its own: the body's either side
 * of each table, and each cell's. The spacing and the panels are settled within each.
 */
function paragraphRuns(body: readonly Body[]): Paragraph[][] {
  const runs: Paragraph[][] = [[]];
  // A text box's paragraphs are a story of their own, each box's its own run.
  const boxes: Paragraph[][] = [];
  for (const item of body) {
    if (isTable(item)) {
      for (const row of item.rows) for (const cell of row.cells) runs.push(cell.paragraphs);
      runs.push([]);
    } else {
      runs[runs.length - 1]!.push(item);
      if (item.box !== undefined) boxes.push([...item.box.paragraphs]);
    }
  }
  return [...runs, ...boxes].filter((run) => run.length > 0);
}

/** A table as Word reads it: its properties and grid, then each row's, then each cell's. */
function tableXml(table: WordTable): string {
  const rows = table.rows
    .map(
      (row) =>
        `<w:tr>${row.properties}` +
        row.cells
          .map(
            (cell) =>
              `<w:tc>${cell.properties}` +
              cell.paragraphs.map((paragraph) => paragraphXml(paragraph)).join('') +
              '</w:tc>',
          )
          .join('') +
        '</w:tr>',
    )
    .join('');
  return `<w:tbl>${table.properties}${rows}</w:tbl>`;
}

/** What a caption holds, as the table's and the list's caption fields and Word's title read it. */
interface Captioned {
  readonly id: string;
  readonly anchor: string | null;
  readonly label: string | null;
  readonly caption: readonly PublishedInline[];
}

/** What a style's line spacing leaves above and between its lines, over its text's size: template 13's leading. */
function leading(properties: ResolvedParagraphStyle['properties']): number {
  return properties.lineSpacing - properties.size;
}

/**
 * A caption's words, its label's and its own, as the PDF prints them - a reference among them as what
 * it printed, and a page as nothing, which only the page knows: a table's title in Word.
 */
function captionText(captioned: Captioned): string {
  const own = captioned.caption
    .map((run) => ('text' in run ? run.text : 'reference' in run ? (run.reference.text ?? '') : ''))
    .join('');
  return captioned.label === null ? own : `${captioned.label} ${own}`;
}

/**
 * **A caption's label as Word's fields** (Word 2, ruling R1; measured, M3), exactly as `captionField`
 * describes it: the label's word and a space, where the layout gives one; `STYLEREF <prefix> \s` and
 * the separator, where the scheme prefixes the number; and `SEQ <sequence> \* <format>`, with
 * `\s <restart>` where the rule restarts. Each field is prefilled from `number`, the numbering table's,
 * whose last part is `counter`, so that the label reads as the PDF's until Word updates it, and after.
 */
function captionLabel(
  field: CaptionField,
  number: string,
  counter: string,
  run: (text: string) => string,
): string {
  const switchOf = (name: string) => ` ${BACKSLASH}${name}`;
  const prefix =
    field.prefix === null
      ? ''
      : fieldBegin(`STYLEREF ${field.prefix}${switchOf('s')}`) +
        run(number.slice(0, number.length - field.separator.length - counter.length)) +
        FIELD_END +
        run(field.separator);
  const sequence =
    `SEQ ${field.sequence}${switchOf('*')} ${field.format}` +
    (field.restart === null ? '' : `${switchOf('s')} ${field.restart}`);
  return (
    (field.word === '' ? '' : run(`${field.word} `)) +
    prefix +
    fieldBegin(sequence) +
    run(counter) +
    FIELD_END
  );
}

/** A paragraph as Word reads it, its properties in the order CT_PPr requires. */
function paragraphXml(paragraph: Paragraph, sectionProperties?: string): string {
  const before = paragraph.firstOfSection === true ? 0 : paragraph.spacing?.before;
  const after = paragraph.spacing?.after;
  const properties =
    `<w:pStyle w:val="${paragraph.style}"/>` +
    (paragraph.keepNext === true ? '<w:keepNext/>' : '') +
    (paragraph.pageBreakBefore === true ? '<w:pageBreakBefore/>' : '') +
    (paragraph.numbering ?? '') +
    (paragraph.tabs ?? '') +
    (paragraph.bidi === true ? '<w:bidi/>' : '') +
    (paragraph.closing === true
      ? '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
      : before === undefined && after === undefined && paragraph.box === undefined
        ? ''
        : '<w:spacing' +
          (before === undefined ? '' : ` w:before="${twips(before)}"`) +
          (after === undefined ? '' : ` w:after="${twips(after)}"`) +
          // A floated figure's anchor a tenth of a point high: measured, the text after it stands
          // where it stood after a frame.
          (paragraph.box === undefined ? '' : ' w:line="2" w:lineRule="exact"') +
          '/>') +
    (paragraph.indent === undefined ? '' : indentXml(paragraph.indent)) +
    (paragraph.spacing?.contextual === false ? '<w:contextualSpacing w:val="0"/>' : '') +
    (paragraph.justify === undefined ? '' : `<w:jc w:val="${paragraph.justify}"/>`) +
    (sectionProperties ?? '');
  const box =
    paragraph.box === undefined
      ? ''
      : `<w:r>${paragraph.box.open}` +
        paragraph.box.paragraphs.map((each) => paragraphXml(each)).join('') +
        `${paragraph.box.close}</w:r>`;
  return `<w:p><w:pPr>${properties}</w:pPr>${box}${paragraph.content}</w:p>`;
}

/** A paragraph's indents as `w:ind`. */
function indentXml(indent: Indent): string {
  return (
    `<w:ind w:left="${indent.left}" w:right="${indent.right}"` +
    (indent.hanging === undefined ? '' : ` w:hanging="${indent.hanging}"`) +
    (indent.firstLine === undefined ? '' : ` w:firstLine="${indent.firstLine}"`) +
    '/>'
  );
}

/**
 * A run of text: tabs and line breaks as Word's own elements, the rest as text whose spaces are kept.
 * An empty run is none.
 */
function runXml(text: string, properties: string): string {
  if (text === '') return '';
  let content = '';
  let pending = '';
  const flush = () => {
    if (pending !== '') content += `<w:t xml:space="preserve">${escapeXml(pending)}</w:t>`;
    pending = '';
  };
  for (const character of text) {
    if (character === TAB || character === LINE_FEED) {
      flush();
      content += character === TAB ? '<w:tab/>' : '<w:br/>';
    } else {
      pending += character;
    }
  }
  flush();
  return `<w:r>${properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`}${content}</w:r>`;
}

/**
 * What `wordRun` says of a run, in CT_RPr's order: its character style, then each value pinned, in
 * pairs where Word reads a complex script's apart (task 2's projection spells them the same way); and
 * where a preformatted block's characters are set closer, by how much (`closer`).
 */
function pinned(run: WordRun, closer = 0): string {
  const { pins } = run;
  return (
    (run.characterStyle === undefined
      ? ''
      : `<w:rStyle w:val="${markStyleId(run.characterStyle)}"/>`) +
    (pins.typeface === undefined ? '' : rFonts(pins.typeface)) +
    (pins.bold === undefined ? '' : toggle('b', pins.bold)) +
    (pins.italic === undefined ? '' : toggle('i', pins.italic)) +
    (pins.colour === undefined ? '' : `<w:color w:val="${hex(pins.colour)}"/>`) +
    (closer === 0 ? '' : `<w:spacing w:val="${-closer}"/>`) +
    (pins.size === undefined ? '' : size(pins.size)) +
    (pins.underline === undefined ? '' : `<w:u w:val="${pins.underline ? 'single' : 'none'}"/>`) +
    (pins.position === undefined ? '' : `<w:vertAlign w:val="${pins.position}"/>`)
  );
}

/**
 * A run's language and direction (R9; measured, M12): in a right-to-left passage, `w:rtl` and its
 * language as a complex script's, which is what Word reads of such a run; elsewhere its language only
 * where it is not the document's, which the defaults carry. `own` is a language mark's.
 */
function languageProperties(passage: Passage, own: string | null, documentTag: string): string {
  const tag = own ?? passage.tag;
  if (passage.rtl) return `<w:rtl/><w:lang w:bidi="${tag}"/>`;
  return tag === documentTag ? '' : `<w:lang w:val="${tag}"/>`;
}

/** A field's start: its instruction, then the separator its result follows. */
function fieldBegin(code: string): string {
  return fieldChar('begin') + instruction(` ${code} `) + fieldChar('separate');
}

const FIELD_END = fieldChar('end');

/** A field's begin, separate or end mark, as a run of its own. */
function fieldChar(kind: 'begin' | 'separate' | 'end'): string {
  return `<w:r><w:fldChar w:fldCharType="${kind}"/></w:r>`;
}

/** Part of a field's instruction, as a run of its own, its spaces kept. */
function instruction(code: string): string {
  return `<w:r><w:instrText xml:space="preserve">${escapeXml(code)}</w:instrText></w:r>`;
}

/**
 * **A cross-reference's field** (Word 3, ruling R4): every run of it - its marks, its instruction and
 * its result - stating `properties`, the text's around it, since Word sets an updated result as the
 * instruction's first character is set and reads a relative field's words in that run's language
 * (M4); its result `result`, or none.
 */
function referenceField(code: string, result: string, properties: string): string {
  const stated = properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`;
  const mark = (kind: 'begin' | 'separate' | 'end') =>
    `<w:r>${stated}<w:fldChar w:fldCharType="${kind}"/></w:r>`;
  return (
    mark('begin') +
    `<w:r>${stated}<w:instrText xml:space="preserve"> ${escapeXml(code)} </w:instrText></w:r>` +
    mark('separate') +
    runXml(result, properties) +
    mark('end')
  );
}

/**
 * A running head's section (measured in Word for the final review of Word 1, I1 and M1): the level-1
 * heading's number, a space and its title, as the PDF prints the heading. Word's number for a heading
 * with none - front matter's under a scheme that numbers none there, or one not numbered - is "0",
 * which the PDF does not print, so the number and its space stand inside an `IF` that prints nothing
 * for "0"; a section's number is never 0, so nothing else is lost. In a right-to-left document the
 * number and its space are a right-to-left embedding, without which Word set the number after the
 * title in reading order, where the PDF sets it first; with it, Word sets a number of digits and one
 * of letters where the PDF does, to the point. A right-to-left mark before the number placed digits
 * but not a letter, and `w:rtl` on the fields' runs placed both but had Word draw them in Times New
 * Roman rather than the embedded face.
 */
function sectionFields(rtl: boolean): string {
  const number = fieldBegin(`STYLEREF "${LEVEL_ONE}" ${BACKSLASH}n`) + FIELD_END;
  return (
    fieldChar('begin') +
    instruction(' IF "') +
    number +
    instruction(`" = "0" "" "${rtl ? RIGHT_TO_LEFT_EMBEDDING : ''}`) +
    number +
    instruction(` ${rtl ? POP_DIRECTIONAL_FORMATTING : ''}" `) +
    fieldChar('separate') +
    FIELD_END +
    fieldBegin(`STYLEREF "${LEVEL_ONE}"`) +
    FIELD_END
  );
}

/** The text block's width in points: the page across, less both margins and the gutter. */
function textBlockWidth(format: PageFormat): number {
  const across = format.orientation === 'landscape' ? format.page.height : format.page.width;
  return across - format.margins.inside - format.margins.outside - format.gutter;
}

const twips = (points: number) => Math.round(points * 20);

/**
 * A section's properties (R8; measured, M8 and M16): its header and footer, its footnotes' numbering
 * where the document has a footnote (Word 3, ruling R2), a new page, the Word page
 * - its size turned where it is landscape, the inside margin on the left and the outside on the right,
 * which `w:mirrorMargins` alternates where they differ, the header and footer halfway into their
 * margins - its page numbering, and the cover's title page.
 */
function sectionProperties(
  section: Section,
  format: PageFormat,
  parts: ReadonlyMap<string, string>,
  footnotes: string,
): string {
  const header = parts.get(section.furniture.header)!;
  const footer = parts.get(section.furniture.footer)!;
  const references =
    `<w:headerReference w:type="default" r:id="${header}"/>` +
    (section.cover ? `<w:headerReference w:type="first" r:id="${header}"/>` : '') +
    `<w:footerReference w:type="default" r:id="${footer}"/>` +
    (section.cover ? `<w:footerReference w:type="first" r:id="${footer}"/>` : '');
  const landscape = format.orientation === 'landscape';
  const width = landscape ? format.page.height : format.page.width;
  const height = landscape ? format.page.width : format.page.height;
  const { top, bottom, inside, outside } = format.margins;
  return (
    '<w:sectPr>' +
    references +
    footnotes +
    '<w:type w:val="nextPage"/>' +
    `<w:pgSz w:w="${twips(width)}" w:h="${twips(height)}"${landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${twips(top)}" w:right="${twips(outside)}" w:bottom="${twips(bottom)}" ` +
    `w:left="${twips(inside)}" w:header="${Math.round(twips(top) / 2)}" ` +
    `w:footer="${Math.round(twips(bottom) / 2)}" w:gutter="${twips(format.gutter)}"/>` +
    (section.pageNumbering ?? '') +
    (section.cover ? '<w:titlePg/>' : '') +
    '</w:sectPr>'
  );
}

/**
 * The document's settings (R6), in CT_Settings' order: its faces embedded, the margins mirrored where
 * the inside and the outside differ, hyphenation where a style hyphenates, the fields updated as it
 * opens, the separator and the continuation separator its footnotes are set under where it has a
 * footnote (Word 3, ruling R2; M5), compatibility mode 15 with spaces that add (M1), the maths face
 * Word sets equations in (R10), and the document's language.
 */
function settingsXml(
  document: PublishedDocument,
  theme: ResolvedTheme,
  format: PageFormat,
  footnotes: boolean,
): string {
  const mirrored = format.margins.inside !== format.margins.outside || format.gutter > 0;
  const hyphenates = [...theme.paragraphStyles.values()].some(
    (style) => style.properties.hyphenate,
  );
  const tag = wordLanguage(document.language);
  return (
    `${DECLARATION}<w:settings xmlns:w="${W_NS}" xmlns:m="${M_NS}">` +
    '<w:embedTrueTypeFonts/>' +
    (mirrored ? '<w:mirrorMargins/>' : '') +
    (hyphenates ? '<w:autoHyphenation/>' : '') +
    '<w:updateFields w:val="true"/>' +
    (footnotes
      ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'
      : '') +
    '<w:compat><w:doNotUseHTMLParagraphAutoSpacing/>' +
    '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
    '</w:compat>' +
    `<m:mathPr><m:mathFont m:val="${escapeXml(wordFamily(theme.maths))}"/></m:mathPr>` +
    `<w:themeFontLang w:val="${tag}"${document.direction === 'rtl' ? ` w:bidi="${tag}"` : ''}/>` +
    '</w:settings>'
  );
}

/** The title and the language, which Word shows and a screen reader announces; no date, no author. */
function coreXml(document: PublishedDocument): string {
  return (
    DECLARATION +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(document.title)}</dc:title>` +
    `<dc:language>${wordLanguage(document.language)}</dc:language>` +
    '</cp:coreProperties>'
  );
}

/**
 * An image format's content type, by the extension its part is named with, for each format the
 * document places, in the order it first places them: only those, as a package declares no type it
 * holds no part of.
 */
function imageTypes(extensions: readonly string[]): string {
  return [...new Set(extensions)]
    .map((extension) => {
      const format = Object.values(ADMITTED_FORMATS).find((each) => each.extension === extension);
      if (format === undefined) throw new Error(`No image format is named .${extension}`);
      return `<Default Extension="${extension}" ContentType="${format.contentType}"/>`;
    })
    .join('');
}

/** An alignment across the measure as Word spells a paragraph's, which it reads by the text's direction. */
function justification(alignment: PublishedFigure['alignment']): 'left' | 'center' | 'right' {
  return alignment === 'start' ? 'left' : alignment === 'end' ? 'right' : 'center';
}

/**
 * Text as an attribute's value, whose line feeds, carriage returns and tabs are kept as references,
 * which a reader would otherwise read as spaces.
 */
function escapeAttribute(value: string): string {
  return escapeXml(value)
    .replaceAll(LINE_FEED, '&#10;')
    .replaceAll(String.fromCharCode(13), '&#13;')
    .replaceAll(TAB, '&#9;');
}

function relationshipsXml(relationships: readonly string[]): string {
  return (
    DECLARATION +
    `<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${relationships.join('')}</Relationships>`
  );
}

/** The style a heading at a depth is written in, and the theme's style it is set in. */
interface HeadingStyle {
  readonly id: string;
  readonly theme: string;
}

/**
 * The style a heading at each depth Word numbers is written in (measured in Word for the final review
 * of Word 1, I2). Word takes a style named "heading N" as its own Heading N, with outline level N
 * whatever the style or the paragraph states - a paragraph's own `w:outlineLvl` is ignored there - so
 * a heading is written in the style Word names for its depth, or its outline level is another's: the
 * heading role's style where the projection names it Heading N at its depth, and otherwise one of the
 * writer's own named Word's way and based on it - at the seventh to ninth depths, which no role has,
 * and at a depth whose role shares a shallower role's style.
 */
function headingStyles(theme: ResolvedTheme): Map<number, HeadingStyle> {
  const depths = headingDepths(theme);
  const styles = new Map<number, HeadingStyle>();
  for (let depth = 1; depth <= WORD_LEVELS; depth += 1) {
    const role = theme.roles[HEADINGS[Math.min(depth, HEADINGS.length) - 1]!];
    styles.set(depth, {
      id: depths.get(role) === depth ? role : `Heading${depth}`,
      theme: role,
    });
  }
  return styles;
}

/** The style each heading depth's list level is linked from: every depth's heading style. */
function headingLinks(theme: ResolvedTheme): Map<number, string> {
  return new Map([...headingStyles(theme)].map(([depth, style]) => [depth, style.id]));
}

/**
 * The writer's own heading styles: each named as Word names its built-in heading at that depth, based
 * on the role's style, and adding only its place on the body's list - which the list links back to,
 * so that a heading a recipient sets in it is numbered at its depth too - and the outline level its
 * name gives it.
 */
function ownHeadingStyles(theme: ResolvedTheme): string[] {
  return [...headingStyles(theme)]
    .filter(([, style]) => style.id !== style.theme)
    .map(
      ([depth, style]) =>
        `<w:style w:type="paragraph" w:styleId="${style.id}">` +
        `<w:name w:val="heading ${depth}"/><w:basedOn w:val="${style.theme}"/><w:qFormat/>` +
        `<w:pPr><w:numPr><w:ilvl w:val="${depth - 1}"/>` +
        `<w:numId w:val="${HEADING_LISTS.body}"/></w:numPr>` +
        `<w:outlineLvl w:val="${depth - 1}"/></w:pPr></w:style>`,
    );
}

/** The style Word sets a rebuilt list of figures' entries in, by its identifier. */
const LIST_ENTRY_STYLE = 'TableofFigures';

/**
 * The entries of a list after the contents in the style Word names `table of figures`, which it sets a
 * rebuilt list's entries in (M9) - a list of tables' too: the list entry role's style, which it is
 * based on and adds nothing to.
 */
function listEntryStyle(theme: ResolvedTheme): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${LIST_ENTRY_STYLE}">` +
    `<w:name w:val="table of figures"/><w:basedOn w:val="${theme.roles.listEntry}"/>` +
    '<w:uiPriority w:val="99"/><w:unhideWhenUsed/></w:style>'
  );
}

/**
 * **The footnote reference style** (Word 3, ruling R2; M5): Word's own, by its name and identifier,
 * superscript as template 13 sets a footnote's mark in the text and its number in the note, the rest
 * the text's where the mark stands. Measured in Word 16 against the PDF of one document: in 11pt text
 * Word's mark is 6.96pt raised 4.56 where the engine's is 7.15 raised 4.98, and in a 9.35pt note its
 * number 6.00 raised 3.48 against 6.08 and 4.24, each standing where the engine's does to 0.03pt.
 */
const FOOTNOTE_REFERENCE_STYLE =
  `<w:style w:type="character" w:styleId="${FOOTNOTE_REFERENCE}">` +
  '<w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>' +
  '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';

/**
 * **The footnotes part** (Word 3, ruling R2; M5): the separator and the continuation separator Word
 * requires, `-1` and `0`, which the settings name, each a paragraph of the footnote place's style with
 * no space about it, as Word writes its own; then each note, by its identifier, in the order the text
 * met its mark.
 */
function footnotesXml(
  notes: readonly { readonly id: number; readonly paragraphs: readonly Paragraph[] }[],
  place: string,
): string {
  const separator = (type: string, id: number, element: string) =>
    `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:pStyle w:val="${place}"/>` +
    `<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:${element}/></w:r></w:p></w:footnote>`;
  return (
    `${DECLARATION}<w:footnotes ${DOCUMENT_NAMESPACES}>` +
    separator('separator', -1, 'separator') +
    separator('continuationSeparator', 0, 'continuationSeparator') +
    notes
      .map(
        (note) =>
          `<w:footnote w:id="${note.id}">` +
          note.paragraphs.map((paragraph) => paragraphXml(paragraph)).join('') +
          '</w:footnote>',
      )
      .join('') +
    '</w:footnotes>'
  );
}

/**
 * The contents' entries at each level Word names them, `toc 1` to `toc 9`, which Word sets its rebuilt
 * entries in: each the contents entry's style, which it is based on and adds nothing to.
 */
function contentsStyles(theme: ResolvedTheme, depth: number): string[] {
  const entry = theme.roles.contentsEntry;
  return Array.from(
    { length: Math.min(depth, WORD_LEVELS) },
    (_, index) =>
      `<w:style w:type="paragraph" w:styleId="TOC${index + 1}">` +
      `<w:name w:val="toc ${index + 1}"/><w:basedOn w:val="${entry}"/>` +
      '<w:uiPriority w:val="39"/><w:unhideWhenUsed/></w:style>',
  );
}

const fileKey = (weight: string, posture: string) => `${weight} ${posture}`;

/** Each file's place in a font's entry, in the order CT_Font requires. */
const EMBEDS = [
  ['regular normal', 'w:embedRegular'],
  ['bold normal', 'w:embedBold'],
  ['regular italic', 'w:embedItalic'],
  ['bold italic', 'w:embedBoldItalic'],
] as const;

/**
 * The font table and the faces embedded in it (R10; measured, M10). Each Word family is named once,
 * in the order the theme names its faces: Word knows a face by its family alone, so two typefaces of
 * one family are one face to it. A face the text is set in is embedded where it may be and names no
 * Word face of its own: each file the text needs - the file of each weight and posture any typeface of
 * the family is set at, or its regular where it has no file for one, from which Word makes it as it
 * would without - obfuscated under a key from the file's hash. A face with a Word face is named by it,
 * embeds nothing, and is reported once where the text is set in it (STY-052). `assemble` refuses a
 * face that may not be embedded and names none (`typeface_not_embeddable`), so meeting one throws.
 */
function fontParts(
  theme: ResolvedTheme,
  used: ReadonlyMap<string, ReadonlySet<string>>,
  faces: ReadonlyMap<string, Uint8Array>,
): {
  table: string;
  files: { id: string; name: string; bytes: Uint8Array }[];
  substituted: { family: string; wordFamily: string }[];
} {
  const families = new Map<string, Typeface[]>();
  for (const face of theme.typefaces.values()) {
    const family = wordFamily(face);
    families.set(family, [...(families.get(family) ?? []), face]);
  }
  const files: { id: string; name: string; bytes: Uint8Array }[] = [];
  const substituted = new Map<string, { family: string; wordFamily: string }>();
  const entries: string[] = [];
  for (const [family, members] of families) {
    // The file for each place in the entry, from whichever typeface of the family needs it first.
    const needed = new Map<string, Typeface['files'][number]>();
    for (const face of members) {
      const at = used.get(face.id);
      if (at === undefined) continue;
      if (face.wordFamily !== undefined) {
        if (face.wordFamily !== face.family) {
          substituted.set(`${face.family} ${face.wordFamily}`, {
            family: face.family,
            wordFamily: face.wordFamily,
          });
        }
        continue;
      }
      if (!face.embedding.word) {
        throw new Error(`${face.family} may not be embedded in Word, which assemble refuses`);
      }
      for (const key of at) {
        const file =
          face.files.find((each) => fileKey(each.weight, each.posture) === key) ??
          face.files.find((each) => each.weight === 'regular' && each.posture === 'normal') ??
          face.files[0]!;
        const place = fileKey(file.weight, file.posture);
        if (!needed.has(place)) needed.set(place, file);
      }
    }
    let embeds = '';
    for (const [place, element] of EMBEDS) {
      const file = needed.get(place);
      if (file === undefined) continue;
      const bytes = faces.get(file.sha256);
      if (bytes === undefined) throw new Error(`No bytes for the face file ${file.sha256}`);
      const id = `rId${files.length + 1}`;
      const obfuscatedBy = fontKey(file.sha256);
      files.push({
        id,
        name: `font${files.length + 1}.odttf`,
        bytes: obfuscateFont(bytes, obfuscatedBy),
      });
      embeds += `<${element} r:id="${id}" w:fontKey="${obfuscatedBy}"/>`;
    }
    const fixed = members[0]!.advance !== undefined;
    entries.push(
      `<w:font w:name="${escapeXml(family)}"><w:charset w:val="00"/><w:family w:val="auto"/>` +
        `<w:pitch w:val="${fixed ? 'fixed' : 'variable'}"/>${embeds}</w:font>`,
    );
  }
  return {
    table: `${DECLARATION}<w:fonts ${NAMESPACES}>${entries.join('')}</w:fonts>`,
    files,
    substituted: [...substituted.values()],
  };
}
