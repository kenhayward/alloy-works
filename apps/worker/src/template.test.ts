import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assemble,
  defaultLayout,
  DRAFT_NOTICE,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  PUBLISHING_SCHEMA_2,
  PUBLISHING_SCHEMA_3,
  type AssembleInput,
  type Layout,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PIPELINE_VERSION } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;
const fonts = await loadPinnedFonts();

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    // Of each file with LF endings (.gitattributes normalises them). Were a row to fail, that template
    // changed: put it back and make the next directory, never move a published version's hash.
    // Template 1's moved once, before anything was published: the document's title became a heading
    // (it had been Typst's `title()`, which a screen reader hears as a paragraph), so no publication
    // names the old bytes. Template 2 is re-pinned freely until the pull request that makes it
    // merges, since nothing is published from a branch. It moved from the port of template 1
    // (b02df4a5...) when it came to set the layout's page, its cover and each matter's page numbers,
    // again (dad852c3...) when a comment said what starts each matter on a page of its own, again
    // (729e21cd...) when it came to set the running heads and feet, the contents and the appendices,
    // and again (5ec19bf6...) when the cover shed a disjunct `assemble` can never reach - a document
    // with no nodes and no cover is refused before Typst sees it, so only the cover opened it.
    // Template 3 is template 2 with a run's marks set, and reads `publishing/3`. Template 4 is
    // template 3 with a block that can be a list, and reads `publishing/4`; it is re-pinned freely
    // until the pull request that makes it merges, since nothing is published from a branch. It
    // moved once (e1a41129...), when two comments were made exact: that the three markers are
    // cycled rather than a ceiling on the nesting, and that a refused compile tells the author the
    // publish failed and never which block did it. No line that sets anything changed.
    // Templates 1, 2 and 3 are published versions and their rows never move again.
    const pinned: Record<number, string> = {
      1: 'e8afabbac53bb797cfb024937ef4387834994a2d50062a029510d9ff300f58b0',
      2: '01bb7d4058901cdf904e05696bb1ccdf4a202a7802d3f7e420f8230d67290e54',
      3: '682840cb57284deec3ccfd2c29a7c738f5013b2cc233971d177c34c3f4ac5381',
      4: '13b8f620f4b7bc4c627360aa30ea48d595745df5d01290558d57cf6677f6ba43',
    };
    const hashes: Record<number, string> = {};
    for (const template of Object.values(PUBLICATION_TEMPLATE)) {
      expect(template.name).toBe('publication');
      hashes[template.version] = createHash('sha256')
        .update(await readFile(template.file))
        .digest('hex');
    }
    // Every template the worker can compile with is pinned, and nothing pinned is missing.
    expect(hashes).toEqual(pinned);
  });

  it("is chosen by the schema of the document it reads: slice 1's for a request made before layouts", () => {
    // Written as LITERAL strings and numbers, never through the constants. `TEMPLATE_READING` is
    // declared with a computed key, so the day `PUBLISHING_SCHEMA` is repointed the key moves and
    // the value stays behind - and `satisfies Record<PublishedSchema, ...>` cannot catch it, since
    // `PublishedSchema` is derived from the same constant. Asserted through the constants this row
    // would move with them and say nothing. It has now cost three slices; it stops here.
    expect(TEMPLATE_READING).toEqual({ 'publishing/1': 1, 'publishing/4': 4 });
  });

  it('reads the schema it was written for, and a frozen schema stays frozen', async () => {
    // Each template asserts its own schema string on the first line it runs, so a document is never
    // read by a template that cannot read it. This is also the only reader of `PUBLISHING_SCHEMA_2`
    // and of `PUBLISHING_SCHEMA_3`: templates 2 and 3 are immutable and their bytes say
    // `publishing/2` and `publishing/3`, so were either frozen constant ever repointed - the
    // accident this whole pair exists to stop - the row that names it is what goes red.
    const reads: Record<number, string> = {
      1: PUBLISHING_SCHEMA_1,
      2: PUBLISHING_SCHEMA_2,
      3: PUBLISHING_SCHEMA_3,
      4: PUBLISHING_SCHEMA,
    };
    for (const template of Object.values(PUBLICATION_TEMPLATE)) {
      const source = await readFile(template.file, 'utf8');
      expect(source, `template ${template.version}`).toContain(
        `#assert(doc.schema == "${reads[template.version]}"`,
      );
    }
    // No row for a template that is not registered, and none missing: a version added without one
    // would read `undefined` above, and one left behind would be a schema nothing compiles.
    expect(Object.keys(reads).map(Number)).toEqual(
      Object.values(PUBLICATION_TEMPLATE).map((template) => template.version),
    );
  });
});

/**
 * One fixed input touching each part of `assemble` the published document carries: a section, a
 * reference inside it, a paragraph, and a component in another language than its document's - under
 * the layout given, or none, as a request made before layouts is assembled.
 */
const fixed = <Under extends Layout | null>(
  covers: (codePoint: number) => boolean,
  layout: Under,
): AssembleInput & { readonly layout: Under } => ({
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'section',
        id: 'introduction'.padEnd(26, 'a'),
        title: [{ type: 'text', value: 'Introduction', marks: [] }],
        ...positional,
        children: [
          {
            type: 'reference',
            id: 'calibration'.padEnd(26, 'a'),
            component: '00000000-0000-4000-8000-000000000001',
            mode: { kind: 'latest' },
            ...positional,
            children: [],
          },
        ],
      },
    ],
  }),
  occurrences: new Map([
    [
      'calibration'.padEnd(26, 'a'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Calibration',
        language: 'de-DE',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: 'Set the tray.', marks: [] }],
          },
        ],
      }),
    ],
  ]),
  refused: [],
  layout,
  revision: '0.1',
  covers,
});

describe('the pipeline version', () => {
  // `assemble` and the draft notice it carries (`DRAFT_NOTICE` for slice 1, the layout's words since,
  // which the template's hash does not cover) decide what every publication says, so the record names
  // them by the pipeline version: each version, what it makes of this input. Never edit a row - a
  // change to either is a new pipeline version and a new row, and a publication made before still
  // names what made it. '1' is still made, for a request made before layouts; '2' is the record of
  // what was made under a layout before a run carried its marks, and nothing makes one now - which is
  // exactly why the row stays, and why '3' - what was made under a layout before a block could be
  // a list - stays beside it.
  const madeByPipeline: Record<string, string> = {
    '1': '3b844cb4ceedbe2b52040c79014ea18959295a1602754eb9861631891beb6fa1',
    '2': '699d5c34b7e4049fc32f5846a5525f5d3a35785c2858a78755161c58427ad1d5',
    '3': '1f3c5abc9b8b013b66fa691f73678994f3c3a891c146d63cc08d657dbeb8e9bf',
    '4': 'c23e9fc3e9b230f17a0bdda4763e712f3f295a490b5db866688d408b2a44217a',
  };
  const digest = (made: { document: unknown; numbering: unknown }) =>
    createHash('sha256')
      .update(JSON.stringify({ document: made.document, numbering: made.numbering }))
      .digest('hex');

  it('is a literal row per schema, so a schema bumped without it goes red rather than lying', () => {
    // The same trap as `TEMPLATE_READING` above, and worse where it lands: `PIPELINE_VERSION` is
    // the one field PUB-063 exists for, so a key that moves while its value stays behind records
    // every publication the new pipeline makes as having been made by the old one - in the PDF's
    // own provenance, with the typecheck clean. Literals, never the constants.
    expect(PIPELINE_VERSION).toEqual({ 'publishing/1': '1', 'publishing/4': '4' });
  });

  it('is the version its number says: what assemble makes of a fixed input, the draft notice included', async () => {
    const assembled = assemble(fixed((await loadPinnedFonts()).covers, null));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA_1);
    expect(PIPELINE_VERSION[assembled.document.schema]).toBe('1');
    expect(digest(assembled)).toBe(madeByPipeline[PIPELINE_VERSION[assembled.document.schema]]);
    expect(assembled.document.notice).toEqual(DRAFT_NOTICE);
    // The override reached the published document, so the pin covers the language path too.
    expect(assembled.document.nodes[0]?.children[0]?.language).toEqual({
      lang: 'de',
      region: 'DE',
    });
  });

  it('is the version its number says under a layout: what assemble makes of the fixed input under the default layout', async () => {
    const assembled = assemble(fixed((await loadPinnedFonts()).covers, defaultLayout));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA);
    expect(PIPELINE_VERSION[assembled.document.schema]).toBe('4');
    expect(digest(assembled)).toBe(madeByPipeline[PIPELINE_VERSION[assembled.document.schema]]);
    expect(assembled.document.words).toMatchObject({
      notice: DRAFT_NOTICE.page,
      noticeSentence: DRAFT_NOTICE.text,
    });
    expect(assembled.document.nodes[0]?.children[0]?.language).toEqual({
      lang: 'de',
      region: 'DE',
    });
  });
});

/**
 * The fixed input under the default layout, with the component holding the blocks given instead of
 * its paragraph: the shortest route from a stored block to the bytes template 4 reads.
 */
const holding = async (content: readonly unknown[]) => {
  const assembled = assemble({
    ...fixed(fonts.covers, defaultLayout),
    occurrences: new Map([
      [
        'calibration'.padEnd(26, 'a'),
        parseContentDocument({
          schemaVersion: 1,
          title: 'Calibration',
          language: 'en-GB',
          direction: 'ltr',
          content,
        }),
      ],
    ]),
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return assembled.document;
};

const text = (value: string) => [{ type: 'text', value, marks: [] }];
const body = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: text(value),
});

describe('the published list shapes that are easy to read past', () => {
  // Lists are read in full against the PDF in `lists.test.ts`. These three are here, beside the
  // template that must read them, because each is a real published spelling a reader skims over: a
  // start of 0, which is falsy in every language this pipeline is written in; an item that came out
  // of `assemble` with nothing in it at all, which must still make a valid `LI` under PDF/UA-1; and
  // a second level of bullets, which the template sets a marker for and Typst does not.
  const typst = createTypst({ binary: typstBinaryPath(), fonts });
  const at = new Date('2026-09-20T00:00:00Z');

  it('numbers an ordered list from a start of 0 with no format, which is decimal', async () => {
    const document = await holding([
      {
        type: 'list',
        id: 'L1',
        kind: 'ordered',
        start: 0,
        items: [
          { content: [body('b1', 'Check the readings')] },
          { content: [body('b2', 'Note the serial')] },
        ],
      },
    ]);
    // The pair the template must read: a falsy start that is a start, and no format at all, which
    // is decimal by default. `checkBlock` permits it, so it is a document an author can store.
    expect(document.nodes[0]?.children[0]?.blocks[0]).toMatchObject({
      type: 'list',
      start: 0,
      format: null,
    });
    const read = await readPdf(
      await typst.compile(PUBLICATION_TEMPLATE[4].file, JSON.stringify(document), at),
    );
    const said = read.taggedText.flat().join(' ').replace(/\s+/g, ' ');
    expect(said).toContain('0. Check the readings');
    expect(said).toContain('1. Note the serial');
  });

  it('sets an item that came out empty as an item with nothing in it, and passes veraPDF', async () => {
    const document = await holding([
      {
        type: 'list',
        id: 'D1',
        kind: 'definition',
        items: [
          { term: text('Creep'), content: [body('d1', 'Slow strain.')] },
          // No term typed yet and a paragraph with no runs in it: where a cursor stands after
          // Enter. `assemble` KEEPS it rather than dropping it, since dropping it would renumber
          // every item below - so the template meets an item with no label and no body content.
          { content: [{ type: 'paragraph', id: 'd2', style: 'body', content: [] }] },
        ],
      },
      {
        type: 'list',
        id: 'U1',
        kind: 'unordered',
        items: [
          { content: [body('u1', 'Wipe the tray')] },
          { content: [{ type: 'paragraph', id: 'u2', style: 'body', content: [] }] },
        ],
      },
    ]);
    const blocks = document.nodes[0]?.children[0]?.blocks ?? [];
    expect(blocks.map((block) => (block.type === 'list' ? block.items[1] : null))).toEqual([
      { term: null, blocks: [] },
      { term: null, blocks: [] },
    ]);
    const pdf = await typst.compile(PUBLICATION_TEMPLATE[4].file, JSON.stringify(document), at);
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const read = await readPdf(pdf);
    // Every role from the first list to the end of the document: the two lists and nothing after
    // them. `toContain('LI')` stood here and could not fail for this test's own title - drop the
    // empty items from both branches and the roles still hold an `LI`, because the items that were
    // not empty make one. What says the empty item is still there is the `LI Lbl LBody` ending each
    // list with nothing inside that body, and only the sequence can show it. Taken from the first
    // `L` rather than from the start so the cover and the contents, which are the layout's and not
    // this test's subject, cannot move it.
    expect(read.roles.slice(read.roles.indexOf('L')).join(' ')).toBe(
      'L LI Lbl Span LBody P LI Lbl LBody L LI Lbl LBody P LI Lbl LBody',
    );
  }, 120_000);

  it('sets a second level of bullets in a glyph the pinned faces have, rather than refusing', async () => {
    // The whole reason `#set list(marker: ...)` is in the template. Typst's own second-level marker
    // is U+2023 TRIANGULAR BULLET, which Liberation Serif does not have, and the worker compiles
    // with `--ignore-embedded-fonts`, so the engine cannot fall back to a face of its own: a
    // two-level bulleted list exits 1, which the worker reports as `TypstRefused` and nothing else -
    // no cause and no diagnostic, by design, since a diagnostic quotes content. Measured by hand
    // against the pinned engine: without the marker set this very fixture is
    // `PDF/UA-1 error: the text "..." could not be displayed with font "Liberation Serif"`.
    // Delete that line from the template and this is the test that says so.
    const document = await holding([
      {
        type: 'list',
        id: 'U1',
        kind: 'unordered',
        items: [
          {
            content: [
              body('u1', 'Wipe the tray'),
              {
                type: 'list',
                id: 'U2',
                kind: 'unordered',
                items: [{ content: [body('u2', 'Twice')] }],
              },
            ],
          },
        ],
      },
    ]);
    const read = await readPdf(
      await typst.compile(PUBLICATION_TEMPLATE[4].file, JSON.stringify(document), at),
    );
    const said = read.taggedText.flat().join(' ').replace(/\s+/g, ' ');
    // Disc at the top level and circle below it, as the template's comment names them. Written as
    // escapes rather than the characters themselves, so no source file in this repository carries a
    // glyph a diff or a terminal can hide.
    expect(said).toContain('\u{2022} Wipe the tray');
    expect(said).toContain('\u{25E6} Twice');
  });
});
