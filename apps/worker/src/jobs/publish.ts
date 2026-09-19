import { createHash } from 'node:crypto';
import {
  failPublicationRequest,
  publicationInputs,
  recordPublication,
  type TenantDatabase,
} from '@alloy-works/db';
import { assemble, defaultNumberingScheme, type PublishFailure } from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import { PINNED_FONT_FILES, type PinnedFonts } from '../fonts.js';
import { JobRefused } from '../refusal.js';
import { PUBLICATION_TEMPLATE } from '../template.js';
import type { Typst } from '../typst.js';
import type { JobHandler } from '../worker.js';

/**
 * The pipeline's own version (PUB-063): `assemble` and this job, as one, and the draft notice
 * `assemble` carries into every page - words the template's hash does not cover, because they are
 * the data's. Raised with any of them; `template.test.ts` holds what each version's `assemble` makes
 * of one fixed input, notice included.
 */
export const PIPELINE_VERSION = '1';

/** The document's own failures, every one at once: the job is finished, never tried again. */
export class PublishRefused extends JobRefused {
  constructor(readonly failures: readonly PublishFailure[]) {
    super('publish_refused', 'The document cannot be published as it stands.');
  }
}

/** The store would not take the output, or the database its record. Worth another attempt. */
class StoreFailed extends Error {
  readonly code = 'store_failed';
}

/**
 * The platform's failure, as the request records it: its stage and nothing an author could act on -
 * no node, no block, no detail - so a face changed under a running worker, a crash or a lost
 * connection never reads as something wrong with the document.
 */
const platformFailure = (stage: 'engine' | 'store'): PublishFailure => ({
  stage,
  code: stage === 'store' ? 'store_failed' : 'engine_failed',
  node: null,
  block: null,
  detail: null,
});

/**
 * One publish: the recorded inputs through `assemble`, the published document through the pinned
 * Typst and the fixed template, the PDF into the tenant's store by its hash, and the publication
 * recorded whole (docs/design/publishing.md, "The request and the job"). The worker decides nothing:
 * the request recorded, as its publisher, which version each occurrence takes and which it could not
 * read, and this reads exactly those.
 */
export function publishJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly typst: Typst;
  readonly fonts: PinnedFonts;
}): JobHandler {
  return {
    async run(tenant, job) {
      // Nothing enqueues a publish job without a subject; a row that did would otherwise match no
      // request and complete silently as `done`, with no publication and no record of the attempt.
      if (!job.subjectId) throw new JobRefused('no_subject', 'A publish job must name a request.');
      const read = await deps.db.withTenant(tenant, async (trx) => ({
        inputs: await publicationInputs(trx, job.subjectId!),
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: finished by another attempt.
      if (!read.inputs) return;
      const { request, outline, occurrences, refused } = read.inputs;

      const assembled = assemble({
        outline,
        occurrences: new Map([...occurrences].map(([node, each]) => [node, each.content])),
        refused,
        scheme: defaultNumberingScheme,
        covers: deps.fonts.covers,
      });
      if (!assembled.ok) throw new PublishRefused(assembled.failures);

      // The digest is of the bytes Typst reads, so a reproduction can tell input from engine.
      const data = JSON.stringify(assembled.document);
      const pdf = await deps.typst.compile(PUBLICATION_TEMPLATE.file, data, request.requestedAt);
      const engineVersion = await deps.typst.version();
      let stored;
      try {
        stored = await read.store.put(pdf, 'application/pdf');
      } catch (error) {
        throw new StoreFailed('The store did not take the publication.', { cause: error });
      }
      // Its own transaction: a record that fails ends it, rolled back whole, and the request is failed
      // - after the last attempt - in a fresh one by `failed`, never in the one that caught the error.
      // The PDF was made, so a record the database refuses is the store stage's, like a refused put:
      // the object stays behind, keyed by its hash, and nothing refers to it.
      await deps.db
        .withTenant(tenant, (trx) =>
          recordPublication(trx, {
            requestId: request.id,
            engineVersion,
            templateVersion: PUBLICATION_TEMPLATE.version,
            pipelineVersion: PIPELINE_VERSION,
            // `compile` re-hashed the faces against these very pins before Typst ran.
            fonts: PINNED_FONT_FILES.map(({ file, sha256 }) => ({ file, sha256 })),
            dataSha256: createHash('sha256').update(data).digest('hex'),
            numbering: assembled.numbering,
            output: { key: stored.key, sha256: stored.sha256, bytes: stored.size },
          }),
        )
        .catch((error: unknown) => {
          throw new StoreFailed('The publication could not be recorded.', { cause: error });
        });
    },

    /**
     * The request fails with the document's own list, or - after the last attempt, or when a worker
     * never came back - with the platform's stage and nothing an author could act on.
     */
    async failed(tenant, job, cause) {
      if (!job.subjectId) return;
      const failures: readonly PublishFailure[] =
        cause instanceof PublishRefused
          ? cause.failures
          : [platformFailure(cause instanceof StoreFailed ? 'store' : 'engine')];
      await deps.db.withTenant(tenant, (trx) =>
        failPublicationRequest(trx, job.subjectId!, failures),
      );
    },
  };
}
