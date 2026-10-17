import type {
  LineBody,
  LineComparisonView,
  LineParams,
  LineReturnBody,
  LineReturnView,
  LinesView,
  LineView,
  TransitionParams,
} from '@alloy-works/api-contract';
import {
  bringLineBack,
  compareLines,
  diverge,
  readLines,
  readVersion,
  type Line,
} from '@alloy-works/db';
import { parseContentDocument } from '@alloy-works/domain';
import { shownVersionView } from './components.js';
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
    compareComponentLine: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<LineComparisonView> => {
      const { id, line } = request.params as LineParams;
      const compared = await compareLines(trx, id, line);
      if (!compared) throw notFound();
      const main = (await readVersion(trx, compared.main))!;
      const head = (await readVersion(trx, compared.line))!;
      const blocks = (version: typeof main) =>
        new Map(parseContentDocument(version.content).content.map((each) => [each.id, each]));
      const ours = blocks(main);
      const theirs = blocks(head);
      return {
        main: { id: main.id, number: (await shownVersionView(trx, main)).number },
        line: { id: head.id, number: (await shownVersionView(trx, head)).number },
        differences: compared.differences.map((each) => ({
          ...each,
          mainBlock: (ours.get(each.block) as Record<string, unknown> | undefined) ?? null,
          lineBlock: (theirs.get(each.block) as Record<string, unknown> | undefined) ?? null,
        })),
      };
    },
    bringComponentLineBack: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<LineReturnView> => {
      const { id, line } = request.params as LineParams;
      const body = request.body as LineReturnBody;
      const answer = await bringLineBack(trx, {
        artifactId: id,
        line,
        openedFrom: body.openedFrom,
        lineHead: body.lineHead,
        carry: body.carry,
        by: principalId,
      });
      switch (answer.answer) {
        case 'line.missing':
          throw notFound();
        case 'line.closed':
          throw refused(409, 'line.closed', 'It was brought back already.');
        case 'lock.held':
          throw refused(
            409,
            'lock.held',
            'Somebody is editing it: bring the line back once they are done.',
          );
        case 'carry.invalid':
          throw refused(400, 'carry.invalid', 'A block carried is not one that differs.');
        case 'version.precondition':
          throw refused(
            409,
            'version.precondition',
            'A line moved since the comparison: compare them again.',
          );
        case 'returned':
          return {
            version: {
              id: answer.version.id,
              number: (await shownVersionView(trx, answer.version)).number,
            },
            carried: answer.carried.map((each) => ({ ...each })),
            left: answer.left.map((each) => ({ ...each })),
          };
      }
    },
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
