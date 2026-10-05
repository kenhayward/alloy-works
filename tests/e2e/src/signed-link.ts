import { request as httpRequest } from 'node:http';

import { e2eTargets } from './targets.js';

/** Where the object store actually answers; the name it signs by is a browser's business. */
const STORE_AT = e2eTargets(process.env).storeAt;

/**
 * Follows a link the object store signed. The store's own name is part of what was signed, so it
 * stays in the `Host` header exactly as it was; only where the socket goes is changed, which is
 * what keeps this suite from having an opinion about how a machine resolves `*.localhost`.
 */
export function followSignedLink(link: URL): Promise<{
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const asked = httpRequest(
      {
        host: STORE_AT,
        port: link.port,
        path: `${link.pathname}${link.search}`,
        headers: { host: link.host },
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('error', reject);
        answer.on('end', () =>
          resolve({
            status: answer.statusCode ?? 0,
            contentType: answer.headers['content-type'],
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    asked.on('error', reject);
    asked.end();
  });
}
