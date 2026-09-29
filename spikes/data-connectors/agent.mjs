// One process, run as two containers: the CALLER (placement A, on all three networks) and the
// CONNECTOR (placement C, on aw-dc-sources and aw-dc-connector-rpc only). Same code; the only
// difference is which networks compose attaches, which is the whole point of case 1 - the boundary
// is a fact of the network, not a branch in code. It answers probes, guard decisions, connection
// tests and queries from the vantage of ITS OWN network membership.
import http from 'node:http';
import { tcpProbe, resolveOnce, resolveVia } from './lib/probe.mjs';
import { classify } from './lib/guard.mjs';
import { guardHost } from './lib/guard.mjs';
import { connectionTest, runQuery, makeSink } from './lib/connect.mjs';

const ROLE = process.env.ROLE || 'caller';
const PORT = Number(process.env.PORT || 8080);

function log(...a) { console.log(`[${ROLE}]`, ...a); }

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(200, { ok: true, role: ROLE });
    const b = await body(req);
    if (url.pathname === '/probe') {
      return send(200, { role: ROLE, ...(await tcpProbe(b.host, b.port, b.timeoutMs ?? 2500)) });
    }
    if (url.pathname === '/resolve') {
      return send(200, { role: ROLE, ...(await resolveOnce(b.host)) });
    }
    if (url.pathname === '/rebind-test') {
      // TOCTOU: resolve the rebinding name via the resolver twice (check-time then connect-time),
      // classify each, and probe the connect-time address from THIS container's vantage.
      const server = b.resolver || '172.31.20.25';
      const name = b.name || 'rebind.evil.test';
      const first = await resolveVia(server, name); // guard's check would use this
      const second = await resolveVia(server, name); // driver's re-resolve would use this
      const checkIp = first.addresses?.[0] ?? null;
      const connectIp = second.addresses?.[0] ?? null;
      const reach = connectIp ? await tcpProbe(connectIp, b.port ?? 5432, 2500) : null;
      return send(200, {
        role: ROLE, name,
        checkTime: { ip: checkIp, class: checkIp ? classify(checkIp) : null },
        connectTime: { ip: connectIp, class: connectIp ? classify(connectIp) : null },
        connectReachable: reach,
      });
    }
    if (url.pathname === '/guard') {
      return send(200, { role: ROLE, ...(await guardHost(b.host, { allowDeclaredPrivate: b.allowDeclaredPrivate ?? true })) });
    }
    if (url.pathname === '/conn-test') {
      const sink = makeSink();
      const out = await connectionTest(b.spec, { sink, guard: b.guard ?? true });
      // The caller of the API sees only { ok, reason }. The sink is returned separately so case 2 can
      // search it, standing in for the platform's own logs/job rows which live out of band.
      return send(200, { role: ROLE, result: out, sink: b.exposeSink ? sink.written : undefined });
    }
    if (url.pathname === '/query' || url.pathname === '/rpc/query') {
      const sink = makeSink();
      try {
        const out = await runQuery(b.spec, { sql: b.sql, params: b.params, timeoutMs: b.timeoutMs ?? 5000, sink });
        return send(200, { role: ROLE, result: out, sink: b.exposeSink ? sink.written : undefined });
      } catch (err) {
        // The scrubbed error to the caller; the raw driver bytes stay in the sink.
        return send(502, { role: ROLE, error: err.message, sink: b.exposeSink ? sink.written : undefined });
      }
    }
    return send(404, { error: 'no such path' });
  } catch (err) {
    send(500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => log(`listening on ${PORT}`));
