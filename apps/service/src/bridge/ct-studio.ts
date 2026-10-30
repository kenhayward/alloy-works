import type { CtStudioStatus } from '@alloy-works/api-contract';
import {
  findRole,
  readCtStudio,
  serviceIdentity,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from '../access.js';

/**
 * Administration's CT Studio section (docs/design/ct-studio-connect.md; API-074): the environment's
 * CT Studio as recorded, and the spaces it delivers to. The signing key is never read here; only
 * whether the service was started with one is passed in.
 */
export function ctStudioHandlers(options: {
  readonly db: TenantDatabase;
  readonly tenantOf: (request: FastifyRequest) => Tenant;
  readonly bridgeOn: boolean;
}) {
  /** What is connected, as the summary shows it. */
  async function statusOf(trx: TenantTransaction, tenant: Tenant): Promise<CtStudioStatus> {
    const record = await readCtStudio(trx);
    const identity =
      record === undefined ? undefined : await serviceIdentity(trx, record.identityId);
    const token =
      record?.tokenId == null
        ? undefined
        : await trx
            .selectFrom('api_token')
            .select(['id', 'name', 'expires_at'])
            .where('id', '=', record.tokenId)
            .executeTakeFirst();
    const author = await findRole(trx, 'Author');
    const now = new Date();
    const rows = await trx
      .selectFrom('bridge_settings as b')
      .innerJoin('space as s', 's.id', 'b.space_id')
      .select(['s.id', 's.name', 'b.table_schema'])
      .orderBy('s.name')
      .execute();
    const granted = new Set(
      identity === undefined || author === undefined
        ? []
        : (
            await trx
              .selectFrom('access_grant')
              .select('space_id')
              .where('principal_id', '=', identity.id)
              .where('role_id', '=', author.id)
              .where('level', '=', 'space')
              .where('effect', '=', 'allow')
              .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
              .execute()
          ).map((row) => row.space_id),
    );
    return {
      bridgeOn: options.bridgeOn,
      identity:
        identity === undefined
          ? null
          : { id: identity.id, name: identity.name, disabled: identity.disabledAt !== null },
      token:
        token === undefined
          ? null
          : { id: token.id, name: token.name, expiresAt: token.expires_at.toISOString() },
      spaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        granted: granted.has(row.id),
        data: row.table_schema !== null,
      })),
      hostnames: await options.db.hostnames(tenant.id),
      address: record?.address ?? null,
      sinkId: record?.sinkId ?? null,
    };
  }

  return {
    statusOf,
    handlers: {
      getCtStudio: async (request: FastifyRequest, { trx }: Authorised) =>
        statusOf(trx, options.tenantOf(request)),
    },
  };
}
