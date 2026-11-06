import { BLANK_WORDS, blankTemplate, type BlankWords } from '@alloy-works/domain';
import { sql } from 'kysely';
import { isArchived } from './archival.js';
import { recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * **A space's default template** (TPL-074; the ND plan, ND-A, ND-N): what a document made there without
 * naming one takes. Blank until its administrator chooses another of the space's templates; made when
 * first needed, as whoever needs it, since a version needs an author. A default archived, deleted or
 * moved out of its space counts as none.
 */

/** The column as stored, read through `to_jsonb`, as current code runs on old schemas in migration tests. */
async function storedDefault(trx: TenantTransaction, space: string): Promise<string | null> {
  const { rows } = await sql<{ template: string | null }>`
    select to_jsonb(space) ->> 'default_template' as template from space where id = ${space}`.execute(
    trx,
  );
  return rows[0]?.template ?? null;
}

/** Whether this artifact is a template in this space, neither archived nor deleted: one a default may be. */
async function usable(trx: TenantTransaction, space: string, template: string): Promise<boolean> {
  const row = await trx
    .selectFrom('artifact')
    .select('id')
    .where('id', '=', template)
    .where('kind', '=', 'template')
    .where('space_id', '=', space)
    .executeTakeFirst();
  return (
    row !== undefined && !(await isArchived(trx, template)) && !(await isDeleted(trx, template))
  );
}

/** The space's default template now, or null where it has none that counts (ND-N). */
export async function defaultTemplateOf(
  trx: TenantTransaction,
  space: string,
): Promise<string | null> {
  if (!UUID.test(space)) return null;
  const stored = await storedDefault(trx, space);
  return stored !== null && (await usable(trx, space, stored)) ? stored : null;
}

/**
 * The space's default template, made first where it has none that counts (ND-N): Blank, by `principal`,
 * on the tenant's default theme and layout, set as the default. Under a lock on the space, so two
 * creators at once make one Blank. Undefined where the tenant holds no such space.
 */
export async function ensureDefaultTemplate(
  trx: TenantTransaction,
  space: string,
  principal: string,
  words: BlankWords = BLANK_WORDS,
): Promise<string | undefined> {
  if (!UUID.test(space)) return undefined;
  const exists = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', space)
    .executeTakeFirst();
  if (!exists) return undefined;
  // Locked only on a miss: a default already set needs nothing made, and every create in the space
  // would otherwise queue behind each other's transactions.
  const set = await defaultTemplateOf(trx, space);
  if (set !== null) return set;
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:default-template:${space}`}, 0))`.execute(
    trx,
  );
  const held = await defaultTemplateOf(trx, space);
  if (held !== null) return held;
  const theme = await trx.selectFrom('theme_default').select('theme_id').executeTakeFirstOrThrow();
  const layout = await trx
    .selectFrom('layout_default')
    .select('layout_id')
    .executeTakeFirstOrThrow();
  const made = await createTemplate(trx, {
    spaceId: space,
    author: principal,
    definition: blankTemplate(words, theme.theme_id, layout.layout_id),
  });
  if (!('template' in made)) throw new Error(`Blank was refused: ${made.answer}`);
  await trx
    .updateTable('space')
    .set({ default_template: made.template.id })
    .where('id', '=', space)
    .execute();
  return made.template.id;
}

/** Why a default is not set (ND-A): no such space, or not a template of it, live. */
export type SetDefaultAnswer =
  | { readonly answer: 'set' }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'template.unusable' };

/** Makes one of the space's templates its default; who may is the caller's to decide (administer). */
export async function setDefaultTemplate(
  trx: TenantTransaction,
  space: string,
  template: string,
): Promise<SetDefaultAnswer> {
  if (!UUID.test(space)) return { answer: 'space.missing' };
  if (!UUID.test(template)) return { answer: 'template.unusable' };
  const exists = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', space)
    .executeTakeFirst();
  if (!exists) return { answer: 'space.missing' };
  if (!(await usable(trx, space, template))) return { answer: 'template.unusable' };
  const from = await storedDefault(trx, space);
  const named = await trx
    .updateTable('space')
    .set({ default_template: template })
    .where('id', '=', space)
    .returning('name')
    .executeTakeFirstOrThrow();
  if (from !== template) {
    await recordEvent(
      trx,
      {
        kind: 'space.default_template_changed',
        subject: { kind: 'space', id: space },
        space,
        detail: { from, to: template },
      },
      [{ role: 'subject', text: named.name, refersTo: space }],
    );
  }
  return { answer: 'set' };
}
