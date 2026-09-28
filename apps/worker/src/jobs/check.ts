import { createHash } from 'node:crypto';
import {
  MAX_FAILED_RULES,
  publicationToCheck,
  recordPublicationCheck,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import type { Checker } from '../verapdf.js';
import type { JobHandler } from '../worker.js';

/** The profile a PDF is checked against: veraPDF's name for PDF/UA-1, which the store calls `ua1`. */
export const PDF_UA_1_PROFILE = 'PDF/UA-1 validation profile';

/** The check could not happen - the bytes were not the PDF, or veraPDF checked something else. */
class CheckFailed extends Error {
  readonly code = 'check_failed';
}

/** The type veraPDF's whole report is kept as: its JSON, as it wrote it. */
export const REPORT_CONTENT_TYPE = 'application/json';

/**
 * `check_pdf` (W14.1, W-B): a recorded publication's PDF checked by veraPDF against PDF/UA-1, and what
 * it found kept beside the publication in `publication_check` (W-C; PUB-091): veraPDF's whole report in
 * the tenant's store by its hash, as the PDF is kept, and a summary of it for the page. Queued by
 * `recordPublication` in the transaction that records the publication, so a worker that dies once the
 * record commits leaves it queued, and the next worker takes it (ADR-0030: the report joins the
 * publication after it is recorded).
 *
 * A PDF that fails is a check done, recorded as not compliant with each rule it failed. A check that
 * could not happen - veraPDF would not start or answer, the store would not give the bytes - throws,
 * and the queue tries it again. Run twice for one publication, the second run finds it checked and
 * asks veraPDF nothing. A publication with no PDF has nothing to check, which will not change.
 */
export function checkJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly checker: Checker;
}): JobHandler {
  return {
    async run(tenant, job) {
      const publication = job.subjectId;
      if (publication === null) {
        throw new JobRefused('nothing_to_check', 'A check names the publication it checks.');
      }
      const found = await deps.db.withTenant(tenant, async (trx) => {
        const pdf = await publicationToCheck(trx, publication);
        if (pdf === undefined || pdf === 'checked') return pdf;
        return { ...pdf, store: await deps.stores.forTenant(trx, tenant) };
      });
      if (found === 'checked') return;
      if (found === undefined) {
        throw new JobRefused('nothing_to_check', 'The publication has no PDF to check.');
      }
      // The bytes the publication recorded, and no others: held to their digest before veraPDF sees
      // them, as a publish holds an image it reads back.
      const pdf = await found.store.get(found.key);
      if (createHash('sha256').update(pdf).digest('hex') !== found.sha256) {
        throw new CheckFailed(
          'The store answered other bytes than the PDF the publication recorded.',
        );
      }
      const verdict = await deps.checker.check(pdf);
      if (verdict.profile !== PDF_UA_1_PROFILE) {
        throw new CheckFailed(`veraPDF checked against ${verdict.profile}, not PDF/UA-1.`);
      }
      // The report is kept before the row names it, so no row names bytes the store lacks. A run that
      // fails between the two leaves a report in the store that nothing names, which is the lesser
      // mistake: the next run keeps its own, and its row names that one.
      const kept = await found.store.put(Buffer.from(verdict.report, 'utf8'), REPORT_CONTENT_TYPE);
      await deps.db.withTenant(tenant, (trx) =>
        recordPublicationCheck(trx, {
          publicationId: publication,
          checkerVersion: verdict.version,
          compliant: verdict.compliant,
          // PDF/UA-1's profile has fewer rules than the bound, so this keeps every one.
          failedRules: verdict.rules.slice(0, MAX_FAILED_RULES),
          report: { key: kept.key, sha256: kept.sha256, bytes: kept.size },
        }),
      );
    },

    /**
     * Nothing to write: a check that never happened leaves the publication as it was, which its page
     * says is not yet checked.
     */
    async failed() {},
  };
}
