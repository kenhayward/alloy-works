import { z } from 'zod';

import { migrateStored, type MigrationChain } from '../stored/migrate.js';
import { storableEverywhere, storableText } from '../stored/storable.js';
import { MAXIMUM_OUTLINE_DEPTH, type OutlineMatter } from '../structure/outline.js';
import {
  defaultNumberingScheme,
  numberFormatSchema,
  numberingSchemeSchema,
  type NumberFormat,
  type NumberingScheme,
} from '../structure/scheme.js';

import { disallowed, setWithoutAGlyph } from './glyphs.js';
import { publishedLanguage } from './language.js';
import { DRAFT_NOTICE } from './published.js';

/**
 * The layout's stored shape (docs/design/publishing.md, "The layout"). A layout is an artifact kind
 * whose versions are insert-only, so **the shape is closed at its first version**: every object is
 * strict at every depth, and whatever this parse accepts a later reader must go on accepting. A member
 * nothing reads yet - `paged`, a `docx` format - is refused rather than stored, and arrives with the
 * schema version that reads it.
 *
 * **Version 2 added `matter.lists`** (tables 2): the generated lists of figures, tables and equations a
 * layout declares, each with its title. A layout stored at version 1 reads as one that generates none,
 * so it publishes exactly as it did.
 *
 * **Version 3 added `words.above` and `words.below`** (cross-references 2, ruling R2): what a
 * `relative` reference prints, in the layout's own language, both or neither. A layout stored at
 * version 2 reads as one with neither - a migration cannot know another language's words - and a
 * relative reference under it fails by name rather than printing English into a French document.
 *
 * **Version 4 added `words.continued`** (themes 2, ruling R2): what a continued table's label adds after
 * the table's own label - `Table 3 (continued)` - in the layout's language, since a theme has none
 * (TH-I). **Required of a layout written at version 4**, and absent from one stored earlier, which reads
 * as having none for version 3's reason: a migration cannot know another language's words. A table
 * style asking for a label under a layout with none fails the publish by name rather than printing
 * English.
 */
export const LAYOUT_SCHEMA_VERSION = 4;

/** The sequences a generated list can list: those a caption-bearing block takes (CNT-081, STR-041). */
export const LISTED_SEQUENCES = ['figure', 'table', 'equation'] as const;

/** A generated list the layout declares (PUB-038): which sequence, and the title it is set under. */
export interface LayoutList {
  sequence: (typeof LISTED_SEQUENCES)[number];
  title: string;
}

/** The formats a layout may declare a member for (PUB-012, PUB-014). Word arrives with its slice. */
export const PUBLISHING_FORMATS = ['pdf'] as const;

/** What a running head or foot can print besides words (PUB-008). */
export type LayoutField = 'title' | 'section' | 'page' | 'pages' | 'revision';

/** One part of a running head or foot's slot: some of the layout's words, or a field. */
export type SlotPart = { kind: 'words'; text: string } | { kind: 'field'; field: LayoutField };

export interface PdfFormat {
  /** In points, in the portrait sense - width never exceeds height - from 72 to 14400 each. */
  page: { width: number; height: number };
  /** Landscape turns the page; it is never said by swapping the dimensions. */
  orientation: 'portrait' | 'landscape';
  /** In points, none below zero. Inside and outside are the binding edge's and the other's. */
  margins: { top: number; bottom: number; inside: number; outside: number };
  /** In points, added to the inside margin. */
  gutter: number;
  /** Three slots - start, centre, end - of at most eight parts each. */
  head: [SlotPart[], SlotPart[], SlotPart[]];
  foot: [SlotPart[], SlotPart[], SlotPart[]];
  /** Per matter (PUB-009): how its pages are numbered, and whether it starts again at one. */
  pageNumbering: Record<OutlineMatter, { format: NumberFormat; restart: boolean }>;
}

export interface Layout {
  schemaVersion: typeof LAYOUT_SCHEMA_VERSION;
  /** The one language its words are in: a BCP 47 tag the engine can carry (`publishedLanguage`). */
  language: string;
  /**
   * The words the product sets itself: the contents' title, the draft notice and its sentence, what
   * a relative reference prints either side of its target - both, or neither where the layout has no
   * words for them - and what a continued table's label adds, which only a layout stored before
   * schema version 4 lacks.
   */
  words: {
    contents: string;
    notice: string;
    noticeSentence: string;
    above?: string | undefined;
    below?: string | undefined;
    continued?: string | undefined;
  };
  /** The numbering scheme, in structure.md's shape, labels included (PUB-011, STR-013, STR-024). */
  scheme: NumberingScheme;
  /** The generated front and back matter (PUB-088). */
  matter: {
    cover: boolean;
    contents: { depth: number } | null;
    appendices: { newPage: boolean };
    /** In the order they are set, after the contents; an empty list of one is not set (decision K). */
    lists: LayoutList[];
  };
  /** One member per format it makes, each declared on its own (PUB-012, PUB-014). */
  formats: { pdf: PdfFormat };
}

/** The most a layout's words or a slot's words may hold: a line, never a paragraph. */
const MAXIMUM_WORDS = 200;

/** The least a page may leave to set text in, each way: an inch. */
const LEAST_TEXT = 72;

const CANNOT_BE_STORED = 'The layout holds a character that cannot be stored';
const ENGINE_REFUSES = 'The layout holds a character the engine refuses whatever the face';

const codePoints = (text: string) => Array.from(text, (character) => character.codePointAt(0)!);

/** Whether the engine would draw something: a character that is neither space nor set unseen. */
const visible = (text: string) =>
  codePoints(text).some(
    (codePoint) => !/\s/u.test(String.fromCodePoint(codePoint)) && !setWithoutAGlyph(codePoint),
  );

/** No character PDF/UA-1 refuses, which `assemble` would refuse in a component's words too. */
const settable = (text: string) => !codePoints(text).some(disallowed);

/**
 * Words the product sets as the layout's: the contents' title, the draft notice, a relative
 * reference's _above_ and _below_, and a continued table's _continued_. Each must show something - a
 * blank notice, or one of only zero-width characters, would remove the draft's mark from every page,
 * which no layout may do, and a blank _above_ would print a reference as nothing.
 */
const words = z
  .string()
  .max(MAXIMUM_WORDS)
  .refine(storableText, CANNOT_BE_STORED)
  .refine(settable, ENGINE_REFUSES)
  .refine(visible, 'A layout sets words that say something');

/** A slot's words may be only spacing - `Page ` before a field - but never nothing. */
const slotWords = z
  .string()
  .min(1)
  .max(MAXIMUM_WORDS)
  .refine(storableText, CANNOT_BE_STORED)
  .refine(settable, ENGINE_REFUSES);

const slotPartSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('words'), text: slotWords }),
  z.strictObject({
    kind: z.literal('field'),
    field: z.enum(['title', 'section', 'page', 'pages', 'revision']),
  }),
]);

/** The most parts one slot may hold. */
const MAXIMUM_PARTS = 8;

const slot = z.array(slotPartSchema).max(MAXIMUM_PARTS);
const slots = z.tuple([slot, slot, slot]);

const points = z.number().min(0);
/** A page side, in points: from an inch to two hundred inches, the most a PDF page can be. */
const pageSide = z.number().min(72).max(14400);
const pageNumber = z.strictObject({ format: numberFormatSchema, restart: z.boolean() });

const pdfFormatSchema = z
  .strictObject({
    page: z
      .strictObject({ width: pageSide, height: pageSide })
      .refine(
        (page) => page.width <= page.height,
        'A page is given in the portrait sense; landscape is its orientation',
      ),
    orientation: z.enum(['portrait', 'landscape']),
    margins: z.strictObject({ top: points, bottom: points, inside: points, outside: points }),
    gutter: points,
    head: slots,
    foot: slots,
    pageNumbering: z.strictObject({ front: pageNumber, body: pageNumber, appendix: pageNumber }),
  })
  .refine((pdf) => {
    const turned = pdf.orientation === 'landscape';
    const across = turned ? pdf.page.height : pdf.page.width;
    const down = turned ? pdf.page.width : pdf.page.height;
    const { top, bottom, inside, outside } = pdf.margins;
    return (
      across - inside - pdf.gutter - outside >= LEAST_TEXT && down - top - bottom >= LEAST_TEXT
    );
  }, 'A page leaves at least an inch each way to set text in, inside its margins and gutter');

/**
 * **A layout's words on their own** (`Layout['words']`): what the product sets itself, above and
 * below both or neither, since one without the other would print a relative reference one way and
 * refuse it the other. Exported apart from `layoutSchema` for a caller shown only this much of a
 * layout - the document page reads a reference's _above_ and _below_ from it (cross-references 2,
 * ruling R9) without reading the rest, exactly as it already reads the numbering scheme apart.
 * `continued` is optional here, as a layout stored before schema version 4 reads without it; that a
 * layout written at 4 states it is `layoutSchema`'s to say.
 */
export const layoutWordsSchema = z
  .strictObject({
    contents: words,
    notice: words,
    noticeSentence: words,
    above: words.optional(),
    below: words.optional(),
    continued: words.optional(),
  })
  .refine(
    ({ above, below }) => (above === undefined) === (below === undefined),
    'A layout gives its words for above and below together, or neither',
  );

/**
 * Every layout version, as it reads at the current schema version. The language is held to the rule
 * `assemble` holds a document's to (`publishedLanguage`, `language_not_publishable`): a tag the engine
 * cannot carry is refused, never shortened to one it can. And every string in it, member names and
 * scheme labels among them, is one Postgres can store. This one admits a layout with no words for a
 * continued table, as one stored before schema version 4 reads; `layoutSchema` is it with them.
 */
const upgradedLayoutSchema: z.ZodType<Layout> = z
  .strictObject({
    schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
    language: z.string().superRefine((tag, context) => {
      if (publishedLanguage(tag) === null) {
        context.addIssue({
          code: 'custom',
          message: `The layout's language ${tag} is not one the engine can carry`,
        });
      }
    }),
    words: layoutWordsSchema,
    scheme: numberingSchemeSchema,
    matter: z.strictObject({
      cover: z.boolean(),
      contents: z
        .strictObject({ depth: z.number().int().min(1).max(MAXIMUM_OUTLINE_DEPTH) })
        .nullable(),
      appendices: z.strictObject({ newPage: z.boolean() }),
      lists: z
        .array(z.strictObject({ sequence: z.enum(LISTED_SEQUENCES), title: words }))
        .refine(
          (lists) => new Set(lists.map((list) => list.sequence)).size === lists.length,
          'A layout lists each sequence once',
        ),
    }),
    formats: z.strictObject({ pdf: pdfFormatSchema }),
  })
  .refine(storableEverywhere, CANNOT_BE_STORED);

/**
 * **A layout as it is written at the current schema version**: from version 4 on, with the words a
 * continued table's label adds (themes 2, ruling R2), since a writer knows its own language's.
 */
export const layoutSchema: z.ZodType<Layout> = upgradedLayoutSchema.refine(
  (layout) => layout.words.continued !== undefined,
  {
    message: "A layout at schema version 4 gives the words a continued table's label adds",
    path: ['words', 'continued'],
  },
);

/** The one entry point for a layout at the current schema version, as it is written. */
export function parseLayout(value: unknown): Layout {
  return layoutSchema.parse(value);
}

/**
 * A stored layout, migrated and parsed: held to `layoutSchema` where it was written at the current
 * version, and to what an older version reads as where it was written before, so a layout stored at
 * version 3 reads with no words for a continued table while one stored at 4 without them is refused.
 * Throws, as `parseLayout` does.
 */
function parseStoredLayout(value: unknown): Layout {
  const migrated = migrateStored(value, layoutMigrationChain);
  const written = (value as { schemaVersion: unknown }).schemaVersion;
  return written === LAYOUT_SCHEMA_VERSION
    ? parseLayout(migrated)
    : upgradedLayoutSchema.parse(migrated);
}

// A read-time projection, as every chain's is: the stored bytes never change.
export const layoutMigrationChain: MigrationChain = {
  subject: 'layout',
  current: LAYOUT_SCHEMA_VERSION,
  migrations: {
    // Version 1 generated no lists, so it reads as declaring none.
    1: (layout) => ({
      ...layout,
      matter: { ...(layout.matter as Record<string, unknown>), lists: [] },
    }),
    // Version 2 had no words for above and below, and reads as having neither: which words a layout
    // in another language would give is not a migration's to guess.
    2: (layout) => layout,
    // Version 3 had no words for a continued table, and reads as having none, for version 2's reason.
    3: (layout) => layout,
  },
};

export type LayoutReadOutcome =
  { ok: true; layout: Layout } | { ok: false; artifact: string; version: string; failure: string };

/**
 * Read a stored layout: migrate it, then parse it. One that will not read is reported with its
 * artifact and version and yields nothing, as a stored outline or definition is.
 */
export function readLayout(
  value: unknown,
  context: { artifact: string; version: string },
): LayoutReadOutcome {
  try {
    return { ok: true, layout: parseStoredLayout(value) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * **The product's default layout**, the one every tenant starts with (seeded by migration 0018) and
 * every document publishes under until TPL links a document to a template. English words, structure's
 * default scheme exactly, a cover and a contents three deep, appendices on a new page, and A4 with an
 * inch margin: the title and the section in the head, the revision and the page in the foot. Front
 * matter is paged in lower roman, the body from 1, and appendices carry on from the body.
 */
/** The default layout's page and its running matter, which its two versions share. */
const defaultPdf: PdfFormat = {
  page: { width: 595.28, height: 841.89 },
  orientation: 'portrait',
  margins: { top: 72, bottom: 72, inside: 72, outside: 72 },
  gutter: 0,
  head: [[{ kind: 'field', field: 'title' }], [], [{ kind: 'field', field: 'section' }]],
  foot: [
    [
      { kind: 'words', text: 'Revision ' },
      { kind: 'field', field: 'revision' },
    ],
    [],
    [
      { kind: 'words', text: 'Page ' },
      { kind: 'field', field: 'page' },
    ],
  ],
  pageNumbering: {
    front: { format: 'lowerRoman', restart: true },
    body: { format: 'decimal', restart: true },
    appendix: { format: 'decimal', restart: false },
  },
};

/**
 * **The default layout's first version, 0.1, as migration 0018 stored it**: schema version 1, which
 * generated no lists. Frozen, because the row is insert-only and `default-layout.test.ts` checks it
 * against this; nothing publishes under it any more but a request made while it was the default.
 */
export const FIRST_DEFAULT_LAYOUT = {
  schemaVersion: 1,
  language: 'en',
  words: {
    contents: 'Contents',
    notice: DRAFT_NOTICE.page,
    noticeSentence: DRAFT_NOTICE.text,
  },
  scheme: defaultNumberingScheme,
  matter: { cover: true, contents: { depth: 3 }, appendices: { newPage: true } },
  formats: { pdf: defaultPdf },
} as const;

/**
 * A layout as schema version 2 stored it: no words for above and below. The shape of the default
 * layout's 0.2 and 0.3 rows, which are frozen at it, since a row is insert-only.
 */
export type Layout2 = Omit<Layout, 'schemaVersion' | 'words'> & {
  schemaVersion: 2;
  words: { contents: string; notice: string; noticeSentence: string };
};

/**
 * A frozen schema-2 layout, exactly as its row holds it, checked to read through today's migration
 * chain and parse - so a stored default that would no longer read fails the build's own import, not a
 * publish - and returned unchanged, never as it reads.
 */
function frozenAt2(layout: Layout2): Layout2 {
  parseStoredLayout(layout);
  return layout;
}

/**
 * **The default layout's version 0.2, as migration 0019 stored it**: the first version with a list of
 * tables after the contents, which tables brought (tables 2, ruling R6). Frozen for the reason 0.1 is:
 * `default-layout.test.ts` checks the row against it, and a request made while it was the default goes
 * on publishing under it. At schema version 2, the literal it was stored at, never the constant.
 */
export const SECOND_DEFAULT_LAYOUT: Layout2 = frozenAt2({
  ...FIRST_DEFAULT_LAYOUT,
  schemaVersion: 2,
  matter: {
    ...FIRST_DEFAULT_LAYOUT.matter,
    lists: [{ sequence: 'table', title: 'Tables' }],
  },
});

/**
 * **The default layout's version 0.3, as migration 0021 stored it**: a list of figures and then a list
 * of tables after the contents, as convention orders them (figures 3, ruling R9). Frozen, at schema 2,
 * for 0.2's reason.
 */
export const THIRD_DEFAULT_LAYOUT: Layout2 = frozenAt2({
  ...SECOND_DEFAULT_LAYOUT,
  matter: {
    ...SECOND_DEFAULT_LAYOUT.matter,
    lists: [
      { sequence: 'figure', title: 'Figures' },
      { sequence: 'table', title: 'Tables' },
    ],
  },
});

/**
 * A layout as schema version 3 stored it: words for above and below, and none for a continued table.
 * The shape of the default layout's 0.4 row, which is frozen at it.
 */
export type Layout3 = Omit<Layout, 'schemaVersion' | 'words'> & {
  schemaVersion: 3;
  words: {
    contents: string;
    notice: string;
    noticeSentence: string;
    above?: string | undefined;
    below?: string | undefined;
  };
};

/**
 * **The default layout's version 0.4, as migration 0023 stored it**: 0.3 with the words a relative
 * reference prints, _above_ and _below_ (cross-references 2, ruling R2). Frozen, at schema 3, for 0.2's
 * reason, and checked as 0.2 is to read through today's chain.
 */
export const FOURTH_DEFAULT_LAYOUT: Layout3 = (() => {
  const layout: Layout3 = {
    ...THIRD_DEFAULT_LAYOUT,
    schemaVersion: 3,
    words: { ...THIRD_DEFAULT_LAYOUT.words, above: 'above', below: 'below' },
  };
  parseStoredLayout(layout);
  return layout;
})();

/**
 * The default layout as it stands, **version 0.5**: 0.4 with the words a continued table's label adds,
 * _(continued)_, in its language, English (themes 2, ruling R2), at schema version 4.
 */
export const defaultLayout: Layout = parseLayout({
  ...FOURTH_DEFAULT_LAYOUT,
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  words: { ...FOURTH_DEFAULT_LAYOUT.words, continued: '(continued)' },
});

/**
 * Whether a layout's words serve a document in this language: RFC 4647 basic filtering, the layout's
 * tag taken as a language range, case-insensitively (decision G). `en` serves `en-GB`, because a range
 * matches a tag that begins with it and a hyphen; `en-GB` does not serve `en`, and `en` does not serve
 * `eng`. A layout's tag is never `*`: the engine cannot carry one.
 */
export function speaksFor(layoutLanguage: string, documentLanguage: string): boolean {
  const range = layoutLanguage.toLowerCase();
  const tag = documentLanguage.toLowerCase();
  return tag === range || tag.startsWith(`${range}-`);
}

/** The formats asked for that the layout has no member for, each named once, in the order asked. */
export function unsupportedFormats(layout: Layout, formats: readonly string[]): string[] {
  return [...new Set(formats.filter((format) => !Object.hasOwn(layout.formats, format)))];
}
