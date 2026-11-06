import { readFileSync } from 'node:fs';
import { createServer as createNetServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer, TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';

/**
 * The suite's own SMTP relay (the EM plan, EM-J): just enough of RFC 5321 to take a message, over
 * STARTTLS or TLS from the start, its certificate the development mail CA's for `mailpit`,
 * `localhost` and 127.0.0.1, or another name's. It records what it was sent, whether TLS was up before
 * AUTH, and refuses whatever a test tells it to.
 */

const MAIL = new URL('../../../../deploy/sources/mail/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, MAIL)), 'utf8');

/** The development mail CA, which the suite's children trust beside the system's. */
export const MAIL_CA = read('ca.pem');

const CERTIFICATES = {
  mailpit: { key: read('server-key.pem'), cert: read('server.pem') },
  other: { key: read('other-key.pem'), cert: read('other.pem') },
} as const;

const CRLF = String.fromCharCode(13, 10);

export interface FakeRelay {
  readonly port: number;
  /** Each message taken: its envelope, the data as it arrived, and how it was reached. */
  readonly taken: {
    readonly from: string;
    readonly to: readonly string[];
    readonly data: string;
    readonly auth: string | undefined;
    readonly tlsBeforeAuth: boolean;
  }[];
  /** Whether anybody tried AUTH, TLS or no. */
  readonly authTried: () => boolean;
  /** How many connections it took. */
  readonly connections: () => number;
  close(): Promise<void>;
}

export interface RelayOptions {
  /** `starttls` offers STARTTLS on 587's way; `none` offers no TLS at all; `implicit` is TLS from the start. */
  readonly tls?: 'starttls' | 'none' | 'implicit';
  readonly certificate?: keyof typeof CERTIFICATES;
  /** What RCPT answers, and its words, which a test reads to see they are never kept. */
  readonly rcpt?: string;
  /** What AUTH answers. */
  readonly auth?: string;
  /** What the end of DATA answers. */
  readonly data?: string;
  /** Takes the connection and never greets: a black hole. */
  readonly silent?: boolean;
}

export async function startFakeRelay(options: RelayOptions = {}): Promise<FakeRelay> {
  const mode = options.tls ?? 'starttls';
  const certificate = CERTIFICATES[options.certificate ?? 'mailpit'];
  const taken: FakeRelay['taken'] = [];
  let authTried = false;
  let connections = 0;
  const sockets = new Set<Socket>();

  const handle = (first: Socket) => {
    connections += 1;
    sockets.add(first);
    first.on('close', () => sockets.delete(first));
    first.on('error', () => {});
    if (options.silent) return;
    let socket: Socket = first;
    let secure = mode === 'implicit';
    let buffered = '';
    let inData = false;
    let auth: string | undefined;
    let tlsBeforeAuth = false;
    let from = '';
    let to: string[] = [];
    const say = (line: string) => socket.write(`${line}${CRLF}`);
    const on = (chunk: Buffer) => {
      buffered += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buffered.indexOf(`${CRLF}.${CRLF}`);
          if (end < 0) return;
          const data = buffered.slice(0, end);
          buffered = buffered.slice(end + 5);
          inData = false;
          const answer = options.data ?? '250 2.0.0 queued';
          if (answer.startsWith('2')) taken.push({ from, to, data, auth, tlsBeforeAuth });
          say(answer);
          continue;
        }
        const end = buffered.indexOf(CRLF);
        if (end < 0) return;
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          const offers = [
            ...(mode === 'starttls' && !secure ? ['STARTTLS'] : []),
            'AUTH PLAIN LOGIN',
            '8BITMIME',
          ];
          socket.write(
            ['250-fake relay', ...offers.slice(0, -1).map((each) => `250-${each}`)]
              .concat(`250 ${offers[offers.length - 1]}`)
              .join(CRLF) + CRLF,
          );
        } else if (upper.startsWith('STARTTLS') && mode === 'starttls' && !secure) {
          say('220 2.0.0 ready');
          socket.removeAllListeners('data');
          const upgraded = new TLSSocket(socket, { isServer: true, ...certificate });
          upgraded.on('error', () => {});
          upgraded.on('data', on);
          socket = upgraded;
          secure = true;
        } else if (upper.startsWith('AUTH')) {
          authTried = true;
          tlsBeforeAuth = secure;
          auth = line;
          say(options.auth ?? '235 2.7.0 accepted');
        } else if (upper.startsWith('MAIL FROM:')) {
          from = line.slice(10);
          to = [];
          say('250 2.1.0 ok');
        } else if (upper.startsWith('RCPT TO:')) {
          const answer = options.rcpt ?? '250 2.1.5 ok';
          if (answer.startsWith('2')) to.push(line.slice(8));
          say(answer);
        } else if (upper === 'DATA') {
          say('354 go ahead');
          inData = true;
        } else if (upper === 'QUIT') {
          say('221 2.0.0 bye');
          socket.end();
        } else if (upper === 'RSET' || upper === 'NOOP') {
          say('250 2.0.0 ok');
        } else {
          say('502 5.5.1 not here');
        }
      }
    };
    socket.on('data', on);
    say('220 fake relay ready');
  };

  const server: Server =
    mode === 'implicit'
      ? createTlsServer(certificate, (socket) => handle(socket))
      : createNetServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  return {
    port: address.port,
    taken,
    authTried: () => authTried,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
