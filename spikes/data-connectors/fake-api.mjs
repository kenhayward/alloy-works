// Fake JSON API on aw-dc-sources, the tenant's HTTP source. Two ways in:
//  - the connection's own bearer (API_TOKEN): the tenant service account, which sees every row;
//  - a delegated token from the token-exchange endpoint (phase 2): verified here - signature against
//    the exchange's JWKS, issuer, audience `fake-api`, expiry and scope - and answered with the rows
//    whose owner is the token's `sub`. This is the "scope check" the brief's case 3 asks of the API.
// It also serves /redirect for case 1. `?delayMs=` sets a latency for case 4's timing. Invented data.
import http from 'node:http';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const PORT = Number(process.env.PORT || 80);
const STATIC_TOKEN = process.env.API_TOKEN || 'fake-api-bearer-token-for-the-spike';
const REDIRECT_TO = process.env.REDIRECT_TO || 'http://platform-pg:5432/';
const EXCHANGE = process.env.EXCHANGE_URL || 'http://token-exchange';
const jwks = createRemoteJWKSet(new URL(`${EXCHANGE}/jwks`), { cooldownDuration: 1000 });

// The source's own data. `owner` is the source's rule, as `record.owner` is in the two databases.
const rows = [
  { id: 1, owner: 'ada', amount: '100.00', label: 'alpha' },
  { id: 2, owner: 'grace', amount: '250.50', label: 'beta' },
  { id: 3, owner: 'ada', amount: '12.34', label: 'gamma' },
];
const stats = { served: 0, refused: {} };

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/redirect') { res.writeHead(302, { location: REDIRECT_TO }); res.end('redirecting'); return; }
  if (url.pathname === '/health') return send(200, { ok: true });
  if (url.pathname === '/stats') return send(200, stats);
  // Owner reassignment, standing for a change to the source's own access rule (case 4.5).
  if (url.pathname === '/admin/reassign' && req.method === 'POST') {
    const id = Number(url.searchParams.get('id')); const owner = url.searchParams.get('owner');
    const r = rows.find((x) => x.id === id); if (r) r.owner = owner;
    return send(200, { rows });
  }
  const delay = Math.min(Number(url.searchParams.get('delayMs') || 0), 10000);
  if (delay) await new Promise((r) => setTimeout(r, delay));

  const auth = req.headers['authorization'] || '';
  const refuse = (why) => { stats.refused[why] = (stats.refused[why] || 0) + 1; return send(401, { error: 'invalid_token', error_description: why }); };
  if (auth === `Bearer ${STATIC_TOKEN}`) {
    stats.served++;
    return send(200, { as: 'service-account', rows });
  }
  if (!auth.startsWith('Bearer ')) return refuse('no bearer');
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: 'http://token-exchange', audience: 'fake-api', algorithms: ['ES256'] });
    if (!String(payload.scope || '').split(' ').includes('records:read')) return refuse('scope missing');
    stats.served++;
    return send(200, { as: payload.sub, actor: payload.act?.sub ?? null, exp: payload.exp, rows: rows.filter((r) => r.owner === payload.sub) });
  } catch (err) {
    const why = err.code === 'ERR_JWT_EXPIRED' ? 'token expired'
      : err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ? `claim ${err.claim} wrong`
      : err.code === 'ERR_JWKS_NO_MATCHING_KEY' || err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ? 'signature not trusted'
      : `token invalid (${err.code || 'unknown'})`;
    return refuse(why);
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`[fake-api] listening on ${PORT}`));
