import type {
  TemplateMoveBody,
  TemplateMoved,
  TemplateMovePreview,
  TemplateMoveQuery,
} from '@alloy-works/api-contract';
import {
  documentTemplate,
  loadFacts,
  moveDocumentTemplate,
  previewTemplateMove,
  type MoveRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type MoveReport } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/**
 * Moving a document to its template's newest version (templates.md; the WF6 plan, WF6-C, WF6-D):
 * decided on `edit` by the route, and on reading the template here, since the move reads it.
 */

/** Whether the caller may read the template the document is bound to; a blank one has none. */
async function readsTemplate(
  trx: TenantTransaction,
  principalId: string,
  documentId: string,
): Promise<boolean> {
  const link = await documentTemplate(trx, documentId);
  if (!link) return true;
  const facts = await loadFacts(trx, principalId, { kind: 'artifact', id: link.template });
  return facts !== undefined && decide('read', facts).allowed;
}

function refusal(answer: MoveRefusal): never {
  switch (answer.answer) {
    case 'document.missing':
      throw notFound();
    case 'template.none':
      throw refused(409, 'template.none', 'This document was made blank: it has no template.');
    case 'template.current':
      throw refused(409, 'template.current', "It is at its template's newest version already.");
    case 'template.not_latest':
      throw refused(
        409,
        'template.not_latest',
        "A document moves only to its template's newest version.",
        { latest: answer.latest },
      );
    case 'template.unresolved':
      throw refused(
        400,
        'template.unresolved',
        "The template's newest version names something that does not resolve.",
        { unresolved: answer.unresolved },
      );
    case 'artifact.archived':
      throw refused(409, 'artifact.archived', 'It is archived, and moves once unarchived.');
  }
}

const reportView = (report: MoveReport) => ({
  theme: report.theme,
  layout: report.layout,
  fields: [...report.fields],
  notCarried: [...report.notCarried],
  missing: [...report.missing],
});

export function templateMoveHandlers() {
  return {
    previewTemplateMove: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TemplateMovePreview> => {
      const { id } = request.params as { id: string };
      const { to } = request.query as TemplateMoveQuery;
      if (!(await readsTemplate(trx, principalId, id))) throw notFound();
      const answer = await previewTemplateMove(trx, { documentId: id, to });
      if (answer.answer !== 'previewed') return refusal(answer);
      return {
        template: answer.template,
        from: answer.from,
        to: answer.to,
        latest: answer.latest,
        report: reportView(answer.report),
      };
    },
    moveDocumentTemplate: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TemplateMoved> => {
      const { id } = request.params as { id: string };
      const body = request.body as TemplateMoveBody;
      if (!(await readsTemplate(trx, principalId, id))) throw notFound();
      const answer = await moveDocumentTemplate(trx, {
        documentId: id,
        latest: body.latest,
        to: body.to,
        by: principalId,
      });
      if (answer.answer === 'version.precondition') {
        throw refused(
          409,
          'version.precondition',
          'The document has a newer version. Read it first.',
          { current: answer.current },
        );
      }
      if (answer.answer !== 'moved') return refusal(answer);
      return {
        version: {
          id: answer.version.id,
          number: `${answer.version.revision}.${answer.version.version}`,
        },
        report: reportView(answer.report),
      };
    },
  };
}
