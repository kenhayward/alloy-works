import {
  childDeliverRequestSchema,
  childManifestRequestSchema,
  childEmbedRequestSchema,
  childModelRequestSchema,
  childReferenceRequestSchema,
  childRequestSchema,
} from '@alloy-works/domain';

import { answerDeliver } from './deliver.js';
import { answerManifest } from './manifest.js';
import { answerEmbed, answerModel } from './model.js';
import { answerReference } from './reference.js';
import { answerRequest } from './work.js';

/**
 * The child's entry (D1-H): one line in - the request, its one opened credential and the guard's
 * ranges - and one line out, then exit; a model call (the G1 plan, G1-C) writes a line an event, the
 * last `ended` or `failed`. It holds no key and inherits no environment. Anything it cannot parse
 * ends it without an answer and without saying what it read, which the supervisor answers
 * `connector_error`.
 */
async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? '';
}

const line = (value: unknown) =>
  new Promise<void>((resolve) =>
    process.stdout.write(`${JSON.stringify(value)}\n`, () => resolve()),
  );

async function main(): Promise<number> {
  let input: unknown;
  try {
    input = JSON.parse(await readInput()) as unknown;
  } catch {
    return 2;
  }
  // An extension's manifest (the EX plan, EX-B): one answer.
  const manifest = childManifestRequestSchema.safeParse(input);
  if (manifest.success) {
    await line(await answerManifest(manifest.data));
    return 0;
  }
  // A reference source asked (the XR plan, XR-B): one answer.
  const reference = childReferenceRequestSchema.safeParse(input);
  if (reference.success) {
    await line(await answerReference(reference.data));
    return 0;
  }
  // A webhook delivery (the WB plan, WB-F): one answer.
  const delivery = childDeliverRequestSchema.safeParse(input);
  if (delivery.success) {
    await line(await answerDeliver(delivery.data));
    return 0;
  }
  // An embedding call (the G7 plan, G7-A): one answer.
  const embed = childEmbedRequestSchema.safeParse(input);
  if (embed.success) {
    await line(await answerEmbed(embed.data));
    return 0;
  }
  const model = childModelRequestSchema.safeParse(input);
  if (model.success) {
    await answerModel(model.data, line);
    return 0;
  }
  const parsed = childRequestSchema.safeParse(input);
  if (!parsed.success) return 2;
  // Its deadline from when the process started, which is as close as it can see to the spawn.
  const answer = await answerRequest(parsed.data, {
    startedAt: Math.floor(performance.timeOrigin),
  });
  await line(answer);
  return 0;
}

process.exit(await main());
