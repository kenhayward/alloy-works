// Development only: the stand-in provider on a fixed port, for the service's development tenants.
import { startStandInProvider } from './provider.js';

const port = Number(process.env.STAND_IN_PORT ?? 9090);
const redirectUris = (
  process.env.STAND_IN_REDIRECT_URIS ??
  'http://acme.localhost:8080/v1/sign-in/organisation/callback,http://dev.acme.localhost:8080/v1/sign-in/organisation/callback'
).split(',');

const idp = await startStandInProvider({
  port,
  clients: [{ clientId: 'alloy-dev', clientSecret: 'stand-in-dev-secret', redirectUris }],
});
console.log(`Stand-in provider at ${idp.issuer}, for ${redirectUris.join(' and ')}`);
