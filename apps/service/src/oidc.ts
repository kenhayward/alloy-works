import * as client from 'openid-client';

/** Exactly these, and nothing sensitive (IAM-044): what keeps Google's route out of app review. */
export const SCOPES = 'openid email profile';

export interface ProviderSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * The ID token claim carrying the provider's group values (IAM-009, GP-A): the organisation's
   * provider's configuration names it. Absent for Google, which asserts none.
   */
  readonly groupsClaim?: string;
}

export interface SignInStart {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface Identity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  /** The Workspace domain managing the account (Google's `hd`); null for a personal account. */
  readonly hostedDomain: string | null;
  /**
   * The group values the provider asserted in the configured claim, each once, and no more than
   * `MOST_GROUP_VALUES` of them. None where no claim is configured, where the claim is absent, or
   * where it is not a list; a member that is not a string is dropped (GP-B).
   */
  readonly groups: readonly string[];
}

/**
 * The most group values a sign-in follows. The first this many distinct strings of a claim are kept,
 * in the claim's order, and the rest are ignored, so a claim of any length signs its principal in
 * rather than failing on a statement too large for Postgres; a directory asserting more than this
 * for one person is asserting far more than any environment makes groups for.
 */
export const MOST_GROUP_VALUES = 1000;

/**
 * A claim's group values: a list's strings, each once, the first `MOST_GROUP_VALUES` of them, or none
 * for anything that is not a list.
 */
export function groupValues(claim: unknown): readonly string[] {
  if (!Array.isArray(claim)) return [];
  const strings = claim.filter((value): value is string => typeof value === 'string');
  return [...new Set(strings)].slice(0, MOST_GROUP_VALUES);
}

/** Anything that stops a sign-in: its message is safe to show, and the cause is for the log. */
export class SignInFailed extends Error {}

export interface OidcClient {
  /** A caller that must carry something through the provider signs its own state and passes it. */
  start(
    provider: ProviderSettings,
    redirectUri: string,
    options?: { readonly state?: string },
  ): Promise<SignInStart>;
  finish(
    provider: ProviderSettings,
    callbackUrl: URL,
    expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<Identity>;
}

/**
 * The authorisation code flow with PKCE, over openid-client. Each provider's configuration is
 * discovered once and kept; a failed discovery is forgotten, so it is tried again next time.
 *
 * Every ID token's signature is checked against the keys the provider publishes at its `jwks_uri`
 * (`enableNonRepudiationChecks`), for the organisation's provider and Google alike. openid-client
 * leaves that off by default, trusting the TLS connection to the token endpoint instead; the ID token
 * now carries the groups that confer roles (GP-A), so it is held to its signature as well.
 */
export function createOidcClient(options: { readonly allowInsecureIssuers: boolean }): OidcClient {
  const configurations = new Map<string, Promise<client.Configuration>>();

  function configuration(provider: ProviderSettings): Promise<client.Configuration> {
    const issuer = new URL(provider.issuer);
    if (issuer.protocol !== 'https:' && !options.allowInsecureIssuers) {
      return Promise.reject(new SignInFailed('The identity provider must be reached over HTTPS.'));
    }
    const key = `${provider.issuer} ${provider.clientId}`;
    let found = configurations.get(key);
    if (!found) {
      found = client.discovery(issuer, provider.clientId, provider.clientSecret, undefined, {
        execute: [
          ...(options.allowInsecureIssuers ? [client.allowInsecureRequests] : []),
          client.enableNonRepudiationChecks,
        ],
      });
      found.catch(() => configurations.delete(key));
      configurations.set(key, found);
    }
    return found;
  }

  return {
    async start(provider, redirectUri, options) {
      const config = await configuration(provider);
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = options?.state ?? client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: SCOPES,
        // Without it a provider still signed in skips straight back to whoever signed out.
        prompt: 'select_account',
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return { url: url.href, state, nonce, codeVerifier };
    },

    async finish(provider, callbackUrl, expected) {
      const config = await configuration(provider);
      let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
      try {
        tokens = await client.authorizationCodeGrant(config, callbackUrl, {
          pkceCodeVerifier: expected.codeVerifier,
          expectedState: expected.state,
          expectedNonce: expected.nonce,
          idTokenExpected: true,
        });
      } catch (error) {
        throw new SignInFailed('The identity provider did not confirm the sign-in.', {
          cause: error,
        });
      }
      const claims = tokens.claims();
      if (!claims) throw new SignInFailed('The identity provider returned no identity.');
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : null,
        hostedDomain: typeof claims.hd === 'string' ? claims.hd : null,
        // From the ID token alone, under the basic scopes: no scope is ever asked for groups (IAM-044).
        groups: provider.groupsClaim === undefined ? [] : groupValues(claims[provider.groupsClaim]),
      };
    },
  };
}
