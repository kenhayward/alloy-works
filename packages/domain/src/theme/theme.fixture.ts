import {
  DEFAULT_CATALOGUES,
  DEFAULT_THEME,
  SECOND_DEFAULT_CATALOGUES,
  THIRD_DEFAULT_THEME,
} from './default.js';
import { readTheme, type ResolvedTheme, type ThemeReadOutcome } from './read.js';
import { CATALOGUE_KINDS } from './schema.js';

/**
 * The default theme's inputs as a test changes them: a fresh copy each call, so no test sees another's
 * edits. Kept out of the build (`*.fixture.ts`).
 */
export function defaultInputs() {
  return {
    theme: structuredClone(DEFAULT_THEME),
    catalogues: structuredClone(DEFAULT_CATALOGUES),
  };
}

export type ThemeInputs = ReturnType<typeof defaultInputs>;

/**
 * The default theme's 0.3, before its 0.4 added styles for an author to choose: each catalogue holding
 * only what a place or a role sets, one table style and the two image styles. A test of one of the
 * reader's rules that judges every style - contrast on every fill a text can stand on - reads it, so
 * that what it counts is the rule's, not the styles the default happens to offer.
 */
export function plainInputs(): ThemeInputs {
  return {
    theme: structuredClone(THIRD_DEFAULT_THEME),
    catalogues: structuredClone(SECOND_DEFAULT_CATALOGUES),
  };
}

/** Read the inputs as the store and `assemble` do: each catalogue under the version the theme names. */
export function read(inputs: ThemeInputs): ThemeReadOutcome {
  const byVersion = new Map<string, unknown>(
    CATALOGUE_KINDS.map((kind) => [inputs.theme.catalogues[kind], inputs.catalogues[kind]]),
  );
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
