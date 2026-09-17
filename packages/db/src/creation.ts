import { readDefinition } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/**
 * The component type 0015 gives every environment: Topic, assigning no schemas (MET-012). Fixed, so a
 * development database made before 0015 keeps the one `pnpm dev:setup` has been making rather than
 * gaining a second beside it.
 */
export const STARTER_COMPONENT_TYPE_ID = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

/** The component type this environment declares as its default (MET-012). */
export async function defaultComponentType(trx: TenantTransaction): Promise<string | undefined> {
  const row = await trx
    .selectFrom('component_type_default')
    .select('component_type_id')
    .executeTakeFirst();
  return row?.component_type_id;
}

/** One component type as a chooser shows it. */
export interface ComponentTypeSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * Every component type this environment holds, by name, with the default marked - each read at its
 * latest version the way stored definitions are read, so a payload from an older definition schema is
 * migrated rather than refused. One that does not read is left out rather than throwing: a chooser is
 * better short than broken, and the definitions-management design owns telling somebody why.
 */
export async function listComponentTypes(
  trx: TenantTransaction,
): Promise<readonly ComponentTypeSummary[]> {
  const declared = await defaultComponentType(trx);
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.id', 'v.content'])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.id as version_id', 'latest.content'])
    .where('a.kind', '=', 'componentType')
    .execute();
  const types = rows.flatMap((row): ComponentTypeSummary[] => {
    const read = readDefinition('componentType', row.content, {
      artifact: row.id,
      version: row.version_id,
    });
    if (!read.ok) return [];
    return [{ id: row.id, name: read.definition.name, isDefault: row.id === declared }];
  });
  return types.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
