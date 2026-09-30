import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';

/**
 * A server that speaks just enough of PostgreSQL's protocol to ask for a password the way a hostile
 * source would (the D1 fix, C3): TLS on a certificate it made itself, then, after the startup message,
 * `AuthenticationCleartextPassword` or `AuthenticationMD5Password`. It records every message the
 * client sends after the startup, so a test can say what the client gave away. Loopback alone, which
 * the suite's policy allows (D1-K).
 */

/** One DER element: a tag and its contents. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : body.length < 0x100
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first! * 40 + second!];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) groups.unshift((value & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

/** A self-signed certificate for `fake-source`, made afresh: nothing is kept anywhere. */
function selfSigned(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecdsaWithSha256 = der(0x30, oid('1.2.840.10045.4.3.2'));
  const name = der(
    0x30,
    der(0x31, der(0x30, oid('2.5.4.3'), der(0x0c, Buffer.from('fake-source')))),
  );
  const validity = der(
    0x30,
    der(0x17, Buffer.from('250101000000Z')),
    der(0x17, Buffer.from('351231235959Z')),
  );
  const tbs = der(
    0x30,
    der(0x02, Buffer.from([1])),
    ecdsaWithSha256,
    name,
    validity,
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const certificate = der(
    0x30,
    tbs,
    ecdsaWithSha256,
    der(0x03, Buffer.from([0]), sign('sha256', tbs, privateKey)),
  );
  const lines = certificate
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n');
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`,
  };
}

/**
 * How the fake asks: for the password in the clear or as MD5, as a hostile source would, or by SASL
 * offering SCRAM-SHA-256 with and without channel binding, or without it alone, as a real source or a
 * relay in front of one would. A SASL exchange goes no further than the client's first message.
 */
export type AskedFor = 'cleartext' | 'md5' | 'scram-plus' | 'scram';

export interface FakeSource {
  readonly port: number;
  /** Each message the client sent after its startup message: its type and its body. */
  readonly received: { readonly type: string; readonly body: Buffer }[];
  close(): Promise<void>;
}

/** Reads exactly `bytes` bytes from a socket's stream of chunks. */
function reader(socket: Socket | TLSSocket) {
  let buffered = Buffer.alloc(0);
  const waiting: (() => void)[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (const wake of waiting.splice(0)) wake();
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  return async (bytes: number): Promise<Buffer | undefined> => {
    while (buffered.length < bytes) {
      const more = new Promise<void>((resolve) => waiting.push(resolve));
      if ((await Promise.race([more.then(() => 'more'), closed.then(() => 'closed')])) === 'closed')
        return undefined;
    }
    const taken = buffered.subarray(0, bytes);
    buffered = buffered.subarray(bytes);
    return taken;
  };
}

/** AuthenticationSASL: code 10, then each mechanism's name ended by a zero byte, and a last one. */
function sasl(mechanisms: readonly string[]): Buffer {
  const names = Buffer.concat([
    ...mechanisms.map((name) => Buffer.from(`${name}\0`)),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(9);
  head.write('R', 0);
  head.writeInt32BE(8 + names.length, 1);
  head.writeInt32BE(10, 5);
  return Buffer.concat([head, names]);
}

export async function fakeSource(asking: AskedFor): Promise<FakeSource> {
  const { key, cert } = selfSigned();
  const received: FakeSource['received'] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((plain) => {
    sockets.add(plain);
    plain.on('error', () => {});
    void (async () => {
      // The SSLRequest: eight bytes, answered yes.
      const plainRead = reader(plain);
      if (!(await plainRead(8))) return;
      plain.removeAllListeners('data');
      plain.write('S');
      const secure = new TLSSocket(plain, { isServer: true, key, cert });
      secure.on('error', () => {});
      const read = reader(secure);
      const length = await read(4);
      if (!length) return;
      await read(length.readInt32BE(0) - 4);
      // Ask for the password as the attack does, or offer SASL's mechanisms.
      secure.write(
        asking === 'cleartext'
          ? Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3])
          : asking === 'md5'
            ? Buffer.from([0x52, 0, 0, 0, 12, 0, 0, 0, 5, 1, 2, 3, 4])
            : sasl(
                asking === 'scram-plus'
                  ? ['SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256']
                  : ['SCRAM-SHA-256'],
              ),
      );
      for (;;) {
        const head = await read(5);
        if (!head) return;
        const body = await read(head.readInt32BE(1) - 4);
        if (!body) return;
        received.push({ type: String.fromCharCode(head[0]!), body });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
