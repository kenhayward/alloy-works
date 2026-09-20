import type { OutlineMatter } from '../structure/outline.js';

import type { SlotPart } from './layout.js';

/**
 * The published document (docs/design/publishing.md, "The published document"): the one intermediate
 * every writer reads, holding everything a writer needs and nothing it must decide. Version
 * `publishing/2` is the document under a layout, which `apps/worker/templates/publication/2/` reads.
 * It is never stored - only its digest is, on the publication - so a later shape is a new schema
 * string and a new template version, not a migration.
 */
export const PUBLISHING_SCHEMA = 'publishing/2';

/**
 * The first slice's shape, before layouts: what `assemble` still makes, byte for byte, for a request
 * made before migration 0018 recorded a layout on it, so that such a request publishes exactly as it
 * would have then, with template 1 (Ken's answer F, 2026-09-19).
 */
export const PUBLISHING_SCHEMA_1 = 'publishing/1';

/**
 * A BCP 47 tag as Typst can carry it: a language of two or three letters and, where there is one, a
 * region of two. A tag with a script subtag, a numeric region or any variant is refused, naming it,
 * and never shortened to fit (Ken's answer K, 2026-09-19).
 */
export interface PublishedLanguage {
  readonly lang: string;
  readonly region: string | null;
}

export interface PublishedRun {
  readonly text: string;
}

export interface PublishedParagraph {
  readonly type: 'paragraph';
  readonly id: string;
  readonly runs: readonly PublishedRun[];
}

export type PublishedBlock = PublishedParagraph;

/**
 * One outline node in `publishing/1`, set as a heading at its depth. `number` is `number`'s, set as
 * text; `language` and `direction` are present only where the node's own words differ from the
 * document's - a reference whose component's base language or direction is not the document's.
 */
export interface PublishedNode1 {
  readonly id: string;
  readonly depth: number;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock[];
  readonly children: readonly PublishedNode1[];
}

/**
 * One outline node in `publishing/2`: as in `publishing/1`, and the matter it is in - its top-level
 * node's, carried to every node beneath it, so the template pages and numbers it with no walk upwards.
 */
export interface PublishedNode {
  readonly id: string;
  readonly depth: number;
  readonly matter: OutlineMatter;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock[];
  readonly children: readonly PublishedNode[];
}

/**
 * What every page, and once the tagged text, says of a draft (issue #142): `publishing/1`'s words, and
 * the source of the default layout's (decision H), which declares them in its own language (#144).
 */
export const DRAFT_NOTICE = {
  page: 'Not approved',
  text: 'Not approved. This is a draft publication, not made from an approved baseline.',
} as const;

/** The first slice's published document, for a request made before layouts. */
export interface PublishedDocument1 {
  readonly schema: typeof PUBLISHING_SCHEMA_1;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly notice: { readonly page: string; readonly text: string };
  readonly nodes: readonly PublishedNode1[];
}

/**
 * A page number's pattern as Typst's `numbering` takes it: one per `NumberFormat`, mapped by name
 * (`lowerAlpha` is `a`, `lowerRoman` is `i`), never by position.
 */
export type PublishedPattern = '1' | 'i' | 'I' | 'a' | 'A';

/**
 * The layout's PDF member as the template sets it (PUB-007, PUB-008, PUB-009): the page in points, in
 * the portrait sense with its orientation beside it; the three slots of the running head and foot;
 * and each matter's page numbering as a pattern.
 */
export interface PublishedPdfFormat {
  readonly width: number;
  readonly height: number;
  readonly orientation: 'portrait' | 'landscape';
  readonly margins: {
    readonly top: number;
    readonly bottom: number;
    readonly inside: number;
    readonly outside: number;
  };
  readonly gutter: number;
  readonly head: readonly [readonly SlotPart[], readonly SlotPart[], readonly SlotPart[]];
  readonly foot: readonly [readonly SlotPart[], readonly SlotPart[], readonly SlotPart[]];
  readonly pageNumbering: Readonly<
    Record<OutlineMatter, { readonly pattern: PublishedPattern; readonly restart: boolean }>
  >;
}

/**
 * The document under its layout. `words` are the layout's, in the layout's language, which is not
 * necessarily the document's (`en` serves `en-GB`); `revision` is the document version's
 * `revision.version`, what a running foot's `revision` field prints. `front.contents` is null where the
 * layout declares none **and** where it would hold no entry: a contents of nothing is not published
 * (decision K).
 */
export interface PublishedDocument {
  readonly schema: typeof PUBLISHING_SCHEMA;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly revision: string;
  readonly words: {
    readonly language: PublishedLanguage;
    readonly contents: string;
    readonly notice: string;
    readonly noticeSentence: string;
  };
  readonly format: PublishedPdfFormat;
  readonly front: { readonly cover: boolean; readonly contents: { readonly depth: number } | null };
  readonly appendices: { readonly newPage: boolean };
  readonly nodes: readonly PublishedNode[];
}
