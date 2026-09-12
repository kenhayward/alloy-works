// Development only: the stand-in provider on a fixed port, for the service's development tenants.
import { startStandInProvider } from './provider.js';

const port = Number(process.env.STAND_IN_PORT ?? 9090);
const redirectUris = (
  process.env.STAND_IN_REDIRECT_URIS ??
  'http://acme.localhost:8080/v1/sign-in/organisation/callback,http://dev.acme.localhost:8080/v1/sign-in/organisation/callback'
).split(',');
const googleRedirectUri =
  process.env.STAND_IN_GOOGLE_REDIRECT_URI ??
  'http://signin.localhost:8080/v1/sign-in/google/callback';

const idp = await startStandInProvider({
  port,
  // In a container it must listen on every address, and say the name it is reached by.
  host: process.env.STAND_IN_HOST ?? '127.0.0.1',
  ...(process.env.STAND_IN_ISSUER ? { issuer: process.env.STAND_IN_ISSUER } : {}),
  clients: [
    { clientId: 'alloy-dev', clientSecret: 'stand-in-dev-secret', redirectUris },
    // Plays the product's one Google client, returning only to the sign-in address.
    {
      clientId: 'alloy-google-dev',
      clientSecret: 'stand-in-google-secret',
      redirectUris: [googleRedirectUri],
    },
  ],
});
console.log(
  `Stand-in provider at ${idp.issuer}, for ${[...redirectUris, googleRedirectUri].join(' and ')}`,
);
