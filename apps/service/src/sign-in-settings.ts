import type {
  GoogleSettingsBody,
  ScimOnBody,
  TokenIssued,
  PrincipalParams,
  ProviderBody,
  ProviderChangeBody,
  ProviderParams,
  ProviderSecretBody,
  SharedBody,
  SessionSettingsBody,
  SignInSettings,
} from '@alloy-works/api-contract';
import {
  addProvider,
  changeProvider,
  closeProviderAsked,
  disablePrincipal,
  enablePrincipal,
  googleRoute,
  listProviders,
  markProviderShared,
  revokeApiToken,
  turnScimOff,
  turnScimOn,
  notifyTenant,
  sealProviderSecret,
  sealSecret,
  sessionSettings,
  setGoogleRoute,
  setSessionSettings,
  type Ended,
  type ProviderRefusal,
  type Tenant,
  type TenantTransaction,
  principalAllowsInForce,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { refuseBeyondHoldingAt } from './grant-limits.js';
import type { Credential } from './app.js';
import { AppError } from './errors.js';
import { SCIM_ROOT } from './scim.js';
import { issueChecked, newTokenSecret, tokenView } from './tokens.js';

/** How long a sign-in stays recent enough to change how people sign in (IN-D). */
export const RECENT_SIGN_IN_SECONDS = 600;

/** How long a SCIM token lasts: a year, the most any token may. */
const SCIM_TOKEN_DAYS = 364;

const secondsSince = (at: Date) => (Date.now() - at.getTime()) / 1000;

/** Whether this request's session authenticated recently enough; a token never has (IAM-012). */
const recent = (credential: Credential | null, seconds: number) =>
  credential?.kind === 'session' && secondsSince(credential.authenticatedAt) <= seconds;

/** Refuses a route's request whose session authenticated too long ago, or any token (IAM-012). */
export function refuseUnlessRecent(credential: Credential | null, seconds: number): void {
  if (recent(credential, seconds)) return;
  throw new AppError(
    403,
    'reauthentication_required',
    'This needs you to have signed in within the last few minutes. Sign in again, then try once more.',
    'IAM-012',
  );
}

const lastWayIn = () =>
  new AppError(
    409,
    'last_way_in',
    'Nobody could then sign in and configure sign-in. Give somebody who can sign in another way access first.',
  );

function refused(refusal: ProviderRefusal): AppError {
  switch (refusal) {
    case 'provider.name_taken':
      return new AppError(409, 'provider_name_taken', 'Another provider already has that name.');
    case 'provider.issuer_taken':
      return new AppError(
        409,
        'provider_issuer_taken',
        'That issuer is already configured, and one issuer is configured once.',
      );
    case 'provider.last_way_in':
      return lastWayIn();
    case 'provider.managed':
      return new AppError(
        409,
        'provider_managed_by_organisation',
        'Your organisation keeps this provider current. It can be closed here, not changed.',
        'IAM-085',
      );
    case 'provider.missing':
    case 'provider.closed':
      return new AppError(404, 'provider_not_found', 'There is no such provider here.');
  }
}

const ownSession = () =>
  new AppError(
    409,
    'provider_own_session',
    'You are signed in this way, and closing it would end your own session. Sign in another way first.',
  );

/** Says to every replica what ended, so what still runs by it stops (IAM-082). */
async function sayEnded(trx: TenantTransaction, ended: Ended): Promise<void> {
  for (const session of ended.sessions) {
    await notifyTenant(trx, { kind: 'credential_ended', session });
  }
  for (const token of ended.tokens) {
    await notifyTenant(trx, { kind: 'credential_ended', token });
  }
}

/**
 * Administration's **Sign-in** and a person's disablement (identity.md; the ID plan, IDb). A client
 * secret is sealed here, as it arrives, and never read back; the read answers what is configured
 * without it.
 */
export function signInSettingsHandlers(options: {
  readonly tenantOf: (request: FastifyRequest) => Tenant;
  readonly sealingKey: Buffer;
  /** Whether this service holds the product's Google client at all. */
  readonly googleAvailable: boolean;
  readonly callbackPath: string;
}) {
  const { tenantOf, sealingKey } = options;
  const sealed = (request: FastifyRequest, secret: string) =>
    sealSecret(sealingKey, 'sign-in', tenantOf(request).id, secret);

  const read = async (request: FastifyRequest, trx: TenantTransaction): Promise<SignInSettings> => {
    const credential = request.credential;
    const session = credential?.kind === 'session' ? credential : null;
    const route = await googleRoute(trx);
    return {
      sharing: tenantOf(request).kind === 'organisation',
      providers: (await listProviders(trx)).map((provider) => ({
        id: provider.id,
        name: provider.name,
        issuer: provider.issuer,
        clientId: provider.clientId,
        groupsClaim: provider.groupsClaim,
        closed: provider.closedAt !== null,
        shared: provider.shared,
        managed: provider.managedByOrganisation,
        scim: {
          on: provider.scimIdentity !== null,
          claim: provider.scimClaim,
          lastUsedAt: provider.scimLastUsedAt && provider.scimLastUsedAt.toISOString(),
        },
      })),
      google: {
        available: options.googleAvailable,
        open: route.open,
        domains: [...route.domains],
      },
      sessions: await sessionSettings(trx),
      redirectUri: `${request.protocol}://${request.host}${options.callbackPath}`,
      scimUrl: `${request.protocol}://${request.host}${SCIM_ROOT}`,
      recentSignIn: recent(credential, RECENT_SIGN_IN_SECONDS),
      signedInThrough:
        session === null
          ? null
          : session.route === 'google'
            ? { route: 'google' as const, provider: null }
            : { route: 'organisation' as const, provider: session.providerId },
    };
  };

  return {
    getSignInSettings: async (request: FastifyRequest, { trx }: Authorised) => read(request, trx),

    addProvider: async (request: FastifyRequest, { trx }: Authorised) => {
      const body = request.body as ProviderBody;
      const added = await addProvider(trx, {
        name: body.name,
        issuer: body.issuer,
        clientId: body.clientId,
        sealedSecret: sealed(request, body.clientSecret),
        ...(body.groupsClaim === undefined ? {} : { groupsClaim: body.groupsClaim }),
        ...(body.scimClaim === undefined ? {} : { scimClaim: body.scimClaim }),
      });
      if ('refused' in added) throw refused(added.refused);
      return read(request, trx);
    },

    shareProvider: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const { shared } = request.body as SharedBody;
      if (!(await markProviderShared(trx, id, shared))) throw refused('provider.missing');
      return read(request, trx);
    },

    changeProvider: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const body = request.body as ProviderChangeBody;
      const answer = await changeProvider(trx, id, {
        name: body.name,
        ...(body.groupsClaim === undefined ? {} : { groupsClaim: body.groupsClaim }),
      });
      if (answer !== 'changed') throw refused(answer);
      return read(request, trx);
    },

    replaceProviderSecret: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const { clientSecret } = request.body as ProviderSecretBody;
      const answer = await sealProviderSecret(trx, id, sealed(request, clientSecret));
      if (answer !== 'replaced') throw refused(answer);
      return read(request, trx);
    },

    closeProvider: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const credential = request.credential;
      if (credential?.kind === 'session' && credential.providerId === id) throw ownSession();
      const answer = await closeProviderAsked(trx, id);
      if ('refused' in answer) throw refused(answer.refused);
      await sayEnded(trx, answer);
      return read(request, trx);
    },

    setGoogleSignIn: async (request: FastifyRequest, { trx }: Authorised) => {
      const body = request.body as GoogleSettingsBody;
      if (body.open && !options.googleAvailable) {
        throw new AppError(
          409,
          'google_unavailable',
          'This service holds no Google client, so the route cannot be opened.',
        );
      }
      const credential = request.credential;
      if (!body.open && credential?.kind === 'session' && credential.route === 'google') {
        throw ownSession();
      }
      const answer = await setGoogleRoute(trx, body);
      if ('refused' in answer) throw refused(answer.refused);
      await sayEnded(trx, answer);
      return read(request, trx);
    },

    setSessionSettings: async (request: FastifyRequest, { trx }: Authorised) => {
      await setSessionSettings(trx, request.body as SessionSettingsBody);
      return read(request, trx);
    },

    turnScimOn: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const { claim } = request.body as ScimOnBody;
      const answer = await turnScimOn(trx, id, claim, principalId);
      if (answer === 'provider.missing' || answer === 'provider.managed') throw refused(answer);
      return read(request, trx);
    },

    turnScimOff: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as ProviderParams;
      const answer = await turnScimOff(trx, id);
      if (answer === 'provider.missing') throw refused(answer);
      await sayEnded(trx, { sessions: [], tokens: answer.tokens });
      return read(request, trx);
    },

    // A token replaces those before it, so one that leaked ends as the new one is made.
    issueScimToken: async (request: FastifyRequest, { trx }: Authorised): Promise<TokenIssued> => {
      const { id } = request.params as ProviderParams;
      const provider = await trx
        .selectFrom('identity_provider')
        .select(['name', 'scim_identity'])
        .where('id', '=', id)
        .where('closed_at', 'is', null)
        .executeTakeFirst();
      if (!provider) throw refused('provider.missing');
      if (provider.scim_identity === null) {
        throw new AppError(409, 'scim_off', 'Turn SCIM on for this provider first.');
      }
      const held = await trx
        .selectFrom('api_token')
        .select('id')
        .where('principal_id', '=', provider.scim_identity)
        .orderBy('id')
        .execute();
      for (const token of held) {
        await revokeApiToken(trx, provider.scim_identity, token.id);
        await notifyTenant(trx, { kind: 'credential_ended', token: token.id });
      }
      const secret = newTokenSecret();
      const expiresAt = new Date(Date.now() + SCIM_TOKEN_DAYS * 24 * 60 * 60 * 1000);
      const issued = await issueChecked(
        trx,
        provider.scim_identity,
        {
          name: `SCIM: ${provider.name}`.slice(0, 80),
          scopes: [],
          expiresAt: expiresAt.toISOString(),
        },
        expiresAt,
        secret,
      );
      return { ...tokenView(issued), secret };
    },

    disablePerson: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as PrincipalParams;
      if (id === principalId) {
        throw new AppError(409, 'principal_own_account', 'You cannot disable your own account.');
      }
      const answer = await disablePrincipal(trx, id, 'person');
      if ('refused' in answer) throw personRefused(answer.refused);
      await sayEnded(trx, answer);
      return { id, disabled: true };
    },

    enablePerson: async (request: FastifyRequest, authorised: Authorised) => {
      const { trx } = authorised;
      const { id } = request.params as PrincipalParams;
      // Enabling gives back all they hold, so it is limited as giving it would be (the GL plan).
      const held = await trx
        .selectFrom('principal')
        .select('disabled_at')
        .where('id', '=', id)
        .executeTakeFirst();
      if (held?.disabled_at != null) {
        await refuseBeyondHoldingAt(trx, authorised, await principalAllowsInForce(trx, id));
      }
      const answer = await enablePrincipal(trx, id, 'person');
      if (answer !== 'enabled') throw personRefused(answer);
      return { id, disabled: false };
    },
  };
}

function personRefused(
  refusal:
    | 'principal.missing'
    | 'principal.service'
    | 'principal.erased'
    | 'principal.last_way_in'
    | 'principal.last_holder',
): AppError {
  switch (refusal) {
    case 'principal.missing':
      return new AppError(404, 'principal_not_found', 'There is no such person here.');
    case 'principal.service':
      return new AppError(
        409,
        'principal_service',
        'A service identity is disabled as a service identity, in its own place.',
      );
    case 'principal.erased':
      return new AppError(409, 'principal_erased', 'That person has been erased.');
    case 'principal.last_way_in':
      return lastWayIn();
    case 'principal.last_holder':
      return new AppError(
        409,
        'principal_last_holder',
        'Nobody would hold an administrative permission they hold then, and nobody could give it again, so they cannot be disabled.',
      );
  }
}
