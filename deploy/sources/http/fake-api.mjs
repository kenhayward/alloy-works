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

import { answerModel, isModelPath } from './stand-in-model.mjs';

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

/** A stand-in vocabulary's concept scheme, as a SKOS address serves it (the VO plan, VO-J). */
const REGIONS_TURTLE = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <https://source-http/vocabulary/regions#> .

ex:scheme a skos:ConceptScheme ; skos:prefLabel "Regions"@en .
ex:north a skos:Concept ; skos:inScheme ex:scheme ; skos:prefLabel "North"@en .
ex:south a skos:Concept ; skos:inScheme ex:scheme ; skos:prefLabel "South"@en .
`;

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
      // The stand-in extension's key rides as a bearer: whether it was its own is kept, never the key.
      const bearer =
        headers.authorization === `Bearer ${EXTENSION_KEY}` ||
        headers.authorization === `Bearer ${REFERENCE_EXTENSION_KEY}`;
      // The stand-in model's key rides here in OpenAI's protocol, and is never remembered either.
      delete headers.authorization;
      seen.push({
        method: request.method,
        rawPath: request.url,
        headers,
        body,
        keyed: key === DEV_KEY,
        bearer,
      });
      const send = (status, bytes, extra = {}) => {
        response.writeHead(status, { 'content-length': String(bytes.length), ...extra });
        response.end(bytes);
      };
      // The stand-in model (the G1 plan, G1-H), behind its own key.
      if (isModelPath(url.pathname)) return answerModel(request, url, body, response);
      // The stand-in extension (the EX plan): its test and its run, the run's rows its gauges, those of
      // the region its settings name and the site its parameters name; and one that fails, and one
      // that answers out of shape.
      if ((url.pathname === '/extension/test' || url.pathname === '/extension/run') && !bearer) {
        return send(401, json({ error: 'key' }));
      }
      if (url.pathname === '/extension/test') return send(200, json({ ok: true }));
      if (url.pathname === '/extension/run') {
        const asked = JSON.parse(body || '{}');
        const rows = GAUGES.filter(
          (each) =>
            each.region === asked.settings?.region &&
            (asked.parameters?.site === undefined || each.site === asked.parameters.site),
        ).map(({ site, level }) => ({ site, level }));
        return send(200, json({ rows }));
      }
      if (url.pathname.startsWith('/extension-broken/')) return send(503, json({ error: 'down' }));
      if (url.pathname.startsWith('/extension-refusing/')) {
        return send(422, json({ error: 'no such reading' }));
      }
      if (url.pathname.startsWith('/extension-invalid/')) return send(200, Buffer.from('not json'));
      // The stand-in reference extension (the XR plan, XR-J): its manifest, and CSL-JSON answered to
      // a search by its terms and to a fetch by its `id`, behind its own key.
      if (url.pathname === '/reference-extension/manifest.json') {
        return send(
          200,
          json(standInReferenceManifest(`https://${request.headers.host ?? 'source-http'}`)),
        );
      }
      if (url.pathname.startsWith('/reference-extension/')) {
        if (!bearer) return send(401, json({ error: 'key' }));
        if (url.pathname === '/reference-extension/search') {
          const terms = (url.searchParams.get('query') ?? '').toLowerCase();
          return send(
            200,
            json(HERBARIUM.filter((each) => each.title.toLowerCase().includes(terms))),
          );
        }
        if (url.pathname === '/reference-extension/records') {
          const found = HERBARIUM.filter((each) => each.id === url.searchParams.get('id'));
          return found.length === 0 ? send(404, json([])) : send(200, json(found));
        }
      }
      // An extension's manifest (the EX plan): a stand-in source's, and one past 64 KiB.
      if (url.pathname === '/extension/manifest.json') {
        return send(200, json(standInManifest(`https://${request.headers.host ?? 'source-http'}`)));
      }
      if (url.pathname === '/extension/too-large.json') {
        return send(200, Buffer.from(JSON.stringify({ padding: 'x'.repeat(70_000) })));
      }
      // A vocabulary's SKOS address (the VO plan, VO-J): a small concept scheme in Turtle, and one
      // past 5 MB.
      if (url.pathname === '/vocabulary/regions.ttl') {
        return send(200, Buffer.from(REGIONS_TURTLE), {
          'content-type': 'text/turtle; charset=utf-8',
        });
      }
      if (url.pathname === '/vocabulary/too-large.ttl') {
        return send(200, Buffer.from(`# ${'x'.repeat(5 * 1024 * 1024)}`), {
          'content-type': 'text/turtle',
        });
      }
      // A webhook's receiver (the WB plan): `/hooks` answers 200, `/hooks/<status>` that status, a
      // redirect's with a Location it must never be followed to; each kept in `seen`, unkeyed.
      if (url.pathname === '/hooks/nul') return send(200, Buffer.from('a\u0000b'));
      if (url.pathname === '/hooks' || url.pathname.startsWith('/hooks/')) {
        const asked = /^\/hooks\/([0-9]{3})$/.exec(url.pathname);
        const answer = asked ? Number(asked[1]) : 200;
        return send(answer, Buffer.from(`received ${'x'.repeat(4000)}`), {
          ...(answer >= 300 && answer < 400 ? { location: '/hooks' } : {}),
        });
      }
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
        case '/v1/versioned':
        case '/v1/modified': {
          // The readings with a revision (the FR plan, FR-C): an ETag, or a Last-Modified alone, and
          // 304 to a conditional request it matches. `?v=` names the ETag's version.
          const bytes = json({ data: { items: READINGS }, count: READINGS.length });
          const tagged = pathname === '/v1/versioned';
          const etag = `"readings-${url.searchParams.get('v') ?? '1'}"`;
          const modified = 'Wed, 21 Oct 2026 07:28:00 GMT';
          const unchanged = tagged
            ? request.headers['if-none-match'] === etag
            : request.headers['if-modified-since'] !== undefined &&
              Date.parse(request.headers['if-modified-since']) >= Date.parse(modified);
          const revision = tagged ? { etag } : { 'last-modified': modified };
          if (unchanged) {
            response.writeHead(304, revision);
            return response.end();
          }
          return send(200, bytes, { 'content-type': 'application/json', ...revision });
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

/** The stand-in extension's gauges (the EX plan): invented sites and levels. */
/** The stand-in extension's key: invented. */
const EXTENSION_KEY = 'stand-in-extension-key';

const GAUGES = [
  { region: 'north', site: 'north-weir', level: 2.5 },
  { region: 'north', site: 'north-bridge', level: 1.75 },
  { region: 'south', site: 'south-ford', level: 0.5 },
];

/** The stand-in reference extension's key: invented. */
const REFERENCE_EXTENSION_KEY = 'stand-in-reference-key';

/** The stand-in reference extension's records (the XR plan, XR-J): invented, as CSL-JSON. */
const HERBARIUM = [
  {
    id: 'STAND-0001',
    type: 'article-journal',
    title: 'Saltbush specimens of the eastern plains',
    author: [{ family: 'Pell', given: 'Ada' }],
    'container-title': 'Invented Herbarium Notes',
    issued: { 'date-parts': [[2019, 5]] },
  },
  {
    id: 'STAND-0002',
    type: 'article-journal',
    title: 'Bluebush hybrids reconsidered',
    author: [{ family: 'Marsh', given: 'Grace' }],
    issued: { 'date-parts': [[2020]] },
    'x-alloy-notices': [{ kind: 'retraction', identifier: 'STAND-R-0001', date: '2026-03-01' }],
  },
];

/** The stand-in reference extension's manifest (the XR plan, XR-J): invented, behind this server. */
export function standInReferenceManifest(origin) {
  return {
    manifest: 1,
    name: 'Stand-in herbarium',
    version: '1.0.0',
    publisher: 'Alloy Works development',
    description: 'Invented herbarium papers, for development and the suites.',
    kind: 'reference',
    endpoint: `${origin}/reference-extension`,
    reference: { search: '/search', fetch: '/records' },
    authentication: { label: 'Stand-in key' },
    outbound: [],
  };
}

/** The stand-in extension's manifest (the EX plan): an invented gauge source behind this server. */
export function standInManifest(origin) {
  return {
    manifest: 1,
    name: 'Stand-in gauges',
    version: '1.0.0',
    publisher: 'Alloy Works development',
    description: 'Invented river gauge readings, for development and the suites.',
    kind: 'source',
    endpoint: `${origin}/extension`,
    settings: [{ key: 'region', label: 'Region', type: 'text', required: true }],
    authentication: { label: 'Stand-in key' },
    capabilities: { parameters: true, keyColumns: true, rowLimit: true },
    outbound: [],
  };
}
