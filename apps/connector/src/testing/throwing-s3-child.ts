import { request } from 'node:https';

import { bucketHost, childRequestSchema, type S3Settings } from '@alloy-works/domain';

/**
 * An S3 child made to crash (DAT-005, the D6 plan): it reads its request as the real child does,
 * sends a request to the bucket with the key pair in it, then throws an error naming the composed URL
 * and the opened key pair, uncaught, so Node writes both, with its stack, to standard error and exits
 * without an answer. The supervisor must answer `connector_error` and let nothing of it through.
 */
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const input = childRequestSchema.parse(
  JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''),
);
const { source } = input.request.settings as S3Settings;
const { host, port } = bucketHost(source);
const composed = `https://${host}:${port}/${source.bucket}/echo?pair=${encodeURIComponent(input.secret)}`;
const sent = request(composed, {
  headers: { authorization: input.secret },
  ...(input.ca === undefined ? {} : { ca: input.ca }),
});
sent.on('response', () => {
  throw new Error(`Failed at ${composed} with ${input.secret}`);
});
sent.end();
