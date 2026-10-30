import type {
  BridgeSettingsBody,
  BridgeSettingsView,
  CtStudioConnectBody,
  CtStudioConnected,
  CtStudioStatus,
  CtStudioTokenBody,
  CtStudioTokenIssued,
  TokenIssued,
} from '@alloy-works/api-contract';
import {
  checkSpaceLive,
  createServiceIdentity,
  findRole,
  grant,
  readCtStudio,
  serviceIdentity,
  writeCtStudio,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { AppError } from '../errors.js';
import { issueChecked, newTokenSecret, tokenView } from '../tokens.js';

/** What CT Studio's identity is made as, and what its tokens may do and for how long (the design). */
const IDENTITY_NAME = 'CT Studio deliveries';
const IDENTITY_DESCRIPTION =
  "The identity CT Studio's deliveries act as, made by Administration's CT Studio section";
const TOKEN_NAME = 'CT Studio';
const TOKEN_SCOPES = ['create', 'edit'] as const;
const TOKEN_DAYS = 365;
const DAY_MS = 86_400_000;

const notSetUp = () =>
  new AppError(409, 'ct_studio_not_set_up', 'CT Studio is not connected here yet.', 'API-074');
const alreadySetUp = () =>
  new AppError(
    409,
    'ct_studio_already_set_up',
    'CT Studio already has an identity here, so none is made or adopted.',
    'API-074',
  );
const identityDisabled = () =>
  new AppError(
    409,
    'ct_studio_identity_disabled',
    "CT Studio's identity is disabled, so it is issued nothing and delivers nowhere.",
    'API-074',
  );
const tokenUnusable = () =>
  new AppError(
    422,
    'ct_studio_token_unusable',
    'That token is not one this identity holds, or it is revoked or has expired. Nothing was changed.',
    'API-074',
  );

/**
 * Administration's CT Studio section (docs/design/ct-studio-connect.md; API-074): the environment's
 * CT Studio as recorded, the spaces it delivers to, and connecting one. The signing key is never read
 * here; only whether the service was started with one is passed in. A token's secret is answered once,
 * from the response that issues it, and kept nowhere.
 */
export function ctStudioHandlers(options: {
  readonly db: TenantDatabase;
  readonly tenantOf: (request: FastifyRequest) => Tenant;
  readonly bridgeOn: boolean;
  /** A space's bridge settings saved as PUT bridge-settings saves them (settings.ts). */
  readonly saveSettings: (
    trx: TenantTransaction,
    request: FastifyRequest,
    principalId: string,
    space: string,
    body: BridgeSettingsBody,
  ) => Promise<BridgeSettingsView>;
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
    const rows = await trx
      .selectFrom('bridge_settings as b')
      .innerJoin('space as s', 's.id', 'b.space_id')
      .select(['s.id', 's.name', 'b.table_schema'])
      .orderBy('s.name')
      .execute();
    const granted =
      identity === undefined ? new Set<string>() : await authorSpaces(trx, identity.id);
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

  /** The spaces where a principal holds a live allow grant of Author. */
  async function authorSpaces(trx: TenantTransaction, principal: string): Promise<Set<string>> {
    const author = await findRole(trx, 'Author');
    if (author === undefined) return new Set();
    const rows = await trx
      .selectFrom('access_grant')
      .select('space_id')
      .where('principal_id', '=', principal)
      .where('role_id', '=', author.id)
      .where('level', '=', 'space')
      .where('effect', '=', 'allow')
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date())]))
      .execute();
    return new Set(rows.flatMap((row) => (row.space_id === null ? [] : [row.space_id])));
  }

  /** Author at the space for the identity, unless it holds it already. */
  async function grantAuthor(
    trx: TenantTransaction,
    principal: string,
    space: string,
    by: string,
  ): Promise<void> {
    if ((await authorSpaces(trx, principal)).has(space)) return;
    const author = await findRole(trx, 'Author');
    if (author === undefined) throw new Error('The environment has no Author role');
    const answer = await grant(trx, {
      roleId: author.id,
      subject: { principal },
      level: { kind: 'space', id: space },
      effect: 'allow',
      grantedBy: by,
    });
    if ('refused' in answer) throw new Error(`Author was not granted: ${answer.refused}`);
  }

  /** A token for the identity, create and edit for 365 days by the transaction's clock. */
  async function issueToken(trx: TenantTransaction, principal: string): Promise<TokenIssued> {
    const { now } = await trx
      .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
      .executeTakeFirstOrThrow();
    const expiresAt = new Date(now.getTime() + TOKEN_DAYS * DAY_MS);
    const secret = newTokenSecret();
    const issued = await issueChecked(
      trx,
      principal,
      { name: TOKEN_NAME, scopes: [...TOKEN_SCOPES], expiresAt: expiresAt.toISOString() },
      expiresAt,
      secret,
    );
    return { ...tokenView(issued), secret };
  }

  async function makeIdentity(trx: TenantTransaction, by: string): Promise<string> {
    const made = await createServiceIdentity(trx, {
      name: IDENTITY_NAME,
      description: IDENTITY_DESCRIPTION,
      by,
    });
    return made.id;
  }

  /** The identity to adopt, enabled, and its token, live and its own; refused otherwise. */
  async function adoptable(
    trx: TenantTransaction,
    identityId: string,
    tokenId: string,
  ): Promise<void> {
    const identity = await serviceIdentity(trx, identityId, { lock: true });
    if (identity === undefined) throw notFound();
    if (identity.disabledAt !== null) throw identityDisabled();
    const token = await trx
      .selectFrom('api_token')
      .select('id')
      .where('id', '=', tokenId)
      .where('principal_id', '=', identityId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (token === undefined) throw tokenUnusable();
  }

  return {
    statusOf,
    handlers: {
      getCtStudio: async (request: FastifyRequest, { trx }: Authorised) =>
        statusOf(trx, options.tenantOf(request)),

      connectCtStudio: async (
        request: FastifyRequest,
        { trx, principalId }: Authorised,
      ): Promise<CtStudioConnected> => {
        const body = request.body as CtStudioConnectBody;
        // A space that is not here, or archived, is refused before anything is made for it.
        await checkSpaceLive(trx, body.space);
        const record = await readCtStudio(trx);
        let identityId: string;
        let issued: TokenIssued | null = null;
        let tokenId: string | undefined;
        if (body.identity === null) {
          if (record === undefined) throw notSetUp();
          const held = await serviceIdentity(trx, record.identityId, { lock: true });
          if (held === undefined || held.disabledAt !== null) throw identityDisabled();
          identityId = record.identityId;
        } else if (record !== undefined) {
          throw alreadySetUp();
        } else if ('make' in body.identity) {
          identityId = await makeIdentity(trx, principalId);
          issued = await issueToken(trx, identityId);
          tokenId = issued.id;
        } else {
          await adoptable(trx, body.identity.adopt, body.identity.token);
          identityId = body.identity.adopt;
          tokenId = body.identity.token;
        }
        await grantAuthor(trx, identityId, body.space, principalId);
        await writeCtStudio(trx, {
          identityId,
          ...(tokenId === undefined ? {} : { tokenId }),
          address: body.address,
          sinkId: body.sinkId,
        });
        // Last, as PUT bridge-settings: the delivery store's password changes after all else.
        const settings = await options.saveSettings(
          trx,
          request,
          principalId,
          body.space,
          body.settings,
        );
        const space = await trx
          .selectFrom('space')
          .select(['id', 'name'])
          .where('id', '=', body.space)
          .executeTakeFirstOrThrow();
        return {
          status: await statusOf(trx, options.tenantOf(request)),
          issued,
          space,
          settings,
        };
      },

      issueCtStudioToken: async (
        request: FastifyRequest,
        { trx, principalId }: Authorised,
      ): Promise<CtStudioTokenIssued> => {
        const body = request.body as CtStudioTokenBody;
        const record = await readCtStudio(trx);
        if (record === undefined) throw notSetUp();
        let identityId = record.identityId;
        if (body.replaceIdentity) {
          // Every space CT Studio was connected to, granted to the new identity as to the old.
          const spaces = await trx.selectFrom('bridge_settings').select('space_id').execute();
          identityId = await makeIdentity(trx, principalId);
          for (const { space_id } of spaces) {
            await grantAuthor(trx, identityId, space_id, principalId);
          }
        } else {
          const held = await serviceIdentity(trx, identityId, { lock: true });
          if (held === undefined || held.disabledAt !== null) throw identityDisabled();
        }
        const issued = await issueToken(trx, identityId);
        await writeCtStudio(trx, { identityId, tokenId: issued.id });
        return { status: await statusOf(trx, options.tenantOf(request)), issued };
      },
    },
  };
}
