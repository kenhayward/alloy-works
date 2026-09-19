import net from 'node:net';

/**
 * A way to the database that a test can stop at a chosen statement. Armed with some text, it holds
 * the first thing a client sends that contains it - and everything that client sends after - until
 * it is released, while the database's answers keep flowing. So a test can have a statement sent
 * and not yet received, and do something else meanwhile, without guessing how long anything takes.
 */
export interface QueryHold {
  /** The connection string it was given, through the hold. */
  readonly url: string;
  /** Holds from the next chunk sent that contains `text`; settles once that chunk is held. */
  hold(text: string): Promise<void>;
  /** Sends on everything held, in order, and holds nothing more until armed again. */
  release(): void;
  close(): Promise<void>;
}

interface Pair {
  readonly client: net.Socket;
  readonly upstream: net.Socket;
  readonly held: Buffer[];
  tail: string;
}

export async function holdQueries(url: string): Promise<QueryHold> {
  const target = new URL(url);
  const pairs = new Set<Pair>();
  let armed: { readonly text: string; readonly reached: () => void } | undefined;
  let holding = false;

  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    const pair: Pair = { client, upstream, held: [], tail: '' };
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
      if (armed && !holding && seen.includes(armed.text)) {
        holding = true;
        armed.reached();
      }
      // Kept so that text split across two chunks is still found.
      pair.tail = seen.slice(-64);
      if (holding) pair.held.push(chunk);
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
        armed = { text, reached: resolve };
      }),
    release() {
      armed = undefined;
      holding = false;
      for (const pair of pairs) {
        for (const chunk of pair.held.splice(0)) pair.upstream.write(chunk);
      }
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
