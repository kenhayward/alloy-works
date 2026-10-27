import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { scanXml } from '../content/ooxml/xml.js';
import { renderCitations, SEEDED_STYLE_FILES } from '../library/citations.js';
import type { CslItem } from '../library/entry.js';
import {
  assemble,
  publishedImagePath,
  type AssembleInput,
  type PublishingAsset,
} from '../publishing/assemble.js';
import { defaultLayout, parseLayout, type Layout } from '../publishing/layout.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import { resolved } from '../theme/theme.fixture.js';

import { htmlText } from './text.js';
import {
  escapeText,
  HTML_WRITER_VERSION,
  writeHtml,
  type HtmlWriting,
  type WrittenHtml,
} from './write.js';

// ---------------------------------------------------------------------------------------------------
// Reading what was written back: its head as text, and its body as a tree of elements.
// ---------------------------------------------------------------------------------------------------

interface Element {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: (Element | string)[];
}

/** The body as a tree: the writer closes every element it opens there and writes no void one. */
function body(html: string): Element {
  const start = html.indexOf('<body>');
  const end = html.indexOf('</body>');
  const root: Element = { name: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  for (const event of scanXml(html.slice(start, end + '</body>'.length))) {
    const top = stack[stack.length - 1]!;
    if (event.kind === 'text') top.children.push(event.value);
    else if (event.kind === 'close') {
      expect(top.name, 'an element closed where it was opened').toBe(event.name);
      stack.pop();
    } else {
      const element: Element = { name: event.name, attrs: event.attrs, children: [] };
      top.children.push(element);
      if (event.kind === 'open') stack.push(element);
    }
  }
  return root.children.find((child): child is Element => typeof child !== 'string')!;
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

/** The text an element holds, at any depth. */
const textOf = (element: Element): string =>
  element.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const kids = (element: Element): Element[] =>
  element.children.filter((child): child is Element => typeof child !== 'string');

// ---------------------------------------------------------------------------------------------------
// A document to write: invented people and words, never real ones.
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
const section = (name: string, title: string, children: unknown[] = []) => ({
  type: 'section',
  id: id(name),
  title: [{ type: 'text', value: title, marks: [] }],
  ...positional,
  children,
});
const reference = (name: string, n: number) => ({
  type: 'reference',
  id: id(name),
  component: uuid(n),
  mode: { kind: 'latest' },
  ...positional,
  children: [],
});

const REPORT = 'https://example.test/report?from=ada&to=grace';

/** One section holding one component of these blocks, in a document of this title. */
function oneComponent(blocks: unknown[], over: object = {}, title = 'The dosing report') {
  return {
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title,
      language: 'en-GB',
      direction: 'ltr',
      nodes: [section('intro', 'Introduction', [reference('calib', 1)])],
    }),
    occurrences: new Map([[id('calib'), component('Calibration', blocks, over)]]),
  };
}

/** Each face file the theme names, by its hash: invented bytes, a TrueType file's first four. */
function facesOf(theme: ResolvedTheme): Map<string, Uint8Array> {
  const faces = new Map<string, Uint8Array>();
  let seed = 1;
  for (const face of theme.typefaces.values()) {
    for (const file of face.files) {
      faces.set(file.sha256, Uint8Array.of(0, 1, 0, 0, seed++, 0xff, 0xfe));
    }
  }
  return faces;
}

const DEFAULT_THEME = resolved();

/** Assemble for HTML as the job does, then write it. */
/** The subsetter a domain test is given: every file whole, each call recorded. */
const whole: HtmlWriting['subset'] = (bytes) => bytes;

function written(
  over: Partial<AssembleInput> & { readonly layout?: Layout } = {},
  writing: Partial<Pick<HtmlWriting, 'images' | 'wide' | 'subset'>> = {},
): WrittenHtml & { readonly theme: ResolvedTheme } {
  const theme = over.theme ?? DEFAULT_THEME;
  const assembled = assemble({
    formats: ['html'],
    refused: [],
    layout: defaultLayout,
    theme,
    revision: '0.7',
    covers: () => true,
    assets: new Map<string, PublishingAsset>(),
    ...oneComponent([paragraph('p1', text('Ada wrote this first.'))]),
    ...over,
  } as AssembleInput & { readonly layout: Layout });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  if (assembled.html === null) throw new Error('assembled for no HTML');
  return {
    ...writeHtml({
      document: assembled.document,
      html: assembled.html,
      faces: facesOf(theme),
      images: new Map(),
      subset: whole,
      ...writing,
    }),
    theme,
  };
}

/** What was written, as text, where the writer wrote it whole. */
function htmlOf(writing: WrittenHtml): string {
  if (!writing.ok) throw new Error(JSON.stringify(writing.failures));
  return new TextDecoder().decode(writing.bytes);
}

/** Every face family the file declares with a file inline. */
const declared = (html: string) =>
  new Set(
    [
      ...html.matchAll(
        /font-family: "(aw-face-[\w-]+)"; src: url\("data:font\/(?:ttf|otf);base64,/g,
      ),
    ].map((m) => m[1]),
  );

describe('the HTML writer (the HT plan, HTa)', () => {
  it('is the writer at html/2, which writes every kind (HTb)', () => {
    expect(HTML_WRITER_VERSION).toBe('html/2');
  });

  it('writes one self-contained file: its policy first in its head, its styles and faces inline, nothing fetched', () => {
    const html = htmlOf(written());
    expect(html.startsWith('<!DOCTYPE html>\n<html lang="en-GB" dir="ltr">\n<head>\n')).toBe(true);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const metas = [...head.matchAll(/<meta [^>]*>/g)].map((match) => match[0]);
    // The policy first, so it governs everything after it (HT-L), then the referrer's.
    expect(metas[0]).toBe(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
        "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; " +
        "form-action 'none'\">",
    );
    expect(metas[1]).toBe('<meta name="referrer" content="no-referrer">');
    expect(head).toContain('<meta charset="utf-8">');
    expect(head).toContain('<title>The dosing report</title>');
    // One style element, and nothing else that could fetch: no script, no link, no source.
    expect(head.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script|<link|<iframe|<img|\son\w+=/i);
    expect(html).not.toMatch(/url\("(?!data:)/);
    // The theme's projection, its every rule scoped to the canvas the body is.
    expect(head).toContain('.aw-canvas.aw-canvas [data-role="heading1"]');
    expect(head).toContain('--aw-zoom: 1');
  });

  it('embeds every face the text is set in, as data, and no other (HT-B)', () => {
    const plain = htmlOf(written());
    const serif = DEFAULT_THEME.paragraphStyles.get(DEFAULT_THEME.places.text)!;
    const mono = DEFAULT_THEME.paragraphStyles.get(DEFAULT_THEME.roles.preformatted)!;
    expect(declared(plain)).toContain(`aw-face-${serif.typeface.id}`);
    expect(declared(plain)).not.toContain(`aw-face-${mono.typeface.id}`);
    // Each file whole under a subsetter that keeps it so, in base64: the invented serif's regular's bytes.
    const regular = serif.typeface.files.find(
      (file) => file.weight === 'regular' && file.posture === 'normal',
    )!;
    const bytes = facesOf(DEFAULT_THEME).get(regular.sha256)!;
    expect(plain).toContain(`data:font/ttf;base64,${btoa(String.fromCharCode(...bytes))}`);

    const coded = htmlOf(
      written(oneComponent([{ type: 'preformatted', id: 'c1', text: 'print(1)' }])),
    );
    expect(declared(coded)).toContain(`aw-face-${mono.typeface.id}`);
  });

  it("sets the document's title, the notice's sentence once and the revision in a header, and each node a heading at its depth", () => {
    const deep = ['lvb', 'lvc', 'lvd', 'lve', 'lvf', 'lvg'].reduceRight<unknown[]>(
      (inner, name, index) => [section(name, `Level ${index + 2}`, inner)],
      [],
    );
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [section('lva', 'Level 1', deep), reference('calib', 1)],
    });
    const html = htmlOf(
      written({
        outline,
        occurrences: new Map([
          [id('calib'), component('Calibration', [paragraph('p1', text('Set.'))])],
        ]),
      }),
    );
    const tree = body(html);
    const [header] = all(tree, 'header');
    expect(kids(header!).map((each) => [each.attrs['data-role'], textOf(each)])).toEqual([
      ['title', 'The dosing report'],
      ['noticeSentence', defaultLayout.words.noticeSentence],
      ['running', 'Revision 0.7'],
    ]);
    // Said once: the page's notice is the PDF's, on every page, and HTML has none.
    expect(html.split(defaultLayout.words.notice).length - 1).toBe(1);
    const headings = [...all(tree, 'h1'), ...all(tree, 'h2'), ...all(tree, 'h6')].map((each) => [
      each.name,
      each.attrs['data-role'],
      textOf(each),
    ]);
    expect(headings).toEqual(
      expect.arrayContaining([
        ['h1', 'heading1', '1 Level 1'],
        ['h2', 'heading2', '1.1 Level 2'],
        ['h6', 'heading6', '1.1.1.1.1.1 Level 6'],
        ['h1', 'heading1', '2 Calibration'],
      ]),
    );
    // Deeper than six, a heading by its role and its level, in the sixth's style.
    const seventh = all(tree, 'p').find((each) => each.attrs['role'] === 'heading')!;
    expect(seventh.attrs).toMatchObject({ 'aria-level': '7', 'data-role': 'heading6' });
    expect(textOf(seventh)).toBe('1.1.1.1.1.1.1 Level 7');
    // The contents, a list of links to the layout's depth, with no page numbers (HT-J).
    const [nav] = all(tree, 'nav');
    expect(all(nav!, 'a').map((each) => [each.attrs['href'], textOf(each)])).toEqual([
      [`#n-${id('lva')}`, '1 Level 1'],
      [`#n-${id('lvb')}`, '1.1 Level 2'],
      [`#n-${id('lvc')}`, '1.1.1 Level 3'],
      [`#n-${id('calib')}`, '2 Calibration'],
    ]);
    expect(nav!.attrs['aria-labelledby']).toBe('aw-contents');
    expect(all(tree, 'h1')[0]!.attrs['id']).toBe(`n-${id('lva')}`);
  });

  it('writes runs with their marks nested as the editor renders them, a link keeping no referrer', () => {
    const tree = body(
      htmlOf(
        written(
          oneComponent([
            paragraph(
              'm1',
              text('See '),
              text('the report', { type: 'hyperlink', id: 'k1', href: REPORT }),
              text(', '),
              text('both', { type: 'emphasis', id: 'k2' }, { type: 'strong', id: 'k3' }),
              text(', H'),
              text('2', { type: 'subscript', id: 'k4' }),
              text('O, '),
              text('printer.cfg', { type: 'inlineCode', id: 'k5' }),
              text(' and '),
              text('la mesure', { type: 'language', id: 'k6', tag: 'fr-FR' }),
              text(' <script>&'),
            ),
          ]),
        ),
      ),
    );
    const [p] = all(tree, 'p').filter((each) => each.attrs['data-style'] !== undefined);
    expect(p!.attrs).toMatchObject({ 'data-style': 'body', 'data-place': 'text' });
    expect(textOf(p!)).toBe('See the report, both, H2O, printer.cfg and la mesure <script>&');
    const [a] = all(p!, 'a');
    expect(a!.attrs).toEqual({
      href: REPORT,
      rel: 'noopener noreferrer',
      class: 'aw-mark-hyperlink',
    });
    const [em] = all(p!, 'em');
    expect(em!.attrs['class']).toBe('aw-mark-emphasis');
    // Each mark's text two boxes deep, the next mark inside the inner one, in the published order.
    const [below] = kids(em!);
    expect(below!.attrs['class']).toBe('aw-mark-below');
    const [run] = kids(below!);
    expect(run!.attrs['class']).toBe('aw-mark-run');
    expect(kids(run!)[0]!.name).toBe('strong');
    expect(all(p!, 'sub').map(textOf)).toEqual(['2']);
    expect(all(p!, 'code').map(textOf)).toEqual(['printer.cfg']);
    const [french] = all(p!, 'span').filter((each) => each.attrs['lang'] !== undefined);
    expect(french!.attrs).toMatchObject({ lang: 'fr-FR', dir: 'auto' });
  });

  it('writes lists, quotations and preformatted text as the editor renders them', () => {
    const tree = body(
      htmlOf(
        written(
          oneComponent([
            {
              type: 'list',
              id: 'l1',
              kind: 'ordered',
              start: 3,
              format: 'roman',
              items: [{ content: [paragraph('l1a', text('Warm'))] }],
            },
            {
              type: 'list',
              id: 'l2',
              kind: 'definition',
              items: [{ term: [text('Tray')], content: [paragraph('l2a', text('What holds it'))] }],
            },
            {
              type: 'blockquote',
              id: 'q1',
              content: [paragraph('q1a', text('Measure twice.'))],
              attribution: [text('Grace')],
            },
            { type: 'preformatted', id: 'c1', text: 'a < b\n  c', language: 'python' },
          ]),
        ),
      ),
    );
    const [ol] = all(tree, 'ol').filter((each) => each.attrs['start'] !== undefined);
    expect(ol!.attrs).toEqual({ start: '3', 'data-format': 'roman' });
    expect(all(ol!, 'p')[0]!.attrs['data-place']).toBe('listItem');
    const [dl] = all(tree, 'dl');
    const [group] = kids(dl!);
    expect([group!.name, ...kids(group!).map((each) => each.name)]).toEqual(['div', 'dt', 'dd']);
    expect(kids(group!)[0]!.attrs['data-place']).toBe('listItem');
    const [quotation] = all(tree, 'blockquote');
    expect(all(quotation!, 'p')[0]!.attrs['data-place']).toBe('quotation');
    expect(all(quotation!, 'footer')[0]!.attrs).toEqual({
      class: 'aw-attribution',
      'data-role': 'attribution',
    });
    const [pre] = all(tree, 'pre');
    expect(pre!.attrs).toEqual({ 'data-role': 'preformatted', 'data-language': 'python' });
    expect(textOf(pre!)).toBe('a < b\n  c');
  });

  it('marks a component in another language with its language and its direction', () => {
    const tree = body(
      htmlOf(
        written(
          oneComponent([paragraph('h1', text('Shalom Ada'))], {
            language: 'he-IL',
            direction: 'rtl',
          }),
        ),
      ),
    );
    const [held] = all(tree, 'section').filter((each) => each.attrs['lang'] !== undefined);
    expect(held!.attrs).toMatchObject({ lang: 'he-IL', dir: 'rtl' });
  });

  it('writes the same bytes for the same document, its lines ended by a line feed alone', () => {
    const first = written();
    const second = written();
    expect(htmlOf(first)).toBe(htmlOf(second));
    expect(htmlOf(first)).not.toContain('\r');
    // The default layout's running matter prints its pages, which HTML carries neither of (HT-K).
    expect(first.ok && first.report).toEqual([
      { kind: 'pages_not_carried' },
      { kind: 'running_matter_not_carried' },
    ]);
  });

  it("says a component's mark where it is published in its source language, before its text", () => {
    const assembled = assemble({
      formats: ['html'],
      refused: [],
      layout: defaultLayout,
      theme: DEFAULT_THEME,
      revision: '0.7',
      covers: () => true,
      assets: new Map(),
      untranslated: new Map([[id('calib'), 'Not translated yet']]),
      ...oneComponent([paragraph('p1', text('Ada wrote this first.'))]),
    });
    if (!assembled.ok || assembled.html === null) throw new Error('refused');
    const tree = body(
      htmlOf(
        writeHtml({
          document: assembled.document,
          html: assembled.html,
          faces: facesOf(DEFAULT_THEME),
          images: new Map(),
          subset: whole,
        }),
      ),
    );
    const texts = all(tree, 'p').map(textOf);
    expect(texts.indexOf('Not translated yet')).toBe(texts.indexOf('Ada wrote this first.') - 1);
  });

  it('writes no contents where the layout sets none', () => {
    const layout = structuredClone(defaultLayout);
    delete layout.translations;
    layout.matter.contents = null;
    const tree = body(htmlOf(written({ layout: parseLayout(layout) })));
    expect(all(tree, 'nav')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// HTb: every other kind.
// ---------------------------------------------------------------------------------------------------

const cellOf = (name: string, ...inlines: unknown[]) => ({
  content: [paragraph(name, ...inlines)],
  colspan: 1,
  rowspan: 1,
});
const note = (name: string, ...paragraphs: unknown[]) => ({
  type: 'footnote',
  id: name,
  anchor: { kind: 'span' },
  content: paragraphs,
});
const xref = (name: string, target: object, display = 'number', withoutPages?: string) => ({
  type: 'crossReference',
  id: name,
  target,
  display,
  ...(withoutPages === undefined ? {} : { withoutPages }),
});
const toBlock = (block: string) => ({ kind: 'block', block });
const readings = (name = 't1') => ({
  type: 'table',
  id: name,
  style: 'table',
  caption: [text('Readings')],
  headerRows: 1,
  headerColumns: 1,
  rows: [
    { cells: [cellOf(`${name}a`, text('Site')), cellOf(`${name}b`, text('Level'))] },
    {
      cells: [
        cellOf(`${name}c`, text('York')),
        cellOf(`${name}d`, text('12'), note(`${name}n`, paragraph(`${name}m`, text('Rounded.')))),
      ],
    },
  ],
  note: [text('Measured at noon.')],
});
const X = (alt: string) =>
  `<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="${alt}"><mi>x</mi><mo>+</mo><mn>1</mn></math>`;

const RED = '00000000-0000-4000-8000-00000000a551';
const RED_ASSET: PublishingAsset = {
  object: `t_acme/sha256/${'ab'.repeat(32)}`,
  format: 'png',
  width: 800,
  height: 600,
  alternative: { text: 'Two red squares', language: 'en-GB' },
};
const RED_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
const IMAGES = new Map([[publishedImagePath(RED_ASSET), RED_BYTES]]);

/** A component of these blocks published with its images, the default layout's lists kept. */
const withImages = (blocks: unknown[]) =>
  written({ ...oneComponent(blocks), assets: new Map([[RED, RED_ASSET]]) }, { images: IMAGES });

describe('the HTML writer: every other kind (the HT plan, HTb)', () => {
  it('writes a table as the editor renders one, in its own labelled scrolling region, its notes under it', () => {
    const tree = body(htmlOf(written(oneComponent([readings()]))));
    const [figure] = all(tree, 'figure');
    expect(figure!.attrs).toMatchObject({ class: 'aw-table', 'data-table-style': 'table' });
    const [caption, region, ...after] = kids(figure!);
    expect(caption!.attrs).toMatchObject({ class: 'aw-table-caption', 'data-role': 'caption' });
    expect(textOf(caption!)).toBe('Table 1.1 Readings');
    // A wide table scrolls in its own region, named by the layout's word and reached by the keyboard.
    expect(region!.attrs).toMatchObject({
      role: 'region',
      'aria-label': 'Scrollable table',
      tabindex: '0',
    });
    const [table] = kids(region!);
    expect(table!.attrs['aria-labelledby']).toBe(caption!.attrs['id']);
    const cells = all(table!, 'tr').map((row) =>
      kids(row).map((cell) => [cell.name, cell.attrs['scope'] ?? null, textOf(cell)]),
    );
    expect(cells).toEqual([
      [
        ['th', 'col', 'Site'],
        ['th', 'col', 'Level'],
      ],
      [
        ['th', 'row', 'York'],
        ['td', null, '12a'],
      ],
    ]);
    expect(all(table!, 'p')[0]!.attrs['data-place']).toBe('tableCell');
    // Its note, then each lettered note, under it; the mark a link to its note.
    expect(after.map((each) => [each.attrs['class'], textOf(each)])).toEqual([
      ['aw-table-note', 'Note: Measured at noon.'],
      ['aw-table-note', 'a Rounded.'],
    ]);
    const [mark] = all(table!, 'sup');
    expect(all(mark!, 'a')[0]!.attrs['href']).toBe(`#${after[1]!.attrs['id']}`);
  });

  it('writes a figure and an image in a line from their own bytes, sized as the PDF sets them', () => {
    const tree = body(
      htmlOf(
        withImages([
          {
            type: 'figure',
            id: 'f1',
            asset: RED,
            imageStyle: 'figure',
            caption: [text('Shapes at rest')],
            alternative: { kind: 'inherited' },
          },
          {
            type: 'figure',
            id: 'f2',
            asset: RED,
            imageStyle: 'figure',
            caption: [text('A border')],
            alternative: { kind: 'decorative' },
          },
          paragraph(
            'p1',
            text('Press '),
            { type: 'image', asset: RED, imageStyle: 'inline', alternative: { kind: 'inherited' } },
            text(' to start.'),
          ),
        ]),
      ),
    );
    const images = all(tree, 'img');
    const data = `data:image/png;base64,${btoa(String.fromCharCode(...RED_BYTES))}`;
    expect(images.map((each) => [each.attrs['src'], each.attrs['alt']])).toEqual([
      [data, 'Two red squares'],
      [data, ''],
      [data, 'Two red squares'],
    ]);
    // Its printed width in points, at the canvas's zoom, and its height its own ratio's.
    for (const image of images) {
      expect(image.attrs['style']).toMatch(
        /^width: calc\([\d.]+pt \* var\(--aw-zoom\)\); height: auto;$/,
      );
    }
    const [figure] = all(tree, 'figure');
    expect(figure!.attrs).toMatchObject({ class: 'aw-figure' });
    expect(textOf(all(figure!, 'figcaption')[0]!)).toBe('Figure 1.1 Shapes at rest');
    expect(images[2]!.attrs['class']).toBe('aw-inline-image');
  });

  it('writes footnotes at the end of their top-level section, each linked to its reference and back (HT-I)', () => {
    const tree = body(
      htmlOf(
        written(
          oneComponent([
            paragraph('p1', text('A claim'), note('n1', paragraph('n1a', text('The first note.')))),
            paragraph('p2', text('Another'), note('n2', paragraph('n2a', text('The second.')))),
          ]),
        ),
      ),
    );
    const [section] = all(tree, 'section');
    const notes = kids(section!).at(-1)!;
    expect(notes.attrs['role']).toBe('doc-endnotes');
    const heading = all(notes, 'p').find(
      (each) => each.attrs['id'] === notes.attrs['aria-labelledby'],
    );
    expect(textOf(heading!)).toBe('Notes');
    const items = all(notes, 'li');
    expect(items.map(textOf)).toEqual(['1 The first note.', '2 The second.']);
    const refs = all(section!, 'a').filter((each) => each.attrs['role'] === 'doc-noteref');
    expect(refs.map((each) => [each.attrs['href'], textOf(each)])).toEqual([
      [`#${items[0]!.attrs['id']}`, '1'],
      [`#${items[1]!.attrs['id']}`, '2'],
    ]);
    const back = all(items[0]!, 'a')[0]!;
    expect(back.attrs).toMatchObject({
      role: 'doc-backlink',
      'aria-label': 'Back to reference',
      href: `#${refs[0]!.attrs['id']}`,
    });
  });

  it('STR-055 prints a page reference in its form without pages, as a link to its target', () => {
    const tree = body(
      htmlOf(
        written(
          oneComponent([
            readings(),
            paragraph(
              'p1',
              text('See '),
              xref('x1', toBlock('t1'), 'page', 'numberAndTitle'),
              text(' and '),
              xref('x2', toBlock('t1')),
              text('.'),
            ),
          ]),
        ),
      ),
    );
    const said = all(tree, 'p').find((each) => textOf(each).startsWith('See '))!;
    expect(textOf(said)).toBe('See Table 1.1 Readings and Table 1.1.');
    const target = all(tree, 'figure')[0]!.attrs['id'];
    expect(all(said, 'a').map((each) => each.attrs['href'])).toEqual([`#${target}`, `#${target}`]);
  });

  it('STR-055 fails a page reference with no form without pages where HTML is asked for, naming it', () => {
    const assembled = assemble({
      formats: ['html'],
      refused: [],
      layout: defaultLayout,
      theme: DEFAULT_THEME,
      revision: '0.7',
      covers: () => true,
      assets: new Map(),
      ...oneComponent([
        readings(),
        paragraph('p1', text('See '), xref('x1', toBlock('t1'), 'page')),
      ]),
    });
    expect(assembled.ok ? [] : assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'page_reference_without_pages',
        node: id('calib'),
        block: 'x1',
        detail: null,
      },
    ]);
  });

  it('STR-050 sets nothing for a page break or an appendix starting a new page, and fails nothing', () => {
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        { ...reference('calib', 1), pageBreak: 'page' },
        { ...reference('annex', 2), matter: 'appendix' },
        { ...reference('later', 3), matter: 'appendix' },
      ],
    });
    const layout = structuredClone(defaultLayout);
    layout.matter.appendices.newPage = true;
    const each = (title: string) => component(title, [paragraph('p1', text(`${title} text.`))]);
    const html = htmlOf(
      written({
        outline,
        layout,
        occurrences: new Map([
          [id('calib'), each('Calibration')],
          [id('annex'), each('Annex')],
          [id('later'), each('Later')],
        ]),
      }),
    );
    expect(html).not.toMatch(/break-(before|after)|page-break|<hr/);
    expect(textOf(body(html))).toContain('Later text.');
  });

  it('writes the contents and each list after it as links to what they list, with no page (HT-J)', () => {
    const tree = body(
      htmlOf(
        withImages([
          readings(),
          {
            type: 'figure',
            id: 'f1',
            asset: RED,
            imageStyle: 'figure',
            caption: [text('Shapes')],
            alternative: { kind: 'inherited' },
          },
          { type: 'equation', id: 'e1', mathml: X('x plus one'), numbered: true },
        ]),
      ),
    );
    const navs = all(tree, 'nav');
    const listed = navs.slice(1).map((nav) => ({
      title: textOf(all(nav, 'p')[0]!),
      entries: all(nav, 'a').map((each) => [each.attrs['href'], textOf(each)]),
    }));
    const anchorOf = (name: string) =>
      `#${[...all(tree, 'figure'), ...all(tree, 'div')].find((each) => each.attrs['data-block'] === name)!.attrs['id']}`;
    expect(listed).toEqual(
      defaultLayout.matter.lists.map((list) => ({
        title: list.title,
        entries:
          list.sequence === 'table'
            ? [[anchorOf('t1'), 'Table 1.1 Readings']]
            : list.sequence === 'figure'
              ? [[anchorOf('f1'), 'Figure 1.1 Shapes']]
              : [[anchorOf('e1'), '(1.1)']],
      })),
    );
  });

  it('writes equations as MathML Core with their alternatives, displayed, numbered, in a line and in a title (HT-H)', () => {
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          ...section('intro', 'Introduction', [reference('calib', 1)]),
          title: [text('Rise of '), { type: 'equation', mathml: X('x plus one') }],
        },
      ],
    });
    const tree = body(
      htmlOf(
        written({
          outline,
          occurrences: new Map([
            [
              id('calib'),
              component('Calibration', [
                { type: 'equation', id: 'e1', mathml: X('x plus one'), numbered: true },
                paragraph('p1', text('Let '), { type: 'equation', mathml: X('x plus one') }),
              ]),
            ],
          ]),
        }),
      ),
    );
    const maths = all(tree, 'math');
    for (const each of maths) {
      expect(each.attrs).toMatchObject({ alttext: 'x plus one', 'aria-label': 'x plus one' });
      expect(all(each, 'mi').map(textOf)).toEqual(['x']);
    }
    expect(maths.filter((each) => each.attrs['display'] === 'block')).toHaveLength(1);
    const block = all(tree, 'div').find((each) => each.attrs['class'] === 'aw-equation-block')!;
    expect(all(block, 'span').map(textOf)).toEqual(['Equation 1']);
    // In the heading, in the contents' entry for it, in its block and in the line.
    expect(all(all(tree, 'h1')[0]!, 'math')).toHaveLength(1);
    expect(maths).toHaveLength(4);
  });

  it('writes citations linked to their entries in the bibliography after the last node', () => {
    const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c11';
    const entries = new Map<string, CslItem>([
      [
        MARLOW,
        {
          type: 'book',
          title: 'Sediment and its movement',
          author: [{ family: 'Marlow', given: 'Ada' }],
          issued: { 'date-parts': [[2020]] },
        },
      ],
    ]);
    const layout = structuredClone(defaultLayout);
    layout.matter.bibliography = { title: 'References' };
    const tree = body(
      htmlOf(
        written({
          ...oneComponent([
            paragraph(
              'c1',
              text('Sediment moves '),
              { type: 'citation', entry: MARLOW },
              text('.'),
            ),
          ]),
          layout,
          citations: {
            style: { csl: SEEDED_STYLE_FILES['nlm-citation-sequence'], requires: {} },
            entries: new Map([[id('calib'), entries]]),
            render: renderCitations,
          },
        }),
      ),
    );
    const references = all(tree, 'section').at(-1)!;
    expect(textOf(all(references, 'h1')[0]!)).toBe('References');
    const [entry] = all(references, 'li');
    expect(textOf(entry!)).toMatch(/^1\. Marlow A\. Sediment and its movement/);
    const cited = all(tree, 'a').find((each) => each.attrs['class'] === 'aw-citation')!;
    expect([cited.attrs['href'], textOf(cited)]).toEqual([`#${entry!.attrs['id']}`, '(1)']);
  });

  it('writes each term linked to its glossary entry, and the glossary and abbreviations after the last node', () => {
    const RPM = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c11';
    const term = {
      term: {
        schemaVersion: 1 as const,
        base: 'en',
        labels: [
          {
            language: 'en',
            preferred: 'revolutions per minute',
            alternatives: [],
            abbreviation: 'RPM',
          },
        ],
        definition: [{ language: 'en', text: 'Turns of a shaft in one minute.' }],
        broader: [],
        narrower: [],
        related: [],
      },
      deprecated: false,
    };
    const tree = body(
      htmlOf(
        written({
          ...oneComponent([
            paragraph('c1', text('At '), {
              type: 'text',
              value: 'speed',
              marks: [{ type: 'definedTerm', id: 'm1', term: RPM }],
            }),
          ]),
          terms: { entries: new Map([[id('calib'), new Map([[RPM, term]])]]) },
        }),
      ),
    );
    const [glossary, abbreviations] = all(tree, 'section').slice(-2);
    expect(all(glossary!, 'li').map(textOf)).toEqual([
      'revolutions per minute Turns of a shaft in one minute.',
    ]);
    expect(all(abbreviations!, 'li').map(textOf)).toEqual(['RPM revolutions per minute']);
    const used = all(tree, 'a').find((each) => each.attrs['class'] === 'aw-term')!;
    expect([used.attrs['href'], textOf(used)]).toEqual([
      `#${all(glossary!, 'li')[0]!.attrs['id']}`,
      'revolutions per minute (RPM)',
    ]);
  });

  it('reports a table the PDF set otherwise than at its measure, and what HTML has no place for (HT-K)', () => {
    const writing = written(oneComponent([readings()]), {
      wide: [{ node: id('calib'), block: 't1', set: 'scaled' }],
    });
    expect(writing.ok && writing.report).toEqual([
      { kind: 'pages_not_carried' },
      { kind: 'running_matter_not_carried' },
      { kind: 'table_reflowed', node: id('calib'), block: 't1', label: 'Table 1.1' },
    ]);
    // A layout with no running matter and no contents or lists prints no page HTML could lose.
    const layout = structuredClone(defaultLayout);
    delete layout.translations;
    layout.formats.pdf.head = [[], [], []];
    layout.formats.pdf.foot = [[], [], []];
    layout.matter.contents = null;
    layout.matter.lists = [];
    const bare = written({ layout: parseLayout(layout) });
    expect(bare.ok && bare.report).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// HT-L: content is data, and the leak scan reads what the writer says.
// ---------------------------------------------------------------------------------------------------

/** What an author could type to break out of the markup, in every place words reach. */
const HOSTILE = `<script>alert(1)</script>" onload="alert(2)' onerror='x </style><img src=x onerror=alert(3)> javascript:alert(4)`;

describe('the HTML writer: content is data (the HT plan, HT-L)', () => {
  it('lets nothing hostile out of any kind it writes: no script, no handler, every address its own', () => {
    const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c11';
    const RPM = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c11';
    const h = (value: string) => text(`${value} ${HOSTILE}`);
    const layout = structuredClone(defaultLayout);
    layout.matter.bibliography = { title: 'References' };
    const outline = parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: `The report ${HOSTILE}`,
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          ...section('intro', 'Introduction', [reference('calib', 1)]),
          title: [h('Intro'), { type: 'equation', mathml: X('x') }],
        },
      ],
    });
    const assembled = assemble({
      formats: ['html'],
      refused: [],
      layout,
      theme: DEFAULT_THEME,
      revision: '0.7',
      covers: () => true,
      assets: new Map([[RED, { ...RED_ASSET, alternative: { text: HOSTILE, language: 'en-GB' } }]]),
      outline,
      occurrences: new Map([
        [
          id('calib'),
          component(`Calibration ${HOSTILE}`, [
            paragraph(
              'p1',
              h('Text'),
              text('link', { type: 'hyperlink', id: 'k1', href: REPORT }),
              note('n1', paragraph('n1a', h('Note'))),
              { type: 'equation', mathml: X(`${HOSTILE.replace(/[<>"&']/g, '')}`) },
              {
                type: 'image',
                asset: RED,
                imageStyle: 'inline',
                alternative: { kind: 'inherited' },
              },
              { type: 'citation', entry: MARLOW },
              {
                type: 'text',
                value: 'speed',
                marks: [{ type: 'definedTerm', id: 'm1', term: RPM }],
              },
              xref('x1', toBlock('t1'), 'page', 'numberAndTitle'),
            ),
            {
              ...readings(),
              caption: [h('Caption')],
              note: [h('Table note')],
            },
            {
              type: 'figure',
              id: 'f1',
              asset: RED,
              imageStyle: 'figure',
              caption: [h('Figure')],
              alternative: { kind: 'own', text: HOSTILE },
            },
            { type: 'equation', id: 'e1', mathml: X('x'), numbered: true },
            {
              type: 'list',
              id: 'l1',
              kind: 'definition',
              items: [{ term: [h('Term')], content: [paragraph('l1a', h('Definition'))] }],
            },
            {
              type: 'blockquote',
              id: 'q1',
              content: [paragraph('q1a', h('Quoted'))],
              attribution: [h('Grace')],
            },
            { type: 'preformatted', id: 'c1', text: HOSTILE, language: 'html' },
          ]),
        ],
      ]),
      citations: {
        style: { csl: SEEDED_STYLE_FILES['nlm-citation-sequence'], requires: {} },
        entries: new Map([
          [
            id('calib'),
            new Map<string, CslItem>([
              [
                MARLOW,
                { type: 'book', title: HOSTILE, author: [{ family: 'Marlow', given: 'Ada' }] },
              ],
            ]),
          ],
        ]),
        render: renderCitations,
      },
      terms: {
        entries: new Map([
          [
            id('calib'),
            new Map([
              [
                RPM,
                {
                  term: {
                    schemaVersion: 1 as const,
                    base: 'en',
                    labels: [
                      { language: 'en', preferred: 'rpm', alternatives: [], abbreviation: 'RPM' },
                    ],
                    definition: [{ language: 'en', text: HOSTILE }],
                    broader: [],
                    narrower: [],
                    related: [],
                  },
                  deprecated: false,
                },
              ],
            ]),
          ],
        ]),
      },
    });
    if (!assembled.ok || assembled.html === null) throw new Error(JSON.stringify(assembled));
    // A hyperlink the model would refuse, put into the published document past it: the writer checks.
    const document = JSON.parse(
      JSON.stringify(assembled.document).replaceAll(REPORT, 'javascript:alert(5)'),
    ) as typeof assembled.document;
    const html = htmlOf(
      writeHtml({
        document,
        html: assembled.html,
        faces: facesOf(DEFAULT_THEME),
        images: IMAGES,
        subset: whole,
      }),
    );
    // Every kind it writes holds the words, escaped.
    for (const tag of ['table', 'figure', 'math', 'ol', 'dl', 'blockquote', 'pre', 'nav', 'img']) {
      expect(html, tag).toContain(`<${tag}`);
    }
    expect(html.split(escapeText(HOSTILE)).length).toBeGreaterThan(10);
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/<\/style>/gi)).toHaveLength(1);
    const tags = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((match) => match[0]);
    // Each tag's attributes by name, its values set aside as a browser reads them: every one quoted.
    const names = tags.map((tag) => tag.replace(/"[^"]*"/g, '""'));
    expect(names.filter((tag) => /\son\w+\s*=/i.test(tag) || /'/.test(tag))).toEqual([]);
    const addresses = tags.flatMap((tag) =>
      [...tag.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((match) => match[1]!),
    );
    expect(addresses.length).toBeGreaterThan(5);
    expect(
      addresses.filter(
        (address) =>
          !address.startsWith('#') &&
          !address.startsWith('data:image/png;base64,') &&
          !/^(https?:|mailto:)/.test(address),
      ),
    ).toEqual([]);
    expect(html).not.toContain('javascript:alert(5)"');
  });
});

describe('the HTML writer: the leak scan reads what it says in attributes (the HT plan, HT-L)', () => {
  const SECRET = 'the secret recipe of Ada';

  it("reads an image's alternative from its alt", () => {
    const html = htmlOf(
      written(
        {
          ...oneComponent([
            {
              type: 'figure',
              id: 'f1',
              asset: RED,
              imageStyle: 'figure',
              caption: [text('Shapes')],
              alternative: { kind: 'own', text: SECRET },
            },
          ]),
          assets: new Map([[RED, RED_ASSET]]),
        },
        { images: IMAGES },
      ),
    );
    expect(html).toContain(`alt="${SECRET}"`);
    expect(html.split(SECRET)).toHaveLength(2);
    expect(htmlText(new TextEncoder().encode(html))).toContain(SECRET);
  });

  it("reads an equation's alternative from its alttext, and from its aria-label, each alone", () => {
    const html = htmlOf(
      written(oneComponent([{ type: 'equation', id: 'e1', mathml: X(SECRET), numbered: false }])),
    );
    const without = (attribute: string) =>
      new TextEncoder().encode(html.replaceAll(new RegExp(` ${attribute}="[^"]*"`, 'g'), ''));
    expect(html).toContain(`alttext="${SECRET}"`);
    expect(html).toContain(`aria-label="${SECRET}"`);
    expect(htmlText(without('aria-label'))).toContain(SECRET);
    expect(htmlText(without('alttext'))).toContain(SECRET);
    expect(htmlText(without('(?:alttext|aria-label)'))).not.toContain(SECRET);
  });

  it("reads a table's region and a note's link back by their aria-label, the layout's words", () => {
    const html = htmlOf(written(oneComponent([readings()])));
    const read = htmlText(new TextEncoder().encode(html.replaceAll('Scrollable table', SECRET)));
    expect(read).toContain(SECRET);
  });
});

describe('the HTML writer: each face subset to what it sets (the HT plan, HT-B)', () => {
  const ARABIC = /\p{Script=Arabic}/u;
  const naskh = DEFAULT_THEME.typefaces.get('naskh')!;
  /** Naskh covers Arabic and the space; every other face everything but Arabic. */
  const covers = (codePoint: number, family: string) =>
    family === naskh.family
      ? ARABIC.test(String.fromCodePoint(codePoint)) || codePoint === 0x20
      : !ARABIC.test(String.fromCodePoint(codePoint));
  /** Each file the writer asked for, by its first bytes' seed, and the characters it asked it for. */
  const asked = () => {
    const calls = new Map<number, string>();
    const subset: HtmlWriting['subset'] = (bytes, codePoints) => {
      calls.set(bytes[4]!, String.fromCodePoint(...codePoints));
      return bytes;
    };
    return { calls, subset };
  };
  const seedOf = (sha256: string) => facesOf(DEFAULT_THEME).get(sha256)![4]!;

  it('subsets each face to the characters it sets, and embeds no fallback a Latin document does not fall to', () => {
    const { calls, subset } = asked();
    const html = htmlOf(written({ covers }, { subset }));
    expect(declared(html)).not.toContain('aw-face-naskh');
    const regular = DEFAULT_THEME.typefaces
      .get('serif')!
      .files.find((file) => file.weight === 'regular' && file.posture === 'normal')!;
    const serif = calls.get(seedOf(regular.sha256))!;
    for (const character of 'Ada wrote this first.') expect(serif).toContain(character);
    expect(serif).not.toMatch(/[QZ]/);
    // Every file of a face it sets is subset alike, so a bold or an italic run finds its characters.
    expect(calls.size).toBeGreaterThan(1);
  });

  it('embeds the Naskh where an Arabic word falls to it, its characters alone, declared once for both postures', () => {
    const { calls, subset } = asked();
    const word = String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
    const html = htmlOf(
      written(
        { covers, ...oneComponent([paragraph('p1', text(`Ada said ${word} to Grace.`))]) },
        { subset },
      ),
    );
    expect(declared(html)).toContain('aw-face-naskh');
    const [regular] = naskh.files;
    expect(calls.get(seedOf(regular!.sha256))).toBe(
      String.fromCodePoint(0x0627, 0x0628, 0x062d, 0x0631, 0x0645),
    );
    // No italic file: declared upright once, its file carried once, and the page synthesises no slant.
    const declarations = [...html.matchAll(/@font-face \{ font-family: "aw-face-naskh";[^}]*\}/g)];
    expect(declarations.map((each) => /font-style: (\w+)/.exec(each[0])![1])).toEqual([
      'normal',
      'normal',
    ]);
    expect(html).toContain('font-synthesis-style: none');
  });
});
