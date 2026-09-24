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
  PUBLISHING_SCHEMA_4,
  PUBLISHING_SCHEMA_5,
  PUBLISHING_SCHEMA_6,
  PUBLISHING_SCHEMA_7,
  PUBLISHING_SCHEMA_8,
  PUBLISHING_SCHEMA_9,
  PUBLISHING_SCHEMA_10,
  PUBLISHING_SCHEMA_11,
  type AssembleInput,
  type Layout,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PIPELINE_VERSION } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
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
    // Template 6 is template 5 with a table and the lists after the contents, and reads
    // `publishing/6`. Template 7 is template 6 with a figure and figures among the lists, and reads
    // `publishing/7`. Template 8 is template 7 with an image in a run of text, and reads `publishing/8`.
    // Template 9 is template 8 with a footnote and a table's note, and reads `publishing/9`. Template
    // 10 is template 9 with a cross-reference and the labels its targets carry, and reads
    // `publishing/10`. Template 11 is template 10 with an equation - in a run, as a block, numbered
    // beside it and listed - and a node's title set as runs, and reads `publishing/11`. Template 12
    // reads `publishing/12`, the document set from its theme: every face, size, colour, space and
    // line read from the theme, by ADR-0014's rules. It moved (7979229d...) from template 11
    // asserting the new schema to the template that sets the theme, and again (f64aa5ff...) when a
    // comment said what a quotation's space is and why, and is re-pinned freely until the
    // pull request that makes it merges. Templates 1 to 11 are published versions and their rows never
    // move again.
    const pinned: Record<number, string> = {
      1: 'e8afabbac53bb797cfb024937ef4387834994a2d50062a029510d9ff300f58b0',
      2: '01bb7d4058901cdf904e05696bb1ccdf4a202a7802d3f7e420f8230d67290e54',
      3: '682840cb57284deec3ccfd2c29a7c738f5013b2cc233971d177c34c3f4ac5381',
      4: '13b8f620f4b7bc4c627360aa30ea48d595745df5d01290558d57cf6677f6ba43',
      5: '76e51369e5c83dffc8e263b11dd9f23867aa8e325e72f8a55b59fc8dc8aca7c9',
      6: 'b2dccbc98e950c7fa64f28efe5a6a855bc6906ec1bd60709fbf3208057cd8939',
      7: '07849af0c817c599def36500145af0b72ab1a881970237b094953bf5c9993197',
      8: '1457d0f36c6b2add227ae9cc95fa04de45517caca043a79b9e900642ba90b68f',
      9: 'f837e57769f34465377f5e808e759a68eba921bb3b45adaff7c0a1a581e4ced6',
      10: '07589c1d2487e149643bf82ccd183aaf7c7951ed24792decb508db02a7626339',
      11: '00f58bb2f2dc897356b24fdb09e0fa190a292c9b737d5444e7a8b48070a22a77',
      12: '6b88017fe9334c336c41f314c19b688d66dfe1324c0a5d7bf5a93008fd25b88c',
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
    // Written as LITERAL strings and numbers, never through the constants. Until cross-references 2
    // `TEMPLATE_READING` was keyed by `PUBLISHING_SCHEMA` itself, so the day it was repointed the key
    // moved and the value stayed behind, and `satisfies Record<PublishedSchema, ...>` could not catch
    // it, since `PublishedSchema` is derived from the same constant. Its keys are frozen now, and a
    // repoint fails the typecheck at `PUBLISHING_SCHEMA_CURRENT`; this literal is the second guard,
    // since asserted through the constants the row would move with them and say nothing.
    expect(TEMPLATE_READING).toEqual({
      'publishing/1': 1,
      'publishing/9': 9,
      'publishing/10': 10,
      'publishing/11': 11,
      'publishing/12': 12,
    });
  });

  it("never sets an attribution through the engine's own parameter, which writes a dash the author never typed", async () => {
    // Decision D, as a guard a reader can see: Typst's `quote` takes an attribution and prints an em
    // dash before it. Templates 5 to 7 set the attribution themselves, so the parameter's name never
    // appears in any of them.
    for (const version of [5, 6, 7, 8, 9, 10, 11, 12] as const) {
      const source = await readFile(PUBLICATION_TEMPLATE[version].file, 'utf8');
      expect(source, `template ${version}`).not.toContain('attribution:');
    }
  });

  it("holds no typographic literal from version 12: every face, size, weight, colour and length is the theme's", async () => {
    // Themes 1, ruling R7: template 12 sets everything from the document's `theme` and from nothing
    // else, so that the theme is the whole of how a publication looks and a second theme looks
    // different. Read with its comments taken out, which name faces and sizes freely; what is left
    // may hold a face's name, a colour, or a size, weight or length written as a literal only where
    // an entry below allows it and says why. Every entry must still be needed, so the list cannot
    // outlive what it excuses.
    const allowed: readonly { readonly literal: RegExp; readonly why: string }[] = [
      { literal: /\bn \* 1pt\b/g, why: 'points: the unit a number from the data is multiplied by' },
      { literal: /\bn \* 1em\b/g, why: 'ems: the unit a number from the data is multiplied by' },
      {
        literal: /\brgb\(hex\)/g,
        why: "the one place a colour from the theme becomes the engine's",
      },
      {
        literal: /if on \{ 100% \} else \{ 0% \}/g,
        why: 'widow and orphan control, a boolean in the theme, as the two costs the engine takes',
      },
      { literal: /(?<![\d.])0pt\b/g, why: 'zero: no space, no inset' },
      {
        literal: /\bwidth: 100%/g,
        why: 'a block as wide as the place it stands in, which is layout and no typographic value',
      },
      {
        literal: /\b1em\.to-absolute\(\)/g,
        why: "maths layout: the gap beside an equation's number, as LaTeX keeps it (equations 2)",
      },
      { literal: /\bcolumn-gap: 1em\b/g, why: "maths layout: the gap between cases' columns" },
    ];
    const forbidden: readonly { readonly literal: RegExp; readonly what: string }[] = [
      { literal: /Liberation|STIX|DejaVu|Computer Modern|\bfont: "/g, what: "a face's name" },
      {
        literal: /\b(rgb|luma|cmyk|oklab|oklch|color\.[a-z]+)\(|"#[0-9a-fA-F]{3,8}"/g,
        what: 'a colour',
      },
      {
        literal:
          /\b(black|white|gray|silver|navy|blue|aqua|teal|eastern|purple|fuchsia|maroon|red|orange|yellow|olive|green|lime)\b/g,
        what: 'a named colour',
      },
      { literal: /\d+(\.\d+)?(pt|em|mm|cm|in)\b|\d+(\.\d+)?%/g, what: 'a size or a length' },
      { literal: /\bweight: "/g, what: 'a weight' },
      { literal: /\bstyle: "/g, what: 'a posture' },
    ];
    const source = (await readFile(PUBLICATION_TEMPLATE[12].file, 'utf8')).replace(/\/\/.*$/gm, '');
    const left = allowed.reduce((each, { literal }) => each.replace(literal, ''), source);
    for (const { literal, what } of forbidden) {
      expect(left.match(literal) ?? [], what).toEqual([]);
    }
    for (const { literal, why } of allowed) {
      expect(source.match(literal), `an allowance no longer needed: ${why}`).not.toBeNull();
    }
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
      4: PUBLISHING_SCHEMA_4,
      5: PUBLISHING_SCHEMA_5,
      6: PUBLISHING_SCHEMA_6,
      7: PUBLISHING_SCHEMA_7,
      8: PUBLISHING_SCHEMA_8,
      9: PUBLISHING_SCHEMA_9,
      10: PUBLISHING_SCHEMA_10,
      11: PUBLISHING_SCHEMA_11,
      12: PUBLISHING_SCHEMA,
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
 * the layout given and the default theme, or neither, as a request made before layouts is assembled.
 */
const fixed = <Under extends Layout | null>(
  covers: AssembleInput['covers'],
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
  theme: layout === null ? null : defaultTheme,
  revision: '0.1',
  covers,
  assets: new Map(),
});

describe('the pipeline version', () => {
  // `assemble` and the draft notice it carries (`DRAFT_NOTICE` for slice 1, the layout's words since,
  // which the template's hash does not cover) decide what every publication says, so the record names
  // them by the pipeline version: each version, what it makes of this input. Never edit a row - a
  // change to either is a new pipeline version and a new row, and a publication made before still
  // names what made it. '1' is still made, for a request made before layouts; '2' is the record of
  // what was made under a layout before a run carried its marks, and nothing makes one now - which is
  // exactly why the row stays, and why '3' - what was made under a layout before a block could be
  // a list - stays beside it, as do '4', '5' and '6', before a quotation, a table and a figure,
  // '9', before a cross-reference, '10', before an equation and a title set as runs, and '11',
  // before a document was set from its theme. '12' is re-pinned freely until the pull request that
  // makes it merges, since nothing is published from a branch: it moved (c69fead9...) when the
  // default theme's line spacings and spaces were measured from template 11 (themes 1, task 4), and
  // again (45748643...) when the default theme gave a table's cells a style of their own.
  const madeByPipeline: Record<string, string> = {
    '1': '3b844cb4ceedbe2b52040c79014ea18959295a1602754eb9861631891beb6fa1',
    '2': '699d5c34b7e4049fc32f5846a5525f5d3a35785c2858a78755161c58427ad1d5',
    '3': '1f3c5abc9b8b013b66fa691f73678994f3c3a891c146d63cc08d657dbeb8e9bf',
    '4': 'c23e9fc3e9b230f17a0bdda4763e712f3f295a490b5db866688d408b2a44217a',
    '5': '388ba756e4d6ac9c891e9f94ba056fc65371810f340407cdf945498385e446af',
    '6': '541f5a22035792e06bcc8154e995c4d44b3e01ca482c0e7fa225d9b01c5834eb',
    '7': 'b15a3f1b137e2b7bc40569e9a8a89aad80f848e2c550f933e84daf8f8854dc90',
    '8': 'c8f1fc9a8877ed73fbe6411a398f4c861df7d5a9bb77b7626767838644a25e70',
    '9': '4beeacf97465f356d654aa43dee3686e43cd3ca632d61680252d34e37d568ac5',
    '10': '3b9772e627b7af48e407673a67b94837f9a6f033e63b222dbedf97852b67a82d',
    '11': 'f011fd46928c1b68de5c47de2ea4db75a2b52391b94026c8faddddc01f5191bf',
    '12': 'f38feb9ac3df3c70b4b856207eee06a204b27914b884fe97ef9b3823a468fa6e',
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
    expect(PIPELINE_VERSION).toEqual({ 'publishing/1': '1', 'publishing/12': '12' });
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
    expect(PIPELINE_VERSION[assembled.document.schema]).toBe('12');
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
      await typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        JSON.stringify(document),
        at,
      ),
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
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(document),
      at,
    );
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
      await typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        JSON.stringify(document),
        at,
      ),
    );
    const said = read.taggedText.flat().join(' ').replace(/\s+/g, ' ');
    // Disc at the top level and circle below it, as the template's comment names them. Written as
    // escapes rather than the characters themselves, so no source file in this repository carries a
    // glyph a diff or a terminal can hide.
    expect(said).toContain('\u{2022} Wipe the tray');
    expect(said).toContain('\u{25E6} Twice');
  });
});
