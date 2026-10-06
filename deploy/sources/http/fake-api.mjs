// A tenant's own HTTP API, for development and CI only (the D6 plan, task 1): HTTPS by the
// development CA beside this file, the invented key `source-http-dev-key` in `x-api-key`, and the
// sample's readings as JSON and JSON Lines - with the hostile answers the connector's suite and the
// whole-system suite hold it to: a redirect, a trickle, a gzip bomb, a short body, a wrong digest and
// a wrong count - and case 6's table as JSON, JSON Lines, CSV and XLSX under /v1/files. Every value
// is invented. No dependency but Node.
//
//   node fake-api.mjs           listens on PORT (8443), the certificate from CERT_DIR (this folder)
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import process from 'node:process';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** The development key, sent verbatim in `x-api-key`. Invented; it opens nothing but this fake. */
export const DEV_KEY = 'source-http-dev-key';

/** The sample's readings, as the PostgreSQL source's seed holds them, and more besides. */
export const READINGS = [
  {
    id: 1,
    site: 'North weir',
    depth: 12.5,
    measured: '2026-01-02',
    taken: '2026-01-02T03:04:05.5Z',
    active: true,
    detail: { b: 1, a: [2, 3] },
  },
  {
    id: 2,
    site: 'South weir',
    depth: 7.25,
    measured: '2026-01-03',
    taken: '2026-01-03T04:05:06Z',
    active: false,
    detail: null,
  },
  {
    id: 3,
    site: 'East gauge',
    depth: 0.75,
    measured: '2026-01-04',
    taken: '2026-01-04T05:06:07.25Z',
    active: true,
    detail: { a: 'x' },
  },
];

const json = (value) => Buffer.from(JSON.stringify(value), 'utf8');
const LF = String.fromCharCode(10);
const digest = (bytes) => `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`;

/** The request's body, read whole: the fake's own requests are small. */
async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The fake's routes, under `/v1`. Each request is remembered in `seen`, its secret's header left out,
 * so a suite can read what the connector sent.
 */
export function createFakeApi(options = {}) {
  const dir = options.certDir ?? fileURLToPath(new URL('.', import.meta.url));
  const seen = [];
  const sockets = new Set();
  const server = createServer(
    {
      key: readFileSync(`${dir}/server-key.pem`),
      cert: readFileSync(`${dir}/server.pem`),
    },
    async (request, response) => {
      const url = new URL(request.url ?? '/', 'https://source-http');
      const body = await bodyOf(request);
      const headers = { ...request.headers };
      const key = headers['x-api-key'];
      delete headers['x-api-key'];
      seen.push({
        method: request.method,
        rawPath: request.url,
        headers,
        body,
        keyed: key === DEV_KEY,
      });
      const send = (status, bytes, extra = {}) => {
        response.writeHead(status, { 'content-length': String(bytes.length), ...extra });
        response.end(bytes);
      };
      if (url.pathname === '/v1/status/401' || key !== DEV_KEY)
        return send(401, json({ error: 'key' }));
      const status = /^\/v1\/status\/([0-9]{3})$/.exec(url.pathname);
      if (status) return send(Number(status[1]), json({ error: 'status' }));
      // Case 6's table as each file format writes it (the D6 plan, task 3), from ./files, by a name
      // it holds and no other.
      const file = /^\/v1\/files\/(typed\.(?:json|jsonl|csv|xlsx))$/.exec(url.pathname);
      if (file) return send(200, readFileSync(`${dir}/files/${file[1]}`));
      // The echo answers under any path beneath it, so a value placed in a segment reaches it.
      const pathname = url.pathname.startsWith('/v1/echo/') ? '/v1/echo' : url.pathname;
      switch (pathname) {
        case '/v1':
          return send(200, json({ name: 'readings' }));
        case '/v1/readings': {
          const site = url.searchParams.get('site');
          const items = READINGS.filter((each) => site === null || each.site === site);
          const bytes = json({ data: { items }, count: items.length });
          if (
            (request.headers['accept-encoding'] ?? '').includes('gzip') &&
            url.searchParams.has('gzip')
          ) {
            const zipped = gzipSync(bytes);
            return send(200, zipped, {
              'content-encoding': 'gzip',
              'content-digest': digest(zipped),
            });
          }
          return send(200, bytes, {
            'content-type': 'application/json',
            'content-digest': digest(bytes),
          });
        }
        case '/v1/readings.jsonl':
          return send(
            200,
            Buffer.from(READINGS.map((each) => JSON.stringify(each)).join('\n') + '\n'),
          );
        case '/v1/readings.csv':
          // As CSV, its header first: a quoted empty note is empty text, an unquoted one null.
          return send(
            200,
            Buffer.from(
              [
                'id,site,depth,measured,taken,active,note',
                ...READINGS.map(
                  (each, at) =>
                    `${each.id},"${each.site}",${each.depth},${each.measured},${each.taken},${each.active},${at === 0 ? '""' : ''}`,
                ),
              ].join(LF) + LF,
            ),
            { 'content-type': 'text/csv' },
          );
        case '/v1/echo':
          // What the connector sent, as one row: the method, the path and query as they arrived, the
          // headers but the key, and the body.
          return send(
            200,
            json({
              items: [
                {
                  method: request.method,
                  target: request.url,
                  headers: JSON.stringify(headers),
                  body,
                },
              ],
            }),
          );
        case '/v1/numbers':
          return send(
            200,
            Buffer.from(
              '{"items":[{"big":123456789012345678901234567890,"small":1e-7,"places":0.10}]}',
            ),
          );
        case '/v1/redirect':
          response.writeHead(302, {
            location: 'https://127.0.0.1:1/v1/readings',
            'content-length': '0',
          });
          return response.end();
        case '/v1/trickle': {
          // A byte a second, for as long as the connector waits.
          response.writeHead(200, { 'content-type': 'application/json' });
          response.write('{"items":[');
          const timer = setInterval(() => response.write(' '), 1000);
          response.on('close', () => clearInterval(timer));
          return undefined;
        }
        case '/v1/bomb': {
          const megabytes = Number(url.searchParams.get('mb') ?? '64');
          const zipped = gzipSync(Buffer.alloc(megabytes * 1024 * 1024, 32));
          return send(200, zipped, { 'content-encoding': 'gzip' });
        }
        case '/v1/wide': {
          // Rows of numbers and text up to a body's size, to measure a child reading the most a
          // result may be: each row `columns` members, a decimal and then text in turn.
          const rows = Number(url.searchParams.get('rows') ?? '10');
          const columns = Number(url.searchParams.get('columns') ?? '10');
          const parts = [];
          if (url.searchParams.has('csv')) {
            // As CSV where `csv` is asked: a header, then a record a row, every text quoted.
            const names = ['id', ...Array.from({ length: columns }, (_, at) => `c${at}`)];
            parts.push(names.join(','));
            for (let row = 0; row < rows; row += 1) {
              const fields = [String(row)];
              for (let at = 0; at < columns; at += 1) {
                fields.push(
                  at % 2 === 0
                    ? `${row + 1}${at}.${String(row % 100).padStart(2, '0')}`
                    : `"r${row}c${at}"`,
                );
              }
              parts.push(fields.join(','));
            }
            return send(200, Buffer.from(`${parts.join(LF)}${LF}`, 'utf8'));
          }
          for (let row = 0; row < rows; row += 1) {
            const members = [];
            for (let at = 0; at < columns; at += 1) {
              members.push(
                at % 2 === 0
                  ? `"c${at}":${row + 1}${at}.${String(row % 100).padStart(2, '0')}`
                  : `"c${at}":"r${row}c${at}"`,
              );
            }
            parts.push(`{"id":${row},${members.join(',')}}`);
          }
          // As JSON Lines where `lines` is asked, a row a line.
          const text = url.searchParams.has('lines')
            ? `${parts.join(LF)}${LF}`
            : `{"items":[${parts.join(',')}]}`;
          return send(200, Buffer.from(text, 'utf8'));
        }
        case '/v1/big': {
          const bytes = Number(url.searchParams.get('bytes') ?? '1024');
          return send(200, json({ items: [{ text: 'x'.repeat(bytes) }] }));
        }
        case '/v1/short': {
          response.writeHead(200, { 'content-length': '1000' });
          response.write('{"items":[]}');
          return setTimeout(() => response.socket?.destroy(), 50);
        }
        case '/v1/digest-wrong': {
          const bytes = json({ items: READINGS });
          return send(200, bytes, { 'content-digest': digest(Buffer.from('other')) });
        }
        case '/v1/count-wrong':
          return send(200, json({ data: { items: READINGS }, count: READINGS.length + 2 }));
        default:
          return send(404, json({ error: 'none' }));
      }
    },
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    server,
    seen,
    /** Listens on a port, 0 for any free one, and answers the port it took. */
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const api = createFakeApi({ certDir: process.env.CERT_DIR });
  const port = await api.listen(Number(process.env.PORT ?? '8443'), '0.0.0.0');
  process.stdout.write(`${JSON.stringify({ listening: port })}\n`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
}
