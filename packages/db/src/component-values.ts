import {
  checkUserValues,
  principalIdsIn,
  resolveComponentFields,
  validate,
  type EffectiveField,
  type MetadataFailure,
  type MetadataValues,
} from '@alloy-works/domain';
import { currentDefinitionsFor, type CurrentDefinitions } from './creation.js';
import type { TenantTransaction } from './tables.js';
import type { StoredVersion } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A component's fields at the current definitions of the type its version records (MET-018): what its
 * next version will be cut against, and so what its values are written against.
 */
export async function componentFieldsNow(
  trx: TenantTransaction,
  version: StoredVersion,
): Promise<{ readonly definitions: CurrentDefinitions; readonly effective: EffectiveField[] }> {
  const typeRef = version.definitions.find((each) => each.kind === 'componentType');
  if (!typeRef) throw new Error(`Component ${version.artifactId} records no component type`);
  const definitions = await currentDefinitionsFor(trx, typeRef.id);
  if (!definitions) throw new Error(`No componentType ${typeRef.id} is stored in this tenant`);
  const effective = resolveComponentFields(
    definitions.type.definition,
    definitions.schemas.map((each) => each.definition),
    definitions.fields.map((each) => each.definition),
  );
  return { definitions, effective };
}

/**
 * What cannot be stored honestly with a component (definitions.md, "A component's"; component-editor.md,
 * "Metadata alongside"): a fixed field holding another value than its default (MET-033), a value that is
 * not the JSON its data type takes, and a `user` value naming no principal of this tenant (MET-038),
 * over one query of the principals named. Every other failure is saved, shown, and held at publication.
 */
export async function unstorableValues(
  trx: TenantTransaction,
  effective: readonly EffectiveField[],
  values: MetadataValues,
): Promise<MetadataFailure[]> {
  const failures = validate(effective, values).filter(
    (each) => each.rule === 'fixed' || each.rule === 'type',
  );
  const named = principalIdsIn(values, effective).filter((id) => UUID.test(id));
  const known = new Set(
    named.length === 0
      ? []
      : (await trx.selectFrom('principal').select('id').where('id', 'in', named).execute()).map(
          (row) => row.id,
        ),
  );
  // Nothing deactivates a principal yet, so every principal this tenant holds is an active one.
  failures.push(
    ...checkUserValues(values, effective, (id) => (known.has(id) ? { active: true } : undefined)),
  );
  return failures;
}

/**
 * The environment's people, for a `user` field's picker (definitions.md, DE-J): every principal who has
 * signed in, by name. One invited who has not signed in yet has no name to be picked by.
 */
export async function listPeople(
  trx: TenantTransaction,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const rows = await trx
    .selectFrom('principal')
    .select(['id', 'display_name', 'email'])
    .where('subject', 'is not', null)
    .execute();
  return rows
    .map((row) => ({ id: row.id, name: row.display_name ?? row.email ?? 'Unnamed' }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}
