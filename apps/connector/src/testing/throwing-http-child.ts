import { request } from 'node:https';

import { childRequestSchema, type HttpSettings } from '@alloy-works/domain';

/**
 * An HTTP child made to crash (DAT-005, the D6 plan): it reads its request as the real child does,
 * sends the secret in its header to the base URL, then throws an error naming the composed URL and the
 * secret, uncaught, so Node writes both, with its stack, to standard error and exits without an
 * answer. The supervisor must answer `connector_error` and let nothing of it through.
 */
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const input = childRequestSchema.parse(
  JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''),
);
const { baseUrl, secretHeader } = (input.request.settings as HttpSettings).source;
const composed = `${baseUrl}/echo?key=${encodeURIComponent(input.secret)}`;
const sent = request(composed, {
  headers: { [secretHeader]: input.secret },
  ...(input.ca === undefined ? {} : { ca: input.ca }),
});
sent.on('response', () => {
  throw new Error(`Failed at ${composed} with ${secretHeader}: ${input.secret}`);
});
sent.end();
