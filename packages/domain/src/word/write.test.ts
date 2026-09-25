import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { scanXml } from '../content/ooxml/xml.js';
import { assemble, type AssembleInput } from '../publishing/assemble.js';
import { defaultLayout, parseLayout, type Layout } from '../publishing/layout.js';
import type { PublishingFormat } from '../publishing/layout.js';
import type { PublishedDocument } from '../publishing/published.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import type { Typeface } from '../theme/schema.js';
import { defaultInputs, resolved, type ThemeInputs } from '../theme/theme.fixture.js';

import { fontKey, obfuscateFont } from './fonts.js';
import { writeDocx, WORD_WRITER_VERSION } from './write.js';

// ---------------------------------------------------------------------------------------------------
// Reading a package back: its parts, and each XML part as a tree of elements.
// ---------------------------------------------------------------------------------------------------

interface Element {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: (Element | string)[];
}

/** An XML part as a tree, from the scanner the ooxml reader already uses. */
function tree(xml: string): Element {
  const root: Element = { name: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  for (const event of scanXml(xml)) {
    const top = stack[stack.length - 1]!;
    if (event.kind === 'text') {
      top.children.push(event.value);
    } else if (event.kind === 'close') {
      stack.pop();
    } else {
      const element: Element = { name: event.name, attrs: event.attrs, children: [] };
      top.children.push(element);
      if (event.kind === 'open') stack.push(element);
    }
  }
  const [only] = root.children.filter((child): child is Element => typeof child !== 'string');
  if (only === undefined) throw new Error('no root element');
  return only;
}

/** Every element beneath this one with this name, in document order. */
function all(element: Element, name: string): Element[] {
  const found: Element[] = [];
  for (const child of element.children) {
    if (typeof child === 'string') continue;
    if (child.name === name) found.push(child);
    found.push(...all(child, name));
  }
  return found;
}

const first = (element: Element, name: string): Element | undefined => all(element, name)[0];

/** This element's element children, of one name or all. */
const kids = (element: Element, name?: string): Element[] =>
  element.children.filter(
    (child): child is Element =>
      typeof child !== 'string' && (name === undefined || child.name === name),
  );

/** The text a run sequence prints: every `w:t`, and a tab for a `w:tab`, in order. */
function textOf(element: Element): string {
  let text = '';
  for (const child of element.children) {
    if (typeof child === 'string') continue;
    if (child.name === 'w:t') text += child.children.join('');
    else if (child.name === 'w:tab' && element.name === 'w:r') text += '\t';
    else if (child.name !== 'w:instrText') text += textOf(child);
  }
  return text;
}

/** A field's instructions in a paragraph or a part, trimmed, in order. */
const fieldCodes = (element: Element): string[] =>
  all(element, 'w:instrText').map((each) => each.children.join('').trim());

const styleOf = (paragraph: Element) => first(paragraph, 'w:pStyle')?.attrs['w:val'];

/** A paragraph's own properties, not a run's. */
const pPr = (paragraph: Element) => kids(paragraph, 'w:pPr')[0];

/** The names of a paragraph's own properties, in order. */
const properties = (paragraph: Element): string[] =>
  kids(pPr(paragraph) ?? { name: '', attrs: {}, children: [] }).map((each) => each.name);

interface Package {
  readonly files: Readonly<Record<string, Uint8Array>>;
  xml(name: string): Element;
}

function read(bytes: Uint8Array): Package {
  const files = unzipSync(bytes);
  return {
    files,
    xml(name) {
      const file = files[name];
      if (file === undefined) throw new Error(`no part ${name}`);
      return tree(strFromU8(file));
    },
  };
}

/** The body's paragraphs, in order. */
const paragraphs = (docx: Package) => kids(first(docx.xml('word/document.xml'), 'w:body')!, 'w:p');

/** The first body paragraph printing exactly this. */
const paragraphSaying = (docx: Package, text: string): Element => {
  const found = paragraphs(docx).find((each) => textOf(each) === text);
  if (found === undefined) throw new Error(`no paragraph says ${JSON.stringify(text)}`);
  return found;
};

/** A document's sections, each its paragraphs and the `w:sectPr` that ends it. */
function sections(docx: Package): { paragraphs: Element[]; properties: Element }[] {
  const body = first(docx.xml('word/document.xml'), 'w:body')!;
  const found: { paragraphs: Element[]; properties: Element }[] = [];
  let current: Element[] = [];
  for (const child of kids(body)) {
    if (child.name === 'w:p') {
      current.push(child);
      const ends = kids(pPr(child) ?? child, 'w:sectPr')[0];
      if (ends !== undefined) {
        found.push({ paragraphs: current, properties: ends });
        current = [];
      }
    } else if (child.name === 'w:sectPr') {
      found.push({ paragraphs: current, properties: child });
    }
  }
  return found;
}

/** A relationship part's relationships, by identifier. */
const relationships = (docx: Package, name: string) =>
  new Map(
    all(docx.xml(name), 'Relationship').map((each) => [each.attrs['Id']!, each.attrs] as const),
  );

// ---------------------------------------------------------------------------------------------------
// The document: every kind of thing Word 1 writes, assembled as the job assembles it.
// ---------------------------------------------------------------------------------------------------

const id = (name: string) => name.padEnd(26, 'a');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
const component = (title: string, content: unknown[], over: object = {}): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content,
    ...over,
  });
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
const section = (name: string, title: string, children: unknown[] = [], over: object = {}) => ({
  type: 'section',
  id: id(name),
  title: [{ type: 'text', value: title, marks: [] }],
  ...positional,
  children,
  ...over,
});
const reference = (name: string, n: number, over: object = {}) => ({
  type: 'reference',
  id: id(name),
  component: uuid(n),
  mode: { kind: 'latest' },
  ...positional,
  children: [],
  ...over,
});

const REPORT = 'https://example.test/report?from=ada&to=grace';
const link = { type: 'hyperlink', id: 'k1', href: REPORT };
const U = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
/** Invented Hebrew words: "shalom", "sefer" (book). */
const SHALOM = U(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const SEFER = U(0x05e1, 0x05e4, 0x05e8);

const PREFACE = component('Preface by Ada', [paragraph('p1', text('Ada wrote this first.'))]);
const MARKED = component('Readings', [
  paragraph(
    'm1',
    text('Ada asks you to '),
    text('see the report', link),
    text(' now', link, { type: 'emphasis', id: 'k2' }),
    text(' and to check.'),
  ),
  paragraph(
    'm2',
    text('Set '),
    text('strong', { type: 'strong', id: 'k3' }),
    text(', '),
    text('both', { type: 'emphasis', id: 'k4' }, { type: 'strong', id: 'k5' }),
    text(', '),
    text('under', { type: 'underline', id: 'k6' }),
    text(', H'),
    text('2', { type: 'subscript', id: 'k7' }),
    text('O, x'),
    text('2', { type: 'superscript', id: 'k8' }),
    text(', '),
    text('printer.cfg', { type: 'inlineCode', id: 'k9' }),
    text(', '),
    text('"measure twice"', { type: 'quotedPhrase', id: 'k10' }),
    text(' and '),
    text('la mesure', { type: 'language', id: 'k11', tag: 'fr-FR' }),
    text('.'),
  ),
  paragraph('m3', text('Grace checked the readings.')),
]);
const GERMAN = component('Grüße', [paragraph('g1', text('Grüße aus Berlin.'))], {
  language: 'de-DE',
});
const HEBREW = component(SEFER, [paragraph('h1', text(`${SHALOM} Ada ${SEFER}.`))], {
  language: 'he-IL',
  direction: 'rtl',
});
const VALUES = component('Values', [paragraph('v1', text('The values Grace measured.'))]);

/** Six sections, each beneath the last, to seven levels in all under Method. */
const deep = ['deepb', 'deepc', 'deepd', 'deepe', 'deepf', 'deepg'].reduceRight<unknown[]>(
  (inner, name, index) => [section(name, `Level ${index + 2}`, inner)],
  [],
);

const OUTLINE = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    reference('preface', 1, { matter: 'front' }),
    section('intro', 'Introduction', [reference('marked', 2), reference('german', 3)]),
    section('method', 'Method', [reference('hebrew', 4), ...deep]),
    section('notes', 'Notes', [], { numbered: false }),
    section('tables', 'Tables of values', [reference('values', 5)], { matter: 'appendix' }),
    section('glossary', 'Glossary', [], { matter: 'appendix' }),
  ],
});

const OCCURRENCES = new Map([
  [id('preface'), PREFACE],
  [id('marked'), MARKED],
  [id('german'), GERMAN],
  [id('hebrew'), HEBREW],
  [id('values'), VALUES],
]);

const DEFAULT_THEME = resolved();

/** Every file the theme names, by its hash: invented bytes, each file its own, for the writer to embed. */
function facesOf(theme: ResolvedTheme): Map<string, Uint8Array> {
  const faces = new Map<string, Uint8Array>();
  let seed = 1;
  for (const face of theme.typefaces.values()) {
    for (const file of face.files) {
      const at = seed++;
      faces.set(
        file.sha256,
        Uint8Array.from({ length: 96 }, (_, index) => (index * 31 + at * 17) % 256),
      );
    }
  }
  return faces;
}

interface Written {
  readonly docx: Package;
  readonly bytes: Uint8Array;
  readonly report: ReturnType<typeof writeDocx>['report'];
  readonly document: PublishedDocument;
  readonly theme: ResolvedTheme;
  readonly faces: Map<string, Uint8Array>;
}

/** Assemble for Word as the job does, then write it. */
function written(
  over: Partial<AssembleInput> & { readonly layout?: Layout } = {},
  formats: readonly [PublishingFormat, ...PublishingFormat[]] = ['docx'],
): Written {
  const theme = (over.theme ?? DEFAULT_THEME) as ResolvedTheme;
  const assembled = assemble({
    formats,
    outline: OUTLINE,
    occurrences: OCCURRENCES,
    refused: [],
    layout: defaultLayout,
    theme,
    revision: '0.7',
    covers: () => true,
    assets: new Map(),
    ...over,
  } as AssembleInput & { readonly layout: Layout });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  if (assembled.word === null) throw new Error('assembled for no Word');
  const faces = facesOf(theme);
  const { bytes, report } = writeDocx({
    document: assembled.document,
    numbering: assembled.numbering,
    word: assembled.word,
    formats,
    faces,
  });
  return { docx: read(bytes), bytes, report, document: assembled.document, theme, faces };
}

/** The default layout, changed by `change` and held to the layout's own parse. */
const layoutWith = (change: (layout: Layout) => void): Layout => {
  const layout = structuredClone(defaultLayout);
  change(layout);
  return parseLayout(layout);
};

/** The default theme's inputs changed by `change`, read as the store reads them. */
const themeWith = (change: (inputs: ThemeInputs) => void): ResolvedTheme => {
  const inputs = defaultInputs();
  change(inputs);
  return resolved(inputs);
};

const plain = written();

// ---------------------------------------------------------------------------------------------------

describe('writeDocx: the package (Word 1, ruling R6)', () => {
  it('writes every part, each typed and related, and nothing else', () => {
    const names = Object.keys(plain.docx.files);
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'word/settings.xml',
      'word/fontTable.xml',
      'word/_rels/fontTable.xml.rels',
      ...names.filter((name) => name.startsWith('word/fonts/')),
      'word/header1.xml',
      'word/footer1.xml',
      'word/header2.xml',
      'word/footer2.xml',
      'word/header3.xml',
    ]);
    const types = plain.docx.xml('[Content_Types].xml');
    const overrides = new Map(
      all(types, 'Override').map((each) => [each.attrs['PartName'], each.attrs['ContentType']]),
    );
    const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
    expect(Object.fromEntries(overrides)).toEqual({
      '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
      '/word/document.xml': `${WML}document.main+xml`,
      '/word/styles.xml': `${WML}styles+xml`,
      '/word/numbering.xml': `${WML}numbering+xml`,
      '/word/settings.xml': `${WML}settings+xml`,
      '/word/fontTable.xml': `${WML}fontTable+xml`,
      '/word/header1.xml': `${WML}header+xml`,
      '/word/footer1.xml': `${WML}footer+xml`,
      '/word/header2.xml': `${WML}header+xml`,
      '/word/footer2.xml': `${WML}footer+xml`,
      '/word/header3.xml': `${WML}header+xml`,
    });
    const defaults = new Map(
      all(types, 'Default').map((each) => [each.attrs['Extension'], each.attrs['ContentType']]),
    );
    expect(defaults.get('odttf')).toBe(
      'application/vnd.openxmlformats-officedocument.obfuscatedFont',
    );

    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const pkg = [...relationships(plain.docx, '_rels/.rels').values()];
    expect(pkg.map((each) => [each['Type'], each['Target']])).toEqual([
      [`${REL}officeDocument`, 'word/document.xml'],
      [
        'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        'docProps/core.xml',
      ],
    ]);
    const document = [...relationships(plain.docx, 'word/_rels/document.xml.rels').values()];
    // Every part the document names is in the package, and every part is named.
    for (const each of document.filter((rel) => rel['TargetMode'] !== 'External')) {
      expect(names).toContain(`word/${each['Target']}`);
    }
    expect(document.map((each) => each['Type']!.slice(REL.length)).sort()).toEqual(
      [
        'styles',
        'numbering',
        'settings',
        'fontTable',
        'header',
        'header',
        'header',
        'footer',
        'footer',
        'hyperlink',
      ].sort(),
    );
    const fonts = [...relationships(plain.docx, 'word/_rels/fontTable.xml.rels').values()];
    expect(fonts.map((each) => `word/${each['Target']}`)).toEqual(
      names.filter((name) => name.startsWith('word/fonts/')),
    );
  });

  it('carries the title and the language in the core properties, and no date', () => {
    const core = plain.docx.xml('docProps/core.xml');
    expect(first(core, 'dc:title')!.children.join('')).toBe('The dosing report');
    expect(first(core, 'dc:language')!.children.join('')).toBe('en-GB');
    expect(all(core, 'dcterms:created')).toEqual([]);
  });

  it('makes the same bytes from the same inputs, whenever it is run', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T09:00:00Z'));
      const once = written().bytes;
      vi.setSystemTime(new Date('2031-07-15T17:31:07Z'));
      const again = written().bytes;
      expect(again).toEqual(once);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is the Word writer at word/1', () => {
    expect(WORD_WRITER_VERSION).toBe('word/1');
  });
});

describe('writeDocx: settings (ruling R6)', () => {
  const settings = plain.docx.xml('word/settings.xml');

  it('adds spaces as the theme does, asks Word to update its fields, embeds its faces and names the language', () => {
    expect(kids(settings).map((each) => each.name)).toEqual([
      'w:embedTrueTypeFonts',
      'w:updateFields',
      'w:compat',
      'm:mathPr',
      'w:themeFontLang',
    ]);
    // M1: without the flag Word sets the larger of two facing spaces, not their sum (STY-050).
    expect(kids(first(settings, 'w:compat')!).map((each) => each.name)).toEqual([
      'w:doNotUseHTMLParagraphAutoSpacing',
      'w:compatSetting',
    ]);
    expect(first(settings, 'w:compatSetting')!.attrs).toMatchObject({
      'w:name': 'compatibilityMode',
      'w:val': '15',
    });
    expect(first(settings, 'w:updateFields')!.attrs['w:val']).toBe('true');
    expect(first(settings, 'w:themeFontLang')!.attrs).toEqual({ 'w:val': 'en-GB' });
  });

  it("names the maths face's Word face, Cambria Math under the default theme", () => {
    expect(first(settings, 'm:mathFont')!.attrs['m:val']).toBe('Cambria Math');
  });

  it('turns hyphenation on only where a style hyphenates, and mirrors the margins only where they differ', () => {
    expect(all(settings, 'w:autoHyphenation')).toEqual([]);
    expect(all(settings, 'w:mirrorMargins')).toEqual([]);
    const hyphenating = written({
      theme: themeWith((inputs) => {
        inputs.catalogues.paragraph.base.hyphenate = true;
      }),
      layout: layoutWith((layout) => {
        layout.formats.docx!.margins.inside = 90;
      }),
    }).docx.xml('word/settings.xml');
    expect(kids(hyphenating).map((each) => each.name)).toEqual([
      'w:embedTrueTypeFonts',
      'w:mirrorMargins',
      'w:autoHyphenation',
      'w:updateFields',
      'w:compat',
      'm:mathPr',
      'w:themeFontLang',
    ]);
  });
});

describe('writeDocx: styles and heading numbers (ruling R7)', () => {
  const styles = plain.docx.xml('word/styles.xml');
  const style = (styleId: string) => {
    const found = all(styles, 'w:style').find((each) => each.attrs['w:styleId'] === styleId);
    if (found === undefined) throw new Error(`no style ${styleId}`);
    return found;
  };
  const numPr = (element: Element) => {
    const found = first(element, 'w:numPr');
    return found === undefined
      ? undefined
      : {
          ilvl: first(found, 'w:ilvl')?.attrs['w:val'],
          numId: first(found, 'w:numId')?.attrs['w:val'],
        };
  };

  it("projects the theme's styles, the heading styles linked to the body's list and every other style to none", () => {
    expect(numPr(style('heading-1'))).toEqual({ ilvl: '0', numId: '1' });
    expect(numPr(style('heading-6'))).toEqual({ ilvl: '5', numId: '1' });
    // The title and the contents' heading are based on Heading 1, and would inherit its number.
    expect(numPr(style('title'))).toEqual({ ilvl: '0', numId: '0' });
    expect(numPr(style('contents-heading'))).toEqual({ ilvl: '0', numId: '0' });
    expect(numPr(style('body'))).toEqual({ ilvl: '0', numId: '0' });
  });

  it("names the contents' entries Word's way, each level based on the contents entry's style", () => {
    for (const level of [1, 2, 3]) {
      const entry = style(`TOC${level}`);
      expect(first(entry, 'w:name')!.attrs['w:val']).toBe(`toc ${level}`);
      expect(first(entry, 'w:basedOn')!.attrs['w:val']).toBe('contents-entry');
    }
    expect(all(styles, 'w:style').some((each) => each.attrs['w:styleId'] === 'TOC4')).toBe(false);
  });

  it('PUB-024 numbers every heading by a numbering definition Word computes, never by literal text in the heading', () => {
    const numbering = plain.docx.xml('word/numbering.xml');
    expect(all(numbering, 'w:abstractNum')).toHaveLength(3);
    // Each heading's text is its title alone: its number is the list's.
    const heading = (title: string) => {
      const found = paragraphs(plain.docx).find(
        (each) => styleOf(each)?.startsWith('heading-') === true && textOf(each) === title,
      );
      if (found === undefined) throw new Error(`no heading ${title}`);
      return found;
    };
    expect(styleOf(heading('Introduction'))).toBe('heading-1');
    expect(styleOf(heading('Readings'))).toBe('heading-2');
    // In the body, the style's own link numbers it: no number is written on the paragraph.
    expect(numPr(pPr(heading('Introduction'))!)).toBeUndefined();
    expect(numPr(pPr(heading('Readings'))!)).toBeUndefined();
    // Front matter and appendices number from lists of their own, given directly (M2).
    expect(numPr(pPr(heading('Preface by Ada'))!)).toEqual({ ilvl: '0', numId: '2' });
    expect(numPr(pPr(heading('Tables of values'))!)).toEqual({ ilvl: '0', numId: '3' });
    expect(numPr(pPr(heading('Values'))!)).toEqual({ ilvl: '1', numId: '3' });
    // An unnumbered heading is taken off the list, and consumes nothing of it.
    expect(numPr(pPr(heading('Notes'))!)).toEqual({ ilvl: '0', numId: '0' });
    // Past the sixth level, Heading 6's style, numbered at its own level and at its own outline level.
    const seventh = heading('Level 7');
    expect(styleOf(seventh)).toBe('heading-6');
    expect(numPr(pPr(seventh)!)).toEqual({ ilvl: '6', numId: '1' });
    expect(first(pPr(seventh)!, 'w:outlineLvl')!.attrs['w:val']).toBe('6');
    expect(numPr(pPr(heading('Level 6'))!)).toBeUndefined();
    // No number printed as text anywhere a heading stands.
    for (const each of paragraphs(plain.docx).filter((p) => styleOf(p)?.startsWith('heading-'))) {
      expect(textOf(each)).not.toMatch(/^([0-9ivxA-Z]+(\.[0-9]+)*)\s/);
    }
  });
});

describe('writeDocx: the page (ruling R8)', () => {
  const [cover, contents, front, body, appendix, ...rest] = sections(plain.docx);

  it('makes the cover a section of its own, then the contents, and each matter a section starting a page', () => {
    expect(rest).toEqual([]);
    expect(cover!.paragraphs.map(textOf)).toEqual([
      'The dosing report',
      'Not approved. This is a draft publication, not made from an approved baseline.',
    ]);
    expect(cover!.paragraphs.map(styleOf)).toEqual(['title', 'notice-sentence']);
    expect(textOf(contents!.paragraphs[0]!)).toBe('Contents');
    expect(textOf(front!.paragraphs[0]!)).toBe('Preface by Ada');
    expect(textOf(body!.paragraphs[0]!)).toBe('Introduction');
    expect(textOf(appendix!.paragraphs[0]!)).toBe('Tables of values');
    for (const each of [contents, front, body, appendix]) {
      expect(first(each!.properties, 'w:type')!.attrs['w:val']).toBe('nextPage');
    }
  });

  it("numbers each matter's pages from the layout's Word page: the cover none, front matter from i, the body from 1, the appendices on", () => {
    const numbering = (each: { properties: Element } | undefined) =>
      first(each!.properties, 'w:pgNumType')?.attrs;
    expect(numbering(cover)).toBeUndefined();
    expect(kids(cover!.properties).some((each) => each.name === 'w:titlePg')).toBe(true);
    expect(numbering(contents)).toEqual({ 'w:fmt': 'lowerRoman', 'w:start': '1' });
    // The front matter's own pages carry on from the contents', as one chain in the PDF.
    expect(numbering(front)).toEqual({ 'w:fmt': 'lowerRoman' });
    expect(numbering(body)).toEqual({ 'w:fmt': 'decimal', 'w:start': '1' });
    expect(numbering(appendix)).toEqual({ 'w:fmt': 'decimal' });
  });

  it("sets the Word page, not the PDF's: its size, orientation, margins and gutter, the header and footer halfway into their margins", () => {
    const [first_] = sections(plain.docx);
    expect(first(first_!.properties, 'w:pgSz')!.attrs).toEqual({ 'w:w': '11906', 'w:h': '16838' });
    const letter = written({
      layout: layoutWith((layout) => {
        const docx = layout.formats.docx!;
        docx.page = { width: 612, height: 792 };
        docx.orientation = 'landscape';
        docx.margins = { top: 54, bottom: 36, inside: 90, outside: 72 };
        docx.gutter = 18;
      }),
    });
    const properties = sections(letter.docx)[1]!.properties;
    expect(first(properties, 'w:pgSz')!.attrs).toEqual({
      'w:w': '15840',
      'w:h': '12240',
      'w:orient': 'landscape',
    });
    expect(first(properties, 'w:pgMar')!.attrs).toEqual({
      'w:top': '1080',
      'w:right': '1440',
      'w:bottom': '720',
      'w:left': '1800',
      'w:header': '540',
      'w:footer': '360',
      'w:gutter': '360',
    });
  });

  it('writes no space before the first paragraph of a section, which Word would keep at the top of the page (M16)', () => {
    for (const each of sections(plain.docx)) {
      const spacing = kids(pPr(each.paragraphs[0]!)!, 'w:spacing')[0];
      expect(spacing?.attrs).toEqual({ 'w:before': '0' });
    }
    expect(kids(pPr(paragraphSaying(plain.docx, 'Readings'))!, 'w:spacing')).toEqual([]);
  });

  it('starts each later appendix on a page of its own where the layout says so, by a page break', () => {
    const appendix = sections(plain.docx)[4]!.paragraphs;
    const glossary = appendix.findIndex((each) => textOf(each) === 'Glossary');
    const before = appendix[glossary - 1]!;
    expect(all(before, 'w:br').map((each) => each.attrs['w:type'])).toEqual(['page']);
    expect(textOf(before)).toBe('');
    const together = written({
      layout: layoutWith((layout) => {
        layout.matter.appendices.newPage = false;
      }),
    });
    expect(all(first(together.docx.xml('word/document.xml'), 'w:body')!, 'w:br')).toEqual([]);
  });

  it('opens the first section with the title and the notice sentence where the layout sets no cover', () => {
    const bare = written({
      layout: layoutWith((layout) => {
        layout.matter.cover = false;
      }),
    });
    const [opening] = sections(bare.docx);
    expect(opening!.paragraphs.slice(0, 3).map(textOf)).toEqual([
      'The dosing report',
      'Not approved. This is a draft publication, not made from an approved baseline.',
      'Contents',
    ]);
    expect(first(opening!.properties, 'w:titlePg')).toBeUndefined();
    expect(first(opening!.properties, 'w:pgNumType')!.attrs).toEqual({
      'w:fmt': 'lowerRoman',
      'w:start': '1',
    });
  });
});

describe('writeDocx: headers and footers (ruling R8)', () => {
  const [cover, contents, front, body] = sections(plain.docx);
  const rels = relationships(plain.docx, 'word/_rels/document.xml.rels');
  /** The header or footer part a section names, by kind and type, read. */
  const part = (section: { properties: Element }, kind: 'header' | 'footer', type: string) => {
    const reference = kids(section.properties, `w:${kind}Reference`).find(
      (each) => each.attrs['w:type'] === type,
    );
    if (reference === undefined) throw new Error(`no ${type} ${kind}`);
    return plain.docx.xml(`word/${rels.get(reference.attrs['r:id']!)!['Target']}`);
  };
  const TAB = String.fromCharCode(9);

  it("sets the notice alone in the cover's header, first page and after, and nothing in its footer", () => {
    for (const type of ['first', 'default']) {
      const header = part(cover!, 'header', type);
      expect(kids(header, 'w:p').map(textOf)).toEqual(['Not approved']);
      expect(kids(header, 'w:p').map(styleOf)).toEqual(['notice']);
      expect(kids(part(cover!, 'footer', type), 'w:p').map(textOf)).toEqual(['']);
    }
  });

  it("heads every other page with the notice and the running head, the section a field by the level-1 heading style's name", () => {
    const header = part(body!, 'header', 'default');
    const [notice, running] = kids(header, 'w:p');
    expect(textOf(notice!)).toBe('Not approved');
    expect(styleOf(notice!)).toBe('notice');
    expect(styleOf(running!)).toBe('running');
    // The title as text, then the centre and the end slots after their tabs.
    expect(textOf(running!)).toBe(`The dosing report${TAB}${TAB} `);
    const BS = String.fromCharCode(92);
    expect(fieldCodes(running!)).toEqual([`STYLEREF "Heading 1" ${BS}n`, 'STYLEREF "Heading 1"']);
    // A centre and a right tab stop at the text block's centre and its end: A4 less two inches.
    expect(all(running!, 'w:tab').filter((each) => each.attrs['w:pos'] !== undefined)).toEqual([
      { name: 'w:tab', attrs: { 'w:val': 'center', 'w:pos': '4513' }, children: [] },
      { name: 'w:tab', attrs: { 'w:val': 'right', 'w:pos': '9026' }, children: [] },
    ]);
    expect(part(front!, 'header', 'default')).toEqual(header);
  });

  it('leaves the section out of the running head where the contents stands, before any heading it could name', () => {
    const header = part(contents!, 'header', 'default');
    const [, running] = kids(header, 'w:p');
    expect(fieldCodes(running!)).toEqual([]);
    expect(textOf(running!)).toBe(`The dosing report${TAB}${TAB}`);
  });

  it("feet every page with the layout's words and fields: the revision as text, the page and the pages as Word's", () => {
    const foot = part(body!, 'footer', 'default');
    const [running] = kids(foot, 'w:p');
    expect(textOf(running!)).toBe(`Revision 0.7${TAB}${TAB}Page `);
    expect(fieldCodes(running!)).toEqual(['PAGE']);
    const counted = written({
      layout: layoutWith((layout) => {
        layout.formats.docx!.foot[1] = [
          { kind: 'field', field: 'page' },
          { kind: 'words', text: ' of ' },
          { kind: 'field', field: 'pages' },
        ];
      }),
    });
    const footer = counted.docx.xml('word/footer2.xml');
    expect(fieldCodes(footer)).toEqual(['PAGE', 'NUMPAGES', 'PAGE']);
  });

  it("leaves the revision's direction to the text around it in a right-to-left document, as the page's number is left, so the foot reads as the PDF's does", () => {
    // Found by the Word check: the revision written right to left, as the document's own words are,
    // made Word set "Revision 0.7" as "0.7Revision", where the PDF's bidi, finding no strong letter
    // in "0.7", sets it after the words before it.
    const rtl = written({ outline: { ...OUTLINE, language: 'he-IL', direction: 'rtl' } });
    const [, , , body] = sections(rtl.docx);
    const reference = kids(body!.properties, 'w:footerReference').find(
      (each) => each.attrs['w:type'] === 'default',
    )!;
    const rels = relationships(rtl.docx, 'word/_rels/document.xml.rels');
    const foot = rtl.docx.xml(`word/${rels.get(reference.attrs['r:id']!)!['Target']}`);
    const [running] = kids(foot, 'w:p');
    expect(properties(running!)).toContain('w:bidi');
    const runs = all(running!, 'w:r');
    expect(
      first(
        runs.find((run) => textOf(run) === 'Revision ')!,
        'w:rPr',
      ),
    ).toEqual({
      name: 'w:rPr',
      attrs: {},
      children: [{ name: 'w:lang', attrs: { 'w:val': 'en' }, children: [] }],
    });
    expect(runs.find((run) => textOf(run) === '0.7')).toEqual({
      name: 'w:r',
      attrs: {},
      children: [{ name: 'w:t', attrs: { 'xml:space': 'preserve' }, children: ['0.7'] }],
    });
  });

  it('gives every paragraph it writes a style, in the body and in every header and footer', () => {
    const parts = Object.keys(plain.docx.files).filter((name) =>
      /^word\/(document|header\d+|footer\d+)\.xml$/.test(name),
    );
    for (const name of parts) {
      for (const each of all(plain.docx.xml(name), 'w:p')) {
        expect(styleOf(each), `${name}: ${textOf(each)}`).toBeDefined();
      }
    }
  });
});

describe('writeDocx: the contents (ruling R8)', () => {
  const [, contents] = sections(plain.docx);

  it("is a TOC field to the layout's depth, prefilled with each entry's number and title and no page", () => {
    const BS = String.fromCharCode(92);
    expect(fieldCodes(first(plain.docx.xml('word/document.xml'), 'w:body')!)).toContain(
      `TOC ${BS}o "1-3" ${BS}h ${BS}z ${BS}u`,
    );
    const TAB = String.fromCharCode(9);
    const entries = contents!.paragraphs.slice(1);
    expect(entries.map(textOf)).toEqual([
      `i${TAB}Preface by Ada`,
      `1${TAB}Introduction`,
      `1.1${TAB}Readings`,
      `1.2${TAB}Grüße`,
      `2${TAB}Method`,
      `2.1${TAB}${SEFER}`,
      `2.2${TAB}Level 2`,
      `2.2.1${TAB}Level 3`,
      'Notes',
      `A${TAB}Tables of values`,
      `A.1${TAB}Values`,
      `B${TAB}Glossary`,
    ]);
    expect(entries.map(styleOf)).toEqual([
      'TOC1',
      'TOC1',
      'TOC2',
      'TOC2',
      'TOC1',
      'TOC2',
      'TOC2',
      'TOC3',
      'TOC1',
      'TOC1',
      'TOC2',
      'TOC1',
    ]);
    // One field over them all: begun in the first entry and ended in the last.
    const kinds = (paragraph: Element) =>
      all(paragraph, 'w:fldChar').map((each) => each.attrs['w:fldCharType']);
    expect(kinds(entries[0]!)).toEqual(['begin', 'separate']);
    expect(entries.slice(1, -1).flatMap(kinds)).toEqual([]);
    expect(kinds(entries[entries.length - 1]!)).toEqual(['end']);
    expect(styleOf(contents!.paragraphs[0]!)).toBe('contents-heading');
  });
});

describe('writeDocx: text (ruling R9)', () => {
  const [linked, marked, checked] = [
    paragraphSaying(plain.docx, 'Ada asks you to see the report now and to check.'),
    paragraphSaying(
      plain.docx,
      'Set strong, both, under, H2O, x2, printer.cfg, "measure twice" and la mesure.',
    ),
    paragraphSaying(plain.docx, 'Grace checked the readings.'),
  ];
  /** Each run of a paragraph: its text and its properties, by name and value. */
  const runs = (element: Element) =>
    all(element, 'w:r').map((run) => ({
      text: textOf(run),
      rPr: Object.fromEntries(
        kids(kids(run, 'w:rPr')[0] ?? { name: '', attrs: {}, children: [] }).map((each) => [
          each.name,
          // A language by all it says; anything else by its value, or all it says where it has none.
          each.name === 'w:lang' ? each.attrs : (each.attrs['w:val'] ?? each.attrs),
        ]),
      ),
    }));
  const run = (element: Element, text: string) => {
    const found = runs(element).find((each) => each.text === text);
    if (found === undefined) throw new Error(`no run ${text}`);
    return found.rPr;
  };

  it("sets each paragraph in its resolved style, each mark by its character style and what Word's reading would lose pinned", () => {
    expect(styleOf(marked)).toBe('body');
    expect(run(marked, 'Set ')).toEqual({});
    expect(run(marked, 'strong')).toEqual({ 'w:rStyle': 'mark-strong' });
    // Word names one character style: the emphasis', and the weight is pinned, in pairs.
    expect(run(marked, 'both')).toEqual({
      'w:rStyle': 'mark-emphasis',
      'w:b': '1',
      'w:bCs': '1',
    });
    expect(run(marked, 'under')).toEqual({ 'w:rStyle': 'mark-underline' });
    expect(run(marked, '2')).toEqual({ 'w:rStyle': 'mark-subscript' });
    // Inline code at 0.8 of the text: a scale is a size, pinned on the run (8.8pt, 17.6 half-points).
    expect(run(marked, 'printer.cfg')).toEqual({
      'w:rStyle': 'mark-inlineCode',
      'w:sz': '18',
      'w:szCs': '18',
    });
  });

  it('adds no quotation marks to a quoted phrase: its text is what the author wrote', () => {
    expect(run(marked, '"measure twice"')).toEqual({});
    expect(textOf(marked)).toContain('"measure twice"');
    expect(textOf(marked)).not.toContain('“');
  });

  it('CNT-128 carries a hyperlink into Word as a live link, its target an external relationship, escaped', () => {
    const hyperlinks = all(linked, 'w:hyperlink');
    // Two runs of one link, one emphasised, are one link.
    expect(hyperlinks).toHaveLength(1);
    expect(textOf(hyperlinks[0]!)).toBe('see the report now');
    const target = relationships(plain.docx, 'word/_rels/document.xml.rels').get(
      hyperlinks[0]!.attrs['r:id']!,
    );
    expect(target).toMatchObject({
      Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      Target: REPORT,
      TargetMode: 'External',
    });
    const rels = strFromU8(plain.docx.files['word/_rels/document.xml.rels']!);
    expect(rels).toContain('from=ada&amp;to=grace');
    expect(run(linked, ' now')).toEqual({ 'w:rStyle': 'mark-emphasis' });
  });

  it("PUB-034 CNT-084 carries the document's language and each passage's that differs into Word: the defaults, a component's and a marked run's", () => {
    const styles = plain.docx.xml('word/styles.xml');
    expect(first(first(styles, 'w:docDefaults')!, 'w:lang')!.attrs).toEqual({ 'w:val': 'en-GB' });
    // A run in the document's language says nothing; a language mark says its own.
    expect(run(marked, 'Set ')['w:lang']).toBeUndefined();
    expect(run(marked, 'la mesure')['w:lang']).toEqual({ 'w:val': 'fr-FR' });
    // A component in another language: its heading and its text.
    const german = paragraphSaying(plain.docx, 'Grüße aus Berlin.');
    expect(run(german, 'Grüße aus Berlin.')['w:lang']).toEqual({ 'w:val': 'de-DE' });
    expect(run(paragraphSaying(plain.docx, 'Grüße'), 'Grüße')['w:lang']).toEqual({
      'w:val': 'de-DE',
    });
    expect(first(plain.docx.xml('docProps/core.xml'), 'dc:language')!.children).toEqual(['en-GB']);
  });

  it("sets a right-to-left passage right to left: the paragraph by w:bidi, each run by w:rtl and its language as a complex script's (M12)", () => {
    const hebrew = paragraphSaying(plain.docx, `${SHALOM} Ada ${SEFER}.`);
    expect(properties(hebrew)).toEqual(['w:pStyle', 'w:bidi']);
    expect(run(hebrew, `${SHALOM} Ada ${SEFER}.`)).toEqual({
      'w:rtl': {},
      'w:lang': { 'w:bidi': 'he-IL' },
    });
    const heading = paragraphSaying(plain.docx, SEFER);
    expect(properties(heading)).toContain('w:bidi');
    expect(properties(marked)).toEqual(['w:pStyle']);
  });

  it("keeps the style's contextual spacing within a component and writes nothing over it at a component's edge, where its heading stands between (M1)", () => {
    const body = paragraphs(plain.docx);
    const at = body.findIndex((each) => textOf(each) === textOf(checked));
    // The last paragraph of one component, then the next component's heading, then its text.
    expect(body.slice(at, at + 3).map(styleOf)).toEqual(['body', 'heading-2', 'body']);
    for (const each of body) {
      expect(properties(each)).not.toContain('w:contextualSpacing');
    }
  });
});

describe('writeDocx: faces (ruling R10)', () => {
  const table = plain.docx.xml('word/fontTable.xml');
  const rels = relationships(plain.docx, 'word/_rels/fontTable.xml.rels');
  const theme = plain.theme;
  const serif = theme.typefaces.get('serif')!;
  const mono = theme.typefaces.get('mono')!;
  const file = (face: typeof serif, weight: string, posture: string) =>
    face.files.find((each) => each.weight === weight && each.posture === posture)!;

  it('embeds each file of each face the text is set in, and no other, under a key from its hash', () => {
    const embedded = all(table, 'w:font').map((font) => [
      font.attrs['w:name'],
      kids(font)
        .filter((each) => each.name.startsWith('w:embed'))
        .map((each) => each.name),
    ]);
    // Serif in all four: bold headings, emphasis, and emphasis and strong together. Mono regular for
    // the inline code alone. The maths face sets nothing here, and Word names it Cambria Math.
    expect(embedded).toEqual([
      ['Liberation Serif', ['w:embedRegular', 'w:embedBold', 'w:embedItalic', 'w:embedBoldItalic']],
      ['Liberation Mono', ['w:embedRegular']],
      ['Cambria Math', []],
    ]);
    const serifFont = all(table, 'w:font')[0]!;
    const regular = kids(serifFont, 'w:embedRegular')[0]!;
    expect(regular.attrs['w:fontKey']).toBe(fontKey(file(serif, 'regular', 'normal').sha256));
    const monoRegular = kids(all(table, 'w:font')[1]!, 'w:embedRegular')[0]!;
    expect(monoRegular.attrs['w:fontKey']).toBe(fontKey(file(mono, 'regular', 'normal').sha256));
  });

  it('obfuscates each embedded file, which its key restores to the face the worker holds', () => {
    for (const font of all(table, 'w:font')) {
      for (const embed of kids(font).filter((each) => each.name.startsWith('w:embed'))) {
        const part = `word/${rels.get(embed.attrs['r:id']!)!['Target']}`;
        const bytes = plain.docx.files[part]!;
        const key = embed.attrs['w:fontKey']!;
        const original = [...plain.faces.entries()].find(([sha256]) => fontKey(sha256) === key)![1];
        expect(bytes).not.toEqual(original);
        expect(obfuscateFont(bytes, key)).toEqual(original);
      }
    }
  });

  it('STY-052 names a face Word may not embed by the Word face it declares, embeds none of it, and reports the substitution', () => {
    const substituted = written({
      theme: themeWith((inputs) => {
        const face = inputs.theme.typefaces.find((each) => each.id === 'mono')!;
        face.embedding = { pdf: true, word: false };
        face.wordFamily = 'Courier New';
      }),
    });
    const fonts = all(substituted.docx.xml('word/fontTable.xml'), 'w:font');
    expect(fonts.map((each) => each.attrs['w:name'])).toEqual([
      'Liberation Serif',
      'Courier New',
      'Cambria Math',
    ]);
    expect(kids(fonts[1]!).filter((each) => each.name.startsWith('w:embed'))).toEqual([]);
    const styles = strFromU8(substituted.docx.files['word/styles.xml']!);
    expect(styles).toContain('w:ascii="Courier New"');
    expect(styles).not.toContain('Liberation Mono');
    expect(substituted.report).toContainEqual({
      kind: 'face_substituted',
      family: 'Liberation Mono',
      wordFamily: 'Courier New',
    });
  });
});

describe('writeDocx: two typefaces of one family', () => {
  /** The default theme with a second serif, its files the first's, setting what `mark` marks. */
  const twoSerifs = (mark: string, change: (face: Typeface) => void = () => undefined) =>
    themeWith((inputs) => {
      const serif = inputs.theme.typefaces.find((each) => each.id === 'serif')!;
      const second = { ...structuredClone(serif), id: 'serif-two' };
      change(serif);
      change(second);
      inputs.theme.typefaces.push(second);
      inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
        style.id === mark
          ? { ...style, properties: { ...style.properties, typeface: 'serif-two' } }
          : style,
      );
    });

  it('embeds every file of the family either sets text at, under the one name Word knows it by', () => {
    // The emphasis is set in the second: italic, and bold italic where it is strong too.
    const { docx } = written({ theme: twoSerifs('emphasis') });
    const fonts = all(docx.xml('word/fontTable.xml'), 'w:font');
    expect(fonts.map((each) => each.attrs['w:name'])).toEqual([
      'Liberation Serif',
      'Liberation Mono',
      'Cambria Math',
    ]);
    expect(
      kids(fonts[0]!)
        .filter((each) => each.name.startsWith('w:embed'))
        .map((each) => each.name),
    ).toEqual(['w:embedRegular', 'w:embedBold', 'w:embedItalic', 'w:embedBoldItalic']);
  });

  it('reports a substitution once, however many typefaces of the family are set in its Word face', () => {
    const substituted = written({
      theme: twoSerifs('emphasis', (face) => {
        face.embedding = { pdf: true, word: false };
        face.wordFamily = 'Times New Roman';
      }),
    });
    expect(substituted.report).toEqual([
      { kind: 'face_substituted', family: 'Liberation Serif', wordFamily: 'Times New Roman' },
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ]);
  });
});

describe('writeDocx: the report (ruling R13)', () => {
  afterEach(() => vi.useRealTimers());

  it('says every Word output cites the PDF for its pages, and a Word-only one that it carries no page-cited output', () => {
    expect(plain.report).toEqual([
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ]);
    expect(written({}, ['pdf', 'docx']).report).toEqual([{ kind: 'pages_cite_the_pdf' }]);
  });

  it('reports no substitution for a face the text is not set in: the maths face sets nothing in Word 1', () => {
    expect(plain.report.some((each) => each.kind === 'face_substituted')).toBe(false);
  });
});
