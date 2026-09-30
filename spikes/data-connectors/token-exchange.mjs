// Fake RFC 8693 OAuth 2.0 Token Exchange endpoint on aw-dc-sources: the authorisation server the
// fake API trusts. It trusts subject tokens from the tenant's stand-in provider ONLY (its JWKS arrives
// through the shared `trust` volume), authenticates the client making the exchange (the connector,
// holding the connection's client secret), and issues an ES256 access token restricted to the
// requested audience, naming the user as `sub` and the connector as the actor (`act`).
//
// The exchanged token's lifetime is capped at the subject token's remaining life unless
// CAP_TO_SUBJECT=false, and an administrator can disable a user here (standing for a provider that
// knows a user is disabled at exchange time, as Entra ID's on-behalf-of does). Everything invented.
import http from 'node:http';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, createLocalJWKSet } from 'jose';

const PORT = Number(process.env.PORT || 80);
const ISSUER = 'http://token-exchange';
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const TRUST_FILE = process.env.TRUST_FILE || '/trust/idp-jwks.json';
const ttl = {
  exchange: Number(process.env.EXCHANGE_TTL || 300),
  capToSubject: process.env.CAP_TO_SUBJECT !== 'false',
};
// The one registered client: the connector, for the tenant's HTTP connection. Invented value.
const CLIENTS = new Map([
  [
    process.env.CLIENT_ID || 'aw-connector-acme',
    process.env.CLIENT_SECRET || 'fake-exchange-client-secret-for-the-spike',
  ],
]);
const AUDIENCES = new Set(['fake-api']);
const disabled = new Set();
const stats = { exchanged: 0, refused: {} };

let signer;
async function init() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = `tx-${randomBytes(4).toString('hex')}`;
  jwk.alg = 'ES256';
  signer = { privateKey, jwk };
}

function trust() {
  // Read on every exchange: the provider may restart and rotate its key, and a trust that cannot be
  // read fails closed (IAM-064), never open.
  const t = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8'));
  return { issuer: t.issuer, audience: t.audience, jwks: createLocalJWKSet({ keys: t.keys }) };
}

async function form(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const refuse = (send, code, error, why) => {
  stats.refused[why] = (stats.refused[why] || 0) + 1;
  return send(code, { error, error_description: why });
};

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(200, { ok: true });
    if (url.pathname === '/jwks') return send(200, { keys: [signer.jwk] });
    if (url.pathname === '/stats') return send(200, { ...stats, ttl, disabled: [...disabled] });
    if (url.pathname === '/admin/config' && req.method === 'POST') {
      const f = await form(req);
      if (f.get('exchange')) ttl.exchange = Number(f.get('exchange'));
      if (f.get('capToSubject')) ttl.capToSubject = f.get('capToSubject') !== 'false';
      if (f.get('disable')) disabled.add(f.get('disable'));
      if (f.get('enable')) disabled.delete(f.get('enable'));
      return send(200, { ttl, disabled: [...disabled] });
    }
    if (url.pathname !== '/token' || req.method !== 'POST')
      return send(404, { error: 'not found' });

    const f = await form(req);
    // Client authentication: HTTP Basic, as RFC 6749 prefers.
    const basic = (req.headers.authorization || '').replace(/^Basic /, '');
    const [cid, csecret] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    if (!cid || CLIENTS.get(cid) !== csecret)
      return refuse(send, 401, 'invalid_client', 'client authentication failed');
    if (f.get('grant_type') !== GRANT)
      return refuse(send, 400, 'unsupported_grant_type', 'not a token exchange');
    if (f.get('subject_token_type') !== 'urn:ietf:params:oauth:token-type:access_token') {
      return refuse(send, 400, 'invalid_request', 'subject token must be an access token');
    }
    const audience = f.get('audience');
    if (!AUDIENCES.has(audience)) return refuse(send, 400, 'invalid_target', 'audience not served');

    let t;
    try {
      t = trust();
    } catch {
      return refuse(send, 503, 'temporarily_unavailable', 'provider keys unavailable');
    }
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(f.get('subject_token') || '', t.jwks, {
        issuer: t.issuer,
        audience: t.audience,
        algorithms: ['ES256'],
      }));
    } catch (err) {
      const why =
        err.code === 'ERR_JWT_EXPIRED'
          ? 'subject token expired'
          : err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && err.claim === 'iss'
            ? 'subject token issuer not trusted'
            : err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && err.claim === 'aud'
              ? 'subject token audience wrong'
              : err.code === 'ERR_JWKS_NO_MATCHING_KEY'
                ? 'subject token issuer not trusted'
                : `subject token invalid (${err.code || 'unknown'})`;
      return refuse(send, 400, 'invalid_grant', why);
    }
    if (
      !String(claims.scp || '')
        .split(' ')
        .includes('user_impersonation')
    )
      return refuse(send, 400, 'invalid_scope', 'subject token lacks delegation scope');
    if (disabled.has(claims.sub)) return refuse(send, 400, 'invalid_grant', 'user disabled');

    const now = Math.floor(Date.now() / 1000);
    const lifetime = ttl.capToSubject
      ? Math.max(1, Math.min(ttl.exchange, claims.exp - now))
      : ttl.exchange;
    const accessToken = await new SignJWT({ scope: 'records:read', act: { sub: cid } })
      .setProtectedHeader({ alg: 'ES256', kid: signer.jwk.kid, typ: 'at+jwt' })
      .setIssuer(ISSUER)
      .setSubject(claims.sub)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .setJti(randomBytes(8).toString('hex'))
      .sign(signer.privateKey);
    stats.exchanged++;
    return send(200, {
      access_token: accessToken,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: lifetime,
    });
  } catch (err) {
    send(500, { error: 'server_error', error_description: err.message });
  }
});

await init();
server.listen(PORT, '0.0.0.0', () =>
  console.log(`[token-exchange] listening on ${PORT}; kid ${signer.jwk.kid}`),
);
