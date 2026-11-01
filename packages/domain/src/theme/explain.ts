import { ancestry, type ThemeRefusal } from './read.js';
import type { ParagraphCatalogue, ResolvedParagraphProperties } from './schema.js';

/** A resolved property and the style that states it, or null where it is the catalogue's base. */
export interface ExplainedProperty<T> {
  readonly value: T;
  readonly from: string | null;
}

export type ExplainedProperties = {
  readonly [K in keyof ResolvedParagraphProperties]: ExplainedProperty<
    ResolvedParagraphProperties[K]
  >;
};

export type ExplainOutcome =
  | { ok: true; properties: ExplainedProperties }
  | { ok: false; refusals: ThemeRefusal[] };

/**
 * **Where a style's values come from** (STY-057, SY-E): each property from the nearest ancestor that
 * states it, walked by the reader's own `ancestry`, so what a form shows is what every output sets.
 */
export function explainStyle(catalogue: ParagraphCatalogue, styleId: string): ExplainOutcome {
  const styles = new Map(catalogue.styles.map((style) => [style.id, style]));
  const style = styles.get(styleId);
  if (style === undefined) {
    return {
      ok: false,
      refusals: [
        {
          code: 'style_missing',
          message: `The paragraph catalogue does not contain the style ${styleId}`,
        },
      ],
    };
  }
  const walked = ancestry(style, styles);
  if (!walked.ok) return { ok: false, refusals: [walked.refusal] };
  const out: Record<string, ExplainedProperty<unknown>> = {};
  for (const [key, value] of Object.entries(catalogue.base)) out[key] = { value, from: null };
  // From the root down, so the nearest statement is laid last.
  for (const link of [...walked.path].reverse()) {
    for (const [key, value] of Object.entries(link.properties)) {
      if (value !== undefined) out[key] = { value, from: link.id };
    }
  }
  return { ok: true, properties: out as unknown as ExplainedProperties };
}
