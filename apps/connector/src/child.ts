import { childRequestSchema } from '@alloy-works/domain';

import { answerRequest } from './work.js';

/**
 * The child's entry (D1-H): one line in - the request, its one opened credential and the guard's
 * ranges - and one line out, then exit. It holds no key and inherits no environment. Anything it
 * cannot parse ends it without an answer and without saying what it read, which the supervisor
 * answers `connector_error`.
 */
async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? '';
}

async function main(): Promise<number> {
  let request;
  try {
    request = childRequestSchema.parse(JSON.parse(await readInput()));
  } catch {
    return 2;
  }
  // Its deadline from when the process started, which is as close as it can see to the spawn.
  const answer = await answerRequest(request, { startedAt: Math.floor(performance.timeOrigin) });
  await new Promise<void>((resolve) =>
    process.stdout.write(`${JSON.stringify(answer)}\n`, () => resolve()),
  );
  return 0;
}

process.exit(await main());
