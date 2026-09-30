// Phase 3: a fake HTTP source for cases 5, 6 and 7, started by the case scripts as a child process in
// their own container (so its memory is not the reader's). Invented data only.
//   /echo/...          what arrived: raw URL, path segments raw and decoded, query, headers, body
//   /typed-numbers     case 6's result with decimals and int64 as JSON numbers (a careless API)
//   /typed-strings     the same with them as strings
//   /big?bytes=N       a JSON body of N bytes, Content-Length set
//   /gzip?bytes=N      a JSON body of N bytes sent gzip-compressed, made on the fly (never stored)
//   /drip?bytes=N&everyMs=I   a byte at a time
//   /slow?ms=N         answers after N ms
// And a raw TCP port (PORT+1) whose response lies about its length: Content-Length says `claim` and
// the body carries `bytes`.
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';

const PORT = Number(process.env.PORT || 18080);

export const TYPED = {
  columns: ['k', 'dec', 'big', 'amount', 'd', 'ldt', 'inst', 'tm', 'flag', 'note', 'empty', 'txt'],
  rows: [
    [
      1,
      '123456789012345678.1234567891',
      '9223372036854775807',
      '1234.5600',
      '2026-03-29',
      '2026-03-29T01:30:00.123456',
      '2026-03-29T01:30:00.123456+01:00',
      '23:59:59.999999',
      true,
      null,
      '',
      'Αθήνα 東京 𠮷',
    ],
    [
      2,
      '-0.0000000001',
      '-9223372036854775808',
      '922337203685477.5807',
      '1900-03-01',
      '1900-03-01T00:00:00',
      '1969-12-31T23:59:59.999999Z',
      '00:00:00',
      false,
      'x',
      '',
      'café',
    ],
    [
      3,
      '0',
      '9007199254740993',
      '0.1000',
      '2000-02-29',
      '2026-10-25T01:30:00',
      '2026-10-25T00:30:00Z',
      '12:00:00.5',
      null,
      '',
      null,
      'café',
    ],
  ],
};
const NUMERIC = new Set([1, 2, 3]); // dec, big, amount

function typedBody(asNumbers) {
  // Written by hand so that a JSON number carries every digit, as a server in another language would.
  const cell = (v, i) => (asNumbers && NUMERIC.has(i) ? v : JSON.stringify(v));
  const rows = TYPED.rows.map((r) => '[' + r.map(cell).join(',') + ']').join(',');
  return `{"columns":${JSON.stringify(TYPED.columns)},"rows":[${rows}]}`;
}

function* filler(total) {
  // A JSON array of small objects, `total` bytes long in all.
  const unit = Buffer.from('{"id":12345,"v":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},');
  yield Buffer.from('[');
  let sent = 1;
  while (sent + unit.length + 1 < total) {
    yield unit;
    sent += unit.length;
  }
  const rest = total - sent; // pad so the body is exactly as long as its Content-Length
  yield Buffer.from(' '.repeat(Math.max(0, rest - 3)) + '{}]'.slice(-Math.min(3, rest)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = (k, d) => Number(url.searchParams.get(k) ?? d);
  if (url.pathname.startsWith('/echo')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = '(unparseable)';
    }
    const rawPath = req.url.split('?')[0];
    const raw = rawPath.split('/').slice(2);
    const out = {
      rawUrl: req.url,
      method: req.method,
      segments: raw.map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return null;
        }
      }),
      segmentsIfDecodedFirst: (() => {
        try {
          return decodeURIComponent(rawPath).split('/').slice(2);
        } catch {
          return null;
        }
      })(),
      query: [...url.searchParams.entries()],
      headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-'))),
      bodyText: text,
      body: parsed,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  if (url.pathname === '/typed-numbers' || url.pathname === '/typed-strings') {
    const b = typedBody(url.pathname === '/typed-numbers');
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(b),
    });
    return res.end(b);
  }
  if (url.pathname === '/big') {
    const n = q('bytes', 1e6);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': n });
    for (const c of filler(n)) {
      if (!res.write(c)) await new Promise((r) => res.once('drain', r));
      if (res.destroyed) return;
    }
    return res.end();
  }
  if (url.pathname === '/gzip') {
    const n = q('bytes', 1e6);
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    const gz = zlib.createGzip({ level: 9 });
    gz.pipe(res);
    res.on('close', () => gz.destroy());
    for (const c of filler(n)) {
      if (res.destroyed) return;
      if (!gz.write(c)) await new Promise((r) => gz.once('drain', r));
    }
    return gz.end();
  }
  if (url.pathname === '/drip') {
    const n = q('bytes', 100);
    const every = q('everyMs', 100);
    res.writeHead(200, { 'content-type': 'application/json' });
    for (let i = 0; i < n && !res.destroyed; i++) {
      res.write(i === 0 ? '[' : ' ');
      await new Promise((r) => setTimeout(r, every));
    }
    return res.end(']');
  }
  if (url.pathname === '/slow') {
    await new Promise((r) => setTimeout(r, q('ms', 1000)));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('[]');
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => process.send?.({ ready: true, port: PORT }));

// The liar: a raw response whose Content-Length undercounts its body.
net
  .createServer((sock) => {
    let head = '';
    sock.on('data', (d) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      const u = new URL(head.split(' ')[1], 'http://x');
      const claim = Number(u.searchParams.get('claim') ?? 10);
      const bytes = Number(u.searchParams.get('bytes') ?? 1000);
      sock.write(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${claim}\r\nconnection: close\r\n\r\n`,
      );
      sock.end(Buffer.alloc(bytes, 0x20));
    });
    sock.on('error', () => {});
  })
  .listen(PORT + 1, '127.0.0.1');
