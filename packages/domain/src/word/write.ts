import { strToU8, zipSync, type Zippable } from 'fflate';

import { escapeXml } from '../content/ooxml/xml.js';
import type { WordInput } from '../publishing/assemble.js';
import type { PageFormat, PublishingFormat, SlotPart } from '../publishing/layout.js';
import { parseOutputReport, type OutputReport } from '../publishing/outputs.js';
import type {
  PublishedDocument,
  PublishedInline,
  PublishedLanguage,
  PublishedNode,
  PublishedTitleRun,
} from '../publishing/published.js';
import { sectionNumbers, type NumberingTable } from '../structure/numbering.js';
import type { OutlineMatter } from '../structure/outline.js';
import {
  headingDepths,
  hex,
  markStyleId,
  projectStylesXml,
  rFonts,
  size,
  toggle,
  wordFamily,
  wordLanguage,
} from '../theme/ooxml.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from '../theme/read.js';
import { runFormat, wordRun, type WordRun } from '../theme/runs.js';
import type { Role, StyledMark, Typeface } from '../theme/schema.js';

import { fontKey, obfuscateFont } from './fonts.js';
import { HEADING_LISTS, numberingXml, WORD_FORMATS, WORD_LEVELS } from './numbering.js';

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
 * This slice writes paragraphs, headings, marks, links and languages, and the page around them: the
 * cover, the notice, the contents and the running heads and feet. `assemble` refuses everything else
 * by name for Word (`word_not_yet`), so meeting anything else here is the caller's defect, and throws.
 */

/** What the job records as the output's producer version (R12). */
export const WORD_WRITER_VERSION = 'word/1';

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

// Written by code point, so that no escape in this file has to survive being typed.
const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const LINE_FEED = String.fromCharCode(10);

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

/** The heading roles, the first level's first: a node deeper than the sixth takes the sixth's. */
const HEADINGS = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
] as const satisfies readonly Role[];

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
  readonly content: string;
  readonly numbering?: string;
  readonly tabs?: string;
  readonly bidi?: boolean;
  readonly outlineLevel?: number;
  /** The first paragraph of a section writes no space before, which Word keeps there (M16). */
  firstOfSection?: boolean;
}

/** Which of a section's pages its header and footer parts are for. */
interface Furniture {
  readonly header: string;
  readonly footer: string;
}

interface Section {
  readonly paragraphs: Paragraph[];
  /** The cover's, set apart by `w:titlePg`; every other section's are its default. */
  readonly cover: boolean;
  readonly furniture: Furniture;
  /** `w:pgNumType`, or none: the cover carries no number (M16). */
  readonly pageNumbering: string | null;
}

export function writeDocx(input: WordWriting): WrittenDocx {
  const { document, word } = input;
  const theme = word.theme;
  const format = word.format;
  const writer = new Writer(document, theme);

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
  const contentsFurniture: Furniture =
    document.front.contents === null
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
      paragraphs: opening(),
      cover: true,
      furniture: coverFurniture,
      pageNumbering: null,
    });
  }
  const contents = document.front.contents;
  if (contents !== null) {
    sections.push({
      paragraphs: [
        ...opening(),
        writer.paragraph(theme.roles.contents, writer.runs(document.words.contents, writer.words)),
        ...writer.contents(document.nodes, contents.depth, sectionNumbers(input.numbering)),
      ],
      cover: false,
      furniture: contentsFurniture,
      pageNumbering: pageNumbering('front'),
    });
  }
  for (const segment of segmentsOf(document.nodes)) {
    const paragraphs = opening();
    segment.nodes.forEach((node, index) => {
      // Each later appendix starts a page where the layout says so (PUB-088), by a page break in a
      // paragraph of its own, after which Word drops the heading's space before as the PDF does (M16).
      if (index > 0 && segment.matter === 'appendix' && document.appendices.newPage) {
        paragraphs.push(writer.paragraph(theme.places.text, '<w:r><w:br w:type="page"/></w:r>'));
      }
      paragraphs.push(...writer.node(node));
    });
    sections.push({
      paragraphs,
      cover: false,
      furniture: runningFurniture,
      pageNumbering: pageNumbering(segment.matter),
    });
  }

  const relationships = new Relationships();
  relationships.add('styles', 'styles.xml');
  relationships.add('numbering', 'numbering.xml');
  relationships.add('settings', 'settings.xml');
  relationships.add('fontTable', 'fontTable.xml');
  const partIds = new Map(
    headerParts.parts.map((part) => [part.name, relationships.add(part.kind, part.name)]),
  );
  const body = sections
    .map((section, index) => {
      const properties = sectionProperties(section, format, partIds);
      const last = index === sections.length - 1;
      section.paragraphs[0]!.firstOfSection = true;
      return section.paragraphs
        .map((paragraph, at) =>
          paragraphXml(
            paragraph,
            !last && at === section.paragraphs.length - 1 ? properties : undefined,
          ),
        )
        .join('')
        .concat(last ? properties : '');
    })
    .join('');
  // The text's links, after the parts, each named in the order the text first meets its target.
  for (const [href, id] of writer.links) relationships.external(id, 'hyperlink', href);

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
    `${DECLARATION}<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`,
  );
  put('word/_rels/document.xml.rels', relationshipsXml(relationships.xml));
  put(
    'word/styles.xml',
    projectStylesXml(
      theme,
      { language: document.language, direction: document.direction },
      {
        headingList: HEADING_LISTS.body,
        extraStyles: contents === null ? [] : contentsStyles(theme, contents.depth),
      },
    ),
  );
  put('word/numbering.xml', numberingXml(word.scheme, headingLinks(theme)));
  put('word/settings.xml', settingsXml(document, theme, format));
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
  /** Each link's target, with its relationship's identifier, in the order the text meets them. */
  readonly links = new Map<string, string>();
  readonly document: Passage;
  readonly words: Passage;
  private readonly headingDepths: ReadonlyMap<string, number>;

  constructor(
    private readonly published: PublishedDocument,
    private readonly theme: ResolvedTheme,
  ) {
    this.document = {
      tag: wordLanguage(published.language),
      rtl: published.direction === 'rtl',
    };
    // The layout's words are set left to right in the layout's language, as the PDF's `words` sets
    // them, whatever the document's direction.
    this.words = { tag: wordLanguage(published.words.language), rtl: false };
    this.headingDepths = headingDepths(theme);
  }

  /** A paragraph in a style, by its identifier; the style's face is set, if only by its mark. */
  paragraph(
    styleId: string,
    content: string,
    stated: Omit<Paragraph, 'style' | 'content'> = {},
  ): Paragraph & { readonly xml: string } {
    const style = this.style(styleId);
    this.use(style.typeface, style.properties.bold, style.properties.italic);
    const paragraph = { style: styleId, content, ...stated };
    return { ...paragraph, xml: paragraphXml(paragraph) };
  }

  /** Plain words as one run, in the paragraph's style, where they are set. */
  runs(text: string, passage: Passage): string {
    return runXml(text, languageProperties(passage, null, this.document.tag));
  }

  /** A node's heading, its blocks and every node beneath it, each in its own language. */
  node(node: PublishedNode): Paragraph[] {
    const passage = this.passageOf(node);
    const depth = node.depth;
    const styleId = this.theme.roles[HEADINGS[Math.min(depth, HEADINGS.length) - 1]!];
    const linked = this.headingDepths.get(styleId);
    let numbering: string | undefined;
    if (node.number === null) {
      numbering = NO_NUMBER;
    } else if (node.matter !== 'body' || linked !== depth) {
      // Front matter and appendices number from lists of their own (M2), and a heading its style
      // does not number at its depth - deeper than six, or in a style two roles share - is numbered
      // where it stands. `assemble` refuses a number past the ninth level (`numbering_not_in_word`).
      if (depth > WORD_LEVELS) throw new Error(`A heading numbered at depth ${depth}`);
      numbering =
        `<w:numPr><w:ilvl w:val="${depth - 1}"/>` +
        `<w:numId w:val="${HEADING_LISTS[node.matter]}"/></w:numPr>`;
    }
    const heading = this.paragraph(styleId, this.titleRuns(node.title, styleId, passage), {
      ...(numbering === undefined ? {} : { numbering }),
      bidi: passage.rtl,
      // Its own outline level where its style's is not its depth, so the contents and the navigation
      // place it where the PDF's outline does; Word's deepest is the ninth.
      ...(linked === depth ? {} : { outlineLevel: Math.min(depth, WORD_LEVELS) - 1 }),
    });
    const blocks = node.blocks.map((block) => {
      if (block.type !== 'paragraph') {
        throw new Error(`Word 1 does not write a ${block.type}, which assemble refuses for Word`);
      }
      return this.paragraph(block.style, this.inlineRuns(block.runs, block.style, passage), {
        bidi: passage.rtl,
      });
    });
    return [heading, ...blocks, ...node.children.flatMap((child) => this.node(child))];
  }

  /**
   * The contents' entries, prefilled: each node to the layout's depth, its number and its title with a
   * tab between, in the contents entry style of its level, and no page, which only Word can know (M9).
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
        (number === undefined ? '' : runXml(number + TAB, '')) +
        this.titleRuns(node.title, entryStyle, passage) +
        (index === listed.length - 1 ? FIELD_END : '');
      const style = this.style(entryStyle);
      this.use(style.typeface, style.properties.bold, style.properties.italic);
      const paragraph: Paragraph = {
        style: `TOC${Math.min(node.depth, WORD_LEVELS)}`,
        content,
        bidi: passage.rtl,
      };
      return paragraph;
    });
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
        return withSection ? sectionFields(this.document.rtl ? '<w:rtl/>' : '') : '';
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
   * what the author wrote, marks and all.
   */
  private inlineRuns(runs: readonly PublishedInline[], styleId: string, passage: Passage): string {
    let xml = '';
    let linking: string | null = null;
    for (const run of runs) {
      if (!('text' in run)) {
        throw new Error('Word 1 writes runs of text alone, and assemble refuses the rest for Word');
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
      xml += this.textRun(run.text, kinds, styleId, passage, language);
    }
    if (linking !== null) xml += '</w:hyperlink>';
    return xml;
  }

  private textRun(
    text: string,
    marks: readonly StyledMark[],
    styleId: string,
    passage: Passage,
    language: PublishedLanguage | null,
  ): string {
    const style = this.style(styleId);
    const rendered = runFormat(this.theme, style, marks);
    this.use(rendered.typeface, rendered.bold, rendered.italic);
    return runXml(
      text,
      pinned(wordRun(this.theme, style, marks)) +
        languageProperties(
          passage,
          language === null ? null : wordLanguage(language),
          this.document.tag,
        ),
    );
  }

  /** A link's relationship, one per target however often it is linked. */
  private link(href: string): string {
    let id = this.links.get(href);
    if (id === undefined) {
      id = `rIdLink${this.links.size + 1}`;
      this.links.set(href, id);
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

  add(type: string, target: string): string {
    const id = `rId${this.xml.length + 1}`;
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

/** A paragraph as Word reads it, its properties in the order CT_PPr requires. */
function paragraphXml(paragraph: Paragraph, sectionProperties?: string): string {
  const properties =
    `<w:pStyle w:val="${paragraph.style}"/>` +
    (paragraph.numbering ?? '') +
    (paragraph.tabs ?? '') +
    (paragraph.bidi === true ? '<w:bidi/>' : '') +
    (paragraph.firstOfSection === true ? '<w:spacing w:before="0"/>' : '') +
    (paragraph.outlineLevel === undefined
      ? ''
      : `<w:outlineLvl w:val="${paragraph.outlineLevel}"/>`) +
    (sectionProperties ?? '');
  return `<w:p><w:pPr>${properties}</w:pPr>${paragraph.content}</w:p>`;
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
 * pairs where Word reads a complex script's apart (task 2's projection spells them the same way).
 */
function pinned(run: WordRun): string {
  const { pins } = run;
  return (
    (run.characterStyle === undefined
      ? ''
      : `<w:rStyle w:val="${markStyleId(run.characterStyle)}"/>`) +
    (pins.typeface === undefined ? '' : rFonts(pins.typeface)) +
    (pins.bold === undefined ? '' : toggle('b', pins.bold)) +
    (pins.italic === undefined ? '' : toggle('i', pins.italic)) +
    (pins.colour === undefined ? '' : `<w:color w:val="${hex(pins.colour)}"/>`) +
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
function fieldBegin(code: string, properties = ''): string {
  return (
    fieldChar('begin', properties) +
    instruction(` ${code} `, properties) +
    fieldChar('separate', properties)
  );
}

const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** A field's begin, separate or end mark, as a run of its own. */
function fieldChar(kind: 'begin' | 'separate' | 'end', properties: string): string {
  return `<w:r>${properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`}<w:fldChar w:fldCharType="${kind}"/></w:r>`;
}

/** Part of a field's instruction, as a run of its own, its spaces kept. */
function instruction(code: string, properties: string): string {
  return `<w:r>${properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`}<w:instrText xml:space="preserve">${escapeXml(code)}</w:instrText></w:r>`;
}

/**
 * A running head's section (measured in Word for the final review of Word 1, I1 and M1): the level-1
 * heading's number, a space and its title, as the PDF prints the heading. Word's number for a heading
 * with none - front matter's under a scheme that numbers none there, or one not numbered - is "0",
 * which the PDF does not print, so the number and its space stand inside an `IF` that prints nothing
 * for "0"; a section's number is never 0, so nothing else is lost. `properties` is every run's: in a
 * right-to-left document `w:rtl`, without which Word set the number after the title in reading order,
 * where the PDF sets it first.
 */
function sectionFields(properties: string): string {
  const number =
    fieldBegin(`STYLEREF "${LEVEL_ONE}" ${BACKSLASH}n`, properties) + fieldChar('end', properties);
  return (
    fieldChar('begin', properties) +
    instruction(' IF "', properties) +
    number +
    instruction('" = "0" "" "', properties) +
    number +
    instruction(' " ', properties) +
    fieldChar('separate', properties) +
    fieldChar('end', properties) +
    fieldBegin(`STYLEREF "${LEVEL_ONE}"`, properties) +
    fieldChar('end', properties)
  );
}

/** The text block's width in points: the page across, less both margins and the gutter. */
function textBlockWidth(format: PageFormat): number {
  const across = format.orientation === 'landscape' ? format.page.height : format.page.width;
  return across - format.margins.inside - format.margins.outside - format.gutter;
}

const twips = (points: number) => Math.round(points * 20);

/**
 * A section's properties (R8; measured, M8 and M16): its header and footer, a new page, the Word page
 * - its size turned where it is landscape, the inside margin on the left and the outside on the right,
 * which `w:mirrorMargins` alternates where they differ, the header and footer halfway into their
 * margins - its page numbering, and the cover's title page.
 */
function sectionProperties(
  section: Section,
  format: PageFormat,
  parts: ReadonlyMap<string, string>,
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
 * opens, compatibility mode 15 with spaces that add (M1), the maths face Word sets equations in (R10),
 * and the document's language.
 */
function settingsXml(
  document: PublishedDocument,
  theme: ResolvedTheme,
  format: PageFormat,
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

function relationshipsXml(relationships: readonly string[]): string {
  return (
    DECLARATION +
    `<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${relationships.join('')}</Relationships>`
  );
}

/**
 * The style each heading depth's list level is linked from: the heading role's at that depth, where
 * that style is numbered at that depth - a style two roles share is linked from the shallower alone.
 */
function headingLinks(theme: ResolvedTheme): Map<number, string> {
  const depths = headingDepths(theme);
  const links = new Map<number, string>();
  HEADINGS.forEach((role, index) => {
    const style = theme.roles[role];
    if (depths.get(style) === index + 1) links.set(index + 1, style);
  });
  return links;
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
