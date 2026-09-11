import * as client from 'openid-client';

/** Exactly these, and nothing sensitive (IAM-044): what keeps Google's route out of app review. */
export const SCOPES = 'openid email profile';

export interface ProviderSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
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
}

/** Anything that stops a sign-in: its message is safe to show, and the cause is for the log. */
export class SignInFailed extends Error {}

export interface OidcClient {
  start(provider: ProviderSettings, redirectUri: string): Promise<SignInStart>;
  finish(
    provider: ProviderSettings,
    callbackUrl: URL,
    expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<Identity>;
}

/**
 * The authorisation code flow with PKCE, over openid-client. Each provider's configuration is
 * discovered once and kept; a failed discovery is forgotten, so it is tried again next time.
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
      found = client.discovery(
        issuer,
        provider.clientId,
        provider.clientSecret,
        undefined,
        options.allowInsecureIssuers ? { execute: [client.allowInsecureRequests] } : undefined,
      );
      found.catch(() => configurations.delete(key));
      configurations.set(key, found);
    }
    return found;
  }

  return {
    async start(provider, redirectUri) {
      const config = await configuration(provider);
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: SCOPES,
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
      };
    },
  };
}
