import type {
  CopyAnswer,
  CopyBody,
  CopyParams,
  CopyPreviewAnswer,
} from '@alloy-works/api-contract';
import {
  COPY_MAX,
  copyArtifact,
  previewCopy,
  type CopyCounts,
  type CopyRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, type Authorised } from './access.js';
import { refusedTemplate } from './templates.js';
import { refused } from './wire-codes.js';

/**
 * Whether the caller may make the copy there (the RM plan, RM-F, RM-P): `create`, or `design` for a
 * template, decided in the handler as a move decides its target. A space they may not read is absent.
 */
async function decideTarget(
  trx: TenantTransaction,
  request: FastifyRequest,
  id: string,
  to: string,
): Promise<void> {
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  await authoriseAt(trx, callerOf(request), artifact?.kind === 'template' ? 'design' : 'create', {
    kind: 'space',
    id: to,
  });
}

function refusal(answer: CopyRefusal, facts: Authorised['facts']): Error {
  switch (answer.answer) {
    case 'artifact.missing':
      return notFound();
    case 'space.archived':
      return refused(409, 'space.archived', 'That space is archived.');
    case 'content.invalid':
      return refused(400, 'content.invalid', 'That title cannot be given to a copy.');
    case 'copy.too_large':
      return refused(
        400,
        'copy.too_large',
        `A copy makes at most ${COPY_MAX} components at once: reuse some instead.`,
        { limit: COPY_MAX },
      );
    case 'copy.unreadable':
      return refused(
        400,
        'copy.unreadable',
        'It places a component you may not read, which cannot be copied: reuse it instead.',
        { unreadable: answer.unreadable },
      );
    case 'values.invalid':
      return refused(400, 'values.invalid', 'A value of a component no longer fits its field.', {
        failures: answer.failures,
      });
    default:
      return refusedTemplate(answer, facts);
  }
}

const counted = (answer: CopyCounts) => ({
  kind: answer.kind,
  titleInUse: answer.titleInUse,
  copied: answer.copied,
  reused: answer.reused,
  required: answer.required,
  kept: answer.kept,
  unreadable: answer.unreadable,
  approvedToLatest: answer.approvedToLatest,
  newestShown: answer.newestShown,
  overridesDropped: answer.overridesDropped,
  lines: answer.lines,
  translations: answer.translations,
});

/** The handlers that copy content (the RM plan), `read` on the original already decided. */
export function copyingHandlers() {
  return {
    copyArtifact: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<CopyAnswer> => {
      const { id } = request.params as CopyParams;
      const { to, title, components } = request.body as CopyBody;
      await decideTarget(trx, request, id, to);
      const answer = await copyArtifact(trx, {
        artifactId: id,
        to,
        title,
        components,
        by: principalId,
        scopes: facts.scopes,
      });
      if (answer.answer !== 'copied') throw refusal(answer, facts);
      return {
        id: answer.copy.artifactId,
        version: answer.copy.id,
        ...counted(answer),
        components: answer.components.map((each) => ({ ...each })),
      };
    },

    copyArtifactPreview: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<CopyPreviewAnswer> => {
      const { id } = request.params as CopyParams;
      const { to, title, components } = request.body as CopyBody;
      await decideTarget(trx, request, id, to);
      const answer = await previewCopy(trx, {
        artifactId: id,
        to,
        title,
        components,
        by: principalId,
        scopes: facts.scopes,
      });
      if (answer.answer !== 'previewed') throw refusal(answer, facts);
      return {
        ...counted(answer),
        limit: COPY_MAX,
        consequences: answer.consequences && { ...answer.consequences },
      };
    },
  };
}
