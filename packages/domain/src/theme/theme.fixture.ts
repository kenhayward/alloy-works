import {
  DEFAULT_CATALOGUES,
  DEFAULT_THEME,
  SECOND_DEFAULT_CATALOGUES,
  THIRD_DEFAULT_THEME,
} from './default.js';
import { readTheme, upgradeCatalogue2, type ResolvedTheme, type ThemeReadOutcome } from './read.js';
import {
  CATALOGUE_KINDS,
  type ImageCatalogue,
  type TableCatalogue,
  type Theme,
  type ValueCatalogue,
} from './schema.js';

/**
 * The default theme's inputs as a test changes them: a fresh copy each call, so no test sees another's
 * edits. Kept out of the build (`*.fixture.ts`).
 */
export function defaultInputs(): ThemeInputs {
  return {
    theme: structuredClone(DEFAULT_THEME),
    catalogues: structuredClone(DEFAULT_CATALOGUES),
  };
}

/**
 * A theme and its six catalogues, each as the default's rows hold them, and the value catalogue where
 * the theme names one, as its 0.6 does.
 */
export type ThemeInputs = {
  theme: Theme;
  catalogues: Omit<typeof DEFAULT_CATALOGUES, 'value'> & { value?: ValueCatalogue };
};

/**
 * The default theme's 0.3, before its 0.4 added styles for an author to choose: each catalogue holding
 * only what a place or a role sets, one table style and the two image styles. A test of one of the
 * reader's rules that judges every style - contrast on every fill a text can stand on - reads it, so
 * that what it counts is the rule's, not the styles the default happens to offer.
 */
export function plainInputs(): ThemeInputs {
  const catalogues = structuredClone(SECOND_DEFAULT_CATALOGUES);
  // Its table and image catalogues as the reader reads their `catalogue/2` rows, at `catalogue/3`, so
  // a test changes a style in the shape it is read in.
  return {
    theme: structuredClone(THIRD_DEFAULT_THEME),
    catalogues: {
      ...catalogues,
      table: upgradeCatalogue2(catalogues.table) as TableCatalogue,
      image: upgradeCatalogue2(catalogues.image) as ImageCatalogue,
    },
  };
}

/** Read the inputs as the store and `assemble` do: each catalogue under the version the theme names. */
export function read(inputs: ThemeInputs): ThemeReadOutcome {
  const byVersion = new Map<string, unknown>(
    CATALOGUE_KINDS.map((kind) => [inputs.theme.catalogues[kind], inputs.catalogues[kind]]),
  );
  const value = inputs.theme.catalogues.value;
  if (value !== undefined) byVersion.set(value, inputs.catalogues.value);
  return readTheme(inputs.theme, byVersion);
}

/** Read the inputs, or fail the test naming every refusal. */
export function resolved(inputs: ThemeInputs = defaultInputs()): ResolvedTheme {
  const outcome = read(inputs);
  if (!outcome.ok) {
    throw new Error(outcome.refusals.map((each) => `${each.code}: ${each.message}`).join('\n'));
  }
  return outcome.theme;
}

/** The codes a read refused with, in the order given; none where it read. */
export function codes(outcome: ThemeReadOutcome): string[] {
  return outcome.ok ? [] : outcome.refusals.map((each) => each.code);
}
