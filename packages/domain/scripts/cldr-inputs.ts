// What the declared content languages are derived from (the TE plan, TE-E): the pinned CLDR, read from
// `cldr-core` and `cldr-misc-full`, and the default theme's body faces. Node only; never in src.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { covers } from '@alloy-works/fonts';

import type { CldrInputs } from '../src/interface/declared-languages.js';
import { DEFAULT_THEME } from '../src/theme/default.js';

const require = createRequire(import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const root = (name: string) => dirname(require.resolve(`${name}/package.json`));

export function cldrInputs(): CldrInputs {
  const core = root('cldr-core');
  const misc = root('cldr-misc-full');
  const { version } = json(join(core, 'package.json')) as { version: string };
  const { availableLocales } = json(join(core, 'availableLocales.json')) as {
    availableLocales: { full: string[] };
  };
  const exemplars: Record<string, string> = {};
  for (const tag of availableLocales.full) {
    try {
      const file = json(join(misc, 'main', tag, 'characters.json')) as {
        main: Record<string, { characters: { exemplarCharacters?: string } }>;
      };
      const set = file.main[tag]?.characters.exemplarCharacters;
      if (set !== undefined) exemplars[tag] = set;
    } catch {
      // A locale with no characters of its own declares nothing.
    }
  }
  const rules = (
    json(join(core, 'supplemental', 'plurals.json')) as {
      supplemental: { 'plurals-type-cardinal': Record<string, Record<string, string>> };
    }
  ).supplemental['plurals-type-cardinal'];
  const plurals = Object.fromEntries(
    Object.entries(rules).map(([key, each]) => [
      key,
      Object.keys(each).map((rule) => rule.replace('pluralRule-count-', '')),
    ]),
  );
  return { cldr: version, available: availableLocales.full, exemplars, plurals };
}

/** The default theme's body face and its fallbacks, in order (STY-075). */
const body = (() => {
  const faces = DEFAULT_THEME.typefaces;
  const serif = faces.find((each) => each.id === 'serif')!;
  return [serif, ...(serif.fallback ?? []).map((id) => faces.find((each) => each.id === id)!)].map(
    (each) => each.family,
  );
})();

/** Whether the default theme's body sets a character in one of its faces. */
export const coveredByDefaultFaces = (codePoint: number): boolean =>
  body.some((family) => covers(codePoint, family));
