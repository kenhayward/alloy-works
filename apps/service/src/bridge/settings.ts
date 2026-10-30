import { randomBytes } from 'node:crypto';
import type {
  BridgeSettingsBody,
  BridgeSettingsView,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  checkSpaceLive,
  createConnection,
  createDeliveredStore,
  deliveredNames,
  dropUnlisted,
  lockBridgeProvision,
  readBridgeSettings,
  readConnection,
  readDefinitionLatest,
  readUnlisted,
  readTemplate,
  setConnectionCredential,
  templateReferences,
  writeBridgeSettings,
  type BridgeSettings,
  type DeliveredAccess,
  type DeliveredStore,
  type StoredConnection,
  type Tenant,
  type TenantTransaction,
  type UnlistedProperty,
} from '@alloy-works/db';
import { resolveTemplate, type PostgresSettings } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, type Authorised } from '../access.js';
import type { ConnectorOptions } from '../data/connections.js';
import { createConnectorClient } from '../data/connector.js';
import { failureView } from '../data/failure-words.js';
import { AppError } from '../errors.js';

/**
 * The delivery store as every connection to it names it: the host the connector reaches it by, and
 * the database its tenants' schemas live in (docs/design/ct-studio-sink.md, "Data tables"). The
 * account is the tenant's read-only role, which the store names when it provisions it.
 */
const STORE_HOST = 'delivered-postgres';
const STORE_PORT = 5432;
const STORE_DATABASE = 'delivered';

type Problem = {
  readonly path: string;
  readonly reason:
    'component_type_missing' | 'template_missing' | 'template_unresolved' | 'field_not_in_template';
};

/** A space's settings as the API answers them: data delivery is on while a delivery schema is named. */
function viewOf(
  settings: BridgeSettings | undefined,
  unlisted: readonly UnlistedProperty[],
): BridgeSettingsView {
  return {
    componentType: settings?.componentType ?? null,
    template: settings?.template ?? null,
    propertyMap: { ...settings?.propertyMap },
    data: settings?.tableSchema != null,
    connection: settings?.connectionId ?? null,
    unlisted: unlisted.map((each) => ({
      name: each.name,
      firstDelivered: each.firstDelivered.toISOString(),
      lastDelivered: each.lastDelivered.toISOString(),
      deliveries: each.deliveries,
    })),
  };
}

/** The connection data delivery makes: the tenant's read-only account on the delivery store. */
const connectionSettings = (account: string): PostgresSettings => ({
  schemaVersion: 1,
  name: 'CT Studio delivered data',
  description:
    'The tables CT Studio delivered to this environment, read with an account that can only read them.',
  type: 'postgres',
  source: {
    host: STORE_HOST,
    port: STORE_PORT,
    database: STORE_DATABASE,
    account,
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
});

/** Whether a connection is the delivery store's own, as this one is made: a credential is sealed only for that. */
const pointsAtStore = (found: StoredConnection['settings'], store: PostgresSettings): boolean =>
  found.type === 'postgres' &&
  !found.retired &&
  found.source.host === store.source.host &&
  found.source.port === store.source.port &&
  found.source.database === store.source.database &&
  found.source.account === store.source.account &&
  found.source.tls === store.source.tls;

const storeUnavailable = (message: string) =>
  new AppError(503, 'delivery_store_unavailable', message);

const connectorUnavailable = () =>
  new AppError(503, 'connector_unavailable', failureView('connector_unavailable').message);

/**
 * The bridge settings routes (docs/design/ct-studio-sink.md, "Metadata" and "Data tables"; API-071,
 * API-072): what an administrator of a space sets for CT Studio's deliveries, and the one act that
 * reaches beyond the platform's own database - turning data delivery on, which provisions the
 * tenant's schema and read account on the delivery store and seals that account's password onto
 * the space's connection through the connector. The password lives in this module's memory from
 * the store's answer to the connector's seal, and nowhere else: no response, event or log holds it.
 */
export function bridgeSettingsHandlers(options: {
  readonly tenantOf: (request: FastifyRequest) => Tenant;
  readonly connector?: ConnectorOptions | undefined;
  /** The delivery store's owner URL (SECRET_DELIVERED_URL); absent where there is no store. */
  readonly deliveredUrl?: string | undefined;
}) {
  const client = options.connector ? createConnectorClient(options.connector) : undefined;
  let store: DeliveredStore | undefined;

  /** Opened on first use, so an environment that never turns delivery on never connects to it. */
  const delivered = (): DeliveredStore => {
    if (options.deliveredUrl === undefined || options.deliveredUrl === '') {
      throw storeUnavailable(
        'This environment has no delivery store, so data cannot be delivered.',
      );
    }
    store ??= createDeliveredStore(options.deliveredUrl);
    return store;
  };

  /** The store's own words may name its host: said to the log by code alone, never to the caller. */
  function storeFailed(request: FastifyRequest, error: unknown): AppError {
    request.log.warn(
      { code: (error as { code?: unknown }).code },
      'the delivery store did not answer',
    );
    return storeUnavailable('The delivery store did not answer, so data cannot be delivered.');
  }

  /** Seals a password for a connection through the connector, which alone holds the sealing key. */
  async function seal(
    tenant: Tenant,
    connection: StoredConnection,
    password: string,
  ): Promise<string> {
    if (!client) throw connectorUnavailable();
    const sealed = await client.seal(tenant.id, connection.id, password, connection.settings);
    if ('refused' in sealed) {
      throw new AppError(503, sealed.refused.code, failureView(sealed.refused.code).message);
    }
    return sealed.answer.sealed;
  }

  /** Every problem with the settings asked for, each named; none means they stand. */
  async function problemsOf(
    trx: TenantTransaction,
    request: FastifyRequest,
    body: BridgeSettingsBody,
  ): Promise<Problem[]> {
    const problems: Problem[] = [];
    if (
      body.componentType !== null &&
      (await readDefinitionLatest(trx, body.componentType))?.kind !== 'componentType'
    ) {
      problems.push({ path: 'componentType', reason: 'component_type_missing' });
    }
    // Where a property can be mapped to: nothing for a blank document, else the template's document fields.
    let fields: ReadonlySet<string> | undefined = new Set();
    if (body.template !== null) {
      fields = undefined;
      const template = await readTemplate(trx, body.template);
      const readable =
        template !== undefined &&
        (await authoriseAt(trx, callerOf(request), 'read', {
          kind: 'artifact',
          id: body.template,
        }).then(
          () => true,
          (error: unknown) => {
            if (error instanceof AppError && error.status === 404) return false;
            throw error;
          },
        ));
      if (!template || !readable) {
        problems.push({ path: 'template', reason: 'template_missing' });
      } else if (Object.values(body.propertyMap).some((field) => field !== null)) {
        const resolved = resolveTemplate(
          template.definition,
          await templateReferences(trx, template.definition),
        );
        if (resolved.ok) fields = new Set(resolved.document.map((each) => each.field.id));
        else problems.push({ path: 'template', reason: 'template_unresolved' });
      }
    }
    if (fields !== undefined) {
      for (const [property, field] of Object.entries(body.propertyMap)) {
        // An ignored property names no field, so there is nothing to find.
        if (field !== null && !fields.has(field)) {
          problems.push({ path: `propertyMap.${property}`, reason: 'field_not_in_template' });
        }
      }
    }
    return problems;
  }

  /**
   * Turns data delivery on for a space where it needs a password: the space has no delivery
   * connection that points at the store, or names no schema. The service makes the password, seals it
   * for the space's connection (made, or the one it has) and for every other delivery connection that
   * points at the store, since the account is the tenant's and has one password, and stores those
   * credentials; the store's role is given the password last (`commit`), after the settings are
   * written and just before the transaction commits, so a failure before then changes nothing there.
   * A space with a working connection and a schema needs none, and rotates nothing.
   */
  async function turnOn(
    trx: TenantTransaction,
    request: FastifyRequest,
    principalId: string,
    spaceId: string,
    before: BridgeSettings | undefined,
  ): Promise<{
    readonly connection: string;
    readonly schema: string;
    readonly commit: () => Promise<void>;
  }> {
    const tenant = options.tenantOf(request);
    const { account } = deliveredNames(tenant.id);
    const settings = connectionSettings(account);
    const existing =
      before?.connectionId == null ? undefined : await readConnection(trx, before.connectionId);
    const reusable = existing && pointsAtStore(existing.settings, settings) ? existing : undefined;
    if (reusable && before?.tableSchema != null) {
      return { connection: reusable.id, schema: before.tableSchema, commit: async () => {} };
    }
    const store = delivered();
    if (!client) throw connectorUnavailable();
    let access: Omit<DeliveredAccess, 'password'>;
    try {
      access = await store.ensure(tenant.id);
    } catch (error) {
      throw storeFailed(request, error);
    }
    let connection = reusable;
    if (!connection) {
      const made = await createConnection(trx, {
        author: principalId,
        spaceId,
        settings: connectionSettings(access.account),
      });
      if (made.answer !== 'created') {
        throw new AppError(
          422,
          'delivery_connection_refused',
          'The connection to the delivery store could not be made, so data cannot be delivered.',
        );
      }
      connection = made.connection;
    }
    const others = await trx
      .selectFrom('bridge_settings')
      .select('connection_id')
      .where('connection_id', 'is not', null)
      .where('space_id', '<>', spaceId)
      .execute();
    const sealing: StoredConnection[] = [connection];
    for (const row of others) {
      const other = await readConnection(trx, row.connection_id!);
      if (other && other.id !== connection.id && pointsAtStore(other.settings, settings)) {
        sealing.push(other);
      }
    }
    // Hex, from the system's random source; the store's role changes to it only at the very end.
    const password = randomBytes(24).toString('hex');
    // All sealed before any is stored, so a connector that fails part way stores none of them.
    const sealed = new Map<string, string>();
    for (const each of sealing) sealed.set(each.id, await seal(tenant, each, password));
    for (const each of sealing) {
      const set = await setConnectionCredential(trx, {
        id: each.id,
        sealed: sealed.get(each.id)!,
        by: principalId,
        sealedFor: each.settings,
      });
      if (set.answer !== 'set') {
        throw new AppError(
          409,
          'delivery_credential_not_set',
          'The delivery connection refused its credential, so data cannot be delivered.',
        );
      }
    }
    return {
      connection: connection.id,
      schema: access.schema,
      commit: async () => {
        try {
          await store.setPassword(tenant.id, password);
        } catch (error) {
          throw storeFailed(request, error);
        }
      },
    };
  }

  return {
    handlers: {
      getBridgeSettings: async (request: FastifyRequest, { trx }: Authorised) => {
        const { space } = request.params as SpaceParams;
        return viewOf(await readBridgeSettings(trx, space), await readUnlisted(trx, space));
      },

      putBridgeSettings: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
        const { space } = request.params as SpaceParams;
        const saved = await save(
          trx,
          request,
          principalId,
          space,
          request.body as BridgeSettingsBody,
        );
        await saved.commit();
        return saved.view;
      },
    },
    save,
    /** Lets go of the delivery store's connections, with the app. */
    close: async () => {
      await store?.close();
    },
  };

  /**
   * A space's settings written whole, as PUT bridge-settings writes them, in the caller's transaction:
   * refused whole with each problem named, data turned on or off, and the space's unlisted properties
   * the map now names forgotten. Connecting CT Studio saves through here too. The delivery store's
   * password is not changed here: the caller runs `commit` as its last step, once nothing else it
   * reads or writes can fail and roll back the credential sealed for that password.
   */
  async function save(
    trx: TenantTransaction,
    request: FastifyRequest,
    principalId: string,
    space: string,
    body: BridgeSettingsBody,
  ): Promise<{ readonly view: BridgeSettingsView; readonly commit: () => Promise<void> }> {
    await checkSpaceLive(trx, space);
    const problems = await problemsOf(trx, request, body);
    if (problems.length > 0) {
      throw new AppError(
        422,
        'bridge_settings_invalid',
        'These settings name something this environment does not have. Nothing was changed.',
        undefined,
        { problems },
      );
    }
    // One turn-on at a time for the tenant, so a second reads what the first stored.
    if (body.data) await lockBridgeProvision(trx, options.tenantOf(request).id);
    const before = await readBridgeSettings(trx, space);
    // Off keeps the connection and the tables, and names no schema: a delivery to a space with
    // none is refused not_configured, so no new data arrives (API-072).
    const on = body.data ? await turnOn(trx, request, principalId, space, before) : undefined;
    const written = await writeBridgeSettings(trx, {
      spaceId: space,
      componentType: body.componentType,
      template: body.template,
      propertyMap: body.propertyMap,
      connectionId: on?.connection ?? before?.connectionId ?? null,
      tableSchema: on?.schema ?? null,
      changedBy: principalId,
    });
    // A property the map now names, to a field or to ignore, is no longer unlisted.
    await dropUnlisted(trx, space, Object.keys(body.propertyMap));
    return {
      view: viewOf(written, await readUnlisted(trx, space)),
      commit: async () => {
        await on?.commit();
      },
    };
  }
}
