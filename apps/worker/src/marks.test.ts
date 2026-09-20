import { createHash } from 'node:crypto';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type AssembleInput,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedMark,
  type PublishedNode,
  type PublishedRun,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-20T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const TARGET = 'https://example.test/report';
const LINKED = 'see the report now';
const QUOTED = '"measure twice"';
const CODE = 'printer.cfg';

/**
 * Every kind a published run can carry. Written as a record rather than a list so that a tenth kind
 * added to `PublishedMark` fails to compile here: the fixture below sets every one of them, and a
 * kind nothing sets is a kind no PDF in this suite has ever been read for.
 */
const EVERY_MARK: Record<PublishedMark['kind'], true> = {
  emphasis: true,
  strong: true,
  underline: true,
  subscript: true,
  superscript: true,
  inlineCode: true,
  quotedPhrase: true,
  hyperlink: true,
  language: true,
};

/**
 * The marked component: two paragraphs carrying all nine marks a published run can hold. The link's
 * text, the quoted phrase and the code are each a run of their own, so a reader's extraction can be
 * read for them. `printer.cfg` carries inline code **and** emphasis, which is the run pre-flight F1
 * is about.
 */
const component = () =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Fitting the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          { type: 'text', value: 'Ada asks you to ', marks: [] },
          {
            type: 'text',
            value: LINKED,
            marks: [{ type: 'hyperlink', id: 'k1', href: TARGET, title: 'The survey report' }],
          },
          { type: 'text', value: ' and to check the readings.', marks: [] },
        ],
      },
      {
        type: 'paragraph',
        id: 'p2',
        style: 'body',
        content: [
          { type: 'text', value: 'The ', marks: [] },
          { type: 'text', value: 'emphasis', marks: [{ type: 'emphasis', id: 'k2' }] },
          { type: 'text', value: ', the ', marks: [] },
          { type: 'text', value: 'strong', marks: [{ type: 'strong', id: 'k3' }] },
          { type: 'text', value: ' and the ', marks: [] },
          { type: 'text', value: 'underline', marks: [{ type: 'underline', id: 'k4' }] },
          { type: 'text', value: ' marks are set, water is H', marks: [] },
          { type: 'text', value: '2', marks: [{ type: 'subscript', id: 'k5' }] },
          { type: 'text', value: 'O, the note is marked ', marks: [] },
          { type: 'text', value: '1', marks: [{ type: 'superscript', id: 'k6' }] },
          { type: 'text', value: ', Grace edited ', marks: [] },
          {
            type: 'text',
            value: CODE,
            marks: [
              { type: 'emphasis', id: 'k7' },
              { type: 'inlineCode', id: 'k8' },
            ],
          },
          { type: 'text', value: ' and wrote ', marks: [] },
          { type: 'text', value: QUOTED, marks: [{ type: 'quotedPhrase', id: 'k9' }] },
          { type: 'text', value: ' beside ', marks: [] },
          {
            type: 'text',
            value: 'la mesure',
            marks: [{ type: 'language', id: 'k10', tag: 'fr-FR' }],
          },
          { type: 'text', value: '.', marks: [] },
        ],
      },
    ],
  });

/**
 * A layout with neither a cover nor a contents, so the document opens on the first page: the marked
 * paragraphs are on page one, where the link annotation and the tagged text are read for.
 */
const bare = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false } },
});

/** What the job would assemble of that component alone, under the bare layout. */
const inputOf = (): AssembleInput => ({
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The printer notes',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('fitting'),
        component: COMPONENT,
        mode: { kind: 'latest' },
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        values: {},
        children: [],
      },
    ],
  }),
  occurrences: new Map([[id('fitting'), component()]]),
  refused: [],
  layout: bare,
  revision: '0.1',
  covers: fonts.covers,
});

/** The published document the job would hand the template, which is under a layout and so marked. */
const assembled = (): PublishedDocument => {
  const made = assemble(inputOf());
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  // `assemble` makes the first slice's shape for a request made before layouts, whose runs are text
  // alone; this fixture declares one, so anything else here is a fixture that stopped being marked.
  if (made.document.schema !== PUBLISHING_SCHEMA) {
    throw new Error(`Assembled ${made.document.schema}, which carries no marks`);
  }
  return made.document;
};

/** That document as the JSON text the template reads. */
const markedDocument = () => JSON.stringify(assembled());

/** Every kind of mark the document's runs carry, at any depth - a list item holds blocks too. */
const kindsIn = (document: PublishedDocument) => {
  const kinds = new Set<string>();
  const marksIn = (runs: readonly PublishedRun[]) => {
    for (const run of runs) for (const mark of run.marks) kinds.add(mark.kind);
  };
  // The paragraph branch is the positive test, so a third published block kind fails to compile
  // here rather than being read as a list and quietly contributing no marks.
  const inBlocks = (blocks: readonly PublishedBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        marksIn(block.runs);
        continue;
      }
      for (const item of block.items) {
        marksIn(item.term ?? []);
        inBlocks(item.blocks);
      }
    }
  };
  const walk = (node: PublishedNode) => {
    inBlocks(node.blocks);
    for (const child of node.children) walk(child);
  };
  for (const node of document.nodes) walk(node);
  return kinds;
};

/** Each compile once: the engine takes a second or two a document. */
const made = new Map<string, Promise<{ pdf: Buffer; read: ReadPdf }>>();
const compileOne = (data: string) => {
  let compiling = made.get(data);
  if (compiling === undefined) {
    compiling = (async () => {
      const pdf = await typst.compile(PUBLICATION_TEMPLATE[3].file, data, at);
      return { pdf, read: await readPdf(pdf) };
    })();
    made.set(data, compiling);
  }
  return compiling;
};

/** What a reader's text extraction gives back of some runs, as one string. */
const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ').trim();

/** How many times a phrase is said in some text. */
const times = (said: string, phrase: string) => said.split(phrase).length - 1;

const digest = (pdf: Buffer) => createHash('sha256').update(pdf).digest('hex');

/**
 * Every character a quotation is set with in any language an engine might choose for it: the straight
 * pair, the curly pairs, the guillemets and the low quotes. Counting the author's own characters
 * alone would not see a pair the engine added, because the pair it adds is typographic and the
 * author's are whatever they typed.
 */
const QUOTATION =
  /["'\u{2018}\u{2019}\u{201a}\u{201b}\u{201c}\u{201d}\u{201e}\u{201f}\u{00ab}\u{00bb}\u{2039}\u{203a}]/gu;

describe('the PDF a marked document makes', () => {
  it('sets every mark, links what is linked, and passes veraPDF', async () => {
    // Every kind is really in the fixture, so that what passes below passed with all nine set.
    expect([...kindsIn(assembled())].sort()).toEqual(Object.keys(EVERY_MARK).sort());

    const { pdf, read } = await compileOne(markedDocument());

    // What a screen reader is told: a link, code and a quotation, beside the paragraphs themselves.
    expect(read.roles).toContain('Link');
    expect(read.roles).toContain('Code');
    expect(read.roles).toContain('Quote');
    // And what a reader's viewer would follow, on the page the marked paragraphs are on: the
    // author's target and no other. The layout declares no contents, so no link into the document
    // itself is set either.
    expect(read.links[0]).toEqual([TARGET]);
    expect(spoken(read.taggedText[0]!)).toContain(LINKED);

    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  }, 120_000);

  it('keeps a run that is code and emphasised whatever order its marks arrive in', async () => {
    const data = markedDocument();
    const { read } = await compileOne(data);
    expect(read.roles).toContain('Code');
    expect(spoken(read.taggedText[0]!)).toContain(CODE);

    // `assemble` writes a run's marks in one fixed order and `inlineCode` is last in it, so the
    // fold in template 3 could not lose the emphasis whatever it did. The template's own rule is
    // wider than that: it reads the document as data, and no order of a run's marks may silence
    // one. So the same document is compiled again with this run's two marks the other way round -
    // the order `assemble` does not write today, and the one a later order could - and the two PDFs
    // must be the same file. They are not when `inlineCode` is applied inside the fold, because
    // Typst's `raw` takes text rather than a body and replaces everything applied before it.
    const FORWARD = '"marks":[{"kind":"emphasis"},{"kind":"inlineCode"}]';
    const REVERSED = '"marks":[{"kind":"inlineCode"},{"kind":"emphasis"}]';
    expect(data).toContain(FORWARD);
    const swapped = data.replace(FORWARD, REVERSED);
    const { pdf } = await compileOne(data);
    const { pdf: other, read: read2 } = await compileOne(swapped);
    expect(read2.roles).toContain('Code');
    // The roles first, and the bytes after. A mark lost inside the fold takes its structure element
    // with it, so this names what went missing; the digests say the whole file is the same one, and
    // would be two unreadable hex strings on their own if the engine ever stopped being repeatable.
    expect(read2.roles).toEqual(read.roles);
    expect(digest(other)).toBe(digest(pdf));
  }, 120_000);

  it('says a quoted phrase is a quotation and adds no quotation marks of its own', async () => {
    const { read } = await compileOne(markedDocument());
    expect(read.roles).toContain('Quote');
    // The author's own characters, once: the editor shows a quoted phrase without a pair of its
    // own, and the template sets it with `quotes: false`, so the two cannot drift apart.
    const said = spoken(read.taggedText[0]!);
    expect(times(said, QUOTED)).toBe(1);
    expect(said.match(QUOTATION) ?? []).toEqual(['"', '"']);
  }, 120_000);

  it('tells a reader which run is in another language, and says nothing of any other run', async () => {
    const { read } = await compileOne(markedDocument());
    // A language mark is the one mark whose whole purpose is assistive technology, and it reaches a
    // reader as a property of the run's marked content rather than as a role: nothing in `roles` or
    // in the tagged text moves when it is dropped. What a screen reader changes voice for is this.
    const said = read.languages
      .flat()
      .map((each) => ({ language: each.language, text: spoken(each.runs) }));
    // Two languages are declared anywhere in the document and no third: the document's own, which
    // the engine repeats on each span it writes for a mark, and the one the author set apart.
    expect(read.language).toBe('en-GB');
    expect([...new Set(said.map((each) => each.language))].sort()).toEqual(['en-GB', 'fr-FR']);
    // And exactly one run is in a language other than the document's - the author's French words,
    // and no part of the sentence around them.
    expect(said.filter((each) => each.language !== read.language)).toEqual([
      { language: 'fr-FR', text: 'la mesure' },
    ]);
  }, 120_000);
});
