import { createHash, randomUUID } from 'node:crypto';

import {
  copyPassages,
  embeddedHashes,
  endRun,
  readModelEndpoint,
  recordEmbeddingLag,
  recordGenerationRun,
  startRun,
  storeEmbeddings,
  switchEmbeddingWhenDone,
  takeEmbeddingWork,
  usableModelKey,
  type EmbeddingModel,
  type TenantDatabase,
} from '@alloy-works/db';
import { EMBED_INPUTS_MOST, EMBED_INPUT_CHARS_MOST, modelDeadlineMs } from '@alloy-works/domain';

import type { Embedder } from '../embedder.js';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * **An artifact's embedding** (the G7 plan, G7-F; GEN-044): its latest version's blocks whose words a
 * model lacks a vector for, embedded in batches of at most 96, each batch a run of the version's
 * author, on its document where it is one, counted in the budget; then a passage for each of its
 * blocks. A model's endpoint retired or without a key embeds nothing for it. A failed call ends its
 * run with its code and fails the attempt, which the queue retries.
 */
export function embedJob(deps: {
  readonly db: TenantDatabase;
  readonly embedder: Embedder | undefined;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const artifact = job.subjectId;
      // Off the queue first, so a refused job leaves it free to be queued again (the final review).
      const work = await deps.db.withTenant(tenant, (trx) => takeEmbeddingWork(trx, artifact));
      if (!deps.embedder) {
        throw new JobRefused('embedding_unconfigured', 'This worker has no way to the connector.');
      }
      const embed = deps.embedder;
      if (work.texts.length === 0 || work.models.length === 0) return;
      const done: EmbeddingModel[] = [];
      for (const model of work.models) {
        const held = await deps.db.withTenant(tenant, (trx) =>
          embeddedHashes(
            trx,
            model.model,
            work.texts.map((each) => each.hash),
          ),
        );
        const missing = work.texts.filter((each) => !held.has(each.hash));
        const endpoint = await deps.db.withTenant(tenant, async (trx) => {
          const found = await readModelEndpoint(trx, model.endpointId);
          const sealed =
            found && found.retiredAt === null ? await usableModelKey(trx, found) : undefined;
          return found && sealed !== undefined ? { found, sealed } : undefined;
        });
        if (!endpoint) continue;
        for (let at = 0; at < missing.length; at += EMBED_INPUTS_MOST) {
          const batch = missing.slice(at, at + EMBED_INPUTS_MOST);
          const inputs = batch.map((each) => each.text.slice(0, EMBED_INPUT_CHARS_MOST));
          const run = await deps.db.withTenant(tenant, (trx) =>
            startRun(trx, {
              purpose: 'embedding',
              endpoint: endpoint.found,
              parameters: { inputs: inputs.length, model: model.model },
              contextDigest: sha256(batch.map((each) => each.hash).join('\n')),
              by: work.author,
              documentId: work.documentId,
            }),
          );
          const answer = await embed({
            requestId: randomUUID(),
            tenant: tenant.id,
            endpoint: {
              id: endpoint.found.id,
              protocol: endpoint.found.protocol,
              baseUrl: endpoint.found.baseUrl,
            },
            sealed: endpoint.sealed,
            call: { model: model.model, inputs },
            deadlineMs: modelDeadlineMs(endpoint.found),
          });
          // A vector of other dimensions than the model serves is the model's mismatch, kept nowhere.
          const fits =
            answer.type === 'embedded' &&
            answer.vectors.length === batch.length &&
            answer.vectors.every((vector) => vector.length === model.dims);
          await deps.db.withTenant(tenant, async (trx) => {
            if (fits && answer.type === 'embedded') {
              await storeEmbeddings(
                trx,
                batch.map((each, index) => ({
                  textHash: each.hash,
                  model: model.model,
                  modelVersion: answer.model,
                  dims: model.dims,
                  vector: answer.vectors[index]!,
                })),
              );
            }
            const ended = await endRun(
              trx,
              run,
              fits && answer.type === 'embedded'
                ? {
                    outcome: 'finished',
                    model: answer.model,
                    usage: answer.usage ? { in: answer.usage.in, out: 0 } : null,
                  }
                : {
                    outcome: answer.type === 'failed' ? answer.failure.code : 'model_mismatch',
                  },
            );
            await recordGenerationRun(trx, ended);
          });
          if (!fits) {
            throw new Error(
              `embedding failed: ${answer.type === 'failed' ? answer.failure.code : 'model_mismatch'}`,
            );
          }
        }
        done.push(model);
      }
      await deps.db.withTenant(tenant, async (trx) => {
        await copyPassages(trx, work.entries, done);
        // Its lag, before a switch: nothing is measured while a model is pending (the FR plan, FR-E).
        await recordEmbeddingLag(trx, artifact);
        // A confirmed model serves once every latest text has its vector (G7-J).
        await switchEmbeddingWhenDone(trx);
      });
    },
    async failed() {
      // Nothing to undo: what was embedded is kept, and the artifact's next version queues again.
    },
  };
}
