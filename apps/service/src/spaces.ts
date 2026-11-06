import type {
  CreateSpaceBody,
  DefaultTemplateBody,
  SpaceIdParams,
  SpaceParams,
  SpaceView,
  UpdateSpaceBody,
} from '@alloy-works/api-contract';
import {
  archiveSpace,
  createSpace,
  ensureDefaultTemplate,
  readSpace,
  setDefaultTemplate,
  renameSpace,
  restoreSpace,
  setSpaceLanguage,
  type SpaceState,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/** A space as the API shows it. */
function spaceView(space: SpaceState): SpaceView {
  return {
    id: space.id,
    name: space.name,
    archived: space.archivedAt !== null,
    archivedAt: space.archivedAt?.toISOString() ?? null,
    archivedBy: space.archivedBy,
    language: space.language,
    defaultTemplate: space.defaultTemplate,
  };
}

/** A name as the service stores it: composed, then trimmed (SP-B). */
const normalised = (name: string) => name.normalize('NFC').trim();

/**
 * The handlers that change spaces, each run in the transaction `administer` at the tenant was decided
 * in (access.md, "Routes"; SP-A). None changes a fact a decision reads, so none declares
 * `changesAccess`.
 */
export function spaceHandlers() {
  return {
    createSpace: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SpaceView> => {
      const { name } = request.body as CreateSpaceBody;
      const made = await createSpace(trx, normalised(name));
      // Its Blank, made by whoever made the space, so it has a default from the start (TPL-074; ND-N).
      await ensureDefaultTemplate(trx, made.id, principalId);
      const space = await readSpace(trx, made.id);
      if (!space) throw new Error(`Space ${made.id} was made in this transaction and is not there`);
      return spaceView(space);
    },

    updateSpace: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SpaceView> => {
      const { id } = request.params as SpaceIdParams;
      const body = request.body as UpdateSpaceBody;
      let space = await readSpace(trx, id);
      if (!space) throw notFound();
      if (body.name !== undefined) space = await renameSpace(trx, id, normalised(body.name));
      if (body.language !== undefined) space = await setSpaceLanguage(trx, id, body.language);
      if (body.archived === true) space = await archiveSpace(trx, id, principalId);
      if (body.archived === false) space = await restoreSpace(trx, id);
      if (!space) throw notFound();
      return spaceView(space);
    },

    setDefaultTemplate: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<SpaceView> => {
      const { space } = request.params as SpaceParams;
      const { template } = request.body as DefaultTemplateBody;
      const answer = await setDefaultTemplate(trx, space, template);
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'template.unusable') {
        throw refused(409, 'template.unusable', 'That is not one of the templates in this space.');
      }
      const held = await readSpace(trx, space);
      if (!held) throw notFound();
      return spaceView(held);
    },
  };
}
