import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';

/**
 * **The bridge's stored shapes** (docs/design/ct-studio-sink.md, "Idempotency and atomicity" and
 * "Provenance"; the CS plan, Task 5): the deliveries CT Studio's bridge asked for, the elements a
 * source document's persistent identity has made, a space's bridge settings, and the nonces of signed
 * requests. A delivery is keyed, so a repeat of one finds it instead of making it twice (API-068);
 * a refused delivery gives its key up, so a retry is a fresh attempt (API-067).
 */

export type DeliveryFamily = 'document' | 'data';
export type DeliveryState = 'running' | 'written' | 'refused';

/** A delivery as it is stored. */
export interface StoredDelivery {
  readonly id: string;
  /** Null once refused. */
  readonly key: string | null;
  readonly spaceId: string;
  readonly family: DeliveryFamily;
  readonly state: DeliveryState;
  readonly tokenId: string;
  readonly principalId: string;
  /** The package waiting in the object store; null once the delivery is written or refused. */
  readonly packageKey: string | null;
  readonly persistentId: string | null;
  readonly receipt: unknown;
  readonly refusal: unknown;
  readonly carried: readonly unknown[];
  readonly provenance: unknown;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

/** A refusal as the contract carries it. */
export interface DeliveryRefusal {
  readonly class: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface NewDelivery {
  readonly key: string;
  readonly spaceId: string;
  readonly family: DeliveryFamily;
  readonly tokenId: string;
  /** The service identity the token was issued to. */
  readonly principalId: string;
  readonly packageKey: string | null;
  readonly provenance: unknown;
}

export type StartedDelivery =
  | { readonly answer: 'started'; readonly id: string }
  | { readonly answer: 'running'; readonly id: string }
  | { readonly answer: 'written'; readonly receipt: unknown };

type DeliveryRow = {
  id: string;
  key: string | null;
  space_id: string;
  family: DeliveryFamily;
  state: DeliveryState;
  token_id: string;
  principal_id: string;
  package_key: string | null;
  persistent_id: string | null;
  receipt: unknown;
  refusal: unknown;
  carried: unknown;
  provenance: unknown;
  created_at: Date;
  finished_at: Date | null;
};

const deliveryOf = (row: DeliveryRow): StoredDelivery => ({
  id: row.id,
  key: row.key,
  spaceId: row.space_id,
  family: row.family,
  state: row.state,
  tokenId: row.token_id,
  principalId: row.principal_id,
  packageKey: row.package_key,
  persistentId: row.persistent_id,
  receipt: row.receipt,
  refusal: row.refusal,
  carried: Array.isArray(row.carried) ? (row.carried as unknown[]) : [],
  provenance: row.provenance,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

/**
 * Starts a delivery, or answers the one its key already names (API-068). The insert is the unique key's
 * own arbiter, so of two calls with one key at once exactly one gets `started`: the other waits on
 * the first's commit and then finds its row `running` (or `written`). A key whose delivery was refused
 * is free, so it starts again.
 */
export async function startDelivery(
  trx: TenantTransaction,
  input: NewDelivery,
): Promise<StartedDelivery> {
  for (;;) {
    const made = await trx
      .insertInto('bridge_delivery')
      .values({
        key: input.key,
        space_id: input.spaceId,
        family: input.family,
        token_id: input.tokenId,
        principal_id: input.principalId,
        package_key: input.packageKey,
        provenance: JSON.stringify(input.provenance),
      })
      .onConflict((conflict) => conflict.column('key').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (made) return { answer: 'started', id: made.id };
    const found = await trx
      .selectFrom('bridge_delivery')
      .select(['id', 'state', 'receipt'])
      .where('key', '=', input.key)
      .executeTakeFirst();
    // Freed since the insert (a refusal): the key is ours to start again.
    if (!found) continue;
    return found.state === 'written'
      ? { answer: 'written', receipt: found.receipt }
      : { answer: 'running', id: found.id };
  }
}

/** A delivery by its id, or undefined when this tenant holds none. */
export async function readDelivery(
  trx: TenantTransaction,
  id: string,
): Promise<StoredDelivery | undefined> {
  const row = await trx
    .selectFrom('bridge_delivery')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row === undefined ? undefined : deliveryOf(row);
}

/**
 * Records a running delivery as written, with its receipt, what it carried along unplaced and the
 * source document's persistent identity where it has one, and lets go of the package it no longer
 * needs. Undefined when the delivery is not running. Recorded as bridge.delivered, about the document
 * (`subject`) of a document delivery, and about the space of a data delivery, which has none.
 * `provenance` is what the writing learnt - the properties with nowhere to go (Ruling 15), the
 * originals kept - added to the provenance stored at accept, which keeps everything it had.
 */
export async function finishDelivery(
  trx: TenantTransaction,
  id: string,
  receipt: unknown,
  carried: readonly unknown[],
  options: {
    readonly persistentId?: string;
    readonly subject?: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<StoredDelivery | undefined> {
  const row = await trx
    .updateTable('bridge_delivery')
    .set({
      ...(options.provenance === undefined
        ? {}
        : {
            provenance: sql<string>`provenance || ${JSON.stringify(options.provenance)}::jsonb`,
          }),
      state: 'written',
      receipt: JSON.stringify(receipt),
      carried: JSON.stringify(carried),
      persistent_id: options.persistentId ?? null,
      package_key: null,
      finished_at: new Date(),
    })
    .where('id', '=', id)
    .where('state', '=', 'running')
    .returningAll()
    .executeTakeFirst();
  if (!row) return undefined;
  await recordEvent(trx, {
    kind: 'bridge.delivered',
    space: row.space_id,
    subject:
      options.subject === undefined
        ? { kind: 'space', id: row.space_id }
        : { kind: 'artifact', id: options.subject },
    detail: { delivery: id, family: row.family },
  });
  return deliveryOf(row);
}

/**
 * Records a running delivery as refused, with the contract's error, frees its key so a retry starts
 * fresh, and lets go of the package. The row stays as the record. Undefined when the delivery is not
 * running. Recorded as bridge.refused.
 */
export async function refuseDelivery(
  trx: TenantTransaction,
  id: string,
  error: DeliveryRefusal,
): Promise<StoredDelivery | undefined> {
  const row = await trx
    .updateTable('bridge_delivery')
    .set({
      state: 'refused',
      refusal: JSON.stringify(error),
      key: null,
      package_key: null,
      finished_at: new Date(),
    })
    .where('id', '=', id)
    .where('state', '=', 'running')
    .returningAll()
    .executeTakeFirst();
  if (!row) return undefined;
  await recordEvent(trx, {
    kind: 'bridge.refused',
    outcome: 'refused',
    space: row.space_id,
    subject: { kind: 'space', id: row.space_id },
    detail: { delivery: id, family: row.family, class: error.class, code: error.code },
  });
  return deliveryOf(row);
}

/**
 * Takes a request's nonce (API-066). The platform table's primary key arbitrates between replicas: the
 * second to insert a nonce conflicts (with no target named, which needs no select on the table), and a
 * conflict answers 'replayed' rather than throwing.
 */
export async function recordNonce(
  trx: TenantTransaction,
  nonce: string,
): Promise<'new' | 'replayed'> {
  const result = await sql`
    insert into platform.bridge_nonce (nonce) values (${nonce}) on conflict do nothing`.execute(
    trx,
  );
  return (result.numAffectedRows ?? 0n) > 0n ? 'new' : 'replayed';
}

/**
 * Takes the tenant's lock on turning data delivery on, held to the end of the transaction: of two
 * turn-ons at once, in different spaces, the second reads the first's connections once it commits,
 * so the credentials it seals are never from the older of two passwords.
 */
export async function lockBridgeProvision(trx: TenantTransaction, tenantId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:bridge-provision:${tenantId}`}, 0))`.execute(
    trx,
  );
}

/** A space's bridge settings. */
export interface BridgeSettings {
  readonly spaceId: string;
  readonly componentType: string | null;
  readonly template: string | null;
  /** Property name to the template's document field it fills. */
  /** Each CT Studio property name to the field it fills, or `null` for one the space ignores. */
  readonly propertyMap: Readonly<Record<string, string | null>>;
  readonly connectionId: string | null;
  readonly tableSchema: string | null;
  readonly changedBy: string;
  readonly changedAt: Date;
}

export type NewBridgeSettings = Omit<BridgeSettings, 'changedAt'>;

/** A space's bridge settings, or undefined when it has none, which is a space not set up for delivery. */
export async function readBridgeSettings(
  trx: TenantTransaction,
  spaceId: string,
): Promise<BridgeSettings | undefined> {
  const row = await trx
    .selectFrom('bridge_settings')
    .selectAll()
    .where('space_id', '=', spaceId)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    spaceId: row.space_id,
    componentType: row.component_type,
    template: row.template,
    propertyMap: row.property_map as Record<string, string | null>,
    connectionId: row.connection_id,
    tableSchema: row.table_schema,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

/** The settings that can change, by the name the audit event gives each. */
const named = (settings: Omit<NewBridgeSettings, 'spaceId' | 'changedBy'> | undefined) => ({
  componentType: settings?.componentType ?? null,
  template: settings?.template ?? null,
  propertyMap: JSON.stringify(settings?.propertyMap ?? {}),
  connection: settings?.connectionId ?? null,
  tableSchema: settings?.tableSchema ?? null,
});

/** Writes a space's bridge settings whole, and records bridge.settings_changed with the names that changed. */
export async function writeBridgeSettings(
  trx: TenantTransaction,
  input: NewBridgeSettings,
): Promise<BridgeSettings> {
  const before = await readBridgeSettings(trx, input.spaceId);
  const now = new Date();
  const values = {
    component_type: input.componentType,
    template: input.template,
    property_map: JSON.stringify(input.propertyMap),
    connection_id: input.connectionId,
    table_schema: input.tableSchema,
    changed_by: input.changedBy,
    changed_at: now,
  };
  await trx
    .insertInto('bridge_settings')
    .values({ space_id: input.spaceId, ...values })
    .onConflict((conflict) => conflict.column('space_id').doUpdateSet(values))
    .execute();
  const was = named(before);
  const is = named(input);
  await recordEvent(trx, {
    kind: 'bridge.settings_changed',
    space: input.spaceId,
    subject: { kind: 'space', id: input.spaceId },
    detail: {
      changed: (Object.keys(is) as (keyof typeof is)[]).filter((name) => was[name] !== is[name]),
    },
  });
  return { ...input, changedAt: now };
}

/** An element a source document's persistent identity has made. */
export interface BridgeElement {
  readonly element: string;
  readonly artifactId: string;
  readonly node: string | null;
}

/** What a persistent identity has made so far, by element. */
export async function elementsOf(
  trx: TenantTransaction,
  persistentId: string,
): Promise<readonly BridgeElement[]> {
  const rows = await trx
    .selectFrom('bridge_element')
    .select(['element', 'artifact_id', 'node'])
    .where('persistent_id', '=', persistentId)
    .orderBy('element')
    .execute();
  return rows.map((row) => ({ element: row.element, artifactId: row.artifact_id, node: row.node }));
}

/** Records the elements a persistent identity made; one already recorded takes the new artifact and node. */
export async function recordElements(
  trx: TenantTransaction,
  persistentId: string,
  entries: readonly BridgeElement[],
): Promise<void> {
  if (entries.length === 0) return;
  await trx
    .insertInto('bridge_element')
    .values(
      entries.map((entry) => ({
        persistent_id: persistentId,
        element: entry.element,
        artifact_id: entry.artifactId,
        node: entry.node,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(['persistent_id', 'element']).doUpdateSet((eb) => ({
        artifact_id: eb.ref('excluded.artifact_id'),
        node: eb.ref('excluded.node'),
      })),
    )
    .execute();
}
