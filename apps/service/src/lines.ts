import type { LineBody, LinesView, LineView, TransitionParams } from '@alloy-works/api-contract';
import { diverge, readLines, type Line } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/** Divergent lines (storage-and-versioning.md, "Lines"; the R16 plan, R16-B). */

export const lineView = (line: Line): LineView => ({
  id: line.id,
  name: line.name,
  divergedFrom: { ...line.divergedFrom },
  at: line.at.toISOString(),
  closed: line.closed,
});

/** `POST /v1/components/{id}/lines`, decided on `edit` by the route. */
export function lineHandlers() {
  return {
    listComponentLines: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<LinesView> => {
      const { id } = request.params as TransitionParams;
      return { lines: (await readLines(trx, id)).map(lineView) };
    },
    divergeComponent: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<LineView> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as LineBody;
      const answer = await diverge(trx, {
        artifactId: id,
        revision: body.revision,
        name: body.name,
        by: principalId,
      });
      switch (answer.answer) {
        case 'artifact.missing':
        case 'revision.missing':
          throw notFound();
        case 'line.name_taken':
          throw refused(409, 'line.name_taken', 'Another line of it has that name.');
        case 'diverged':
          return lineView(answer.line);
      }
    },
  };
}
