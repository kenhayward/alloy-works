import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  crossrefChapter,
  crossrefMarsh,
  crossrefMarshRetraction,
  crossrefSearch,
  crossrefUpdates,
  crossrefWork,
  pubmedCorrected,
  pubmedDunnart,
  pubmedRetracted,
  pubmedSearch,
  pubmedSummary,
} from '@alloy-works/domain/sources-fixtures';

/**
 * Fake Crossref and PubMed for the suite (the XR plan, XRa): one HTTPS server on 127.0.0.1, its
 * certificate the development CA's as `fake-api.mjs`'s is, answering domain's invented fixtures at
 * each source's own paths. The supervisor reaches it through `referenceOrigins`, a test's parameter
 * that production's server never takes. Terms answer hostile shapes: `redirect`, `oversized`, `deep`.
 */
const SOURCES = new URL('../../../../deploy/sources/http/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, SOURCES)));

export interface FakeReferences {
  readonly port: number;
  /** Each request's target, as it arrived. */
  readonly seen: string[];
  close(): Promise<void>;
}

const WORKS: Readonly<Record<string, object>> = {
  '10.5555/marsh.2021.017': crossrefMarsh,
  '10.5555/quolls.ch4': crossrefChapter,
};
const RECORDS = [pubmedDunnart, pubmedRetracted, pubmedCorrected];
/** The notices updating each work, by its DOI (XRb): the marsh retracted. */
const UPDATES: Readonly<Record<string, readonly object[]>> = {
  '10.5555/marsh.2021.017': [crossrefMarshRetraction],
};

/** A body no source answers whole: past the search's 512 KiB. */
const OVERSIZED = JSON.stringify({ message: { items: [], padding: 'x'.repeat(600 * 1024) } });
/** Nesting past the bound the connector reads to. */
const DEEP = `${'['.repeat(200)}${']'.repeat(200)}`;

export async function startFakeReferences(): Promise<FakeReferences> {
  const seen: string[] = [];
  const sockets = new Set<Duplex>();
  const server: Server = createServer(
    { key: read('server-key.pem'), cert: read('server.pem') },
    (request, response) => {
      const target = request.url ?? '/';
      seen.push(target);
      const url = new URL(target, 'https://fake.test');
      const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        response.writeHead(status, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          ...headers,
        });
        response.end(body);
      };
      const terms = url.searchParams.get('query') ?? url.searchParams.get('term');
      if (terms === 'redirect') return send(302, '{}', { location: '/works' });
      if (terms === 'oversized') return send(200, OVERSIZED);
      if (terms === 'deep') return send(200, DEEP);
      const updates = /^updates:(.+)$/.exec(url.searchParams.get('filter') ?? '');
      if (url.pathname === '/works' && updates) {
        return send(200, JSON.stringify(crossrefUpdates(UPDATES[updates[1]!] ?? [])));
      }
      if (url.pathname === '/works') return send(200, JSON.stringify(crossrefSearch));
      const work = /^\/works\/(.+)$/.exec(url.pathname);
      if (work) {
        const found = WORKS[decodeURIComponent(work[1]!)];
        return found
          ? send(200, JSON.stringify(crossrefWork(found)))
          : send(404, '"Resource not found."');
      }
      if (url.pathname === '/entrez/eutils/esearch.fcgi') {
        return send(200, JSON.stringify(pubmedSearch));
      }
      if (url.pathname === '/entrez/eutils/esummary.fcgi') {
        const ids = (url.searchParams.get('id') ?? '').split(',');
        return send(
          200,
          JSON.stringify(pubmedSummary(RECORDS.filter((each) => ids.includes(each.uid)))),
        );
      }
      return send(404, '{}');
    },
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
