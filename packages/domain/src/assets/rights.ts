import { z } from 'zod';

import { characters, CONTROL, storable } from '../data/primitives.js';
import { httpsUrl } from '../extensions/manifest.js';
import { isIsoDate } from '../metadata/lexical.js';
import { licencePermits, type Licence } from './licence.js';

export const RIGHTS_LIMITS = { source: 500, credit: 500 } as const;

/** Text people read: not blank, at most `max` characters, no control character. */
const text = (what: string, max: number) =>
  storable(what)
    .refine((value) => value.trim() !== '' && characters(value) <= max, {
      message: `${what} is 1 to ${max.toLocaleString('en')} characters`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

/**
 * **An image's rights** (assets.md; the AL plan, AL-C): the asset's, not a version's, each change a row
 * of its own. Declared, its source (AST-021) and the licence it is held under, with the grant's own
 * expiry (AST-052) and the credit it needs; `undeclared`, recorded so that it is listable (AST-044);
 * or a dataset's image, whose source is the dataset, the environment's own data.
 */
export const assetRightsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('undeclared') }),
  z.strictObject({ kind: z.literal('dataset') }),
  z.strictObject({
    kind: z.literal('declared'),
    source: z.strictObject({
      text: text('A source', RIGHTS_LIMITS.source),
      url: httpsUrl.optional(),
    }),
    licence: z.uuid(),
    /** The last day the grant holds, a calendar date. */
    expires: z.string().refine(isIsoDate, 'not a date, YYYY-MM-DD').optional(),
    credit: text('A credit', RIGHTS_LIMITS.credit).optional(),
  }),
]);
export type AssetRights = z.infer<typeof assetRightsSchema>;

/** What a person may declare (AL-E): never a dataset's kind, which only a dataset's image has. */
export const declarableRightsSchema = z.discriminatedUnion('kind', [
  assetRightsSchema.options[0],
  assetRightsSchema.options[2],
]);
export type DeclarableRights = z.infer<typeof declarableRightsSchema>;

/** What publishing finds of an image's rights (AL-F), each in `publishFailureCodes`. */
export type RightsFinding = {
  readonly code: 'asset_licence_forbids' | 'asset_undeclared' | 'asset_licence_expired';
  /** A failure of the publish, or a warning on it. */
  readonly refuses: boolean;
};

/**
 * An image's rights as a publish finds them (AST-023, AST-052, AST-053; AL-F), on `today`, a calendar
 * date: a licence not permitting publication always refuses; an undeclared image, or one whose grant is
 * past its last day, refuses or is reported by the environment's policy; a dataset's image passes.
 * `licence` is the one the rights name at its latest version, undefined where it is not there.
 */
export function rightsAtPublish(
  rights: AssetRights,
  licence: Licence | undefined,
  today: string,
  policy: 'warn' | 'refuse',
): RightsFinding | null {
  if (rights.kind === 'dataset') return null;
  if (rights.kind === 'undeclared' || licence === undefined) {
    return { code: 'asset_undeclared', refuses: policy === 'refuse' };
  }
  if (!licencePermits(licence, 'publication')) {
    return { code: 'asset_licence_forbids', refuses: true };
  }
  if (rights.expires !== undefined && rights.expires < today) {
    return { code: 'asset_licence_expired', refuses: policy === 'refuse' };
  }
  return null;
}
