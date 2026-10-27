import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { scanXml } from '../content/ooxml/xml.js';
import { assemble, type AssembleInput, type PublishingAsset } from '../publishing/assemble.js';
import type { PublishFailure } from '../publishing/failures.js';
import { defaultLayout, parseLayout, type Layout } from '../publishing/layout.js';
import { OUTLINE_SCHEMA_VERSION, parseOutlineDocument } from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import { resolved } from '../theme/theme.fixture.js';

import { HTML_WRITER_VERSION, writeHtml, type WrittenHtml } from './write.js';

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
function written(
  over: Partial<AssembleInput> & { readonly layout?: Layout } = {},
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
    ...writeHtml({ document: assembled.document, html: assembled.html, faces: facesOf(theme) }),
    theme,
  };
}

/** What was written, as text, where the writer wrote it whole. */
function htmlOf(writing: WrittenHtml): string {
  if (!writing.ok) throw new Error(JSON.stringify(writing.failures));
  return new TextDecoder().decode(writing.bytes);
}

const failuresOf = (writing: WrittenHtml): readonly PublishFailure[] =>
  writing.ok ? [] : writing.failures;

describe('the HTML writer (the HT plan, HTa)', () => {
  it('is the writer at html/1', () => {
    expect(HTML_WRITER_VERSION).toBe('html/1');
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

  it('embeds every face the text is set in, and its fallbacks whole, as data, and no other (HT-B)', () => {
    const plain = htmlOf(written());
    const serif = DEFAULT_THEME.paragraphStyles.get(DEFAULT_THEME.places.text)!;
    const mono = DEFAULT_THEME.paragraphStyles.get(DEFAULT_THEME.roles.preformatted)!;
    const declared = (html: string) =>
      new Set(
        [
          ...html.matchAll(/font-family: "(aw-face-[\w-]+)"; src: url\("data:font\/ttf;base64,/g),
        ].map((m) => m[1]),
      );
    for (const face of serif.chain) expect(declared(plain)).toContain(`aw-face-${face.id}`);
    expect(declared(plain)).not.toContain(`aw-face-${mono.typeface.id}`);
    // Each file whole, in base64: the invented serif's regular file's seven bytes.
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

  it('refuses html_not_yet each block, inline and title it does not write yet, naming where it stands', () => {
    const cell = { content: [paragraph('t1c', text('12'))], colspan: 1, rowspan: 1 };
    const X = '<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x"><mi>x</mi></math>';
    const writing = written(
      oneComponent([
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [text('Readings')],
          headerRows: 0,
          headerColumns: 0,
          rows: [{ cells: [cell] }],
        },
        { type: 'equation', id: 'e1', mathml: X, numbered: false },
        paragraph(
          'p1',
          text('Let '),
          { type: 'equation', mathml: X },
          text(' rise'),
          {
            type: 'footnote',
            id: 'n1',
            anchor: { kind: 'span' },
            content: [paragraph('n1a', text('Says Grace.'))],
          },
          text(' as '),
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 't1' },
            display: 'number',
          },
        ),
      ]),
    );
    const at = (block: string, detail: string) => ({
      stage: 'compose',
      code: 'html_not_yet',
      node: id('calib'),
      block,
      detail,
    });
    expect(failuresOf(writing)).toEqual([
      // Generated matter first, where it stands: the list of tables after the contents.
      { stage: 'compose', code: 'html_not_yet', node: null, block: null, detail: 'listOf:table' },
      at('t1', 'table'),
      at('e1', 'equation'),
      at('p1', 'equation'),
      at('p1', 'footnote'),
      at('p1', 'reference'),
    ]);
  });

  it('writes the same bytes for the same document, its lines ended by a line feed alone', () => {
    const first = written();
    const second = written();
    expect(htmlOf(first)).toBe(htmlOf(second));
    expect(htmlOf(first)).not.toContain('\r');
    expect(first.ok && first.report).toEqual([]);
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
