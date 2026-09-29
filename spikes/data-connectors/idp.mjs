// Stand-in identity provider on aw-dc-platform: the TENANT's own OpenID Connect provider, as ADR-0009
// has it. Phase 2 makes it real enough to exercise delegation: it signs ES256 tokens with a key
// generated at start, publishes its JWKS (on /jwks and into the shared `trust` volume, which is how the
// token-exchange endpoint on the sources network comes to trust it without a route between them), and
// issues refresh tokens with rotation and reuse detection, as OAuth 2.0 Security BCP asks of a public
// provider. Every user is invented (Ada, Grace); nothing here is a real provider.
//
// A second issuer, `https://accounts.google.test`, signs with a key of its own and stands for the
// Google route: its tokens are well formed and signed, but nothing on the sources side trusts it.
import http from 'node:http';
import fs from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = Number(process.env.PORT || 80);
const ISSUER = process.env.ISSUER || 'http://idp';
const GOOGLE_ISSUER = 'https://accounts.google.test';
const CLIENT_ID = process.env.CLIENT_ID || 'alloy-works';
const PRODUCT_AUDIENCE = process.env.PRODUCT_AUDIENCE || 'api://alloy-works';
const TRUST_DIR = process.env.TRUST_DIR || '/trust';

// Lifetimes are settable at run time so case 4 can make a token expire inside a publish.
const ttl = { access: Number(process.env.ACCESS_TTL || 300), refresh: Number(process.env.REFRESH_TTL || 86400) };

const keys = {};
async function makeKey(name) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = `${name}-${randomBytes(4).toString('hex')}`;
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  keys[name] = { privateKey, jwk };
}

// Refresh tokens: opaque, stored by hash, each in a family. Using a rotated-out token again revokes
// the whole family (reuse detection), which is what a real provider does and what makes custody hard.
const refresh = new Map(); // hash -> { sub, family, state: 'live'|'rotated'|'revoked', exp, scope }
const families = new Map(); // family -> { sub, revoked }
const stats = { issued: 0, refreshed: 0, reuseDetected: 0, refused: 0 };
const h = (t) => createHash('sha256').update(t).digest('hex');

async function mint(issuerName, sub, audience, extra, lifetime) {
  const k = keys[issuerName];
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: k.jwk.kid, typ: 'JWT' })
    .setIssuer(issuerName === 'google' ? GOOGLE_ISSUER : ISSUER)
    .setSubject(sub)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .setJti(randomBytes(8).toString('hex'))
    .sign(k.privateKey);
}

function newRefresh(sub, family, scope) {
  const token = `rt.${randomBytes(24).toString('base64url')}`;
  refresh.set(h(token), { sub, family, state: 'live', exp: Date.now() + ttl.refresh * 1000, scope });
  return token;
}

async function tokenSet(issuerName, sub, scope, family) {
  const accessToken = await mint(issuerName, sub, PRODUCT_AUDIENCE, { scp: 'user_impersonation', azp: CLIENT_ID }, ttl.access);
  const idToken = await mint(issuerName, sub, CLIENT_ID, { name: sub === 'ada' ? 'Ada' : sub === 'grace' ? 'Grace' : sub }, ttl.access);
  const out = { token_type: 'Bearer', id_token: idToken, access_token: accessToken, expires_in: ttl.access, scope };
  if (issuerName === 'tenant' && scope.split(' ').includes('offline_access')) {
    const fam = family ?? randomBytes(6).toString('hex');
    if (!families.has(fam)) families.set(fam, { sub, revoked: false });
    out.refresh_token = newRefresh(sub, fam, scope);
    out.refresh_expires_in = ttl.refresh;
  }
  stats.issued++;
  return out;
}

async function form(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('json')) {
    try { return new Map(Object.entries(JSON.parse(text || '{}'))); } catch { return new Map(); }
  }
  return new URLSearchParams(text);
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(200, { ok: true });
    if (url.pathname === '/jwks') return send(200, { keys: [keys.tenant.jwk] });
    if (url.pathname === '/stats') return send(200, { ...stats, ttl, families: families.size });
    if (url.pathname === '/admin/ttl' && req.method === 'POST') {
      const f = await form(req);
      if (f.get('access')) ttl.access = Number(f.get('access'));
      if (f.get('refresh')) ttl.refresh = Number(f.get('refresh'));
      return send(200, { ttl });
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const f = await form(req);
      const grant = f.get('grant_type');
      // `urn:spike:signin` stands for the authorization-code flow a browser completes: the harness has
      // no browser, so it asks for the user's token set directly. Everything downstream is real.
      if (grant === 'urn:spike:signin') {
        const sub = f.get('sub');
        if (!['ada', 'grace'].includes(sub)) return send(400, { error: 'invalid_request', error_description: 'unknown user' });
        const issuerName = f.get('issuer') === 'google' ? 'google' : 'tenant';
        return send(200, await tokenSet(issuerName, sub, f.get('scope') || 'openid', undefined));
      }
      if (grant === 'refresh_token') {
        const rec = refresh.get(h(f.get('refresh_token') || ''));
        if (!rec) { stats.refused++; return send(400, { error: 'invalid_grant', error_description: 'unknown refresh token' }); }
        const fam = families.get(rec.family);
        if (rec.state === 'rotated') {
          // Reuse of a rotated token: treat as theft, revoke the whole family.
          stats.reuseDetected++;
          fam.revoked = true;
          for (const r of refresh.values()) if (r.family === rec.family) r.state = 'revoked';
          return send(400, { error: 'invalid_grant', error_description: 'refresh token reused; family revoked' });
        }
        if (rec.state === 'revoked' || fam?.revoked) { stats.refused++; return send(400, { error: 'invalid_grant', error_description: 'refresh token revoked' }); }
        if (rec.exp < Date.now()) { stats.refused++; return send(400, { error: 'invalid_grant', error_description: 'refresh token expired' }); }
        rec.state = 'rotated';
        stats.refreshed++;
        return send(200, await tokenSet('tenant', rec.sub, rec.scope, rec.family));
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    // RFC 7009-shaped revocation, plus a "disable the user" switch standing for an administrator at
    // the tenant's provider. Neither can reach a JWT already issued: it lives until its `exp`.
    if (url.pathname === '/revoke' && req.method === 'POST') {
      const f = await form(req);
      let n = 0;
      const rt = f.get('token');
      const sub = f.get('sub');
      for (const [k, r] of refresh) {
        if ((rt && k === h(rt)) || (sub && r.sub === sub)) {
          r.state = 'revoked';
          const fam = families.get(r.family);
          if (fam) fam.revoked = true;
          n++;
        }
      }
      return send(200, { revoked: n });
    }
    return send(404, { error: 'not found' });
  } catch (err) {
    send(500, { error: err.message });
  }
});

await makeKey('tenant');
await makeKey('google');
try {
  fs.mkdirSync(TRUST_DIR, { recursive: true });
  fs.writeFileSync(`${TRUST_DIR}/idp-jwks.json`, JSON.stringify({ issuer: ISSUER, audience: PRODUCT_AUDIENCE, keys: [keys.tenant.jwk] }));
  fs.writeFileSync(`${TRUST_DIR}/google-jwks.json`, JSON.stringify({ issuer: GOOGLE_ISSUER, keys: [keys.google.jwk] }));
} catch (err) {
  console.log('[idp] could not write trust files:', err.message);
}
server.listen(PORT, '0.0.0.0', () => console.log(`[idp] listening on ${PORT}; kid ${keys.tenant.jwk.kid}`));
