/**
 * The published document (docs/design/publishing.md, "The published document"): the one intermediate
 * every writer reads, holding everything a writer needs and nothing it must decide. Version
 * `publishing/1` is what `apps/worker/templates/publication/1/` reads. It is never stored - only its
 * digest is, on the publication - so a later shape is a new schema string and a new template version,
 * not a migration.
 */
export const PUBLISHING_SCHEMA = 'publishing/1';

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
 * One outline node, set as a heading at its depth. `number` is `number`'s, set as text; `language`
 * and `direction` are present only where the node's own words differ from the document's - a
 * reference whose component's base language or direction is not the document's.
 */
export interface PublishedNode {
  readonly id: string;
  readonly depth: number;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock[];
  readonly children: readonly PublishedNode[];
}

/**
 * What every page, and once the tagged text, says of a draft (issue #142). The template's words, in
 * English, until a layout declares its own (issue #144).
 */
export const DRAFT_NOTICE = {
  page: 'Not approved',
  text: 'Not approved. This is a draft publication, not made from an approved baseline.',
} as const;

export interface PublishedDocument {
  readonly schema: typeof PUBLISHING_SCHEMA;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly notice: { readonly page: string; readonly text: string };
  readonly nodes: readonly PublishedNode[];
}
