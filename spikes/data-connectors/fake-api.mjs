// Fake JSON API on aw-dc-sources, behind a bearer token. Phase 3 (case 3) adds per-user scope checks
// so Ada and Grace see different rows; for phase 1 it needs only to exist and to answer a bearer.
// It also serves a /redirect endpoint used by case 1 (redirect from allowed host to a denied one).
import http from 'node:http';
const PORT = Number(process.env.PORT || 80);
const STATIC_TOKEN = process.env.API_TOKEN || 'fake-api-bearer-token-for-the-spike';
const REDIRECT_TO = process.env.REDIRECT_TO || 'http://platform-pg:5432/';

const rows = [
  { id: 1, owner: 'ada', amount: '100.00', label: 'alpha' },
  { id: 2, owner: 'grace', amount: '250.50', label: 'beta' },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/redirect') {
    res.writeHead(302, { location: REDIRECT_TO }); res.end('redirecting'); return;
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${STATIC_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ rows }));
});
server.listen(PORT, '0.0.0.0', () => console.log(`[fake-api] listening on ${PORT}`));
