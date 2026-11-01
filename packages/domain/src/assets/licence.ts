import { z } from 'zod';

import { languageTagSchema } from '../content/model/document.js';
import { characters, CONTROL, storable } from '../data/primitives.js';
import { httpsUrl } from '../extensions/manifest.js';
import { definitionIdentity } from '../metadata/definition.js';

/**
 * **A licence** (assets.md; the AL plan, AL-B): an environment-wide definition an image is held under,
 * saying what it permits (AST-022) and whether, and how, it must be credited (AST-045). Expiry and the
 * credit an image needs are its grant's, on the image (AL-C), never the licence's.
 */
export const LICENCE_USES = ['internal', 'publication', 'redistribution', 'modification'] as const;
export type LicenceUse = (typeof LICENCE_USES)[number];

export const LICENCE_LIMITS = { languages: 50, name: 200, wording: 500 } as const;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, {
  message: 'A key is a lower-case letter, then letters, digits or underscores',
});

/** Text people read: not blank, at most `max` characters, no control character. */
const text = (what: string, max: number) =>
  storable(what)
    .refine((value) => value.trim() !== '' && characters(value) <= max, {
      message: `${what} is 1 to ${max.toLocaleString('en')} characters`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

export const licenceDefinitionSchema = z
  .strictObject({
    ...definitionIdentity,
    key,
    base: languageTagSchema,
    names: z
      .array(
        z.strictObject({ language: languageTagSchema, text: text('A name', LICENCE_LIMITS.name) }),
      )
      .min(1)
      .max(LICENCE_LIMITS.languages),
    permits: z
      .array(z.enum(LICENCE_USES))
      .refine((uses) => new Set(uses).size === uses.length, { message: 'Each use once' }),
    attribution: z.strictObject({
      required: z.boolean(),
      wording: text('An attribution', LICENCE_LIMITS.wording).optional(),
    }),
    url: httpsUrl.optional(),
  })
  .superRefine((licence, ctx) => {
    licence.names.forEach((each, n) => {
      if (licence.names.findIndex((other) => other.language === each.language) !== n) {
        ctx.addIssue({
          code: 'custom',
          path: ['names', n, 'language'],
          message: 'Each language once',
        });
      }
    });
    if (!licence.names.some((each) => each.language === licence.base)) {
      ctx.addIssue({ code: 'custom', path: ['names'], message: 'Named in the base language' });
    }
    if (!licence.attribution.required && licence.attribution.wording !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['attribution', 'wording'],
        message: 'Only a licence requiring attribution says what it must say',
      });
    }
  });
export type Licence = z.infer<typeof licenceDefinitionSchema>;

export interface LicenceProblem {
  readonly rule: 'licence_invalid';
  readonly path: string;
  readonly message: string;
}

/** A licence refused, with every problem found. */
export class LicenceRefused extends Error {
  constructor(readonly problems: readonly LicenceProblem[]) {
    super(
      `The licence is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`,
    );
  }
}

/** The shape every write parses. Throws `LicenceRefused`. */
export function parseLicence(value: unknown): Licence {
  const parsed = licenceDefinitionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new LicenceRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'licence_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

export const licencePermits = (licence: Licence, use: LicenceUse) => licence.permits.includes(use);

/** Its name in `language`, the base language's where it has none. */
export const licenceName = (licence: Licence, language: string) =>
  (licence.names.find((each) => each.language === language) ??
    licence.names.find((each) => each.language === licence.base))!.text;
