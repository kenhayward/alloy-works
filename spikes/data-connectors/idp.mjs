// Stand-in identity provider on aw-dc-platform. Phase 2 uses it to mint a subject token for Ada or
// Grace that the token-exchange endpoint trusts. Phase 1 needs only a process that starts and can be
// reached (case 1 points a hostile connection at it too). Minimal on purpose.
import http from 'node:http';
const PORT = Number(process.env.PORT || 80);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/token' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const sub = form.get('sub') || form.get('username') || 'ada';
    // A stub id token: phase 2 replaces this with a signed JWT the exchange endpoint verifies.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id_token: `idp-token.${sub}`, sub, token_type: 'Bearer', expires_in: 300 }));
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`[idp] listening on ${PORT} (phase-1 stub)`));
