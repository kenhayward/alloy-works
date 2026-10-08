import type {
  CreateSpaceBody,
  SpaceIdParams,
  SpaceView,
  UpdateSpaceBody,
} from '@alloy-works/api-contract';
import {
  archiveSpace,
  createSpace,
  readSpace,
  renameSpace,
  restoreSpace,
  SpaceArchived,
  SpaceRefused,
  type SpaceRefusal,
  type SpaceState,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A space as the API shows it. */
function spaceView(space: SpaceState): SpaceView {
  return {
    id: space.id,
    name: space.name,
    archived: space.archivedAt !== null,
    archivedAt: space.archivedAt?.toISOString() ?? null,
    archivedBy: space.archivedBy,
  };
}

/** What each refusal says, for a person administering spaces. */
const REFUSALS: Readonly<Record<SpaceRefusal, readonly [number, string]>> = {
  'space.name_invalid': [400, 'A space name is 1 to 200 characters, with no control characters.'],
  'space.name_taken': [409, 'There is already a space with that name, perhaps an archived one.'],
  'space.last': [409, 'This is the last space not archived, so it cannot be archived.'],
};

/**
 * A space's own refusal, or a creation in an archived space (the SP1 plan, SP-C), as the wire says it;
 * undefined for anything else. The error handler asks this of every failure, so each route that makes
 * an artifact answers `409 space_archived` without having to remember to.
 */
export function spaceRefusal(error: unknown): AppError | undefined {
  if (error instanceof SpaceArchived) {
    return refused(
      409,
      'space.archived',
      'This space is archived, so nothing new can be made in it. Restore it first.',
    );
  }
  if (error instanceof SpaceRefused) {
    const [status, message] = REFUSALS[error.refusal];
    return refused(status, error.refusal, message);
  }
  return undefined;
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
    createSpace: async (request: FastifyRequest, { trx }: Authorised): Promise<SpaceView> => {
      const { name } = request.body as CreateSpaceBody;
      const made = await createSpace(trx, normalised(name));
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
      if (body.archived === true) space = await archiveSpace(trx, id, principalId);
      if (body.archived === false) space = await restoreSpace(trx, id);
      if (!space) throw notFound();
      return spaceView(space);
    },
  };
}
