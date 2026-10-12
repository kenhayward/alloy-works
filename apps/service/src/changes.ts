import type { ChangesQuery, ChangesView } from '@alloy-works/api-contract';
import { changesSince, latestVersion, type Tenant, type TenantDatabase } from '@alloy-works/db';
import { readOutline, walkOutline } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf } from './access.js';

/**
 * What changed since (SCH-025, SCH-048; the CP plan, CP-I): in a document - itself and every component
 * its latest outline places - a space, or a set of results a caller already holds, as the caller may
 * read each. A document or a space they may not read is answered as none, as everywhere.
 */
export function changesHandlers(db: TenantDatabase, tenantOf: (request: FastifyRequest) => Tenant) {
  return {
    listChangesSince: async (request: FastifyRequest): Promise<ChangesView> => {
      const query = request.query as ChangesQuery;
      const caller = callerOf(request);
      const since = new Date(query.since);
      const answer = await db.withTenant(tenantOf(request), async (trx) => {
        if (query.space !== undefined) {
          await authoriseAt(trx, caller, 'read', { kind: 'space', id: query.space });
          return changesSince(trx, { since, reader: caller.principalId, space: query.space });
        }
        if (query.document !== undefined) {
          await authoriseAt(trx, caller, 'read', { kind: 'artifact', id: query.document });
          const version = await latestVersion(trx, query.document);
          const placed: string[] = [query.document];
          if (version?.kind === 'document') {
            const read = readOutline(version.content, {
              artifact: query.document,
              version: version.id,
            });
            if (read.ok) {
              walkOutline(read.outline.nodes, (node) => {
                if (node.type === 'reference') placed.push(node.component);
              });
            }
          }
          return changesSince(trx, {
            since,
            reader: caller.principalId,
            artifacts: [...new Set(placed)],
          });
        }
        return changesSince(trx, {
          since,
          reader: caller.principalId,
          artifacts: (query.ids ?? '').split(','),
        });
      });
      return {
        since: since.toISOString(),
        recordBegins: answer.recordBegins?.toISOString() ?? null,
        fromRecordStart: answer.fromRecordStart,
        more: answer.more,
        artifacts: answer.artifacts.map((each) => ({
          ...each,
          latest: { ...each.latest, at: each.latest.at.toISOString() },
        })),
        values: answer.values.map((each) => ({ ...each, at: each.at.toISOString() })),
      };
    },
  };
}
