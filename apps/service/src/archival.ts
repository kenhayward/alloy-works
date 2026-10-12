import type { ArchivalParams, ArchivalView } from '@alloy-works/api-contract';
import { archiveArtifact, unarchiveArtifact, type TenantTransaction } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';

/**
 * Archiving and unarchiving (lifecycle.md; the AH plan, Task 1), each decided on `retire`, which
 * `authorise` decides beside `read`. Each route its own kind: anything else at its address is absent.
 */
export function archivalHandlers() {
  const acting =
    (kind: 'component' | 'document', archived: boolean) =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<ArchivalView> => {
      const { id } = request.params as ArchivalParams;
      if ((await kindOf(trx, id)) !== kind) throw notFound();
      const act = archived ? archiveArtifact : unarchiveArtifact;
      if (!(await act(trx, id, principalId))) throw notFound();
      return { archived };
    };
  return {
    archiveComponent: acting('component', true),
    unarchiveComponent: acting('component', false),
    archiveDocument: acting('document', true),
    unarchiveDocument: acting('document', false),
  };
}

async function kindOf(trx: TenantTransaction, id: string): Promise<string | undefined> {
  const row = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.kind;
}
