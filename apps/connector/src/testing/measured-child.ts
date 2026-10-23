import { childRequestSchema } from '@alloy-works/domain';

import { answerRequest } from '../work.js';

/**
 * The child as `child.ts` is, for the suite alone: one line in, one line out, and then, on its
 * standard error, the most memory it held - its peak resident set, in bytes - so a test can hold a
 * run to a bound (DAT-110). Nothing else differs.
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
  const answer = await answerRequest(request, { startedAt: Math.floor(performance.timeOrigin) });
  await new Promise<void>((resolve) =>
    process.stdout.write(`${JSON.stringify(answer)}\n`, () => resolve()),
  );
  const peak = process.resourceUsage().maxRSS * 1024;
  await new Promise<void>((resolve) =>
    process.stderr.write(`${JSON.stringify({ peakBytes: peak })}\n`, () => resolve()),
  );
  return 0;
}

process.exit(await main());
