import type { TenantDatabase } from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { Typst } from '../typst.js';
import type { JobHandler } from '../worker.js';

/**
 * The sample: the environment's own name rendered through the fixed template, kept in that tenant's
 * store, and recorded on the row that asked for it. Every read and write is inside `withTenant`.
 */
export function sampleJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly typst: Typst;
}): JobHandler {
  return {
    async run(tenant, job) {
      const found = await deps.db.withTenant(tenant, async (trx) => ({
        sample: await trx
          .selectFrom('sample')
          .select(['id', 'state', 'requested_at'])
          .where('id', '=', job.subjectId)
          .executeTakeFirst(),
        environment: (
          await trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow()
        ).display_name,
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: the sample was withdrawn, or another attempt already finished it.
      if (!found.sample || found.sample.state !== 'queued') return;

      const pdf = await deps.typst.render(
        { environment: found.environment, requestedAt: found.sample.requested_at.toISOString() },
        found.sample.requested_at,
      );
      const stored = await found.store.put(pdf, 'application/pdf');
      const engine = await deps.typst.version();
      await deps.db.withTenant(tenant, (trx) =>
        trx
          .updateTable('sample')
          .set({
            state: 'done',
            object_key: stored.key,
            sha256: stored.sha256,
            bytes: stored.size,
            engine,
            finished_at: new Date(),
          })
          .where('id', '=', found.sample!.id)
          .where('state', '=', 'queued')
          .execute(),
      );
    },

    async failed(tenant, job) {
      await deps.db.withTenant(tenant, (trx) =>
        trx
          .updateTable('sample')
          .set({ state: 'failed', finished_at: new Date() })
          .where('id', '=', job.subjectId)
          .where('state', '=', 'queued')
          .execute(),
      );
    },
  };
}
