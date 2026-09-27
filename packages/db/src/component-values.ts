import { sql } from 'kysely';
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
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';

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
 * signed in, a page at a time by when each first appeared and then id (API-007) - a name is changed in
 * place at every sign-in, so it is no key a walk could hold its order by. The picker sorts them by name.
 * One invited who has not signed in yet has no name to be picked by.
 */
export async function listPeople(
  trx: TenantTransaction,
  request: ListingRequest<SortOf<'people'>> = { limit: 100 },
): Promise<Listed<{ readonly id: string; readonly name: string }>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.people.joined;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  const inner = trx
    .selectFrom('principal as p')
    .select(['p.id', 'p.display_name', 'p.email'])
    .select(sortColumns([sql`p.created_at`]))
    .where('p.subject', 'is not', null);
  const { rows, next } = await keysetPage<{
    id: string;
    display_name: string | null;
    email: string | null;
  }>(trx, inner, types, request.order ?? order, limit, request.after);
  return {
    items: rows.map((row) => ({ id: row.id, name: row.display_name ?? row.email ?? 'Unnamed' })),
    next,
    snapshot,
  };
}
