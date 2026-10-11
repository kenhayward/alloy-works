import {
  auditExportBody,
  failAuditExport,
  finishAuditExport,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { JobHandler } from '../worker.js';

/**
 * **An export of the audit log written** (ADM-039, LIF-028; the AU2 plan, AU-N): every event its
 * filters match as of the snapshot it was asked in, as JSON Lines, kept in the tenant's own store and
 * recorded on its row. Writing it records nothing: asking for it was the event, and each download is.
 */
export function auditExportJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const body = await auditExportBody(deps.db, tenant, job.subjectId);
      // Nothing to do: another attempt already finished it.
      if (!body) return;
      const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
      const kept = await store.put(Buffer.from(body.bytes), 'application/x-ndjson');
      await deps.db.withTenant(tenant, (trx) =>
        finishAuditExport(trx, job.subjectId!, kept, body.events),
      );
    },

    async failed(tenant, job) {
      if (job.subjectId === null) return;
      await deps.db.withTenant(tenant, (trx) => failAuditExport(trx, job.subjectId!));
    },
  };
}
