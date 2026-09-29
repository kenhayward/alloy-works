// Fake RFC 8693 OAuth 2.0 Token Exchange endpoint on aw-dc-sources. Phase 2 (cases 3-4) drives it:
// it trusts a subject_token minted by the stand-in idp and returns an access token the fake API will
// accept as a given user. For phase 1 it is a stub that starts and answers /health and the token
// endpoint shape, so phase 2 can begin without waiting on infrastructure.
import http from 'node:http';
const PORT = Number(process.env.PORT || 80);
const GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/token' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    // Stub behaviour: accept the token-exchange grant and echo an access token naming the subject.
    if (form.get('grant_type') !== GRANT) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unsupported_grant_type' })); return;
    }
    const subject = form.get('subject_token') || 'unknown';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      access_token: `exchanged-for.${subject}`,
      token_type: 'Bearer',
      expires_in: 300,
    }));
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`[token-exchange] listening on ${PORT} (phase-1 stub)`));
