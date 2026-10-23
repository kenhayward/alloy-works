import { languageTagSchema, type ContentDocument } from '../content/model/document.js';
import { lineDifferences } from '../workflow/lines.js';

/**
 * A variant's translation status (docs/design/translation.md; the TR plan, TR-E): the declared set
 * (LOC-030). Approval is a workflow state on the variant's own line, never one of these.
 * `machineDrafted` and `inTranslation` are XL's.
 */
export const TRANSLATION_STATUSES = [
  'untranslated',
  'machineDrafted',
  'inTranslation',
  'translated',
  'outOfDate',
] as const;

export type TranslationStatus =
  | { readonly status: 'untranslated' | 'translated' }
  /** `retranslate` where any later source version was declared to need it (LOC-015, LOC-031). */
  | { readonly status: 'outOfDate'; readonly retranslate: boolean };

/**
 * A variant's status, never stored (TR-E; LOC-014): untranslated where nothing records what it
 * translates; out of date the moment any main-line version follows the one it translates.
 */
export function translationStatus(input: {
  readonly translates: string | null;
  readonly laterSource: readonly { readonly retranslate: boolean }[];
}): TranslationStatus {
  if (input.translates === null) return { status: 'untranslated' };
  if (input.laterSource.length === 0) return { status: 'translated' };
  return { status: 'outOfDate', retranslate: input.laterSource.some((each) => each.retranslate) };
}

/** Why a language line cannot be begun in `language` for a source in `source`, or null (TR-B). */
export function translationLanguageRefusal(
  source: string,
  language: string,
): 'translation.language_invalid' | 'translation.same_language' | null {
  if (!languageTagSchema.safeParse(language).success) return 'translation.language_invalid';
  return language === source ? 'translation.same_language' : null;
}

/** The source as a variant starts (TR-B): every block and its id kept, the root in `language`. */
export const asVariant = (source: ContentDocument, language: string): ContentDocument => ({
  ...source,
  language,
});

/** One source block a translation has not followed (TR-F; LOC-040). */
export interface SourceChange {
  readonly block: string;
  readonly change: 'added' | 'changed' | 'removed';
}

/**
 * Each block that differs between the source a variant translates and the source now, by block id
 * (TR-F): the newer source's blocks in its order, then those it no longer holds.
 */
export function sourceChangesBetween(was: ContentDocument, now: ContentDocument): SourceChange[] {
  return lineDifferences(now, was).map(({ block, change }) => ({
    block,
    change: change === 'main' ? 'added' : change === 'line' ? 'removed' : 'changed',
  }));
}
