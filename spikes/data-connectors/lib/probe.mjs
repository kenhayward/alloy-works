// Raw reachability probe. Doubles as case 1's DAT-006 oracle: it reports the OUTCOME CLASS of a
// connection attempt, which is exactly what a connection test would leak to an administrator. If the
// classes differ (refused vs filtered vs unknown-host vs connected), an admin can map our network.
import net from 'node:net';
import dns from 'node:dns/promises';

// Classify a TCP connect. Returns one of: connected, refused, timeout, dns-error, unreachable, other.
export function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const done = (outcome, detail) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      try {
        sock.destroy();
      } catch {}
      resolve({ outcome, detail: detail ?? null, ms: Math.round(ms) });
    };
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done('connected'));
    sock.once('timeout', () => done('timeout', 'socket timeout (filtered/dropped)'));
    sock.once('error', (err) => {
      const code = err.code || err.errno || 'ERR';
      if (code === 'ECONNREFUSED') return done('refused', code);
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return done('dns-error', code);
      if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return done('unreachable', code);
      return done('other', code);
    });
    try {
      sock.connect(port, host);
    } catch (err) {
      done('other', err.code || String(err));
    }
  });
}

// Resolve a name the way the harness sees it now (used to expose DNS rebinding: resolve twice).
export async function resolveOnce(host) {
  try {
    const res = await dns.lookup(host, { all: true });
    return { ok: true, addresses: res.map((r) => r.address) };
  } catch (err) {
    return { ok: false, code: err.code || String(err) };
  }
}

// Resolve a name through a SPECIFIC DNS server, isolated from the process resolver, so the rebinding
// resolver can be queried without disturbing container service discovery.
export async function resolveVia(server, host) {
  const r = new dns.Resolver();
  r.setServers([server]);
  try {
    const addresses = await r.resolve4(host);
    return { ok: true, addresses };
  } catch (err) {
    return { ok: false, code: err.code || String(err) };
  }
}
