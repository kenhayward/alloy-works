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
import { mathsTree } from '../publishing/maths.js';
import type { PublishedDocument } from '../publishing/published.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import type { Typeface } from '../theme/schema.js';
import { defaultInputs, resolved, type ThemeInputs } from '../theme/theme.fixture.js';

import { syntheticFace } from './face.fixture.js';
import { fontKey, obfuscateFont } from './fonts.js';
import { omml } from './omml.js';
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
 * 0.35 - and for a space, a quarter, which a note's number is set apart from its text by; and none of
 * its own for anything else, which takes the missing glyph's half an em.
 */
const ADVANCES = new Map<number, number>([
  [0x20, 512],
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

  it('is the Word writer at word/4', () => {
    expect(WORD_WRITER_VERSION).toBe('word/4');
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

  it("CNT-085 sets each paragraph in its resolved style, each mark by its character style and what Word's reading would lose pinned", () => {
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

  it("PUB-069 asks Word to hyphenate where the style does, and gives each passage its own language to hyphenate by, never the document's alone", () => {
    const hyphenating = written({
      theme: themeWith((inputs) => {
        inputs.catalogues.paragraph.base.hyphenate = true;
      }),
    }).docx;
    // Word hyphenates automatically, and the running text's style does not suppress it.
    expect(all(hyphenating.xml('word/settings.xml'), 'w:autoHyphenation')).toHaveLength(1);
    const body = all(hyphenating.xml('word/styles.xml'), 'w:style').find(
      (each) => each.attrs['w:styleId'] === 'body',
    )!;
    expect(first(first(body, 'w:pPr')!, 'w:suppressAutoHyphens')!.attrs['w:val']).toBe('0');
    // What Word hyphenates a passage by is the language its run carries: a marked French phrase,
    // a German component, each its own, in a document in English.
    const french = paragraphSaying(
      hyphenating,
      'Set strong, both, under, H2O, x2, printer.cfg, "measure twice" and la mesure.',
    );
    expect(run(french, 'la mesure')['w:lang']).toEqual({ 'w:val': 'fr-FR' });
    const german = paragraphSaying(hyphenating, 'Grüße aus Berlin.');
    expect(run(german, 'Grüße aus Berlin.')['w:lang']).toEqual({ 'w:val': 'de-DE' });
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

  it('reports no substitution for a face the text is not set in: the maths face, where no equation is set', () => {
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

  it('drops one line feed that ends a block, as the engine does, where a block of a line feed alone is one empty line', () => {
    // Measured, the pinned Typst: raw "x\n" as tall as "x", "\n" one line, "\n\n" two.
    const ended = writtenOf([
      said('before'),
      code('E1', 'ends\n'),
      said('between'),
      code('E2', '\n'),
      said('then'),
      code('E3', 'two\n\n'),
      said('after'),
    ]);
    const { body, at } = bodyOf(ended.docx);
    const between = (from: string, to: string) =>
      body.slice(body.indexOf(at(from)) + 1, body.indexOf(at(to))).map(textOf);
    expect(between('before', 'between')).toEqual(['ends']);
    expect(between('between', 'then')).toEqual(['']);
    expect(between('then', 'after')).toEqual(['two', '']);
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

  it("sets a right-to-left table's caption label - its word, its fields' results and its separator - in the layout's words, left to right, as the PDF prints it, and its own words right to left; its entry in the list of tables likewise", () => {
    // Measured in Word for Word 2's final review (M2): with the label's runs right to left in the
    // component's language, Word laid each field's result out as an island of its own and printed
    // "1.1 Table" after the caption's words, where the PDF prints "Table 1.1" before them.
    const hebrew = written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: SEFER,
        language: 'he-IL',
        direction: 'rtl',
        nodes: [reference('blocks', 9)],
      }),
      occurrences: new Map([
        [
          id('blocks'),
          component(SEFER, [readings({ style: 'table', caption: [text(SEFER)] })], {
            language: 'he-IL',
            direction: 'rtl',
          }),
        ],
      ]),
    });
    // The default layout's words are English.
    expect(hebrew.document.words.language).toEqual({ lang: 'en', region: null });
    const words = { 'w:val': 'en' };
    const right = { 'w:bidi': 'he-IL' };
    const shown = (paragraph: Element) =>
      all(paragraph, 'w:r')
        .filter((run) => kids(run, 'w:t').length > 0)
        .map((run) => [textOf(run), all(run, 'w:rtl').length > 0, first(run, 'w:lang')?.attrs]);
    const blocks = blocksOf(hebrew.docx);
    const table = blocks.find((each) => each.name === 'w:tbl')!;
    expect(shown(blocks[blocks.indexOf(table) - 1]!)).toEqual([
      ['Table ', false, words],
      ['1', false, words],
      ['.', false, words],
      ['1', false, words],
      [' ', true, right],
      [SEFER, true, right],
    ]);
    const [, front] = sections(hebrew.docx);
    const entry = front!.paragraphs.find((each) => textOf(each) === `Table 1.1 ${SEFER}`)!;
    expect(shown(entry)).toEqual([
      ['Table 1.1', false, words],
      [` ${SEFER}`, true, right],
    ]);
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
    // A floated figure's text box before the image it holds.
    const numbered = drawings(document).map((each) => {
      const docPr = kids(each, 'wp:docPr')[0]!.attrs;
      const box = first(each, 'wps:wsp') !== undefined;
      return [docPr['id'], docPr['name'], box ? null : first(each, 'pic:cNvPr')!.attrs['id']];
    });
    expect(numbered).toEqual([
      ['1', 'Picture 1', '1'],
      ['2', 'Picture 2', '2'],
      ['3', 'Text Box 3', null],
      ['4', 'Picture 4', '4'],
      ['5', 'Picture 5', '5'],
      ['6', 'Picture 6', '6'],
    ]);
  });

  it("floats a figure its style floats to the head of its page's text area, its image and its caption in one text box the measure wide, which Word keeps clear of every other float and the text stands clear of, as the PDF's band (WO-G, measured)", () => {
    // Anchored in an empty paragraph of its own, in the caption role, a tenth of a point high, where the
    // figure stands in the flow.
    const anchored = body.find((each) => all(each, 'wp:anchor').length > 0)!;
    expect(textOf(before(anchored))).toBe('Figure 1.2 A border');
    expect(styleOf(anchored)).toBe('caption');
    expect(kids(anchored, 'w:r')).toHaveLength(1);
    const [anchor] = all(anchored, 'wp:anchor');
    const page = sections(figured.docx).at(-1)!.properties;
    const size = first(page, 'w:pgSz')!.attrs;
    const margins = first(page, 'w:pgMar')!.attrs;
    const measure =
      Number(size['w:w']) -
      Number(margins['w:left']) -
      Number(margins['w:right']) -
      Number(margins['w:gutter']);
    // Word moves a float that may not overlap another off it: two on one page stand one above the
    // other, where two frames had stood on each other (measured).
    expect(anchor!.attrs).toMatchObject({
      distT: '0',
      distB: '0',
      distL: '0',
      distR: '0',
      simplePos: '0',
      behindDoc: '0',
      locked: '0',
      layoutInCell: '1',
      allowOverlap: '0',
    });
    expect(kids(anchor!).map((each) => each.name)).toEqual([
      'wp:simplePos',
      'wp:positionH',
      'wp:positionV',
      'wp:extent',
      'wp:effectExtent',
      'wp:wrapTopAndBottom',
      'wp:docPr',
      'wp:cNvGraphicFramePr',
      'a:graphic',
    ]);
    const placed = (name: string) => {
      const position = first(anchor!, name)!;
      return [position.attrs['relativeFrom'], textOf(first(position, 'wp:align')!)];
    };
    expect(placed('wp:positionH')).toEqual(['margin', '']);
    expect(first(first(anchor!, 'wp:positionH')!, 'wp:align')!.children).toEqual(['center']);
    expect(first(first(anchor!, 'wp:positionV')!, 'wp:align')!.children).toEqual(['top']);
    expect(first(anchor!, 'wp:positionV')!.attrs['relativeFrom']).toBe('margin');
    expect(extentOf(anchor!).cx).toBe(Math.round((measure / 20) * EMU));
    const shape = first(anchor!, 'wps:wsp')!;
    expect(first(shape, 'wps:cNvSpPr')!.attrs['txBox']).toBe('1');
    // Word fits the box to what it holds; the text below it clear by the engine's clearance, an em and
    // a half of the text, less the leading Word sets above the text's first line where the PDF sets
    // none, inside the box at its foot, so that a box below it stands clear of it too.
    const bodyPr = first(shape, 'wps:bodyPr')!;
    expect(bodyPr.attrs).toMatchObject({
      lIns: '0',
      tIns: '0',
      rIns: '0',
      bIns: String(Math.round((16.5 - 3.35) * EMU)),
    });
    expect(kids(bodyPr).map((each) => each.name)).toEqual(['a:spAutoFit']);
    // The image in a paragraph of its own, aligned across the box as its style says; the caption after.
    const inside = kids(first(shape, 'w:txbxContent')!, 'w:p');
    expect(inside).toHaveLength(2);
    const [held, caption] = inside as [Element, Element];
    const [inline] = drawings(held);
    expect(inline!.name).toBe('wp:inline');
    expect(styleOf(held)).toBe('caption');
    expect(kids(pPr(held)!, 'w:jc')[0]?.attrs).toEqual({ 'w:val': 'right' });
    expect(extentOf(inline!)).toEqual(sized(figureImageKey(node, 'f3')));
    expect(first(inline!, 'wp:docPr')!.attrs['descr']).toBe('A blue square');
    expect(styleOf(caption)).toBe('caption');
    expect(textOf(caption)).toBe('Figure 1.3 Blue on top');
    expect(fieldCodes(caption)).toEqual(['STYLEREF 1 \\s', 'SEQ Figure \\* arabic \\s 1']);
    expect(all(document, 'w:framePr')).toEqual([]);
  });

  it('PUB-031 anchors a floated figure where the document puts it, between the blocks either side of it, wherever Word draws it', () => {
    const anchored = body.find((each) => all(each, 'wp:anchor').length > 0)!;
    // The box holds the figure - its image and its caption - and is drawn against the page...
    const box = first(anchored, 'w:txbxContent')!;
    expect(textOf(kids(box, 'w:p')[1]!)).toBe('Figure 1.3 Blue on top');
    expect(first(first(anchored, 'wp:anchor')!, 'wp:positionV')!.attrs['relativeFrom']).not.toBe(
      'paragraph',
    );
    // ...but it stands in the document, which is what Word reads it in, where the figure stands:
    // after the figure before it and before the paragraph after it.
    expect(textOf(before(anchored))).toBe('Figure 1.2 A border');
    expect(textOf(body[body.indexOf(anchored) + 1]!)).toBe('Press  to start.');
  });

  it("spaces a floated figure's box as the PDF's band: the image at its head, the caption its style's space before below it, and its anchor taking no room in the flow", () => {
    const anchored = body.find((each) => all(each, 'wp:anchor').length > 0)!;
    const [held, caption] = kids(first(anchored, 'w:txbxContent')!, 'w:p') as [Element, Element];
    // The default caption has no space before, which the image keeps: the leading a block figure's
    // image takes above it is the flow's, which the box stands out of.
    expect(spacing(held)).toEqual({ 'w:after': '0' });
    expect(spacing(caption)).toEqual({ 'w:after': '0' });
    expect(spacing(anchored)).toEqual({ 'w:after': '0', 'w:line': '2', 'w:lineRule': 'exact' });
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
    const pictures = drawings(document).filter((each) => each.name === 'wp:inline');
    const targets = pictures.map(
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

  it('writes a list without its links where one of its figures floats, since Word lists a caption in a text box with no page under them (measured); the other lists keep them', () => {
    const floated = writtenOf(
      [
        figure('f1', RED, 'Shapes at rest'),
        readings({ style: 'table' }),
        figure('f3', BLUE, 'Blue on top', { imageStyle: 'floated' }),
      ],
      { assets: IMAGES, theme: floatedTheme },
    );
    const [, lists] = sections(floated.docx);
    const section: Element = { name: 'section', attrs: {}, children: lists!.paragraphs };
    expect(fieldCodes(section)).toEqual([
      `TOC ${BS}o "1-3" ${BS}h ${BS}z ${BS}u`,
      `TOC ${BS}z ${BS}c "Figure"`,
      `TOC ${BS}h ${BS}z ${BS}c "Table"`,
    ]);
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

describe('writeDocx: footnotes (Word 3, ruling R2; M5)', () => {
  const note = (name: string, ...paragraphs: unknown[]) => ({
    type: 'footnote',
    id: name,
    anchor: { kind: 'span' },
    content: paragraphs,
  });
  const noteCell = (name: string, ...content: unknown[]) => ({
    content: [paragraph(name, ...content)],
    colspan: 1,
    rowspan: 1,
  });
  /** Notes in running text, in a table's cell and in its header row, a German one and a Hebrew one. */
  const NOTED = component('Notes', [
    paragraph('p1', text('A claim'), note('n1', paragraph('n1a', text('The first note.')))),
    paragraph(
      'p2',
      text('Linked', link),
      note(
        'n2',
        paragraph('n2a', text('See '), text('the report', { ...link, id: 'k20' }), text('.')),
        paragraph(
          'n2b',
          text('Its '),
          text('second', { type: 'emphasis', id: 'e1' }),
          text(' paragraph.'),
        ),
      ),
      text(' and on'),
    ),
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 1,
      headerColumns: 0,
      rows: [
        { cells: [noteCell('h1', text('Site'), note('n3', paragraph('n3a', text('Headed.'))))] },
        { cells: [noteCell('c1', text('York'), note('n4', paragraph('n4a', text('In a cell.'))))] },
      ],
    },
  ]);
  const GERMAN_NOTE = component(
    'Grüße',
    [paragraph('g1', text('Grüße'), note('n5', paragraph('n5a', text('Eine Anmerkung.'))))],
    { language: 'de-DE' },
  );
  const HEBREW_NOTE = component(
    SEFER,
    [paragraph('r1', text(SHALOM), note('n6', paragraph('n6a', text(SEFER))))],
    { language: 'he-IL', direction: 'rtl' },
  );
  const noted = written({
    // A table style whose header is bold, as template 13 sets its text and its mark.
    theme: themeWith((inputs) => {
      inputs.catalogues.table.styles[0]!.headerRow.bold = true;
    }),
    layout: layoutWith((layout) => {
      layout.matter.lists = [];
    }),
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        reference('preface', 1, { matter: 'front' }),
        reference('noted', 2),
        reference('german', 3),
        reference('hebrew', 4),
        reference('values', 5, { matter: 'appendix' }),
      ],
    }),
    occurrences: new Map([
      [id('preface'), PREFACE],
      [id('noted'), NOTED],
      [id('german'), GERMAN_NOTE],
      [id('hebrew'), HEBREW_NOTE],
      [id('values'), VALUES],
    ]),
  });
  const body = () => first(noted.docx.xml('word/document.xml'), 'w:body')!;
  const notes = () => kids(noted.docx.xml('word/footnotes.xml'), 'w:footnote');
  /** The paragraphs of the note at this place in the part, its separators counted. */
  const noteAt = (at: number) => kids(notes()[at]!, 'w:p');
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

  it('writes the footnotes part, typed and related from the document, with the separator and continuation separator Word requires and every note after them, numbered in document order', () => {
    const types = noted.docx.xml('[Content_Types].xml');
    expect(
      all(types, 'Override').find((each) => each.attrs['PartName'] === '/word/footnotes.xml')
        ?.attrs['ContentType'],
    ).toBe(`${WML}footnotes+xml`);
    const related = [...relationships(noted.docx, 'word/_rels/document.xml.rels').values()];
    expect(related.filter((each) => each['Type'] === `${REL}footnotes`)).toEqual([
      expect.objectContaining({ Target: 'footnotes.xml' }),
    ]);
    expect(notes().map((each) => [each.attrs['w:type'], each.attrs['w:id']])).toEqual([
      ['separator', '-1'],
      ['continuationSeparator', '0'],
      ...['1', '2', '3', '4', '5', '6'].map((each) => [undefined, each]),
    ]);
    expect(all(notes()[0]!, 'w:separator')).toHaveLength(1);
    expect(all(notes()[1]!, 'w:continuationSeparator')).toHaveLength(1);
    // Settings name the two, after the fields' update and before the compatibility settings.
    const settings = noted.docx.xml('word/settings.xml');
    const names = kids(settings).map((each) => each.name);
    expect(names.indexOf('w:footnotePr')).toBe(names.indexOf('w:updateFields') + 1);
    expect(
      kids(first(settings, 'w:footnotePr')!).map((each) => [each.name, each.attrs['w:id']]),
    ).toEqual([
      ['w:footnote', '-1'],
      ['w:footnote', '0'],
    ]);
  });

  it("PUB-025 writes every footnote as a real Word footnote, numbered by Word: a reference run in the footnote reference style where it stands - in text, in a cell and in a header row - and Word's own number at the head of its note, never a number of the PDF's", () => {
    expect(all(body(), 'w:footnoteReference').map((each) => each.attrs['w:id'])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    const runs = all(body(), 'w:r').filter((run) => kids(run, 'w:footnoteReference').length > 0);
    for (const run of runs) {
      expect(first(run, 'w:rStyle')!.attrs['w:val']).toBe('FootnoteReference');
    }
    // Word's number, never the numbering table's label: no mark of its own follows a reference, and
    // each note opens with Word's number of it.
    for (const run of runs) expect(textOf(run)).toBe('');
    expect(strFromU8(noted.docx.files['word/document.xml']!)).not.toContain('customMarkFollows');
    for (const each of notes().slice(2)) {
      expect(kids(kids(each, 'w:p')[0]!, 'w:r')[0]!.children).toContainEqual(
        expect.objectContaining({ name: 'w:footnoteRef' }),
      );
    }
    // A header row sets its text bold, as template 13 does, and its mark with it.
    expect(first(runs[2]!, 'w:b')?.attrs['w:val']).toBe('1');
    expect(first(runs[3]!, 'w:b')).toBeUndefined();
    // The link before the mark is closed first: the mark is no part of it.
    const linked = paragraphSaying(noted.docx, 'Linked and on');
    expect(all(linked, 'w:hyperlink').map(textOf)).toEqual(['Linked']);
    expect(all(first(linked, 'w:hyperlink')!, 'w:footnoteReference')).toEqual([]);
    // The one in the header row and the one in the body row are in the table's cells.
    const table = first(body(), 'w:tbl')!;
    expect(all(table, 'w:footnoteReference').map((each) => each.attrs['w:id'])).toEqual(['3', '4']);
  });

  it('defines the footnote reference style as Word names its own, superscript as the PDF sets the mark', () => {
    const styles = noted.docx.xml('word/styles.xml');
    const style = all(styles, 'w:style').find(
      (each) => each.attrs['w:styleId'] === 'FootnoteReference',
    )!;
    expect(style.attrs['w:type']).toBe('character');
    expect(first(style, 'w:name')!.attrs['w:val']).toBe('footnote reference');
    expect(first(style, 'w:vertAlign')!.attrs['w:val']).toBe('superscript');
    // Written only where a footnote is.
    expect(strFromU8(plain.docx.files['word/styles.xml']!)).not.toContain('FootnoteReference');
  });

  it("opens each note with its number in the same style, an em in and a twentieth of an em from its text, as the PDF sets it, and sets its paragraphs in the footnote place's style", () => {
    const [only] = noteAt(2);
    expect(styleOf(only!)).toBe('footnote');
    const [number, gap] = kids(only!, 'w:r');
    expect(kids(number!).map((each) => each.name)).toEqual(['w:rPr', 'w:footnoteRef']);
    expect(kids(kids(number!, 'w:rPr')[0]!).map((each) => each.name)).toEqual(['w:rStyle']);
    expect(first(number!, 'w:rStyle')!.attrs['w:val']).toBe('FootnoteReference');
    // Then a space, scaled to 0.05em of the footnote place's 9.35pt: the engine's gap after the number,
    // a fifth of the face's quarter-em space at Word's 9.5pt.
    expect(textOf(gap!)).toBe(' ');
    expect(first(gap!, 'w:w')!.attrs['w:val']).toBe('20');
    // Its first line an em in, of 9.35pt; its later paragraphs where the style stands them.
    expect(first(pPr(only!)!, 'w:ind')!.attrs['w:firstLine']).toBe('187');
    expect(textOf(only!)).toBe(' The first note.');
    const [opening, second] = noteAt(3);
    expect(first(pPr(opening!)!, 'w:ind')!.attrs['w:firstLine']).toBe('187');
    expect(first(pPr(second!)!, 'w:ind')).toBeUndefined();
    expect(all(second!, 'w:footnoteRef')).toEqual([]);
    expect(styleOf(second!)).toBe('footnote');
  });

  it("writes a note's runs as the text's: its marks by their character styles and its links related from the footnotes part", () => {
    const [opening, second] = noteAt(3);
    expect(textOf(second!)).toBe('Its second paragraph.');
    const emphasised = all(second!, 'w:r').find((run) => textOf(run) === 'second')!;
    expect(first(emphasised, 'w:rStyle')!.attrs['w:val']).toBe('mark-emphasis');
    const [hyperlink] = all(opening!, 'w:hyperlink');
    expect(textOf(hyperlink!)).toBe('the report');
    expect(
      relationships(noted.docx, 'word/_rels/footnotes.xml.rels').get(hyperlink!.attrs['r:id']!),
    ).toMatchObject({ Type: `${REL}hyperlink`, Target: REPORT, TargetMode: 'External' });
  });

  it("stands the notes' separators at the start of a right-to-left document's lines, its right, where the PDF draws its line, and at the left in a left-to-right one, whatever direction a note is in (measured, M2 of Word 3's final review)", () => {
    const separators = (written: Written) =>
      kids(written.docx.xml('word/footnotes.xml'), 'w:footnote')
        .slice(0, 2)
        .map((each) => first(kids(each, 'w:p')[0]!, 'w:bidi') !== undefined);
    // The Hebrew note stands in a left-to-right document.
    expect(separators(noted)).toEqual([false, false]);
    const hebrew = written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: SEFER,
        language: 'he-IL',
        direction: 'rtl',
        nodes: [reference('hebrew', 4)],
      }),
      occurrences: new Map([[id('hebrew'), HEBREW_NOTE]]),
      layout: layoutWith((layout) => {
        layout.matter.lists = [];
      }),
    });
    expect(separators(hebrew)).toEqual([true, true]);
  });

  it('sets a note in the language and direction where its mark stands, as the PDF does', () => {
    const [german] = noteAt(6);
    const words = all(german!, 'w:r').find((run) => textOf(run) === 'Eine Anmerkung.')!;
    expect(first(words, 'w:lang')!.attrs).toEqual({ 'w:val': 'de-DE' });
    const [hebrew] = noteAt(7);
    expect(properties(hebrew!)).toContain('w:bidi');
    const own = all(hebrew!, 'w:r').find((run) => textOf(run) === SEFER)!;
    expect(first(own, 'w:rtl')).toBeDefined();
    expect(first(own, 'w:lang')!.attrs).toEqual({ 'w:bidi': 'he-IL' });
  });

  it("numbers each matter's section's footnotes by Word, in its rule's format, from 1 again at each (footnoteProperties)", () => {
    const numbered = sections(noted.docx).map((each) => {
      const stated = first(each.properties, 'w:footnotePr');
      return stated === undefined
        ? null
        : kids(stated).map((child) => [child.name, child.attrs['w:val']]);
    });
    const restarted = [
      ['w:numFmt', 'decimal'],
      ['w:numRestart', 'eachSect'],
    ];
    // The cover and the contents hold no footnote.
    expect(numbered).toEqual([null, null, restarted, restarted, restarted]);
    // After the header and footer references, where CT_SectPr puts it.
    const [, , front] = sections(noted.docx);
    const names = kids(front!.properties).map((each) => each.name);
    expect(names.indexOf('w:footnotePr')).toBe(names.lastIndexOf('w:footerReference') + 1);
  });

  it('writes nothing of footnotes where the document has none', () => {
    expect(Object.keys(plain.docx.files)).not.toContain('word/footnotes.xml');
    expect(strFromU8(plain.docx.files['word/settings.xml']!)).not.toContain('footnotePr');
    expect(strFromU8(plain.docx.files['word/document.xml']!)).not.toContain('footnotePr');
  });

  it('spaces two notes apart by both their spaces, as the PDF sets two notes: nothing stated under the default theme, whose footnote style adds them, and M1 d8 where the style asks for contextual spacing', () => {
    for (const each of notes()
      .slice(2)
      .flatMap((one) => kids(one, 'w:p'))) {
      expect(properties(each)).not.toContain('w:spacing');
      expect(properties(each)).not.toContain('w:contextualSpacing');
    }
    const contextual = themeWith((inputs) => {
      const footnote = inputs.catalogues.paragraph.styles.find((each) => each.id === 'footnote')!;
      footnote.properties = { ...footnote.properties, spaceBefore: 1, contextualSpacing: true };
    });
    const spaced = writtenOf(
      [
        paragraph(
          'p1',
          text('One'),
          note('n1', paragraph('n1a', text('A.')), paragraph('n1b', text('B.'))),
          text('Two'),
          note('n2', paragraph('n2a', text('C.')), paragraph('n2b', text('D.'))),
        ),
      ],
      { theme: contextual },
    );
    const said = kids(spaced.docx.xml('word/footnotes.xml'), 'w:footnote')
      .flatMap((one) => kids(one, 'w:p'))
      .slice(2)
      .map((each) => ({
        contextual: first(pPr(each)!, 'w:contextualSpacing')?.attrs['w:val'],
        spacing: first(pPr(each)!, 'w:spacing')?.attrs,
      }));
    // Within a note its style's contextual spacing stands; between two, M1's d8: off on the pair, and
    // the space it drops within each note dropped by hand.
    expect(said).toEqual([
      { contextual: undefined, spacing: undefined },
      { contextual: '0', spacing: { 'w:before': '0' } },
      { contextual: '0', spacing: { 'w:after': '0' } },
      { contextual: undefined, spacing: undefined },
    ]);
  });
});

describe('writeDocx: bookmarks and cross-references (Word 3, rulings R3 and R4; M4)', () => {
  const xref = (name: string, target: object, display = 'number') => ({
    type: 'crossReference',
    id: name,
    target,
    display,
  });
  const toNode = (name: string) => ({ kind: 'node', node: id(name) });
  const toBlock = (block: string) => ({ kind: 'block', block });
  const note = (name: string, ...paragraphs: unknown[]) => ({
    type: 'footnote',
    id: name,
    anchor: { kind: 'span' },
    content: paragraphs,
  });
  const cellOf = (name: string, ...content: unknown[]) => ({
    content: [paragraph(name, ...content)],
    colspan: 1,
    rowspan: 1,
  });
  const EVERY = ['number', 'title', 'numberAndTitle', 'relative', 'page'];
  /** A reference to `target` in each of `forms`, a slash between each two. */
  const inEach = (name: string, target: object, forms: readonly string[] = EVERY) =>
    forms.flatMap((display, at) => [
      ...(at === 0 ? [] : [text(' / ')]),
      xref(`${name}${at}`, target, display),
    ]);
  /**
   * References of every form to every kind of target: a section, a table, a figure, a footnote and a
   * paragraph; a section three deep in the body, one three deep in an appendix and a component in the
   * front matter; and references in a table's header row, its caption and its note, a footnote's text,
   * a section's title and a German passage.
   */
  const CITING = component('Citing', [
    paragraph('p1', text('Methods: '), ...inEach('a', toNode('methods'))),
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 1,
      headerColumns: 0,
      rows: [
        { cells: [cellOf('h1', text('Site '), xref('h0', toBlock('p1'), 'relative'))] },
        { cells: [cellOf('c1', text('York'))] },
      ],
    },
    figure('f1', RED, 'Shapes'),
    paragraph('p2', text('Table: '), ...inEach('b', toBlock('t1'))),
    paragraph('p3', text('Figure: '), ...inEach('q', toBlock('f1'))),
    paragraph(
      'p4',
      text('Noted'),
      note('n1', paragraph('n1a', text('Back on '), xref('c0', toBlock('p1'), 'page'))),
    ),
    paragraph(
      'p5',
      ...inEach('d', toBlock('n1'), ['number', 'relative', 'page']),
      text(' / '),
      ...inEach('e', toBlock('p1'), ['relative', 'page']),
      text(' / '),
      xref('g0', toNode('deeper')),
      text(' / '),
      xref('g1', toNode('annexc')),
      text(' / '),
      xref('g2', toNode('front')),
    ),
    {
      type: 'table',
      id: 't2',
      style: 'table',
      caption: [text('Cited in '), xref('k0', toNode('methods'))],
      headerRows: 0,
      headerColumns: 0,
      note: [text('See '), xref('k1', toBlock('t1'), 'relative')],
      rows: [{ cells: [cellOf('c2', text('x'))] }],
    },
  ]);
  const GERMAN_CITING = component(
    'Verweise',
    [paragraph('g1', text('Siehe '), xref('r0', toNode('methods'), 'relative'))],
    { language: 'de-DE' },
  );
  const CITING_OUTLINE = parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      reference('front', 1, { matter: 'front' }),
      section('methods', 'Methods', [
        reference('citing', 2),
        section('deep', 'Deep', [section('deeper', 'Deeper')]),
      ]),
      {
        ...section('results', 'Results', [reference('german', 3)]),
        title: [text('After '), xref('t0', toNode('methods')), text(' ended')],
      },
      section('annex', 'Annex', [section('annexb', 'Annex B', [section('annexc', 'Annex C')])], {
        matter: 'appendix',
      }),
    ],
  });
  const citing = (): Written =>
    written({
      outline: CITING_OUTLINE,
      occurrences: new Map([
        [id('front'), PREFACE],
        [id('citing'), CITING],
        [id('german'), GERMAN_CITING],
      ]),
      assets: IMAGES,
    });
  const cited = citing();
  const document = () => cited.docx.xml('word/document.xml');
  const footnotes = () => cited.docx.xml('word/footnotes.xml');
  /** The last body paragraph printing exactly this: a caption's, after its list's entry. */
  const saying = (words: string): Element => {
    const found = paragraphs(cited.docx).filter((each) => textOf(each) === words);
    if (found.length === 0) throw new Error(`no paragraph says ${JSON.stringify(words)}`);
    return found[found.length - 1]!;
  };
  const name = (n: number) => `_Ref${String(n).padStart(9, '0')}`;
  const REF = (n: number, ...switches: string[]) =>
    ['REF', name(n), ...switches.map((each) => `\\${each}`)].join(' ');
  const PAGEREF = (n: number) => `PAGEREF ${name(n)} \\h`;
  /**
   * A caption's number, whose result Word sets in the field's own formatting (the final review of
   * Word 4, M2).
   */
  const NUMBER = (n: number, ...switches: string[]) => `${REF(n, ...switches)} \\* CHARFORMAT`;

  /** Every element beneath this one, in document order. */
  const inOrder = (element: Element): Element[] =>
    kids(element).flatMap((child) => [child, ...inOrder(child)]);

  /**
   * Each bookmark in a part or a paragraph, in the order they begin: its name and identifier, the text
   * it holds - field results included - whether it holds a footnote's mark, and whether it ends.
   */
  const bookmarksOf = (element: Element) => {
    const found: { name: string; id: string; text: string; mark: boolean; ended: boolean }[] = [];
    const open: (typeof found)[number][] = [];
    for (const each of inOrder(element)) {
      if (each.name === 'w:bookmarkStart') {
        const bookmark = {
          name: each.attrs['w:name']!,
          id: each.attrs['w:id']!,
          text: '',
          mark: false,
          ended: false,
        };
        found.push(bookmark);
        open.push(bookmark);
      } else if (each.name === 'w:bookmarkEnd') {
        const at = open.findIndex((bookmark) => bookmark.id === each.attrs['w:id']);
        open[at]!.ended = true;
        open.splice(at, 1);
      } else if (each.name === 'w:t') {
        for (const bookmark of open) bookmark.text += each.children.join('');
      } else if (each.name === 'w:footnoteReference') {
        for (const bookmark of open) bookmark.mark = true;
      }
    }
    return found;
  };

  /** Each field at the top of a paragraph or a part: its instruction, trimmed, and what it shows. */
  const fieldsOf = (element: Element) => {
    const found: { code: string; result: string }[] = [];
    const open: { code: string; result: string; separated: boolean }[] = [];
    for (const run of all(element, 'w:r')) {
      for (const child of kids(run)) {
        const kind = child.attrs['w:fldCharType'];
        const top = open[open.length - 1];
        if (child.name === 'w:instrText') top!.code += child.children.join('');
        else if (kind === 'begin') open.push({ code: '', result: '', separated: false });
        else if (kind === 'separate') top!.separated = true;
        else if (kind === 'end') {
          const field = open.pop()!;
          if (open.length === 0) found.push({ code: field.code.trim(), result: field.result });
        } else if (child.name === 'w:t' && top?.separated === true) {
          top.result += child.children.join('');
        }
      }
    }
    return found;
  };
  /** The references among a paragraph's fields: those that name a bookmark. */
  const referencesIn = (paragraph: Element) =>
    fieldsOf(paragraph).filter((field) => /^(REF|NOTEREF|PAGEREF) /.test(field.code));
  const P1 = 'Methods: 1 / Methods / 1 Methods / above / ';

  it("names each target's hidden bookmarks _Ref and nine digits, in document order, one set however many references name it, and the same names for the same document", () => {
    const marked = [...bookmarksOf(document()), ...bookmarksOf(footnotes())];
    // The front matter's component, Methods, the paragraph, the table's two, the figure's two, the
    // footnote, the section three deep and the appendix's three deep.
    expect(marked.map((each) => [each.name, each.id])).toEqual(
      Array.from({ length: 10 }, (_, at) => [name(at + 1), String(at + 1)]),
    );
    for (const each of marked) {
      expect(each.name).toMatch(/^_Ref[0-9]{9}$/);
      expect(each.ended).toBe(true);
    }
    // Written again, the same bytes.
    expect(citing().bytes).toEqual(cited.bytes);
  });

  it("sets a heading's bookmark around its title's words, a caption's two around its label and its words, a footnote's around its mark and a block's where it begins, holding nothing, since a page or above and below is all a block is named for and Word refuses a relative field inside its own bookmark (measured)", () => {
    const [
      front,
      methods,
      p1,
      tableLabel,
      tableWords,
      figureLabel,
      figureWords,
      mark,
      deeper,
      annex,
    ] = bookmarksOf(document());
    expect(front!.text).toBe('Preface by Ada');
    // Word's number is the heading's list's, which `REF \r` reads: no text of the heading's own.
    expect(methods!.text).toBe('Methods');
    expect(deeper!.text).toBe('Deeper');
    expect(annex!.text).toBe('Annex C');
    expect(bookmarksOf(saying('Methods')).map((each) => each.name)).toEqual([name(2)]);
    expect(p1!.text).toBe('');
    // Begun and ended before anything the paragraph holds.
    const held = kids(saying(P1)).map((each) => each.name);
    expect(held.slice(0, 3)).toEqual(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd']);
    expect(tableLabel!.text).toBe('Table 1.1');
    expect(tableWords!.text).toBe('Readings');
    expect(figureLabel!.text).toBe('Figure 1.1');
    expect(figureWords!.text).toBe('Shapes');
    expect(mark).toMatchObject({ text: '', mark: true });
  });

  it("PUB-026 writes every cross-reference as a field Word can update - REF, NOTEREF or PAGEREF at its target's bookmark - prefilled with what the PDF prints, and each page empty until Word lays the page out", () => {
    // A caption's number set in the reference's own formatting by `\* CHARFORMAT`: measured in Word 16
    // (the final review of Word 4, M2), a number in a bold term printed its label's regular, the rest
    // of the term bold, where with the switch the whole term was bold, as the PDF sets it.
    expect(referencesIn(saying(P1))).toEqual([
      { code: REF(2, 'r', 'h'), result: '1' },
      { code: REF(2, 'h'), result: 'Methods' },
      { code: REF(2, 'r', 'h'), result: '1' },
      { code: REF(2, 'h'), result: 'Methods' },
      { code: REF(2, 'p', 'h'), result: 'above' },
      { code: PAGEREF(2), result: '' },
    ]);
    expect(
      referencesIn(saying('Table: Table 1.1 / Readings / Table 1.1 Readings / above / ')),
    ).toEqual([
      { code: NUMBER(4, 'h'), result: 'Table 1.1' },
      { code: REF(5, 'h'), result: 'Readings' },
      { code: NUMBER(4, 'h'), result: 'Table 1.1' },
      { code: REF(5, 'h'), result: 'Readings' },
      { code: REF(4, 'p', 'h'), result: 'above' },
      { code: PAGEREF(4), result: '' },
    ]);
    expect(
      referencesIn(saying('Figure: Figure 1.1 / Shapes / Figure 1.1 Shapes / above / ')),
    ).toEqual([
      { code: NUMBER(6, 'h'), result: 'Figure 1.1' },
      { code: REF(7, 'h'), result: 'Shapes' },
      { code: NUMBER(6, 'h'), result: 'Figure 1.1' },
      { code: REF(7, 'h'), result: 'Shapes' },
      { code: REF(6, 'p', 'h'), result: 'above' },
      { code: PAGEREF(6), result: '' },
    ]);
    expect(referencesIn(saying('1 / above /  / above /  / 1.2.1 / A.1.1 / i'))).toEqual([
      { code: `NOTEREF ${name(8)} \\h`, result: '1' },
      { code: REF(8, 'p', 'h'), result: 'above' },
      { code: PAGEREF(8), result: '' },
      { code: REF(3, 'p', 'h'), result: 'above' },
      { code: PAGEREF(3), result: '' },
      { code: REF(9, 'r', 'h'), result: '1.2.1' },
      { code: REF(10, 'r', 'h'), result: 'A.1.1' },
      { code: REF(1, 'r', 'h'), result: 'i' },
    ]);
    // In a footnote's text, a paragraph's, and a link as the PDF's is.
    expect(referencesIn(footnotes())).toEqual([{ code: PAGEREF(3), result: '' }]);
  });

  it("links a reference only where the PDF does - a paragraph's text - and writes the same field without its link in a header row, a caption, a table's note and a section's title (XR-D)", () => {
    const [header] = all(first(document(), 'w:tbl')!, 'w:p');
    expect(referencesIn(header!)).toEqual([{ code: REF(3, 'p'), result: 'above' }]);
    expect(referencesIn(saying('Table 1.2 Cited in 1'))).toEqual([
      { code: REF(2, 'r'), result: '1' },
    ]);
    expect(referencesIn(saying('See above'))).toEqual([{ code: REF(4, 'p'), result: 'above' }]);
    // The section's title: its words, and the reference among them, as the PDF sets them.
    const results = saying('After 1 ended');
    expect(isHeading(results)).toBe(true);
    expect(referencesIn(results)).toEqual([{ code: REF(2, 'r'), result: '1' }]);
  });

  it("sets a relative reference in the passage's language, whose words Word's update prints (WO-C), prefilled with the layout's", () => {
    const german = saying('Siehe above');
    expect(referencesIn(german)).toEqual([{ code: REF(2, 'p', 'h'), result: 'above' }]);
    const runs = all(german, 'w:r').slice(1);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(first(run, 'w:lang')?.attrs).toEqual({ 'w:val': 'de-DE' });
  });

  it('keeps the place of a target that publishes nothing as a bookmark holding nothing: at the end of the paragraph before it, else at the start of the one after it, else in an empty paragraph of its own, which carries a list item its number', () => {
    const pointing = (...blocks: string[]) =>
      paragraph(
        'refs',
        ...blocks.flatMap((block, at) => [
          text(at === 0 ? 'See ' : ', '),
          xref(`r${at}`, toBlock(block), 'page'),
        ]),
      );
    const blank = (name: string) => paragraph(name);
    const marked = writtenOf([
      said('before'),
      blank('e1'),
      { type: 'blockquote', id: 'q1', content: [blank('e2'), said('quoted')] },
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [text('Readings')],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [cellOf('c1', text('York')), { content: [blank('e3')], colspan: 1, rowspan: 1 }],
          },
        ],
      },
      list('L1', 'ordered', [item(blank('e4')), item(said('second'))]),
      pointing('e1', 'e2', 'e3', 'e4'),
    ]);
    const { body, at } = bodyOf(marked.docx);
    const names = (paragraph: Element) =>
      kids(paragraph)
        .filter((each) => each.name === 'w:bookmarkStart')
        .map((each) => each.attrs['w:name']);
    const ends = (paragraph: Element) => kids(paragraph).map((each) => each.name);
    // After the paragraph before it, holding nothing.
    expect(names(at('before'))).toEqual([name(1)]);
    expect(ends(at('before')).slice(-2)).toEqual(['w:bookmarkStart', 'w:bookmarkEnd']);
    // First in a quotation, before the paragraph after it.
    expect(names(at('quoted'))).toEqual([name(2)]);
    expect(ends(at('quoted')).slice(0, 3)).toEqual(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd']);
    // Alone in a cell, in the cell's one paragraph.
    const [, cell] = rowsOf(first(marked.docx.xml('word/document.xml'), 'w:tbl')!)[0]!;
    const [holder, ...none] = kids(cell!, 'w:p');
    expect(none).toEqual([]);
    expect(names(holder!)).toEqual([name(3)]);
    expect(styleOf(holder!)).toBe(marked.theme.places.tableCell);
    // Alone in a list's item, in the one paragraph that carries the item's number.
    const second = body.indexOf(at('second'));
    const items = body.slice(second - 1, second + 1);
    expect(items.map((each) => [textOf(each), styleOf(each)])).toEqual([
      ['', marked.theme.places.listItem],
      ['second', marked.theme.places.listItem],
    ]);
    expect(names(items[0]!)).toEqual([name(4)]);
    for (const each of items) expect(first(pPr(each)!, 'w:numPr')).toBeDefined();
    // And no other paragraph for it: the caption before the table stands before it.
    expect(textOf(body[second - 2]!)).toBe('Table 1.1 Readings');
    expect(referencesIn(at('See , , , '))).toEqual(
      [1, 2, 3, 4].map((n) => ({ code: PAGEREF(n), result: '' })),
    );
  });

  /** Each reference field's runs in a paragraph, begin to end, by its instruction. */
  const fieldRuns = (paragraph: Element) => {
    const found: { code: string; runs: Element[] }[] = [];
    let open: { code: string; runs: Element[] } | null = null;
    for (const run of all(paragraph, 'w:r')) {
      const kind = first(run, 'w:fldChar')?.attrs['w:fldCharType'];
      if (kind === 'begin') open = { code: '', runs: [] };
      if (open === null) continue;
      open.runs.push(run);
      const instruction = first(run, 'w:instrText');
      if (instruction !== undefined) open.code += instruction.children.join('');
      if (kind === 'end') {
        found.push({ ...open, code: open.code.trim().replace(/ _Ref\d{9}/, '') });
        open = null;
      }
    }
    return found;
  };

  it("writes a number Word computes - a heading's, a note's, a page's - left to right in a right-to-left passage, its language the passage's, since Word drew one of digits alone in a right-to-left run in Times New Roman (measured by the Word check); every other form in the passage's direction", () => {
    const hebrew = written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: SEFER,
        language: 'he-IL',
        direction: 'rtl',
        nodes: [section('rtlbody', SEFER, [reference('rtlpart', 4)])],
      }),
      occurrences: new Map([
        [
          id('rtlpart'),
          component(
            SEFER,
            [
              paragraph('r0', text(SHALOM), note('rn', paragraph('rna', text(SEFER)))),
              paragraph(
                'r1',
                text(`${SHALOM} `),
                xref('x0', toNode('rtlbody')),
                text(' '),
                xref('x1', toBlock('rn')),
                text(' '),
                xref('x2', toBlock('r0'), 'page'),
                text(' '),
                xref('x3', toBlock('r0'), 'relative'),
                text(' '),
                xref('x4', toNode('rtlbody'), 'title'),
              ),
            ],
            { language: 'he-IL', direction: 'rtl' },
          ),
        ],
      ]),
    });
    const [, cites] = all(hebrew.docx.xml('word/document.xml'), 'w:p').filter((each) =>
      textOf(each).startsWith(SHALOM),
    );
    const fields = fieldRuns(cites!).map(({ code, runs }) => [
      code,
      runs.every((run) => first(run, 'w:rtl') !== undefined),
      runs.every((run) => first(run, 'w:lang')?.attrs['w:bidi'] === 'he-IL'),
    ]);
    expect(fields).toEqual([
      ['REF \\r \\h', false, true],
      ['NOTEREF \\h', false, true],
      ['PAGEREF \\h', false, true],
      ['REF \\p \\h', true, true],
      ['REF \\h', true, true],
    ]);
  });

  it("writes the space between two references' fields that print left to right in a right-to-left passage without its direction, so Word sets them as one left-to-right run, as the PDF does, where each stood apart in reading order (measured, M2 of Word 3's final review)", () => {
    const hebrew = written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: SEFER,
        language: 'he-IL',
        direction: 'rtl',
        nodes: [section('rtlbody', SEFER, [reference('rtlpart', 4)])],
      }),
      occurrences: new Map([
        [
          id('rtlpart'),
          component(
            SEFER,
            [
              paragraph('r0', text(SHALOM), note('rn', paragraph('rna', text(SEFER)))),
              {
                type: 'table',
                id: 't1',
                style: 'table',
                caption: [text('Readings')],
                headerRows: 0,
                headerColumns: 0,
                rows: [{ cells: [cellOf('c1', text('1'))] }],
              },
              paragraph(
                'r1',
                text(`${SHALOM} `),
                xref('x0', toNode('rtlbody')),
                text(' '),
                xref('x1', toBlock('rn')),
                text(' '),
                xref('x2', toBlock('r0'), 'page'),
                text(' '),
                xref('x3', toBlock('r0'), 'relative'),
                text(' '),
                xref('x4', toNode('rtlbody'), 'numberAndTitle'),
                text(' '),
                xref('x5', toNode('rtlbody'), 'title'),
                text(' '),
                xref('x6', toBlock('r0'), 'relative'),
                text(' '),
                xref('x7', toBlock('t1'), 'numberAndTitle'),
                text(' '),
                xref('x8', toBlock('r0'), 'relative'),
              ),
            ],
            { language: 'he-IL', direction: 'rtl' },
          ),
        ],
      ]),
    });
    const [, cites] = all(hebrew.docx.xml('word/document.xml'), 'w:p').filter((each) =>
      textOf(each).startsWith(SHALOM),
    );
    // Each run of text, outside the fields, and whether it is right to left.
    const texts = kids(cites!, 'w:r')
      .filter((run) => first(run, 'w:t') !== undefined && first(run, 'w:instrText') === undefined)
      .map((run) => [textOf(run), first(run, 'w:rtl') !== undefined]);
    const spaces = texts.filter(([words]) => words === ' ').map(([, rtl]) => rtl);
    // Between a number, a note's number, a page and "above", none, and before a number and a title,
    // which the number begins; beside the Hebrew title, whether between two references or inside
    // one, the passage's; between a table's label and its Latin words, inside the reference and after
    // it, none. And the words before them the passage's.
    expect(spaces).toEqual([false, false, false, false, true, true, true, false, false, false]);
    expect(texts[0]).toEqual([`${SHALOM} `, true]);
  });

  it("names a floated figure's place for above and below where its box is anchored in the text, since Word's REF \\p to its caption in the box prints the caption's words (measured by the Word check); its number, title and page at its caption", () => {
    const floated = writtenOf(
      [
        said('before'),
        figure('f3', BLUE, 'Blue on top', { imageStyle: 'floated' }),
        paragraph(
          'p1',
          xref('x0', toBlock('f3'), 'relative'),
          text(' '),
          xref('x1', toBlock('f3'), 'page'),
          text(' '),
          xref('x2', toBlock('f3'), 'numberAndTitle'),
        ),
      ],
      { theme: floatedTheme, assets: IMAGES },
    );
    const { at, body } = bodyOf(floated.docx);
    const anchor = body[body.indexOf(at('before')) + 1]!;
    expect(first(anchor, 'w:txbxContent')).toBeDefined();
    // The caption's two inside the box; the anchor's own after the box's run, holding nothing.
    const boxed = all(first(anchor, 'w:txbxContent')!, 'w:bookmarkStart');
    expect(boxed.map((each) => each.attrs['w:name'])).toEqual([name(1), name(2)]);
    const own = kids(anchor).filter((each) => each.name === 'w:bookmarkStart');
    expect(own.map((each) => each.attrs['w:name'])).toEqual([name(3)]);
    expect(kids(anchor).map((each) => each.name)).toEqual([
      'w:pPr',
      'w:r',
      'w:bookmarkStart',
      'w:bookmarkEnd',
    ]);
    const cites = paragraphs(floated.docx).find((each) => textOf(each).startsWith('above'))!;
    expect(referencesIn(cites)).toEqual([
      { code: REF(3, 'p', 'h'), result: 'above' },
      { code: PAGEREF(1), result: '' },
      { code: NUMBER(1, 'h'), result: 'Figure 1.1' },
      { code: REF(2, 'h'), result: 'Blue on top' },
    ]);
  });

  it("names a caption with no label's place by a bookmark holding nothing where the caption begins, since Word's REF \\p inside the bookmark around its words printed Word's self-reference error (measured, M1 of Word 3's final review)", () => {
    // An appendix without a number, before any with one: the scheme gives its table and its figure
    // no number, so their captions have no label.
    const unlabelled = written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          section('early', 'Early annex', [reference('blocks', 9)], {
            matter: 'appendix',
            numbered: false,
          }),
        ],
      }),
      occurrences: new Map([
        [
          id('blocks'),
          component('Blocks', [
            said('before'),
            {
              type: 'table',
              id: 'u1',
              style: 'table',
              caption: [
                text('Early, see '),
                xref('u0', toBlock('u1'), 'relative'),
                text(' on '),
                xref('u2', toBlock('u1'), 'page'),
              ],
              headerRows: 0,
              headerColumns: 0,
              rows: [{ cells: [cellOf('c1', text('x'))] }],
            },
            figure('f1', RED, 'Shapes', {
              caption: [text('Shapes '), xref('u3', toBlock('f1'), 'relative')],
            }),
            paragraph(
              'p1',
              xref('u4', toBlock('u1'), 'relative'),
              text(' '),
              xref('u5', toBlock('f1'), 'page'),
            ),
          ]),
        ],
      ]),
      assets: IMAGES,
    });
    const captioned = (words: string) =>
      paragraphs(unlabelled.docx).find((each) => textOf(each) === words)!;
    const table = captioned('Early, see above on ');
    // The place first, holding nothing, then the words, holding the references to the place.
    expect(
      kids(table)
        .map((each) => each.name)
        .slice(0, 4),
    ).toEqual(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:bookmarkStart']);
    expect(bookmarksOf(table).map(({ name, text }) => [name, text])).toEqual([
      [name(1), ''],
      [name(2), 'Early, see above on '],
    ]);
    expect(referencesIn(table)).toEqual([
      { code: REF(1, 'p'), result: 'above' },
      { code: `PAGEREF ${name(1)}`, result: '' },
    ]);
    const figured = captioned('Shapes above');
    expect(bookmarksOf(figured).map(({ name, text }) => [name, text])).toEqual([
      [name(3), ''],
      [name(4), 'Shapes above'],
    ]);
    expect(referencesIn(figured)).toEqual([{ code: REF(3, 'p'), result: 'above' }]);
    expect(referencesIn(captioned('above '))).toEqual([
      { code: REF(1, 'p', 'h'), result: 'above' },
      { code: PAGEREF(3), result: '' },
    ]);
  });
});

describe('writeDocx: equations (Word 4, rulings R4 and R5)', () => {
  /** x squared plus a y a script level smaller, which the converter sizes from the text's size. */
  const MATHML =
    '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared plus a small y">' +
    '<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mstyle scriptlevel="1"><mi>y</mi></mstyle></math>';
  const converted = mathsTree(MATHML);
  if (!converted.ok) throw new Error('the fixture is refused');
  const TREE = converted.tree;
  const inline = { type: 'equation', mathml: MATHML };
  const displayed = (name: string, numbered = false, mathml = MATHML) => ({
    type: 'equation',
    id: name,
    mathml,
    numbered,
  });
  const xref = (name: string, target: object, display = 'number') => ({
    type: 'crossReference',
    id: name,
    target,
    display,
  });
  const toBlock = (block: string) => ({ kind: 'block', block });
  const quote = (name: string, blocks: unknown[], attribution: unknown[]) => ({
    type: 'blockquote',
    id: name,
    content: blocks,
    attribution,
  });
  /**
   * An equation in a line wherever the PDF sets one - a paragraph's text, a list's item, a term, an
   * attribution, a table's caption, cell and note, a footnote's text and a section's title - displayed
   * and numbered at the top level, in a list's item and in a quotation, and displayed with no number;
   * in every matter, so that each numbers as its rule does; references to a numbered one and to one
   * with no number; and the list of equations after the contents.
   */
  const CALCULATION = component('Calculation', [
    paragraph('p1', text('Let '), inline, text(' hold.')),
    displayed('e1', true),
    displayed('e2'),
    list('L1', 'ordered', [
      item(paragraph('li', text('Take '), inline)),
      item(displayed('e4', true)),
    ]),
    list('D1', 'definition', [{ term: [text('Square '), inline], content: [said('of x')] }]),
    quote('q1', [displayed('e3', true)], [text('After '), inline]),
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Values of '), inline],
      headerRows: 0,
      headerColumns: 0,
      note: [text('Where '), inline],
      rows: [{ cells: [{ content: [paragraph('c1', inline)], colspan: 1, rowspan: 1 }] }],
    },
    paragraph('p2', text('Noted'), {
      type: 'footnote',
      id: 'n1',
      anchor: { kind: 'span' },
      content: [paragraph('n1a', text('As '), inline)],
    }),
    paragraph(
      'p3',
      xref('r0', toBlock('e1')),
      text(' / '),
      xref('r1', toBlock('e1'), 'page'),
      text(' / '),
      xref('r2', toBlock('e1'), 'relative'),
      text(' / '),
      xref('r3', toBlock('e2'), 'relative'),
    ),
    said('after'),
  ]);
  const LISTING = layoutWith((layout) => {
    layout.matter.lists = [...layout.matter.lists, { sequence: 'equation', title: 'Equations' }];
  });
  const equated = (over: Parameters<typeof written>[0] = {}): Written =>
    written({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          reference('preface', 1, { matter: 'front' }),
          section('intro', 'Introduction', [reference('calc', 9)]),
          { ...section('method', 'Method'), title: [text('Method for '), inline] },
          section('annex', 'Annex', [reference('derived', 10)], { matter: 'appendix' }),
        ],
      }),
      occurrences: new Map([
        [id('preface'), component('Preface by Ada', [displayed('f1', true)])],
        [id('calc'), CALCULATION],
        [id('derived'), component('Derivation', [displayed('a1', true), displayed('a2', true)])],
      ]),
      layout: LISTING,
      ...over,
    });
  const equations = equated();
  const document = () => equations.docx.xml('word/document.xml');
  const xml = (docx: Package, name: string) => strFromU8(docx.files[name]!);
  const BS = String.fromCharCode(92);
  /** What the converter writes of the tree at a size, in a line or displayed. */
  const converter = (size: number, display = false) =>
    omml(TREE, { display, size, face: 'Cambria Math' });
  /** The half points the converter states on the small y, at the text's size. */
  const small = (size: number) => String(Math.round(size * 0.73 * 2));
  const sizeOf = (styleId: string) => DEFAULT_THEME.paragraphStyles.get(styleId)!.properties.size;
  /** Every equation in a line in this element, not a displayed one's. */
  const inLine = (element: Element): Element[] =>
    kids(element).flatMap((child): Element[] =>
      child.name === 'm:oMathPara' ? [] : child.name === 'm:oMath' ? [child] : inLine(child),
    );
  const displays = (element: Element) => all(element, 'm:oMathPara');
  /** The numbered equations' rows, in document order. */
  const rows = () => all(document(), 'w:tbl').filter((table) => displays(table).length > 0);
  /** The one table that is a table. */
  const table = () => all(document(), 'w:tbl').find((each) => displays(each).length === 0)!;
  const measure = () => {
    const { page, margins, gutter } = equations.word.format;
    return page.width - margins.inside - margins.outside - gutter;
  };
  /** How wide the invented faces set words, at a size, in points. */
  const widthOf = (words: string, size: number) =>
    ([...words].reduce((sum, each) => sum + (ADVANCES.get(each.codePointAt(0)!) ?? 1024), 0) /
      2048) *
    size;
  /** The cells' first paragraphs of a numbered equation's row: its equation's, then its label's. */
  const cellsOf = (row: Element) => rowsOf(row)[0]!.map((cell) => first(cell, 'w:p')!);

  it("PUB-067 writes every equation as Word's own, the converter's OMML of the maths tree the PDF sets - in a line an m:oMath where its run stands, displayed an m:oMathPara - never an image and never the MathML", () => {
    const text = xml(equations.docx, 'word/document.xml');
    const said = paragraphSaying(equations.docx, 'Let  hold.');
    // In its run's place, between the words either side of it.
    expect(kids(said).map((each) => each.name)).toEqual(['w:pPr', 'w:r', 'm:oMath', 'w:r']);
    expect(text).toContain(`<m:oMath>${converter(sizeOf('body'))}</m:oMath>`);
    expect(text).toContain(
      `<m:oMathPara><m:oMath>${converter(sizeOf('body'), true)}</m:oMath></m:oMathPara>`,
    );
    for (const part of ['word/document.xml', 'word/footnotes.xml']) {
      expect(xml(equations.docx, part)).not.toContain('<math');
      // Its alternative only where a table's title names it by its words.
      expect(xml(equations.docx, part).match(/x squared plus a small y/g) ?? []).toHaveLength(
        part === 'word/document.xml' ? 1 : 0,
      );
      expect(equations.docx.xml(part).attrs['xmlns:m']).toBe(
        'http://schemas.openxmlformats.org/officeDocument/2006/math',
      );
    }
    expect(all(document(), 'w:drawing')).toEqual([]);
  });

  it("sets an equation in a line wherever its run stands - a paragraph, a list's item, a term, an attribution, a table's caption, cell and note, a footnote and a section's title and its contents entry - sized from its text's size", () => {
    const { at } = bodyOf(equations.docx);
    const titles = paragraphs(equations.docx).filter((each) => textOf(each) === 'Method for ');
    const placed: [Element, string][] = [
      [at('Let  hold.'), 'body'],
      [at('Take '), 'body'],
      [at('Square '), 'body'],
      [at('After '), 'attribution'],
      [
        paragraphs(equations.docx)
          .filter((each) => textOf(each) === 'Table 1.1 Values of ')
          .at(-1)!,
        'caption',
      ],
      [at('Where '), 'table-note'],
      [first(table(), 'w:p')!, 'table-cell'],
      [titles.at(-1)!, 'heading-1'],
    ];
    for (const [paragraph, style] of placed) {
      const [equation, ...more] = inLine(paragraph);
      expect(more, style).toEqual([]);
      expect(first(equation!, 'w:sz')?.attrs['w:val'], style).toBe(small(sizeOf(style)));
    }
    // In the note, as its own text.
    const note = all(equations.docx.xml('word/footnotes.xml'), 'w:footnote').at(-1)!;
    expect(first(inLine(note)[0]!, 'w:sz')?.attrs['w:val']).toBe(small(sizeOf('footnote')));
    // The contents' entry for the section, as Word's update rebuilds it from the heading.
    const entry = paragraphs(equations.docx).find((each) => textOf(each) === '2 Method for ')!;
    expect(inLine(entry)).toHaveLength(1);
  });

  it("sets an equation in a bold style - a heading's - with bold off on its runs, as the PDF sets maths in its own weight, since Word gives the heading's bold to its maths as it saves the document (the Word check, Word 4)", () => {
    const { at } = bodyOf(equations.docx);
    const heading = paragraphs(equations.docx)
      .filter((each) => textOf(each) === 'Method for ')
      .at(-1)!;
    const bold = (paragraph: Element) =>
      all(inLine(paragraph)[0]!, 'm:r').map((run) =>
        all(run, 'w:b').map((each) => each.attrs['w:val']),
      );
    expect(styleOf(heading)).toBe('heading-1');
    expect(bold(heading)).toEqual([['0'], ['0'], ['0'], ['0']]);
    // Nowhere else: the body's style is not bold, nor the contents entry Word rebuilds from the heading.
    expect(bold(at('Let  hold.'))).toEqual([[], [], [], []]);
    const entry = paragraphs(equations.docx).find((each) => textOf(each) === '2 Method for ')!;
    expect(bold(entry)).toEqual([[], [], [], []]);
  });

  it("R5 reports the maths face set as Word's own, STIX Two Math as Cambria Math, where the document sets an equation, and names Word's maths face with the display defaults the PDF's display matches", () => {
    expect(equations.report).toContainEqual({
      kind: 'face_substituted',
      family: 'STIX Two Math',
      wordFamily: 'Cambria Math',
    });
    const settings = equations.docx.xml('word/settings.xml');
    expect(
      kids(first(settings, 'm:mathPr')!).map((each) => [each.name, each.attrs['m:val']]),
    ).toEqual([
      ['m:mathFont', 'Cambria Math'],
      ['m:dispDef', undefined],
      ['m:defJc', 'center'],
      ['m:wrapIndent', '1440'],
    ]);
  });

  it("sets an equation's text in the maths face's Word face, as the PDF sets it in the maths face (Word 4's ledger)", () => {
    const worded = writtenOf([
      displayed('e1', false, MATHML.replace('<mo>+</mo>', '<mtext>if</mtext>')),
    ]);
    const run = all(worded.docx.xml('word/document.xml'), 'm:r').find(
      (each) => all(each, 'm:nor').length > 0,
    )!;
    expect(first(run, 'w:rFonts')?.attrs['w:ascii']).toBe('Cambria Math');
  });

  it("displays an equation with no number as an m:oMathPara in a paragraph of its own, in the style of the text of the place it stands in, as the PDF's display block", () => {
    const alone = blocksOf(equations.docx).filter(
      (each) => each.name === 'w:p' && displays(each).length > 0,
    );
    expect(alone).toHaveLength(1);
    const [e2] = alone;
    expect(styleOf(e2!)).toBe('body');
    // Its bookmark first, holding nothing, as any block's.
    expect(kids(e2!).map((each) => each.name)).toEqual([
      'w:pPr',
      'w:bookmarkStart',
      'w:bookmarkEnd',
      'm:oMathPara',
    ]);
    expect(kids(displays(e2!)[0]!).map((each) => each.name)).toEqual(['m:oMath']);
  });

  it('numbers a displayed equation in a borderless row of two cells (WO-H, M17): the equation in the wide cell, centred on the measure, and its label at the right of a fixed cell as wide as the label and an em, as the PDF sets it', () => {
    const [f1, e1] = rows();
    const width = measure();
    const number = widthOf('Equation 1', 11) + 11;
    const properties = stated(e1!, 'w:tblPr');
    expect(Object.keys(properties)).toEqual([
      'w:tblW',
      'w:tblBorders',
      'w:tblLayout',
      'w:tblCellMar',
      'w:tblLook',
    ]);
    expect(properties['w:tblW']).toEqual({ 'w:w': twips(width), 'w:type': 'dxa' });
    expect(properties['w:tblLayout']).toEqual({ 'w:type': 'fixed' });
    // No rule anywhere, and no header row, first column or band for a reader to take it by.
    const borders = kids(kids(e1!, 'w:tblPr')[0]!, 'w:tblBorders')[0]!;
    expect(kids(borders).map((each) => [each.name, each.attrs['w:val']])).toEqual([
      ['w:top', 'nil'],
      ['w:left', 'nil'],
      ['w:bottom', 'nil'],
      ['w:right', 'nil'],
      ['w:insideH', 'nil'],
      ['w:insideV', 'nil'],
    ]);
    const margins = kids(kids(e1!, 'w:tblPr')[0]!, 'w:tblCellMar')[0]!;
    expect(kids(margins).map((each) => [each.name, each.attrs['w:w']])).toEqual([
      ['w:left', '0'],
      ['w:right', '0'],
    ]);
    expect(properties['w:tblLook']).toEqual({
      'w:val': '0600',
      'w:firstRow': '0',
      'w:lastRow': '0',
      'w:firstColumn': '0',
      'w:lastColumn': '0',
      'w:noHBand': '1',
      'w:noVBand': '1',
    });
    expect(all(e1!, 'w:tblHeader')).toEqual([]);
    expect(all(e1!, 'w:gridCol').map((each) => each.attrs['w:w'])).toEqual([
      String(Math.round(width * 20) - Math.round(number * 20)),
      String(Math.round(number * 20)),
    ]);
    for (const cell of rowsOf(e1!)[0]!) {
      expect(stated(cell, 'w:tcPr')['w:vAlign']).toEqual({ 'w:val': 'center' });
    }
    expect(kids(first(e1!, 'w:trPr')!).map((each) => each.name)).toEqual(['w:cantSplit']);
    // The equation in the wide cell, stood in by the number's cell so it centres on the measure.
    const [shown, numbered] = cellsOf(e1!) as [Element, Element];
    expect(displays(shown)).toHaveLength(1);
    expect(styleOf(shown)).toBe('body');
    expect(indents(shown)).toEqual({
      'w:left': String(Math.round(number * 20)),
      'w:right': '0',
      'w:firstLine': '0',
    });
    // The label at the right, in the layout's words, left to right.
    expect(textOf(numbered)).toBe('Equation 1');
    expect(styleOf(numbered)).toBe('body');
    expect(kids(pPr(numbered)!, 'w:jc')[0]?.attrs['w:val']).toBe('right');
    expect(indents(numbered)).toEqual({ 'w:left': '0', 'w:right': '0', 'w:firstLine': '0' });
    expect(all(numbered, 'w:bidi')).toEqual([]);
    expect(textOf(cellsOf(f1!)[1]!)).toBe('Equation i');
  });

  it("numbers each equation by Word's fields as captionField says in every matter, each prefilled with the numbering table's label: the front's roman under a name of its own, the body's counting from 1 again, the appendix's by its chapter (Word 4's Ruling 3)", () => {
    const labels = rows().map((row) => cellsOf(row)[1]!);
    expect(labels.map(textOf)).toEqual([
      'Equation i',
      'Equation 1',
      'Equation 2',
      'Equation 3',
      'Equation A.1',
      'Equation A.2',
    ]);
    expect(labels.map(fieldCodes)).toEqual([
      [`SEQ EquationFront ${BS}* roman ${BS}s 1`],
      [`SEQ Equation ${BS}* arabic ${BS}s 1`],
      [`SEQ Equation ${BS}* arabic`],
      [`SEQ Equation ${BS}* arabic`],
      [`STYLEREF 1 ${BS}s`, `SEQ Equation ${BS}* arabic ${BS}s 1`],
      [`STYLEREF 1 ${BS}s`, `SEQ Equation ${BS}* arabic ${BS}s 1`],
    ]);
  });

  it("stands a numbered equation's row where its place stands it - a list's item, a quotation - as wide as what is left of the measure, its cells at their edges", () => {
    const [, , inList, inQuotation] = rows();
    const quotation = DEFAULT_THEME.paragraphStyles.get('quotation')!.properties;
    const properties = stated(inQuotation!, 'w:tblPr');
    expect(properties['w:tblInd']).toEqual({
      'w:w': twips(quotation.startIndent),
      'w:type': 'dxa',
    });
    expect(properties['w:tblW']).toEqual({
      'w:w': twips(measure() - quotation.startIndent - quotation.endIndent),
      'w:type': 'dxa',
    });
    expect(stated(inList!, 'w:tblPr')['w:tblInd']).toBeDefined();
    const [shown, numbered] = cellsOf(inQuotation!) as [Element, Element];
    expect(styleOf(shown)).toBe('quotation');
    expect(styleOf(numbered)).toBe('quotation');
    expect(indents(numbered)).toEqual({ 'w:left': '0', 'w:right': '0', 'w:firstLine': '0' });
  });

  it("turns contextual spacing off in both of a numbered equation's cells where their style asks for it, since Word dropped the space after the equation's paragraph facing the label's, of its style, and set the label a line above the equation (measured)", () => {
    const [, e1, , inQuotation] = rows();
    for (const cell of cellsOf(inQuotation!)) expect(contextual(cell)).toBe('0');
    // The text's style asks for none, and nothing is stated over it.
    for (const cell of cellsOf(e1!)) expect(contextual(cell)).toBeUndefined();
  });

  it('keeps an equation alone in its paragraph in the line, as the PDF sets it, by a zero-width space before it: Word displays an m:oMath with nothing else in its paragraph (measured)', () => {
    const ZWSP = String.fromCharCode(0x200b);
    const alone = first(table(), 'w:p')!;
    expect(kids(alone).map((each) => each.name)).toEqual(['w:pPr', 'w:r', 'm:oMath']);
    expect(textOf(alone)).toBe(ZWSP);
    // Beside words, nothing added.
    expect(textOf(paragraphSaying(equations.docx, 'Let  hold.'))).not.toContain(ZWSP);
    // A displayed one is displayed already.
    for (const each of blocksOf(equations.docx)) {
      if (each.name === 'w:p' && displays(each).length > 0) expect(textOf(each)).toBe('');
    }
  });

  it("R6 spaces a numbered equation's row as the PDF spaces its display block, the same space in both cells so the number stays on the equation's middle, and nothing more on the paragraph after it", () => {
    // The text's style with a space before, so that an item's equation, a line below its number,
    // states the space it drops.
    const spaced = equated({
      theme: themeWith((inputs) => {
        inputs.catalogues.paragraph.styles = inputs.catalogues.paragraph.styles.map((each) =>
          each.id === 'body'
            ? { ...each, properties: { ...each.properties, spaceBefore: 4 } }
            : each,
        );
      }),
    });
    const blocks = blocksOf(spaced.docx);
    const [, e1, inList] = blocks.filter(
      (each) => each.name === 'w:tbl' && displays(each).length > 0,
    );
    const [shown, numbered] = cellsOf(e1!) as [Element, Element];
    expect(spacing(numbered)).toEqual(spacing(shown));
    // An item's number on an empty paragraph of its own, a line above its equation, as for a table.
    for (const cell of cellsOf(inList!)) expect(spacing(cell)).toEqual({ 'w:before': '0' });
    // The paragraph after it spaced by its own space before, the row's after in its cells.
    const after = blocks[blocks.indexOf(e1!) + 1]!;
    expect(displays(after)).toHaveLength(1);
    expect(spacing(after)).toBeUndefined();
  });

  it("names a numbered equation for a reference by a hidden bookmark around its label, and one with no number by one where its paragraph begins, holding nothing; a reference to either is a field at it, in Word 3's forms", () => {
    const [, e1] = rows();
    const label = cellsOf(e1!)[1]!;
    expect(all(label, 'w:bookmarkStart').map((each) => each.attrs['w:name'])).toEqual([
      '_Ref000000001',
    ]);
    // Around the label's word and its field.
    const held = kids(label).map((each) => each.name);
    expect(held[1]).toBe('w:bookmarkStart');
    expect(held.at(-1)).toBe('w:bookmarkEnd');
    const unnumbered = blocksOf(equations.docx).find(
      (each) => each.name === 'w:p' && displays(each).length > 0,
    )!;
    expect(all(unnumbered, 'w:bookmarkStart').map((each) => each.attrs['w:name'])).toEqual([
      '_Ref000000002',
    ]);
    const referring = paragraphSaying(equations.docx, 'Equation 1 /  / above / above');
    expect(fieldCodes(referring)).toEqual([
      `REF _Ref000000001 ${BS}h ${BS}* CHARFORMAT`,
      `PAGEREF _Ref000000001 ${BS}h`,
      `REF _Ref000000001 ${BS}p ${BS}h`,
      `REF _Ref000000002 ${BS}p ${BS}h`,
    ]);
  });

  it("lists the numbered equations after the contents as the lists of figures and tables are: a TOC field over front matter's SEQ EquationFront labels, then one over the SEQ Equation labels, prefilled with each label and no page", () => {
    const [, front] = sections(equations.docx);
    const shown = front!.paragraphs.map(textOf);
    const listed = front!.paragraphs.slice(shown.indexOf('Equations'));
    expect(listed.map(textOf)).toEqual([
      'Equations',
      'Equation i',
      '',
      'Equation 1',
      'Equation 2',
      'Equation 3',
      'Equation A.1',
      'Equation A.2',
    ]);
    expect(fieldCodes({ name: 'list', attrs: {}, children: listed })).toEqual([
      `TOC ${BS}h ${BS}z ${BS}c "EquationFront"`,
      `TOC ${BS}h ${BS}z ${BS}c "Equation"`,
    ]);
    // Each field begun in its first entry; front matter's ended in an empty paragraph of its own, its
    // mark hidden, so that the empty paragraph Word leaves after the entries it rebuilds is joined to
    // the body's first entry and no gap is seen between them (measured), and holding the leader tab
    // Word gives the entries it rebuilds, which the joined entry is set by (measured: without it, the
    // body's first entry lost its leader).
    const marks = (paragraph: Element) =>
      all(paragraph, 'w:fldChar').map((each) => each.attrs['w:fldCharType']);
    expect(marks(listed[1]!)).toEqual(['begin', 'separate']);
    expect(marks(listed[2]!)).toEqual(['end']);
    expect(all(pPr(listed[2]!)!, 'w:vanish')).toHaveLength(1);
    expect(all(pPr(listed[2]!)!, 'w:tab').map((each) => each.attrs)).toEqual([
      { 'w:val': 'right', 'w:leader': 'dot', 'w:pos': twips(measure()) },
    ]);
    expect(marks(listed[3]!)).toEqual(['begin', 'separate']);
    expect(marks(listed[7]!)).toEqual(['end']);
    // The body's entries and the lists of figures and tables, one field each, hide no mark.
    for (const entry of [listed[1]!, ...listed.slice(3)]) {
      expect(all(entry, 'w:vanish')).toEqual([]);
    }
    for (const entry of listed.slice(1)) expect(styleOf(entry)).toBe('TableofFigures');
  });

  it("prefills a list's entry for a caption holding an equation with the equation, and names the table by its caption's words with the equation's alternative among them", () => {
    const [, front] = sections(equations.docx);
    const entry = front!.paragraphs.find((each) => textOf(each) === 'Table 1.1 Values of ')!;
    expect(inLine(entry)).toHaveLength(1);
    expect(stated(table(), 'w:tblPr')['w:tblCaption']).toEqual({
      'w:val': 'Table 1.1 Values of x squared plus a small y',
    });
  });

  it("reports each heading the contents or a running head holds and each caption a list after the contents holds with an equation that is not a row of plain runs, which Word's rebuilt entries set as its characters in a row (the final review of Word 4, I2)", () => {
    // The table's caption, which the list of tables holds, then the chapter the contents and the
    // running heads hold, each holding x squared, in the order the text meets them.
    expect(equations.report.filter((each) => each.kind === 'equation_flattened')).toEqual([
      { kind: 'equation_flattened', node: id('calc'), block: 't1', label: 'Table 1.1' },
      { kind: 'equation_flattened', node: id('method'), block: null, label: '2' },
    ]);
    // A row of plain runs is set the same in a row: nothing is said of one.
    const FLAT =
      '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x plus 10"><mi>x</mi><mo>+</mo><mn>10</mn></math>';
    const flat = equated({
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          {
            ...section('method', 'Method', [reference('calc', 9)]),
            title: [text('Method for '), { type: 'equation', mathml: FLAT }],
          },
        ],
      }),
      occurrences: new Map([
        [
          id('calc'),
          component('Calculation', [
            {
              type: 'table',
              id: 't1',
              style: 'table',
              caption: [text('Values of '), { type: 'equation', mathml: FLAT }],
              headerRows: 0,
              headerColumns: 0,
              rows: [{ cells: [{ content: [said('c')], colspan: 1, rowspan: 1 }] }],
            },
          ]),
        ],
      ]),
    });
    expect(flat.report.filter((each) => each.kind === 'equation_flattened')).toEqual([]);
    // Nor of a heading no contents and no running head holds, nor a caption no list collects.
    const unlisted = equated({
      layout: layoutWith((layout) => {
        layout.matter.contents = null;
        layout.matter.lists = [];
        layout.formats.docx!.head = [[{ kind: 'field', field: 'title' }], [], []];
      }),
    });
    expect(unlisted.report.filter((each) => each.kind === 'equation_flattened')).toEqual([]);
  });

  it('reports no substitution of the maths face, and writes no equation, where the document sets none', () => {
    expect(plain.report.some((each) => each.kind === 'face_substituted')).toBe(false);
    expect(xml(plain.docx, 'word/document.xml')).not.toContain('<m:oMath');
  });
});
