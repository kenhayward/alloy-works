import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Where an entry's `field_values` hold its conditions and its relationships' fields (the R14 plan,
 * R14-D, R14-E): keys no field's id can take, so the fields facet, which joins on a field's id, never
 * reads them, and no table gains a column an older schema lacks.
 */
export const CONDITIONS_KEY = '~conditions';
export const RELATIONS_KEY = '~relations';

/** One field value of a relationship an artifact is an end of, and the artifact at its other end. */
export interface HeldRelation {
  readonly type: string;
  readonly field: string;
  readonly value: unknown;
  readonly other: string;
}

/**
 * Every field value of every relationship `artifact` is an end of (SCH-063), each with the other end,
 * so a reader who may not read that end is told nothing of it. None before 0108, which only a test
 * migrated to an earlier point reads.
 */
export async function relationsHeld(
  trx: TenantTransaction,
  artifact: string,
): Promise<HeldRelation[]> {
  if (!(await relationshipsStored(trx))) return [];
  const { rows } = await sql<HeldRelation>`
    select r.type_id::text as type, fv.key as field, fv.value,
           (case when r.from_id = ${artifact}::uuid then r.to_id else r.from_id end)::text as other
      from relationship r
      cross join lateral jsonb_each(r.field_values) as fv(key, value)
     where r.from_id = ${artifact}::uuid or r.to_id = ${artifact}::uuid
     order by r.type_id, fv.key, r.id`.execute(trx);
  return rows;
}

async function relationshipsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    held: boolean;
  }>`select to_regclass('relationship') is not null as held`.execute(trx);
  return rows[0]?.held === true;
}

/** An entry's values as stored: its fields', then its conditions and its relationships' fields. */
export function storedValues(
  values: Readonly<Record<string, unknown>>,
  conditions: readonly string[],
  relations: readonly HeldRelation[],
): string {
  return JSON.stringify({
    ...values,
    ...(conditions.length === 0 ? {} : { [CONDITIONS_KEY]: conditions }),
    ...(relations.length === 0 ? {} : { [RELATIONS_KEY]: relations }),
  });
}
