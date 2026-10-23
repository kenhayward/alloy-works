import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import type { Term } from '../library/term.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import type { ResolvedTheme } from '../theme/read.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble } from './assemble.js';
import {
  defaultLayout,
  LAYOUT_SCHEMA_VERSION,
  TENTH_DEFAULT_LAYOUT,
  type Layout,
} from './layout.js';
import type {
  PublishedBlock,
  PublishedDocument,
  PublishedInline,
  PublishedMark,
} from './published.js';
import { termPlaces, type PublishingTerm } from './terms.js';

/**
 * **Terms published** (the TM plan, TMb): each use printing its term's forms by the theme's rule, first
 * use in reading order, labels in the document's language, the glossary and the abbreviations, and
 * what a publish reports of its terms.
 */

const id = (name: string) => name.padEnd(26, 'a');
const NODE = id('pump');
const TITLED = id('intro');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const RPM = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
const TORQUE = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c02';
const PSI = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
const KPA = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c04';
const APEX = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c05';
const DRAFT = '1c0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c06';

const term = (
  labels: Term['labels'],
  definition: Term['definition'] = [],
  more: Partial<Term> = {},
): Term => ({
  schemaVersion: 1,
  base: 'en',
  labels,
  definition,
  broader: [],
  narrower: [],
  related: [],
  ...more,
});

/** Invented terms of an invented pump. */
const TERMS: Readonly<Record<string, PublishingTerm>> = {
  [RPM]: {
    term: term(
      [
        {
          language: 'en',
          preferred: 'revolutions per minute',
          alternatives: [],
          abbreviation: 'RPM',
        },
      ],
      [{ language: 'en', text: 'Turns of a shaft in one minute.' }],
    ),
    deprecated: false,
  },
  [TORQUE]: {
    term: term(
      [
        { language: 'en', preferred: 'Torque', alternatives: [] },
        { language: 'de', preferred: 'Drehmoment', alternatives: [] },
      ],
      [
        { language: 'en', text: 'A turning force.' },
        { language: 'de', text: 'Eine drehende Kraft.' },
      ],
    ),
    deprecated: false,
  },
  [PSI]: {
    term: term(
      [
        {
          language: 'en',
          preferred: 'pounds per square inch',
          alternatives: [],
          abbreviation: 'psi',
        },
      ],
      [],
      { replacedBy: KPA },
    ),
    deprecated: true,
  },
  [APEX]: {
    term: term(
      [{ language: 'en', preferred: 'apex', alternatives: [], abbreviation: 'AX' }],
      [{ language: 'en', text: 'The highest point.' }],
    ),
    deprecated: false,
  },
};

const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const termed = (value: string, mark: string, of: string, ...marks: object[]) =>
  text(value, ...marks, { type: 'definedTerm', id: mark, term: of });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
const footnote = (name: string, ...paragraphs: unknown[]) => ({
  type: 'footnote',
  id: name,
  anchor: { kind: 'span' },
  content: paragraphs,
});
const tableOf = (name: string, ...caption: unknown[]) => ({
  type: 'table',
  id: name,
  style: 'table',
  caption,
  headerRows: 0,
  headerColumns: 0,
  rows: [{ cells: [{ content: [paragraph(`${name}c`, text('1'))], colspan: 1, rowspan: 1 }] }],
});

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };

const outline = (language: string, title: unknown[] | null): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The pump report',
    language,
    direction: 'ltr',
    nodes: [
      ...(title === null
        ? []
        : [{ type: 'section', id: TITLED, title, ...positional, children: [] }]),
      {
        type: 'reference',
        id: NODE,
        component: COMPONENT,
        mode: { kind: 'latest' },
        ...positional,
        children: [],
      },
    ],
  });

const component = (...content: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'The pump',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

const all = () => new Map(Object.entries(TERMS));

const publish = (
  content: ContentDocument,
  over: {
    layout?: Layout;
    theme?: ResolvedTheme;
    language?: string;
    title?: unknown[];
    terms?: ReadonlyMap<string, PublishingTerm>;
  } = {},
) =>
  assemble({
    formats: ['pdf'],
    outline: outline(over.language ?? 'en-GB', over.title ?? null),
    occurrences: new Map([[NODE, content]]),
    refused: [],
    layout: over.layout ?? defaultLayout,
    theme: over.theme ?? resolved(),
    revision: '0.1',
    covers: (codePoint) => codePoint < 0x2100,
    assets: new Map(),
    terms: {
      entries: new Map([
        [NODE, over.terms ?? all()],
        [TITLED, over.terms ?? all()],
      ]),
    },
  });

const published = (assembled: ReturnType<typeof publish>): PublishedDocument => {
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return assembled.document as PublishedDocument;
};

const warningsOf = (assembled: ReturnType<typeof publish>) => {
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return assembled.terms;
};

/** Every term the document prints, in the order its blocks hold them, notes at their marks. */
const termsOf = (document: PublishedDocument) => {
  const found: { text: string; marks: readonly PublishedMark[]; link: string | null }[] = [];
  const runs = (inlines: readonly PublishedInline[]) => {
    for (const run of inlines) {
      if ('term' in run) found.push(run.term);
      if ('footnote' in run) blocks(run.footnote.paragraphs);
    }
  };
  const blocks = (each: readonly PublishedBlock[]) => {
    for (const block of each) {
      if (block.type === 'paragraph') runs(block.runs);
      if (block.type === 'table') runs(block.caption);
    }
  };
  for (const node of document.nodes) blocks(node.blocks);
  return found;
};
const printed = (document: PublishedDocument) => termsOf(document).map((each) => each.text);
const paragraphText = (document: PublishedDocument) =>
  document.nodes
    .flatMap((node) => node.blocks)
    .flatMap((block) => (block.type === 'paragraph' ? block.runs : []))
    .map((run) => ('text' in run ? run.text : 'term' in run ? run.term.text : ''))
    .join('');

describe('terms published (TMb)', () => {
  it('LIB-016 expands a term on its first use in reading order, a footnote at its mark, and prints its abbreviation after', () => {
    const document = published(
      publish(
        component(
          paragraph(
            'p1',
            text('The '),
            termed('speed', 'm1', RPM),
            footnote('f1', paragraph('fp1', text('Measured in '), termed('rpm', 'm2', RPM))),
            text(' rose.'),
          ),
          paragraph('p2', text('Then '), termed('rpm', 'm3', RPM), text(' fell.')),
        ),
      ),
    );
    expect(printed(document)).toEqual(['revolutions per minute (RPM)', 'RPM', 'RPM']);
    expect(paragraphText(document)).toBe('The revolutions per minute (RPM) rose.Then RPM fell.');
  });

  it('LIB-017 prints every use expanded where the theme says always, and the abbreviation alone where it says never', () => {
    const content = component(
      paragraph('p1', termed('rpm', 'm1', RPM), text(' and '), termed('rpm', 'm2', RPM)),
    );
    const always = { ...resolved(), termExpansion: 'always' as const };
    const never = { ...resolved(), termExpansion: 'never' as const };
    expect(printed(published(publish(content, { theme: always })))).toEqual([
      'revolutions per minute (RPM)',
      'revolutions per minute (RPM)',
    ]);
    expect(printed(published(publish(content, { theme: never })))).toEqual(['RPM', 'RPM']);
  });

  it('prints its preferred label where a term has no abbreviation, whatever the rule', () => {
    const content = component(
      paragraph('p1', termed('the force', 'm1', TORQUE), text(', '), termed('it', 'm2', TORQUE)),
    );
    expect(printed(published(publish(content)))).toEqual(['Torque', 'Torque']);
  });

  it('prints the preferred label in a heading, which is no use, so the first use after it is expanded', () => {
    const document = published(
      publish(component(paragraph('p1', termed('rpm', 'm1', RPM))), {
        title: [text('On '), termed('speed', 't1', RPM)],
      }),
    );
    expect(document.nodes[0]!.title).toEqual([{ text: 'On revolutions per minute', marks: [] }]);
    expect(printed(document)).toEqual(['revolutions per minute (RPM)']);
  });

  it('counts a split span as two uses, and prints one span over two text nodes once, in the marks of its first character', () => {
    const strong = { type: 'strong', id: 's1' };
    const document = published(
      publish(
        component(
          paragraph(
            'p1',
            termed('r', 'm1', RPM, strong),
            termed('pm', 'm1', RPM),
            text(' then '),
            // Split: one span become two marks side by side.
            termed('rp', 'm2', RPM),
            termed('m', 'm3', RPM),
          ),
        ),
      ),
    );
    expect(termsOf(document).map(({ text: words, marks }) => ({ words, marks }))).toEqual([
      { words: 'revolutions per minute (RPM)', marks: [{ kind: 'strong' }] },
      { words: 'RPM', marks: [] },
      { words: 'RPM', marks: [] },
    ]);
  });

  it("LIB-014 LIB-050 prints labels in the document's language, else the base language's, and reports each fallback by term and language", () => {
    const assembled = publish(
      component(
        paragraph('p1', termed('torque', 'm1', TORQUE), text(' at '), termed('rpm', 'm2', RPM)),
      ),
      { language: 'de' },
    );
    expect(printed(published(assembled))).toEqual(['Drehmoment', 'revolutions per minute (RPM)']);
    expect(warningsOf(assembled)).toEqual([
      { code: 'term_fallback', term: RPM, count: 1, language: 'de' },
    ]);
  });

  it('prints a draft, unreadable or missing term as the words it covers, and reports it without failing', () => {
    const assembled = publish(
      component(paragraph('p1', text('A '), termed('gauge', 'm1', DRAFT), text(' reads.'))),
    );
    const document = published(assembled);
    expect(printed(document)).toEqual([]);
    expect(paragraphText(document)).toBe('A gauge reads.');
    expect(warningsOf(assembled)).toEqual([{ code: 'term_unresolved', term: DRAFT, count: 1 }]);
  });

  it('LIB-018 prints a deprecated term, and reports it where it is used, naming its replacement', () => {
    const assembled = publish(
      component(paragraph('p1', termed('psi', 'm1', PSI), text(', '), termed('psi', 'm2', PSI))),
    );
    expect(printed(published(assembled))).toEqual(['pounds per square inch (psi)', 'psi']);
    expect(warningsOf(assembled)).toEqual([
      { code: 'term_deprecated', term: PSI, count: 2, replacedBy: KPA },
    ]);
  });

  it("PUB-039 generates the glossary and the abbreviations from the approved terms used, in the document language's collation, each use linked to its entry", () => {
    const document = published(
      publish(
        component(
          paragraph(
            'p1',
            termed('torque', 'm1', TORQUE),
            text(', '),
            termed('rpm', 'm2', RPM),
            text(', '),
            termed('apex', 'm3', APEX),
            text(', '),
            termed('gauge', 'm4', DRAFT),
          ),
          tableOf('f1', termed('torque', 'm5', TORQUE)),
        ),
      ),
    );
    // In collation `apex` comes first, though `R` and `T` come before `a` by code point.
    expect(document.back.glossary).toEqual({
      title: 'Glossary',
      entries: [
        { anchor: `g-${APEX}`, label: 'apex', definition: 'The highest point.' },
        {
          anchor: `g-${RPM}`,
          label: 'revolutions per minute',
          definition: 'Turns of a shaft in one minute.',
        },
        { anchor: `g-${TORQUE}`, label: 'Torque', definition: 'A turning force.' },
      ],
    });
    expect(document.back.abbreviations).toEqual({
      title: 'Abbreviations',
      entries: [
        { abbreviation: 'AX', label: 'apex' },
        { abbreviation: 'RPM', label: 'revolutions per minute' },
      ],
    });
    // Linked in running text, and set as text in a caption, as a citation is.
    expect(termsOf(document).map((each) => each.link)).toEqual([
      `g-${TORQUE}`,
      `g-${RPM}`,
      `g-${APEX}`,
      null,
    ]);
  });

  it('places neither under a layout declaring none, and links no use', () => {
    const document = published(
      publish(component(paragraph('p1', termed('rpm', 'm1', RPM))), {
        layout: { ...TENTH_DEFAULT_LAYOUT, schemaVersion: LAYOUT_SCHEMA_VERSION },
      }),
    );
    expect(document.back).toMatchObject({ glossary: null, abbreviations: null });
    expect(termsOf(document)).toEqual([
      { text: 'revolutions per minute (RPM)', marks: [], link: null },
    ]);
  });

  it('finds each use a component holds for the store to report, a split span twice', () => {
    expect(
      termPlaces(
        component(
          paragraph('p1', termed('a', 'm1', RPM), termed('b', 'm2', RPM)),
          tableOf('f1', termed('c', 'm3', TORQUE)),
        ),
      ).map((each) => each.term),
    ).toEqual([RPM, RPM, TORQUE]);
  });
});
