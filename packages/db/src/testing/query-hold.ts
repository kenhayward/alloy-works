import net from 'node:net';

/**
 * A way to the database that a test can stop at a chosen statement. Armed with some text, it holds
 * the first thing a client sends that contains it - and everything that client sends after - until
 * it is released, while the database's answers keep flowing. So a test can have a statement sent
 * and not yet received, and do something else meanwhile, without guessing how long anything takes.
 * It can also drop every connection through it, and turn new ones away, as a database going away
 * would.
 */
export interface QueryHold {
  /** The connection string it was given, through the hold. */
  readonly url: string;
  /** Holds from the next chunk sent that contains `text`; settles once that chunk is held. */
  hold(text: string): Promise<void>;
  /** Sends on everything held, in order, and holds nothing more until armed again. */
  release(): void;
  /** Ends every connection through it at once. */
  cut(): void;
  /** While true, a new connection is ended as soon as it arrives. */
  refuse(refusing: boolean): void;
  close(): Promise<void>;
}

interface Pair {
  readonly client: net.Socket;
  readonly upstream: net.Socket;
  readonly held: Buffer[];
  holding: boolean;
  tail: string;
}

export async function holdQueries(url: string): Promise<QueryHold> {
  const target = new URL(url);
  const pairs = new Set<Pair>();
  let armed: { readonly text: string; readonly reached: () => void } | undefined;
  let refusing = false;

  const server = net.createServer((client) => {
    if (refusing) {
      client.destroy();
      return;
    }
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    const pair: Pair = { client, upstream, held: [], holding: false, tail: '' };
    pairs.add(pair);
    const drop = () => {
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.on('close', drop);
    upstream.on('close', drop);
    upstream.on('data', (chunk: Buffer) => client.write(chunk));
    client.on('data', (chunk: Buffer) => {
      const seen = pair.tail + chunk.toString('latin1');
      if (armed && !pair.holding && seen.includes(armed.text)) {
        pair.holding = true;
        armed.reached();
        armed = undefined;
      }
      // Kept so that text split across two chunks is still found.
      pair.tail = seen.slice(-64);
      if (pair.holding) pair.held.push(chunk);
      else upstream.write(chunk);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const through = new URL(url);
  through.hostname = '127.0.0.1';
  through.port = String((server.address() as net.AddressInfo).port);

  return {
    url: through.toString(),
    hold: (text) =>
      new Promise<void>((resolve) => {
        // What was sent before it was armed is not what it is waiting for.
        for (const pair of pairs) pair.tail = '';
        armed = { text, reached: resolve };
      }),
    release() {
      armed = undefined;
      for (const pair of pairs) {
        pair.holding = false;
        for (const chunk of pair.held.splice(0)) pair.upstream.write(chunk);
      }
    },
    cut() {
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
    },
    refuse(on) {
      refusing = on;
    },
    async close() {
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
