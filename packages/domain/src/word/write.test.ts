import { strFromU8, strToU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { scanXml } from '../content/ooxml/xml.js';
import {
  assemble,
  figureImageKey,
  inlineImageKey,
  publishedImagePath,
  type AssembleInput,
  type PublishingAsset,
  type WordInput,
} from '../publishing/assemble.js';
import { defaultLayout, parseLayout, type Layout } from '../publishing/layout.js';
import type { PublishingFormat } from '../publishing/layout.js';
import type { PublishedDocument } from '../publishing/published.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import type { Typeface } from '../theme/schema.js';
import { defaultInputs, resolved, type ThemeInputs } from '../theme/theme.fixture.js';

import { syntheticFace } from './face.fixture.js';
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

/**
 * The fields in a paragraph or a part, each its instruction trimmed, in order: a field nested in
 * another's instruction is written into it in braces, as Word shows field codes, and not listed apart.
 */
function fieldCodes(element: Element): string[] {
  const codes: string[] = [];
  // Each field begun and not yet ended, innermost last, with whether its result has begun.
  const open: { code: string; result: boolean }[] = [];
  for (const run of all(element, 'w:r')) {
    for (const child of kids(run)) {
      const kind = child.attrs['w:fldCharType'];
      if (child.name === 'w:instrText') {
        open[open.length - 1]!.code += child.children.join('');
      } else if (kind === 'begin') {
        open.push({ code: '', result: false });
      } else if (kind === 'separate') {
        open[open.length - 1]!.result = true;
      } else if (kind === 'end') {
        const field = open.pop()!;
        const outer = open[open.length - 1];
        if (outer === undefined) codes.push(field.code.trim());
        else if (!outer.result) outer.code += `{${field.code}}`;
      }
    }
  }
  return codes;
}

const styleOf = (paragraph: Element) => first(paragraph, 'w:pStyle')?.attrs['w:val'];

/** Whether a paragraph is in a heading's style: a heading role's, or one of the writer's own. */
const isHeading = (paragraph: Element) => /^(heading-|Heading)/.test(styleOf(paragraph) ?? '');

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

/**
 * The advances every invented face sets its characters at, in 2048ths of an em: Liberation Serif's for
 * the characters a list's markers are made of - a figure half an em, a full stop a quarter, a disc
 * 0.35 - and none of its own for anything else, which takes the missing glyph's half an em.
 */
const ADVANCES = new Map<number, number>([
  ...[...'0123456789'].map((digit): [number, number] => [digit.codePointAt(0)!, 1024]),
  [0x2e, 512],
  [0x61, 909],
  [0x63, 909],
  [0x64, 1024],
  [0x69, 569],
  [0x76, 1024],
  [0x2022, 717],
  [0x25e6, 727],
  [0x25aa, 727],
]);

/**
 * Every file the theme names, by its hash: an invented face, each file its own, for the writer to
 * embed and to read its markers' widths from.
 */
function facesOf(theme: ResolvedTheme): Map<string, Uint8Array> {
  const faces = new Map<string, Uint8Array>();
  let seed = 1;
  for (const face of theme.typefaces.values()) {
    for (const file of face.files) {
      faces.set(file.sha256, syntheticFace(ADVANCES, { seed: seed++ }));
    }
  }
  return faces;
}

interface Written {
  readonly docx: Package;
  readonly bytes: Uint8Array;
  readonly report: ReturnType<typeof writeDocx>['report'];
  readonly document: PublishedDocument;
  readonly word: WordInput;
  readonly theme: ResolvedTheme;
  readonly faces: Map<string, Uint8Array>;
  readonly images: Map<string, Uint8Array>;
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
  const images = imagesOf(over.assets ?? new Map());
  const { bytes, report } = writeDocx({
    document: assembled.document,
    numbering: assembled.numbering,
    word: assembled.word,
    formats,
    faces,
    images,
  });
  return {
    docx: read(bytes),
    bytes,
    report,
    document: assembled.document,
    word: assembled.word,
    theme,
    faces,
    images,
  };
}

/**
 * Every image the request resolved, by the path the published document names it at: invented bytes,
 * each its own, which the writer copies into the package as they are and never reads.
 */
function imagesOf(assets: ReadonlyMap<string, PublishingAsset>): Map<string, Uint8Array> {
  return new Map(
    [...assets.values()].map((asset) => [
      publishedImagePath(asset),
      strToU8(`the bytes of ${asset.object}`),
    ]),
  );
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
        (each) => isHeading(each) && textOf(each) === title,
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
    // Past the sixth level too: a style of the writer's own, linked at its depth.
    expect(numPr(pPr(heading('Level 7'))!)).toBeUndefined();
    expect(numPr(pPr(heading('Level 6'))!)).toBeUndefined();
    // No number printed as text anywhere a heading stands.
    for (const each of paragraphs(plain.docx).filter(isHeading)) {
      expect(textOf(each)).not.toMatch(/^([0-9ivxA-Z]+(\.[0-9]+)*)\s/);
    }
  });

  /**
   * What Word makes of a heading paragraph (measured in Word for the final review of Word 1, I2): a
   * style Word names "heading N" is its built-in Heading N, whose outline level is N whatever the
   * paragraph or the style states - a paragraph's own `w:outlineLvl` is ignored there - and any other
   * style's is the paragraph's own, else its style's, else body text. And the number its style is
   * linked to, where the paragraph states none of its own.
   */
  const wordReads = (docx: Package, paragraph: Element) => {
    const styles = docx.xml('word/styles.xml');
    const byId = (id: string | undefined) =>
      all(styles, 'w:style').find((each) => each.attrs['w:styleId'] === id);
    const style = byId(styleOf(paragraph))!;
    const name = first(style, 'w:name')!.attrs['w:val']!;
    const builtIn = /^heading ([1-9])$/i.exec(name);
    let level: number | undefined = builtIn === null ? undefined : Number(builtIn[1]);
    const stated = (element: Element | undefined) =>
      element === undefined
        ? undefined
        : kids(kids(element, 'w:pPr')[0] ?? element, 'w:outlineLvl')[0];
    for (let at: Element | undefined = style; level === undefined && at !== undefined;) {
      const own = stated(at);
      if (own !== undefined) level = Number(own.attrs['w:val']) + 1;
      at = byId(first(at, 'w:basedOn')?.attrs['w:val']);
    }
    const own = stated(paragraph);
    if (builtIn === null && own !== undefined) level = Number(own.attrs['w:val']) + 1;
    return { name, level: level ?? 10, style };
  };

  it("sets every heading in a style Word names for its depth, since Word takes a heading's outline level from its style's name and ignores the paragraph's own (I2)", () => {
    const shared = written({
      theme: themeWith((inputs) => {
        inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((each) =>
          each.id === 'heading-5' ? { ...each, appliesTo: ['heading5', 'heading6'] } : each,
        );
        inputs.theme.roles.heading6 = 'heading-5';
      }),
    });
    for (const { docx, document } of [plain, shared]) {
      const depths = new Map<string, number>();
      const walk = (nodes: PublishedDocument['nodes']) =>
        nodes.forEach((node) => {
          depths.set(node.title.map((run) => ('text' in run ? run.text : '')).join(''), node.depth);
          walk(node.children);
        });
      walk(document.nodes);
      const headings = paragraphs(docx).filter(isHeading);
      expect(headings.map(textOf).sort()).toEqual([...depths.keys()].sort());
      for (const each of headings) {
        const depth = depths.get(textOf(each))!;
        const read = wordReads(docx, each);
        expect([textOf(each), read.name.toLowerCase(), read.level]).toEqual([
          textOf(each),
          `heading ${depth}`,
          depth,
        ]);
      }
    }
    // Past the sixth level, and at the sixth where its role shares the fifth's style: Word's own
    // "heading N", based on the role's style and adding only its place on the body's list, which the
    // list links back to, so that a heading a recipient sets in it is numbered at its depth too.
    const styles = plain.docx.xml('word/styles.xml');
    const numbering = plain.docx.xml('word/numbering.xml');
    const body = all(numbering, 'w:abstractNum')[0]!;
    for (const depth of [7, 8, 9]) {
      const style = all(styles, 'w:style').find(
        (each) => each.attrs['w:styleId'] === `Heading${depth}`,
      )!;
      expect(first(style, 'w:basedOn')!.attrs['w:val']).toBe('heading-6');
      expect(first(style, 'w:ilvl')!.attrs['w:val']).toBe(String(depth - 1));
      expect(first(style, 'w:numId')!.attrs['w:val']).toBe('1');
      expect(first(style, 'w:outlineLvl')!.attrs['w:val']).toBe(String(depth - 1));
      const level = kids(body, 'w:lvl')[depth - 1]!;
      expect(first(level, 'w:pStyle')!.attrs['w:val']).toBe(`Heading${depth}`);
    }
    const sharedStyles = shared.docx.xml('word/styles.xml');
    const sixth = all(sharedStyles, 'w:style').find(
      (each) => each.attrs['w:styleId'] === 'Heading6',
    )!;
    expect(first(sixth, 'w:basedOn')!.attrs['w:val']).toBe('heading-5');
    // No paragraph states an outline level: Word would not read it.
    for (const { docx } of [plain, shared]) {
      expect(paragraphs(docx).filter((each) => first(pPr(each)!, 'w:outlineLvl'))).toEqual([]);
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

  it('starts each later appendix on a page of its own where the layout says so, by a page break before its heading', () => {
    // Not a break in a paragraph of its own, which takes a line after the appendix before: where that
    // appendix fills its last page, the line flows onto a page the break then leaves blank (measured in
    // Word for the final review of Word 1, M2). Before its heading, Word drops the heading's space
    // before at the top of the page, as the PDF does.
    const appendix = sections(plain.docx)[4]!.paragraphs;
    const glossary = appendix.find((each) => textOf(each) === 'Glossary')!;
    expect(properties(glossary).slice(0, 3)).toEqual(['w:pStyle', 'w:pageBreakBefore', 'w:numPr']);
    const body = first(plain.docx.xml('word/document.xml'), 'w:body')!;
    expect(all(body, 'w:br')).toEqual([]);
    expect(all(body, 'w:pageBreakBefore')).toHaveLength(1);
    const together = written({
      layout: layoutWith((layout) => {
        layout.matter.appendices.newPage = false;
      }),
    });
    expect(
      all(first(together.docx.xml('word/document.xml'), 'w:body')!, 'w:pageBreakBefore'),
    ).toEqual([]);
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
    // The title as text, then the centre and the end slots after their tabs: the section's space is
    // its field's, printed only where there is a number before it.
    expect(textOf(running!)).toBe(`The dosing report${TAB}${TAB}`);
    const BS = String.fromCharCode(92);
    // The level-1 heading's number where it has one, then a space, and its title: an unnumbered
    // heading's number is "0" to `STYLEREF \n`, which the PDF does not print (measured in Word for the
    // final review of Word 1, I1), and a section's number is never 0.
    expect(fieldCodes(running!)).toEqual([
      `IF "{ STYLEREF "Heading 1" ${BS}n }" = "0" "" "{ STYLEREF "Heading 1" ${BS}n } "`,
      'STYLEREF "Heading 1"',
    ]);
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

  it("embeds the running head's number right to left in a right-to-left document, so it comes first in reading order, as the PDF's does", () => {
    // Measured in Word for the final review of Word 1 (M1): with nothing to say otherwise, Word set
    // the number after the title in reading order, where the PDF sets it first. A right-to-left
    // embedding around the number and its space puts a number of digits and one of letters where the
    // PDF does, to the point. A right-to-left mark before it placed digits but not a letter, and
    // `w:rtl` on the fields' runs placed both but drew them in Times New Roman, not the embedded face.
    const BS = String.fromCharCode(92);
    const [EMBED, POP] = [String.fromCharCode(0x202b), String.fromCharCode(0x202c)];
    const rtl = written({ outline: { ...OUTLINE, language: 'he-IL', direction: 'rtl' } });
    const [, , , body] = sections(rtl.docx);
    const reference = kids(body!.properties, 'w:headerReference').find(
      (each) => each.attrs['w:type'] === 'default',
    )!;
    const rels = relationships(rtl.docx, 'word/_rels/document.xml.rels');
    const head = rtl.docx.xml(`word/${rels.get(reference.attrs['r:id']!)!['Target']}`);
    const [, running] = kids(head, 'w:p');
    expect(fieldCodes(running!)).toEqual([
      `IF "{ STYLEREF "Heading 1" ${BS}n }" = "0" "" "${EMBED}{ STYLEREF "Heading 1" ${BS}n } ${POP}"`,
      'STYLEREF "Heading 1"',
    ]);
    const runs = kids(running!, 'w:r');
    const section = runs.slice(runs.findIndex((run) => kids(run, 'w:fldChar').length > 0));
    expect(section.flatMap((run) => all(run, 'w:rtl'))).toEqual([]);
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
    // Number, space and title, as the PDF prints an entry and Word rebuilds one (final review of Word
    // 1, M3): a reader who declines the update sees what Word would build, less the page.
    const entries = contents!.paragraphs.slice(1);
    expect(entries.map(textOf)).toEqual([
      'i Preface by Ada',
      '1 Introduction',
      '1.1 Readings',
      '1.2 Grüße',
      '2 Method',
      `2.1 ${SEFER}`,
      '2.2 Level 2',
      '2.2.1 Level 3',
      'Notes',
      'A Tables of values',
      'A.1 Values',
      'B Glossary',
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

// ---------------------------------------------------------------------------------------------------
// Word 2: lists, quotations and preformatted text.
// ---------------------------------------------------------------------------------------------------

/**
 * A document's body paragraphs, read once, and the first saying exactly this: each read of a part makes
 * new elements, so a paragraph is found among the ones its neighbours are counted in.
 */
function bodyOf(docx: Package): { body: Element[]; at: (text: string) => Element } {
  const body = paragraphs(docx);
  return {
    body,
    at(text) {
      const found = body.find((each) => textOf(each) === text);
      if (found === undefined) throw new Error(`no paragraph says ${JSON.stringify(text)}`);
      return found;
    },
  };
}

/** One component under one section, written for Word: what each block's test reads. */
const writtenOf = (content: unknown[], over: Parameters<typeof written>[0] = {}): Written =>
  written({
    ...over,
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [reference('blocks', 9)],
    }),
    occurrences: new Map([[id('blocks'), component('Blocks', content)]]),
  });

const list = (name: string, kind: string, items: unknown[], over: object = {}) => ({
  type: 'list',
  id: name,
  kind,
  items,
  ...over,
});
/** An item holding these blocks. */
const item = (...blocks: unknown[]) => ({ content: blocks });
/** A paragraph saying its own name. */
const said = (name: string) => paragraph(name, text(name));

/** Twentieths of a point, as Word states a length. */
const twips = (points: number) => String(Math.round(points * 20));
/** How wide the invented faces set these characters, at the default list item's 11pt. */
const wide = (...codePoints: number[]) =>
  (codePoints.reduce((sum, each) => sum + ADVANCES.get(each)!, 0) / 2048) * 11;
const [DISC, CIRCLE, SQUARE] = [0x2022, 0x25e6, 0x25aa];
/** Half an em of the list item's 11pt between a marker and its item (Typst's `body-indent`). */
const GAP = 5.5;

/** A paragraph's numbering: its level and its definition, or undefined where it has none. */
const numbered = (element: Element) => {
  const found = first(pPr(element) ?? element, 'w:numPr');
  return found === undefined
    ? undefined
    : {
        ilvl: first(found, 'w:ilvl')!.attrs['w:val'],
        numId: first(found, 'w:numId')!.attrs['w:val'],
      };
};
/** A paragraph's own indents, or undefined where its style's stand. */
const indents = (element: Element) => kids(pPr(element)!, 'w:ind')[0]?.attrs;
/** A paragraph's own spacing, or undefined where its style's stands. */
const spacing = (element: Element) => kids(pPr(element)!, 'w:spacing')[0]?.attrs;
/** A paragraph's own contextual spacing, or undefined where its style's stands. */
const contextual = (element: Element) =>
  kids(pPr(element)!, 'w:contextualSpacing')[0]?.attrs['w:val'];

/** A numbering definition's level, by the `w:num` that names it and the level's index. */
function level(docx: Package, numId: string, ilvl: string): Element {
  const numbering = docx.xml('word/numbering.xml');
  const num = all(numbering, 'w:num').find((each) => each.attrs['w:numId'] === numId)!;
  const abstractId = first(num, 'w:abstractNumId')!.attrs['w:val'];
  const abstract = all(numbering, 'w:abstractNum').find(
    (each) => each.attrs['w:abstractNumId'] === abstractId,
  )!;
  return kids(abstract, 'w:lvl').find((each) => each.attrs['w:ilvl'] === ilvl)!;
}
/** What a level prints and from what, as Word reads it. */
const printing = (lvl: Element) => ({
  start: first(lvl, 'w:start')?.attrs['w:val'],
  format: first(lvl, 'w:numFmt')!.attrs['w:val'],
  text: first(lvl, 'w:lvlText')!.attrs['w:val'],
  justified: first(lvl, 'w:lvlJc')!.attrs['w:val'],
  indent: first(lvl, 'w:ind')!.attrs,
});

describe('writeDocx: lists (Word 2, ruling R4)', () => {
  const listed = writtenOf([
    said('before'),
    list('B1', 'unordered', [
      item(
        said('disc first'),
        said('disc second'),
        list('B2', 'unordered', [
          item(said('circle'), list('B3', 'unordered', [item(said('square'))])),
        ]),
      ),
      item(said('disc again')),
    ]),
    list(
      'N1',
      'ordered',
      [item(said('nine')), item(said('ten')), item(paragraph('empty')), item(said('twelve'))],
      { start: 9 },
    ),
    list('A1', 'ordered', [item(said('letter c'))], { start: 3, format: 'alphabetic' }),
    list('R1', 'ordered', [item(said('roman iv'))], { start: 4, format: 'roman' }),
    list('M1', 'unordered', [
      item(
        said('mixed disc'),
        list('M2', 'ordered', [
          item(said('mixed one'), list('M3', 'unordered', [item(said('mixed circle'))])),
        ]),
      ),
      item(list('M4', 'unordered', [item(said('starts nested'))])),
    ]),
    said('after'),
  ]);
  const { body, at } = bodyOf(listed.docx);

  it("gives each list a numbering definition of its own, after the headings' three, each nested list at the next level of its own", () => {
    const numbering = listed.docx.xml('word/numbering.xml');
    // B1 to B3, N1, A1, R1 and M1 to M4: ten lists, each its own.
    expect(all(numbering, 'w:abstractNum')).toHaveLength(13);
    expect(all(numbering, 'w:num')).toHaveLength(13);
    expect(numbered(at('disc first'))).toEqual({ ilvl: '0', numId: '4' });
    expect(numbered(at('circle'))).toEqual({ ilvl: '1', numId: '5' });
    expect(numbered(at('square'))).toEqual({ ilvl: '2', numId: '6' });
    expect(numbered(at('disc again'))).toEqual({ ilvl: '0', numId: '4' });
    expect(numbered(at('nine'))).toEqual({ ilvl: '0', numId: '7' });
    expect(numbered(at('mixed circle'))).toEqual({ ilvl: '2', numId: '12' });
    // Every definition has Word's nine levels, so a recipient can nest an item further.
    for (const abstract of all(numbering, 'w:abstractNum').slice(3)) {
      expect(kids(abstract, 'w:lvl')).toHaveLength(9);
    }
  });

  it("numbers an ordered list in its format from its start, and bullets an unordered one by how many unordered lists it stands in, template 13's disc, circle and square", () => {
    expect(printing(level(listed.docx, '7', '0'))).toMatchObject({
      start: '9',
      format: 'decimal',
      text: '%1.',
    });
    expect(printing(level(listed.docx, '8', '0'))).toMatchObject({
      start: '3',
      format: 'lowerLetter',
      text: '%1.',
    });
    expect(printing(level(listed.docx, '9', '0'))).toMatchObject({
      start: '4',
      format: 'lowerRoman',
    });
    const bullet = (numId: string, ilvl: string) => printing(level(listed.docx, numId, ilvl));
    expect(bullet('4', '0')).toMatchObject({ format: 'bullet', text: String.fromCodePoint(DISC) });
    expect(bullet('5', '1')).toMatchObject({ text: String.fromCodePoint(CIRCLE) });
    expect(bullet('6', '2')).toMatchObject({ text: String.fromCodePoint(SQUARE) });
    // An ordered list between does not count: the engine cycles its markers by unordered lists alone.
    expect(bullet('12', '2')).toMatchObject({ text: String.fromCodePoint(CIRCLE) });
    // Past a list's own level, the next marker; the levels a recipient adds carry the list's kind on.
    expect(bullet('4', '1')).toMatchObject({ text: String.fromCodePoint(CIRCLE) });
    expect(printing(level(listed.docx, '7', '1'))).toMatchObject({ start: '1', text: '%2.' });
  });

  it("stands each marker where the PDF's engine does, ended at the widest marker of its list as its face sets it, and each item half an em after it", () => {
    // A disc from the text block's edge, then its items; the circle's list from where they stand.
    const disc = wide(DISC) + GAP;
    expect(indents(at('disc first'))).toEqual({
      'w:left': twips(disc),
      'w:right': '0',
      'w:hanging': twips(GAP),
    });
    const circle = disc + wide(CIRCLE) + GAP;
    expect(indents(at('circle'))).toMatchObject({ 'w:left': twips(circle) });
    expect(indents(at('square'))).toMatchObject({ 'w:left': twips(circle + wide(SQUARE) + GAP) });
    // Right-aligned, as the engine aligns its numbers: "9." ends where "12." does.
    const numbers = wide(0x31, 0x32, 0x2e) + GAP;
    expect(indents(at('nine'))).toEqual({
      'w:left': twips(numbers),
      'w:right': '0',
      'w:hanging': twips(GAP),
    });
    expect(printing(level(listed.docx, '7', '0'))).toMatchObject({
      justified: 'right',
      indent: { 'w:left': twips(numbers), 'w:hanging': twips(GAP) },
    });
    expect(indents(at('letter c'))).toMatchObject({ 'w:left': twips(wide(0x63, 0x2e) + GAP) });
    expect(indents(at('roman iv'))).toMatchObject({
      'w:left': twips(wide(0x69, 0x76, 0x2e) + GAP),
    });
  });

  it("stands an item's later paragraphs where its first stands, with no number", () => {
    expect(numbered(at('disc second'))).toBeUndefined();
    expect(indents(at('disc second'))).toEqual({
      'w:left': twips(wide(DISC) + GAP),
      'w:right': '0',
      'w:firstLine': '0',
    });
  });

  it("keeps an empty item as an empty numbered paragraph, so the numbers after it stay the author's", () => {
    const ten = body.indexOf(at('ten'));
    expect(textOf(body[ten + 1]!)).toBe('');
    expect(numbered(body[ten + 1]!)).toEqual({ ilvl: '0', numId: '7' });
    expect(numbered(at('twelve'))).toEqual({ ilvl: '0', numId: '7' });
  });

  it('puts the number of an item that opens with anything but a paragraph on an empty paragraph of its own before it', () => {
    const nested = body.indexOf(at('starts nested'));
    expect(textOf(body[nested - 1]!)).toBe('');
    expect(numbered(body[nested - 1]!)).toEqual({ ilvl: '0', numId: '10' });
    expect(numbered(at('starts nested'))).toEqual({ ilvl: '1', numId: '13' });
  });

  it("sets each item's paragraphs in the list item's style, and the markers in its face", () => {
    for (const text of ['disc first', 'disc second', 'nine', 'square']) {
      expect(styleOf(at(text))).toBe('body');
    }
    const fonts = first(first(level(listed.docx, '4', '0'), 'w:rPr')!, 'w:rFonts')!;
    expect(fonts.attrs['w:ascii']).toBe('Liberation Serif');
  });

  it('R6 stands items a line apart as the PDF does, dropping the space after an item that the style would put before the next, and spaces the list as a whole by the style', () => {
    // The body style: 2.75 after, none before, no contextual spacing.
    expect(spacing(at('before'))).toBeUndefined();
    expect(spacing(at('disc first'))).toBeUndefined();
    expect(spacing(at('square'))).toEqual({ 'w:after': '0' });
    expect(spacing(at('nine'))).toEqual({ 'w:after': '0' });
    expect(spacing(at('twelve'))).toBeUndefined();
    expect(spacing(at('disc again'))).toBeUndefined();
    expect(spacing(at('after'))).toBeUndefined();
    for (const each of body) expect(contextual(each)).toBeUndefined();
  });
});

describe('writeDocx: definition lists (Word 2, ruling R4)', () => {
  const defined = writtenOf([
    list('D1', 'definition', [
      { term: [text('Creep')], content: [said('slow strain'), said('under load')] },
      { content: [said('no term yet')] },
      {
        term: [text('Tensile '), text('strength', { type: 'emphasis', id: 'k1' })],
        content: [said('the most')],
      },
    ]),
  ]);
  const { body, at } = bodyOf(defined.docx);

  it('sets a term as template 13 does, in the list item style and bold, and no term where the author has typed none', () => {
    const term = at('Creep');
    expect(styleOf(term)).toBe('body');
    expect(numbered(term)).toBeUndefined();
    const marked = at('Tensile strength');
    for (const run of [...all(term, 'w:r'), ...all(marked, 'w:r')]) {
      expect(first(run, 'w:b')).toBeDefined();
    }
    expect(textOf(body[body.indexOf(at('no term yet')) - 1]!)).toBe('under load');
  });

  it('indents its definitions two ems of the list item, with no number', () => {
    for (const text of ['slow strain', 'under load', 'no term yet']) {
      expect(numbered(at(text))).toBeUndefined();
      expect(indents(at(text))).toEqual({
        'w:left': twips(22),
        'w:right': '0',
        'w:firstLine': '0',
      });
    }
    expect(indents(at('Creep'))).toBeUndefined();
  });

  it('R6 stands a term a line above its definition, the nearest Word comes to the PDF, and an item a line below the one before', () => {
    // The engine sets a definition an em below its term, closer than a line, which Word cannot.
    expect(spacing(at('Creep'))).toEqual({ 'w:after': '0' });
    expect(spacing(at('slow strain'))).toBeUndefined();
    expect(spacing(at('under load'))).toEqual({ 'w:after': '0' });
    expect(spacing(at('no term yet'))).toEqual({ 'w:after': '0' });
  });
});

describe('writeDocx: quotations (Word 2, ruling R5)', () => {
  const quote = (name: string, blocks: unknown[], attribution?: string) => ({
    type: 'blockquote',
    id: name,
    content: blocks,
    ...(attribution === undefined ? {} : { attribution: [text(attribution)] }),
  });
  const quoted = writtenOf([
    said('into'),
    quote('Q1', [said('one a'), said('one b')], 'Ada'),
    quote('Q2', [said('two a'), said('two b')], 'Grace'),
    said('between'),
    quote('Q3', [said('three a'), said('three b')]),
    quote('Q4', [said('four a'), said('four b')]),
    said('out'),
    quote('Q5', [said('five a'), list('QL', 'ordered', [item(said('quoted item'))])], 'Alice'),
  ]);
  const { body, at } = bodyOf(quoted.docx);

  it("sets a quotation's blocks in the quotation style, its attribution a paragraph after them in the attribution role's, standing in as far as the quotation does", () => {
    expect(styleOf(at('one a'))).toBe('quotation');
    expect(indents(at('one a'))).toBeUndefined();
    const ada = at('Ada');
    expect(styleOf(ada)).toBe('attribution');
    expect(indents(ada)).toEqual({
      'w:left': twips(11),
      'w:right': twips(11),
      'w:firstLine': '0',
    });
    expect(body.indexOf(ada)).toBe(body.indexOf(at('one b')) + 1);
  });

  it('stands a list in a quotation in by the quotation, its number from there', () => {
    expect(indents(at('quoted item'))).toMatchObject({
      'w:left': twips(11 + wide(0x31, 0x2e) + GAP),
      'w:right': twips(11),
    });
  });

  it("R6 writes M1's d8 where two quotations meet with no attribution between: contextual spacing off on the pair, and the spaces the PDF drops dropped", () => {
    expect(spacing(at('three b'))).toEqual({ 'w:before': '0' });
    expect(contextual(at('three b'))).toBe('0');
    expect(spacing(at('four a'))).toEqual({ 'w:after': '0' });
    expect(contextual(at('four a'))).toBe('0');
    // Word's own contextual spacing everywhere else: within each quotation, and where an attribution
    // or a paragraph of another style stands between.
    for (const text of ['one a', 'one b', 'two a', 'two b', 'three a', 'four b', 'Ada', 'Grace']) {
      expect(spacing(at(text))).toBeUndefined();
      expect(contextual(at(text))).toBeUndefined();
    }
  });

  it('R6 spaces a list in a quotation from the paragraph before it by both spaces, which the quotation style gives without help', () => {
    expect(spacing(at('five a'))).toBeUndefined();
    expect(contextual(at('five a'))).toBeUndefined();
  });
});

describe('writeDocx: preformatted text (Word 2, ruling R5)', () => {
  const code = (name: string, value: string, label?: string) => ({
    type: 'preformatted',
    id: name,
    text: value,
    ...(label === undefined ? {} : { language: label }),
  });
  const coded = writtenOf([
    said('before'),
    code('C1', 'first  line\n  second\n\nfourth', 'shell'),
    code('C2', 'one line'),
    said('after'),
  ]);
  const { body, at } = bodyOf(coded.docx);
  const lines = body.slice(body.indexOf(at('first  line')), body.indexOf(at('one line')) + 1);

  it('sets its label in the preformatted label role, then each line a paragraph of the preformatted role, its spaces kept exactly', () => {
    expect(styleOf(at('shell'))).toBe('preformatted-label');
    expect(body.indexOf(at('shell'))).toBe(body.indexOf(at('first  line')) - 1);
    expect(lines.map(textOf)).toEqual(['first  line', '  second', '', 'fourth', 'one line']);
    for (const line of lines) expect(styleOf(line)).toBe('preformatted');
    const kept = first(at('  second'), 'w:t')!;
    expect(kept.attrs['xml:space']).toBe('preserve');
    expect(kept.children.join('')).toBe('  second');
  });

  it("R6 sets a block's lines a line apart, as the PDF sets them in one paragraph, and the block apart from what is around it by its style", () => {
    expect(lines.slice(0, 4).map(spacing)).toEqual([
      { 'w:after': '0' },
      { 'w:before': '0', 'w:after': '0' },
      { 'w:before': '0', 'w:after': '0' },
      { 'w:before': '0' },
    ]);
  });

  it('keeps two blocks one after another two panels, as the PDF sets them: the second stood a twentieth of a point further in, where Word joins paragraphs of one border and indent into one panel', () => {
    // Measured in Word 16: the two blocks' lines in one panel, 15.60pt from the first's last line to the
    // second's first where the PDF has 27.70; with the second's indents a twip more, two panels, 28.56.
    const panels = writtenOf([
      code('P1', 'one'),
      code('P2', 'two a\ntwo b'),
      code('P3', 'three'),
      said('between'),
      code('P4', 'four'),
    ]);
    const { at } = bodyOf(panels.docx);
    // The style's own: its padding and Word's reach past it, 8pt, each side.
    const moved = { 'w:left': '161', 'w:right': '161', 'w:firstLine': '0' };
    expect(indents(at('one'))).toBeUndefined();
    expect(indents(at('two a'))).toEqual(moved);
    expect(indents(at('two b'))).toEqual(moved);
    expect(indents(at('three'))).toBeUndefined();
    expect(indents(at('four'))).toBeUndefined();
  });

  it("sets a block whose widest line the PDF's measure holds but Word's panel does not the least whole twentieths of a point closer that fits it, every line alike, and no closer than half a point's size would", () => {
    // Measured in Word 16 (the Word check, Word 2 task 5): 8.8pt text is 9pt in Word, in a panel 4pt
    // narrower than the PDF's, so of the 83 columns the PDF's measure holds Word set 80 and wrapped
    // the rest. 83 at 9pt is 448.20pt against a room of 435.28; 4 twentieths closer is 431.60.
    const widest = '1234567890'.repeat(9).slice(0, 83);
    const fits = 'x'.repeat(80);
    const over = 'y'.repeat(90);
    const set = writtenOf([
      code('W1', `${widest}\nshort`),
      said('between'),
      code('W2', fits),
      said('and'),
      code('W3', over),
    ]);
    const { at } = bodyOf(set.docx);
    const closer = (paragraph: Element) =>
      all(paragraph, 'w:r').map((run) => first(run, 'w:spacing')?.attrs['w:val'] ?? null);
    expect(closer(at(widest))).toEqual(['-4']);
    expect(closer(at('short'))).toEqual(['-4']);
    expect(closer(at(fits))).toEqual([null]);
    // Ninety columns would want 12 twentieths, more than the 6 the next half point down gives: Word
    // wraps it as it would have, rather than set its characters over each other.
    expect(closer(at(over))).toEqual([null]);
    // In the order CT_RPr keeps: after the colour, before the size.
    const properties = kids(first(at(widest), 'w:rPr')!).map((each) => each.name);
    expect(properties.indexOf('w:spacing')).toBeGreaterThan(-1);
    expect(properties.slice(properties.indexOf('w:spacing') + 1)).not.toContain('w:color');
  });

  it('keeps a panel apart from a paragraph of another style with the same panel, which Word would join to it too', () => {
    const labelled = writtenOf([code('P1', 'one'), code('P2', 'two', 'shell')], {
      theme: themeWith((inputs) => {
        inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((each) =>
          each.id === 'preformatted-label'
            ? { ...each, properties: { ...each.properties, background: '#f0f0f0', padding: 6 } }
            : each,
        );
      }),
    });
    const { at } = bodyOf(labelled.docx);
    expect(indents(at('one'))).toBeUndefined();
    expect(indents(at('shell'))).toEqual({ 'w:left': '161', 'w:right': '161', 'w:firstLine': '0' });
    expect(indents(at('two'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
// Word 2: tables.
// ---------------------------------------------------------------------------------------------------

/** The body's paragraphs and tables, in order, and nothing else. */
const blocksOf = (docx: Package) =>
  kids(first(docx.xml('word/document.xml'), 'w:body')!).filter(
    (child) => child.name === 'w:p' || child.name === 'w:tbl',
  );
/** A table's rows, each its cells. */
const rowsOf = (table: Element) => kids(table, 'w:tr').map((row) => kids(row, 'w:tc'));
/** A cell's or a table's properties, as attributes by element, where it states each. */
const stated = (element: Element, group: string) => {
  const found = kids(element, group)[0];
  return found === undefined
    ? {}
    : Object.fromEntries(kids(found).map((each) => [each.name, each.attrs]));
};
/** Whether every run of a paragraph is set bold on the run itself. */
const pinnedBold = (paragraph: Element) =>
  all(paragraph, 'w:r').every((run) => first(run, 'w:b')?.attrs['w:val'] === '1');

const cell = (
  name: string,
  value: string | null,
  spans: { colspan?: number; rowspan?: number } = {},
) => ({
  content: [value === null ? paragraph(name) : paragraph(name, text(value))],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});

/**
 * A table style asking for all of it: a filled, bold, ruled header row and header column, a band,
 * rules of their own widths and colours, no vertical rules, a wide padding, the header not repeated,
 * rows kept whole and a continuation label.
 */
const RULED = {
  id: 'ruled',
  name: 'Ruled',
  appliesTo: ['table' as const],
  headerRow: { fill: '#d9e2f3', bold: true, rule: { width: 2, colour: '#c00000' } },
  headerColumn: { fill: '#e2efd9', bold: true, rule: { width: 1.5, colour: '#00aa00' } },
  banding: { fill: '#fff2cc' },
  rules: {
    outer: { width: 0.5, colour: '#1f4e79' },
    horizontal: { width: 0.5, colour: '#808080' },
    vertical: 'none' as const,
  },
  padding: 6,
  breaks: { repeatHeader: false, keepRowsWhole: true, continuationLabel: true },
};
const ruledTheme = themeWith((inputs) => {
  inputs.catalogues.table.styles.push(RULED);
});

/** The default layout with no list after the contents, which Word 3 writes and Word refuses till then. */
const UNLISTED = layoutWith((layout) => {
  layout.matter.lists = [];
});
const tabledOf = (content: unknown[], over: Parameters<typeof written>[0] = {}) =>
  writtenOf(content, { layout: UNLISTED, ...over });

/**
 * Two header rows, the first's "Site" spanning both and "Values" two columns; a header column, its
 * "York" spanning two body rows; a cell with nothing in it; a caption with a mark; a note.
 */
const readings = (over: object = {}) => ({
  type: 'table',
  id: 't1',
  style: 'ruled',
  caption: [text('Readings '), text('at noon', { type: 'emphasis', id: 'e1' })],
  headerRows: 2,
  headerColumns: 1,
  note: [text('Measured by Grace.')],
  rows: [
    { cells: [cell('c1', 'Site', { rowspan: 2 }), cell('c2', 'Values', { colspan: 2 })] },
    { cells: [cell('c3', 'Morning'), cell('c4', 'Evening')] },
    { cells: [cell('c5', 'York', { rowspan: 2 }), cell('c6', '1'), cell('c7', '2')] },
    { cells: [cell('c8', '3'), cell('c9', null)] },
    { cells: [cell('c10', 'Leeds'), cell('c11', '5'), cell('c12', '6')] },
  ],
  ...over,
});

describe('writeDocx: tables (Word 2, ruling R7)', () => {
  const tabled = tabledOf([said('before'), readings(), said('after')], { theme: ruledTheme });
  const { at } = bodyOf(tabled.docx);
  const blocks = blocksOf(tabled.docx);
  const table = blocks.find((each) => each.name === 'w:tbl')!;
  const rows = rowsOf(table);
  const caption = blocks[blocks.indexOf(table) - 1]!;
  /** A cell's paragraphs. */
  const paragraphsOf = (row: number, column: number) => kids(rows[row]![column]!, 'w:p');

  it('sets a table between its caption, above it in the caption role and kept with it, and its note, after it in the table note role', () => {
    const shown = blocks.map((each) => (each.name === 'w:tbl' ? 'table' : textOf(each)));
    expect(shown.slice(shown.indexOf('Blocks'))).toEqual([
      'Blocks',
      'before',
      'Table 1.1 Readings at noon',
      'table',
      'Measured by Grace.',
      'after',
    ]);
    expect(styleOf(caption)).toBe('caption');
    expect(properties(caption).slice(0, 2)).toEqual(['w:pStyle', 'w:keepNext']);
    expect(styleOf(at('Measured by Grace.'))).toBe('table-note');
  });

  it("numbers its caption by Word's fields, as captionField says, each prefilled with the numbering table's label (R1, M3)", () => {
    expect(fieldCodes(caption)).toEqual(['STYLEREF 1 \\s', 'SEQ Table \\* arabic \\s 1']);
    // Each field's result as the numbering table has it, so a reader who never updates them sees the
    // PDF's number.
    expect(textOf(caption)).toBe('Table 1.1 Readings at noon');
    const emphasised = all(caption, 'w:r').find((run) => textOf(run) === 'at noon')!;
    expect(first(emphasised, 'w:rStyle')?.attrs['w:val']).toBe('mark-emphasis');
  });

  it("names the table by its caption's words, which Word reads as the table's title", () => {
    expect(stated(table, 'w:tblPr')['w:tblCaption']).toEqual({
      'w:val': 'Table 1.1 Readings at noon',
    });
  });

  it("sets the table in its table style, the measure wide, its columns equal and fixed, and turns on the style's conditions as the table has header rows, a header column and a band", () => {
    const own = stated(table, 'w:tblPr');
    expect(kids(kids(table, 'w:tblPr')[0]!).map((each) => each.name)).toEqual([
      'w:tblStyle',
      'w:tblW',
      'w:tblLayout',
      'w:tblCellMar',
      'w:tblLook',
      'w:tblCaption',
    ]);
    expect(own['w:tblStyle']).toEqual({ 'w:val': 'Table-ruled' });
    expect(own['w:tblW']).toEqual({ 'w:w': '5000', 'w:type': 'pct' });
    expect(own['w:tblLayout']).toEqual({ 'w:type': 'fixed' });
    expect(own['w:tblLook']).toEqual({
      'w:val': '04A0',
      'w:firstRow': '1',
      'w:lastRow': '0',
      'w:firstColumn': '1',
      'w:lastColumn': '0',
      'w:noHBand': '0',
      'w:noVBand': '1',
    });
    const page = sections(tabled.docx).at(-1)!.properties;
    const size = first(page, 'w:pgSz')!.attrs;
    const margins = first(page, 'w:pgMar')!.attrs;
    const measure =
      Number(size['w:w']) -
      Number(margins['w:left']) -
      Number(margins['w:right']) -
      Number(margins['w:gutter']);
    const columns = all(kids(table, 'w:tblGrid')[0]!, 'w:gridCol').map((each) =>
      Number(each.attrs['w:w']),
    );
    expect(columns).toHaveLength(3);
    expect(new Set(columns).size).toBe(1);
    expect(Math.abs(columns[0]! * 3 - measure)).toBeLessThan(3);
  });

  it("pads its cells by the style's padding, less the leading Word sets above a cell's first line where the PDF sets none, which its caption's space after takes instead (measured)", () => {
    // Word sets the cell style's 14.35 line whole, its 3.35 more than the text's 11pt above the text;
    // the PDF sets a cell's first line at its padding, and that leading above the table (`apart`).
    const margins = Object.fromEntries(
      kids(first(kids(table, 'w:tblPr')[0]!, 'w:tblCellMar')!).map((each) => [
        each.name,
        each.attrs['w:w'],
      ]),
    );
    expect(margins).toEqual({
      'w:top': twips(6 - 3.35),
      'w:left': twips(6),
      'w:bottom': twips(6),
      'w:right': twips(6),
    });
    expect(spacing(caption)).toEqual({ 'w:after': twips(2.75 + 3.35) });
  });

  it('merges cells as the table spans them: across by gridSpan, down by vMerge from the cell that starts it', () => {
    const merge = (row: number, column: number) => stated(rows[row]![column]!, 'w:tcPr');
    expect(rows.map((row) => row.length)).toEqual([2, 3, 3, 3, 3]);
    expect(merge(0, 0)['w:vMerge']).toEqual({ 'w:val': 'restart' });
    expect(merge(0, 1)['w:gridSpan']).toEqual({ 'w:val': '2' });
    expect(merge(1, 0)['w:vMerge']).toEqual({});
    expect(merge(2, 0)['w:vMerge']).toEqual({ 'w:val': 'restart' });
    expect(merge(3, 0)['w:vMerge']).toEqual({});
    expect(merge(3, 1)['w:vMerge']).toBeUndefined();
    // Each cell as wide as the columns it covers.
    const width = Number(merge(4, 0)['w:tcW']!['w:w']);
    expect(merge(0, 1)['w:tcW']).toEqual({ 'w:w': String(width * 2), 'w:type': 'dxa' });
    // What a merge continues holds nothing of its own.
    expect(paragraphsOf(1, 0).map(textOf)).toEqual(['']);
    expect(rows.map((row) => row.map((each) => textOf(each)))).toEqual([
      ['Site', 'Values'],
      ['', 'Morning', 'Evening'],
      ['York', '1', '2'],
      ['', '3', ''],
      ['Leeds', '5', '6'],
    ]);
  });

  it('marks every header row as one, which Word repeats, and keeps each body row whole where the style keeps rows whole', () => {
    const trPr = (row: number) => Object.keys(stated(kids(table, 'w:tr')[row]!, 'w:trPr')).sort();
    expect([0, 1, 2, 3, 4].map(trPr)).toEqual([
      ['w:tblHeader'],
      ['w:tblHeader'],
      ['w:cantSplit'],
      ['w:cantSplit'],
      ['w:cantSplit'],
    ]);
    const kept = tabledOf([readings({ style: 'table' })]);
    const plain = blocksOf(kept.docx).find((each) => each.name === 'w:tbl')!;
    expect(kids(plain, 'w:tr').map((row) => Object.keys(stated(row, 'w:trPr')))).toEqual([
      ['w:tblHeader'],
      ['w:tblHeader'],
      [],
      [],
      [],
    ]);
  });

  it("sets a cell's paragraphs in the table cell place's style, and an empty cell as an empty paragraph, which Word needs", () => {
    expect(paragraphsOf(2, 1).map(styleOf)).toEqual(['table-cell']);
    expect(paragraphsOf(3, 2).map(textOf)).toEqual(['']);
    expect(paragraphsOf(3, 2).map(styleOf)).toEqual(['table-cell']);
  });

  it("sets a bold header's text bold on its runs, as template 13 sets it over whatever its style says, since Word's toggle rule would set a bold cell style's regular", () => {
    expect(pinnedBold(paragraphsOf(0, 0)[0]!)).toBe(true);
    expect(pinnedBold(paragraphsOf(1, 1)[0]!)).toBe(true);
    // The header column's too, and nothing else.
    expect(pinnedBold(paragraphsOf(2, 0)[0]!)).toBe(true);
    expect(all(paragraphsOf(2, 1)[0]!, 'w:b')).toEqual([]);
    const regular = tabledOf([readings({ style: 'table' })]);
    const plain = rowsOf(blocksOf(regular.docx).find((each) => each.name === 'w:tbl')!);
    expect(all(plain[0]![0]!, 'w:b')).toEqual([]);
  });

  it("R6 sets a cell's blocks apart from the cell's edges by nothing but its padding, and spaces its caption and note from the table as the PDF does", () => {
    const listed = tabledOf(
      [
        readings({
          rows: [
            {
              cells: [
                {
                  content: [
                    paragraph('x1', text('first')),
                    paragraph('x2', text('second')),
                    { type: 'list', id: 'XL', kind: 'ordered', items: [item(said('listed'))] },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
                cell('x3', 'alone'),
              ],
            },
          ],
          headerRows: 0,
          headerColumns: 0,
          style: 'table',
        }),
        said('after'),
      ],
      { theme: ruledTheme },
    );
    const { at: cellAt } = bodyOf(listed.docx);
    const inCell = (name: string) =>
      all(first(listed.docx.xml('word/document.xml'), 'w:tbl')!, 'w:p').find(
        (each) => textOf(each) === name,
      )!;
    // The style's own between a cell's paragraphs - none before, 2.75 after - but none at its foot.
    expect(spacing(inCell('first'))).toBeUndefined();
    expect(spacing(inCell('listed'))).toMatchObject({ 'w:after': '0' });
    expect(spacing(inCell('alone'))).toEqual({ 'w:after': '0' });
    // A list in a cell, numbered from its first level by a definition of its own.
    expect(numbered(inCell('listed'))).toEqual({ ilvl: '0', numId: expect.any(String) });
    // The note stands apart from the cells by their space after and its own space before.
    const note = spacing(cellAt('Measured by Grace.'));
    expect(note).toEqual({ 'w:before': twips(2.75) });
  });

  it("R6 puts the space the PDF puts below a table with no note on the paragraph after it, which is the first Word's own reading would space from it", () => {
    const bare = tabledOf([readings({ note: undefined, style: 'table' }), said('after')]);
    const { at: bareAt } = bodyOf(bare.docx);
    // The cells' 2.75 after, and the body's own none before.
    expect(spacing(bareAt('after'))).toEqual({ 'w:before': twips(2.75) });
  });

  it('never ends a section in a table: an empty paragraph a point high follows, to carry the section or close the body', () => {
    const last = tabledOf([readings({ note: undefined, style: 'table' })]);
    const body = blocksOf(last.docx);
    const tail = body[body.length - 1]!;
    expect(tail.name).toBe('w:p');
    expect(body[body.length - 2]!.name).toBe('w:tbl');
    expect(textOf(tail)).toBe('');
    expect(spacing(tail)).toMatchObject({ 'w:line': '20', 'w:lineRule': 'exact' });
  });

  it('R7 reports each table Word could not set as its style asks: a header column lost, a header its style does not repeat repeated, a continuation label left out, each by its place and label', () => {
    const place = { node: id('blocks'), block: 't1', label: 'Table 1.1' };
    expect(tabled.report).toEqual([
      { kind: 'header_column_lost', ...place },
      { kind: 'header_repeated', ...place },
      { kind: 'continuation_label_omitted', ...place },
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ]);
    // Under the default's style, repeated and unlabelled, only the header column; with none, nothing.
    expect(tabledOf([readings({ style: 'table' })]).report).toEqual([
      { kind: 'header_column_lost', ...place },
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ]);
    expect(tabledOf([readings({ style: 'table', headerColumns: 0 })]).report).toEqual([
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ]);
  });

  it('writes a caption the scheme gives no number with no field, and one before its first chapter with its counter alone (captionField)', () => {
    const unnumbered = written({
      theme: ruledTheme,
      layout: UNLISTED,
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          reference('front', 9, { matter: 'front', numbered: false }),
          reference('body', 8, { numbered: false }),
        ],
      }),
      occurrences: new Map([
        [id('front'), component('Front', [readings({ id: 'f1' })])],
        [id('body'), component('Body', [readings({ id: 'b1' })])],
      ]),
    });
    const captions = paragraphs(unnumbered.docx).filter((each) => styleOf(each) === 'caption');
    expect(captions.map(textOf)).toEqual(['Readings at noon', 'Table 1 Readings at noon']);
    expect(captions.map(fieldCodes)).toEqual([[], ['SEQ Table \\* arabic \\s 1']]);
    expect(unnumbered.report[0]).toEqual({
      kind: 'header_column_lost',
      node: id('front'),
      block: 'f1',
      label: null,
    });
  });

  it('draws what the style cannot of a second header column on its cells: its fill, and its rule after the last of them alone', () => {
    const two = tabledOf([readings({ headerColumns: 2 })], { theme: ruledTheme });
    const wide = blocksOf(two.docx).find((each) => each.name === 'w:tbl')!;
    const grid = rowsOf(wide);
    // Word's first column is one column: the table's header columns are the writer's to draw.
    expect(stated(wide, 'w:tblPr')['w:tblLook']).toMatchObject({ 'w:firstColumn': '0' });
    const own = (row: number, column: number) => stated(grid[row]![column]!, 'w:tcPr');
    // Body rows: both header columns filled; the rule after the second.
    expect(own(4, 0)['w:shd']).toMatchObject({ 'w:fill': 'E2EFD9' });
    expect(own(4, 1)['w:shd']).toMatchObject({ 'w:fill': 'E2EFD9' });
    expect(own(4, 2)['w:shd']).toBeUndefined();
    const borders = (row: number, column: number) => {
      const found = first(kids(grid[row]![column]!, 'w:tcPr')[0]!, 'w:tcBorders');
      return found === undefined
        ? {}
        : Object.fromEntries(kids(found).map((each) => [each.name, each.attrs]));
    };
    expect(borders(4, 1)['w:right']).toMatchObject({ 'w:sz': '12', 'w:color': '00AA00' });
    expect(borders(4, 0)['w:right']).toBeUndefined();
    // Through the header rows too, where the header row's fill is the style's.
    expect(borders(1, 0)['w:right']).toBeUndefined();
    expect(own(1, 0)['w:shd']).toBeUndefined();
    // Both header columns' text bold.
    expect(pinnedBold(kids(grid[4]![1]!, 'w:p')[0]!)).toBe(true);
  });

  it('stands a table in a quotation in by the quotation, as wide as what is left of the measure', () => {
    const quoted = tabledOf([
      { type: 'blockquote', id: 'Q1', content: [readings({ style: 'table' })] },
    ]);
    const inQuote = blocksOf(quoted.docx).find((each) => each.name === 'w:tbl')!;
    const own = stated(inQuote, 'w:tblPr');
    expect(own['w:tblInd']).toEqual({ 'w:w': twips(11), 'w:type': 'dxa' });
    expect(own['w:tblW']!['w:type']).toBe('dxa');
    const columns = all(kids(inQuote, 'w:tblGrid')[0]!, 'w:gridCol').map((each) =>
      Number(each.attrs['w:w']),
    );
    expect(Math.abs(columns[0]! * 3 - Number(own['w:tblW']!['w:w']))).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------------------------------
// Word 2: figures and images.
// ---------------------------------------------------------------------------------------------------

const RED = '00000000-0000-4000-8000-00000000a551';
const BLUE = '00000000-0000-4000-8000-00000000b1e0';
const RED_HASH = 'ab'.repeat(32);
const BLUE_HASH = 'cd'.repeat(32);
/** Two images as the request resolved them: a PNG four by three, and a square JPEG. */
const IMAGES = new Map<string, PublishingAsset>([
  [
    RED,
    {
      object: `t_acme/sha256/${RED_HASH}`,
      format: 'png',
      width: 800,
      height: 600,
      alternative: { text: 'Two red squares', language: 'en-GB' },
    },
  ],
  [
    BLUE,
    {
      object: `t_acme/sha256/${BLUE_HASH}`,
      format: 'jpeg',
      width: 400,
      height: 400,
      alternative: { text: 'A blue square', language: 'en-GB' },
    },
  ],
]);
const figure = (name: string, asset: string, caption: string, over: object = {}) => ({
  type: 'figure',
  id: name,
  asset,
  imageStyle: 'figure',
  caption: [text(caption)],
  alternative: { kind: 'inherited' },
  ...over,
});
const image = (asset: string) => ({
  type: 'image',
  asset,
  imageStyle: 'inline',
  alternative: { kind: 'inherited' },
});
/** A float at the end of the measure, half the measure wide: the only float the engine has. */
const floatedTheme = themeWith((inputs) => {
  inputs.catalogues.image.styles.push({
    id: 'floated',
    name: 'Floated',
    appliesTo: ['figure'],
    fixed: { dimension: 'width', value: 0.5, unit: 'measure' },
    maximum: { value: 0.6, unit: 'textHeight' },
    placement: 'float',
    alignment: 'end',
  });
});

const EMU = 12700;
/** A drawing's extent, in EMUs. */
const extentOf = (drawing: Element) => {
  const { cx, cy } = first(drawing, 'wp:extent')!.attrs;
  return { cx: Number(cx), cy: Number(cy) };
};
/** Every drawing beneath an element, in document order. */
const drawings = (element: Element) => all(element, 'w:drawing').map((each) => kids(each)[0]!);

describe('writeDocx: figures and images (Word 2, ruling R8)', () => {
  const figured = tabledOf(
    [
      said('before'),
      figure('f1', RED, 'Shapes at rest'),
      figure('f2', RED, 'A border', { alternative: { kind: 'decorative' } }),
      figure('f3', BLUE, 'Blue on top', { imageStyle: 'floated' }),
      paragraph('p1', text('Press '), image(RED), text(' to start.')),
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [text('Keys')],
        headerRows: 1,
        headerColumns: 0,
        rows: [
          { cells: [cell('h1', 'Key'), cell('h2', 'Look')] },
          {
            cells: [
              cell('c1', 'Start'),
              { content: [paragraph('c2', text('Press '), image(BLUE))], colspan: 1, rowspan: 1 },
            ],
          },
        ],
      },
      said('after'),
    ],
    { theme: floatedTheme, assets: IMAGES },
  );
  const document = figured.docx.xml('word/document.xml');
  const { body, at } = bodyOf(figured.docx);
  const node = id('blocks');
  /** The size `assemble` gave an image against the Word page, in EMUs. */
  const sized = (key: string) => {
    const size = figured.word.images.get(key)!;
    return { cx: Math.round(size.width * EMU), cy: Math.round(size.height * EMU) };
  };
  /** The paragraph before this one. */
  const before = (paragraph: Element) => body[body.indexOf(paragraph) - 1]!;

  it("sets a figure's image in a paragraph of its own, aligned as its image style says and kept with its caption, a paragraph below it in the caption role, numbered by Word's fields (R1, M3)", () => {
    const caption = at('Figure 1.1 Shapes at rest');
    const held = before(caption);
    expect(textOf(held)).toBe('');
    expect(drawings(held).map((each) => each.name)).toEqual(['wp:inline']);
    expect(styleOf(held)).toBe('caption');
    expect(properties(held)).toContain('w:keepNext');
    expect(kids(pPr(held)!, 'w:jc')[0]?.attrs).toEqual({ 'w:val': 'center' });
    expect(styleOf(caption)).toBe('caption');
    expect(fieldCodes(caption)).toEqual(['STYLEREF 1 \\s', 'SEQ Figure \\* arabic \\s 1']);
    expect(drawings(caption)).toEqual([]);
  });

  it('draws it the size assemble gave it against the Word page, in EMUs, its picture as large as its frame', () => {
    const [drawing] = drawings(before(at('Figure 1.1 Shapes at rest')));
    const size = sized(figureImageKey(node, 'f1'));
    expect(extentOf(drawing!)).toEqual(size);
    const ext = first(first(drawing!, 'pic:spPr')!, 'a:ext')!.attrs;
    expect({ cx: Number(ext['cx']), cy: Number(ext['cy']) }).toEqual(size);
    // Four by three, the measure wide: the Word page's measure, not the PDF's.
    expect(size.cx / size.cy).toBeCloseTo(4 / 3, 2);
  });

  it("describes an image by its alternative text in docPr's descr, and flags a decorative one by Word's decorative extension with no description (M7)", () => {
    const [described, decorative] = drawings(document);
    expect(first(described!, 'wp:docPr')!.attrs['descr']).toBe('Two red squares');
    expect(all(described!, 'adec:decorative')).toEqual([]);
    const flagged = first(decorative!, 'wp:docPr')!;
    expect(flagged.attrs['descr']).toBeUndefined();
    const ext = first(flagged, 'a:ext')!;
    expect(ext.attrs['uri']).toBe('{C183D7F6-B498-43B3-948B-1728B52AA6E4}');
    expect(kids(ext)[0]).toMatchObject({
      name: 'adec:decorative',
      attrs: {
        'xmlns:adec': 'http://schemas.microsoft.com/office/drawing/2017/decorative',
        val: '1',
      },
    });
    // Its caption and number are kept, as the PDF keeps them (decision F-M).
    expect(fieldCodes(at('Figure 1.2 A border'))).toHaveLength(2);
  });

  it('numbers every drawing from 1 in the order the document holds them, each named, its picture by the same number', () => {
    const numbered = drawings(document).map((each) => {
      const docPr = first(each, 'wp:docPr')!.attrs;
      return [docPr['id'], docPr['name'], first(each, 'pic:cNvPr')!.attrs['id']];
    });
    expect(numbered).toEqual([
      ['1', 'Picture 1', '1'],
      ['2', 'Picture 2', '2'],
      ['3', 'Picture 3', '3'],
      ['4', 'Picture 4', '4'],
      ['5', 'Picture 5', '5'],
    ]);
  });

  it("floats a figure its style floats to the head of its page's text area, its image and its caption one frame the measure wide that the text stands clear of, as the PDF's band (WO-G, measured)", () => {
    const caption = at('Figure 1.3 Blue on top');
    const held = before(caption);
    const frameOf = (paragraph: Element) => kids(pPr(paragraph)!, 'w:framePr')[0]?.attrs;
    const page = sections(figured.docx).at(-1)!.properties;
    const size = first(page, 'w:pgSz')!.attrs;
    const margins = first(page, 'w:pgMar')!.attrs;
    const measure =
      Number(size['w:w']) -
      Number(margins['w:left']) -
      Number(margins['w:right']) -
      Number(margins['w:gutter']);
    // Word groups paragraphs of one frame: the image's and the caption's, so they stand together.
    expect(frameOf(held)).toEqual({
      'w:w': String(measure),
      // The engine's clearance, an em and a half of the text, less the leading Word sets above the
      // text's first line where the PDF sets none.
      'w:vSpace': twips(16.5 - 3.35),
      'w:wrap': 'notBeside',
      'w:vAnchor': 'margin',
      'w:hAnchor': 'margin',
      'w:xAlign': 'center',
      'w:yAlign': 'top',
    });
    expect(frameOf(caption)).toEqual(frameOf(held));
    // In CT_PPr's order: after the style and the keep, before everything else.
    expect(properties(held).slice(0, 3)).toEqual(['w:pStyle', 'w:keepNext', 'w:framePr']);
    // The image inline in its paragraph, aligned across the frame as its style says; the caption after.
    const [inline] = drawings(held);
    expect(inline!.name).toBe('wp:inline');
    expect(kids(pPr(held)!, 'w:jc')[0]?.attrs).toEqual({ 'w:val': 'right' });
    expect(extentOf(inline!)).toEqual(sized(figureImageKey(node, 'f3')));
    expect(first(inline!, 'wp:docPr')!.attrs['descr']).toBe('A blue square');
    expect(fieldCodes(caption)).toEqual(['STYLEREF 1 \\s', 'SEQ Figure \\* arabic \\s 1']);
    expect(textOf(before(held))).toBe('Figure 1.2 A border');
    expect(all(document, 'wp:anchor')).toEqual([]);
  });

  it("spaces a floated figure's frame as the PDF's band: the image at its head, the caption its style's space before below it, and nothing after it but the clearance", () => {
    const caption = at('Figure 1.3 Blue on top');
    // The default caption has no space before, which the image keeps: the leading a block figure's
    // image takes above it is the flow's, which the frame stands out of.
    expect(spacing(before(caption))).toEqual({ 'w:after': '0' });
    expect(spacing(caption)).toEqual({ 'w:after': '0' });
  });

  it("sets an image in a line as a wp:inline in a run of its own, sized by assemble for the Word page, in a paragraph's text and in a table's cell", () => {
    const line = at('Press  to start.');
    const [inline] = drawings(line);
    expect(inline!.name).toBe('wp:inline');
    expect(extentOf(inline!)).toEqual(
      sized(inlineImageKey(node, { kind: 'paragraph', block: 'p1' }, 1)),
    );
    const shown = kids(line, 'w:r').map((run) =>
      first(run, 'w:drawing') === undefined ? textOf(run) : 'image',
    );
    expect(shown).toEqual(['Press ', 'image', ' to start.']);
    const table = blocksOf(figured.docx).find((each) => each.name === 'w:tbl')!;
    const [inCell] = drawings(table);
    expect(inCell!.name).toBe('wp:inline');
    expect(extentOf(inCell!)).toEqual(
      sized(inlineImageKey(node, { kind: 'paragraph', block: 'c2' }, 1)),
    );
    expect(first(inCell!, 'wp:docPr')!.attrs['descr']).toBe('A blue square');
  });

  it('writes each image once, a media part named by its hash, related from the document, and types only the formats it holds', () => {
    const media = Object.keys(figured.docx.files).filter((name) => name.startsWith('word/media/'));
    expect(media).toEqual([`word/media/${RED_HASH}.png`, `word/media/${BLUE_HASH}.jpg`]);
    expect(figured.docx.files[`word/media/${RED_HASH}.png`]).toEqual(
      figured.images.get(`assets/${RED_HASH}.png`),
    );
    const related = relationships(figured.docx, 'word/_rels/document.xml.rels');
    const images = [...related.values()].filter((each) => each['Type']!.endsWith('/image'));
    expect(images.map((each) => each['Target'])).toEqual([
      `media/${RED_HASH}.png`,
      `media/${BLUE_HASH}.jpg`,
    ]);
    // Every picture drawn from its own image's part, however often that image is placed.
    const targets = drawings(document).map(
      (each) => related.get(first(each, 'a:blip')!.attrs['r:embed']!)!['Target'],
    );
    expect(targets).toEqual([
      `media/${RED_HASH}.png`,
      `media/${RED_HASH}.png`,
      `media/${BLUE_HASH}.jpg`,
      `media/${RED_HASH}.png`,
      `media/${BLUE_HASH}.jpg`,
    ]);
    const defaults = (docx: Package) =>
      Object.fromEntries(
        all(docx.xml('[Content_Types].xml'), 'Default').map((each) => [
          each.attrs['Extension'],
          each.attrs['ContentType'],
        ]),
      );
    expect(defaults(figured.docx)).toMatchObject({ png: 'image/png', jpg: 'image/jpeg' });
    const redAlone = tabledOf([figure('f1', RED, 'Shapes')], { assets: IMAGES });
    expect(Object.keys(defaults(redAlone.docx))).toEqual(['rels', 'xml', 'odttf', 'png']);
    expect(Object.keys(defaults(plain.docx))).toEqual(['rels', 'xml', 'odttf']);
    expect(Object.keys(plain.docx.files).filter((name) => name.startsWith('word/media/'))).toEqual(
      [],
    );
  });

  it("R6 spaces a figure as the PDF does: the caption style's leading above the image, where Word sets none above a line an image fills, and the caption its style's space before alone, as Word sets the leading above its text itself (measured)", () => {
    // The default caption is the body's spaces - none before, 2.75 after - and a 14.35 line at 11pt.
    const caption = at('Figure 1.1 Shapes at rest');
    expect(spacing(before(caption))).toEqual({ 'w:before': twips(3.35), 'w:after': '0' });
    expect(spacing(caption)?.['w:before']).toBeUndefined();
  });

  it('declares the drawing namespaces on the document', () => {
    expect(document.attrs).toMatchObject({
      'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'xmlns:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Word 2: the lists of figures and of tables after the contents.
// ---------------------------------------------------------------------------------------------------

describe('writeDocx: the lists after the contents (Word 2, M9)', () => {
  /** Two figures and a table, under the default layout, which lists both after the contents. */
  const listed = writtenOf(
    [
      figure('f1', RED, 'Shapes at rest'),
      readings({ style: 'table' }),
      figure('f2', BLUE, 'A blue one', { alternative: { kind: 'decorative' } }),
    ],
    { assets: IMAGES },
  );
  const [, front, opened] = sections(listed.docx);
  const at = (text: string) => front!.paragraphs.find((each) => textOf(each) === text)!;
  const BS = String.fromCharCode(92);

  it("stands each list after the contents, in the contents' section, each on a page of its own under its title in the list role", () => {
    const shown = front!.paragraphs.map(textOf);
    expect(shown.slice(shown.indexOf('Figures'))).toEqual([
      'Figures',
      'Figure 1.1 Shapes at rest',
      'Figure 1.2 A blue one',
      'Tables',
      'Table 1.1 Readings at noon',
    ]);
    for (const title of ['Figures', 'Tables']) {
      expect(styleOf(at(title))).toBe('contents-heading');
      expect(properties(at(title))).toContain('w:pageBreakBefore');
    }
    // The body starts its own section, after them.
    expect(textOf(opened!.paragraphs[0]!)).toBe('Blocks');
  });

  it("is a TOC field over its sequence's captions, the SEQ name captionField writes, prefilled with each caption paragraph's words and no page (M9)", () => {
    const section: Element = { name: 'section', attrs: {}, children: front!.paragraphs };
    expect(fieldCodes(section)).toEqual([
      `TOC ${BS}o "1-3" ${BS}h ${BS}z ${BS}u`,
      `TOC ${BS}h ${BS}z ${BS}c "Figure"`,
      `TOC ${BS}h ${BS}z ${BS}c "Table"`,
    ]);
    // Begun in the first entry and ended in the last, as the contents is.
    const ends = (paragraph: Element) =>
      all(paragraph, 'w:fldChar').map((each) => each.attrs['w:fldCharType']);
    expect(ends(at('Figure 1.1 Shapes at rest')).slice(0, 2)).toEqual(['begin', 'separate']);
    expect(ends(at('Figure 1.2 A blue one')).at(-1)).toBe('end');
    for (const entry of ['Figure 1.1 Shapes at rest', 'Figure 1.2 A blue one']) {
      expect(styleOf(at(entry))).toBe('TableofFigures');
    }
  });

  it("names the entries' style as Word names the one it rebuilds a list in, based on the list entry role's", () => {
    const style = all(listed.docx.xml('word/styles.xml'), 'w:style').find(
      (each) => each.attrs['w:styleId'] === 'TableofFigures',
    )!;
    expect(first(style, 'w:name')!.attrs['w:val']).toBe('table of figures');
    expect(first(style, 'w:basedOn')!.attrs['w:val']).toBe('contents-entry');
    // And none where there is no list.
    expect(
      all(plain.docx.xml('word/styles.xml'), 'w:style').some(
        (each) => each.attrs['w:styleId'] === 'TableofFigures',
      ),
    ).toBe(false);
  });

  it('stands the lists in a front section of their own where the layout sets no contents, numbered as front matter', () => {
    const alone = writtenOf([figure('f1', RED, 'Shapes at rest')], {
      assets: IMAGES,
      layout: layoutWith((layout) => {
        layout.matter.contents = null;
      }),
    });
    const [, lists, body] = sections(alone.docx);
    expect(lists!.paragraphs.map(textOf)).toEqual(['Figures', 'Figure 1.1 Shapes at rest']);
    // The first thing on the section's page: no break before it.
    expect(properties(lists!.paragraphs[0]!)).not.toContain('w:pageBreakBefore');
    expect(first(lists!.properties, 'w:pgNumType')!.attrs['w:fmt']).toBe('lowerRoman');
    expect(textOf(body!.paragraphs[0]!)).toBe('Blocks');
  });
});
