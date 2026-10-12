import type {
  RestorationView,
  RestoreAnswer,
  RestoreBody,
  RestoreParams,
} from '@alloy-works/api-contract';
import {
  latestVersion,
  previewRestore,
  restoreVersion,
  type RestoreRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import type { NotCarried } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A refusal as the preview lists it: its wire code and what the author needs to act on. */
function refusalView(refusal: RestoreRefusal): RestorationView['refusals'][number] {
  switch (refusal.answer) {
    case 'restore.locked':
      return {
        code: 'restore_locked',
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
      };
    case 'values.invalid':
      return {
        code: 'values_invalid',
        failures: refusal.failures.map((each) => ({ ...each, schemas: [...each.schemas] })),
      };
    case 'restore.unreadable':
      return { code: 'restore_unreadable' };
    case 'restore.unchanged':
      return { code: 'restore_unchanged' };
  }
}

/** The same refusal, refusing the write. */
function refuse(refusal: RestoreRefusal): AppError {
  switch (refusal.answer) {
    case 'restore.locked':
      return refused(409, 'restore.locked', 'This component is being edited. Done editing first.', {
        holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
        expectedRelease: refusal.lock.expiresAt.toISOString(),
      });
    case 'values.invalid':
      return refused(400, 'values.invalid', 'A value does not fit its field.', {
        failures: refusal.failures,
      });
    case 'restore.unreadable':
      return refused(409, 'restore.unreadable', 'This version can no longer be read.');
    case 'restore.unchanged':
      return refused(409, 'restore.unchanged', 'The latest version already holds this.');
  }
}

/** Each value not carried, with its field's name now where one is held. */
async function notCarriedView(trx: TenantTransaction, notCarried: readonly NotCarried[]) {
  return Promise.all(
    notCarried.map(async ({ field, value }) => {
      const definition = await latestVersion(trx, field);
      const name = (definition?.content as { name?: unknown } | undefined)?.name;
      return { field, name: typeof name === 'string' ? name : null, value };
    }),
  );
}

/**
 * Restoring a component's earlier version (the RS plan, Task 1): both decided on `edit`, which
 * `authorise` decides beside `read` (RS-A). The preview and the write share one resolver (VER-035).
 */
export function restoreHandlers() {
  return {
    previewRestore: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<RestorationView> => {
      const { id, version } = request.params as RestoreParams;
      const restoration = await previewRestore(trx, { artifactId: id, version });
      if (!restoration) throw notFound();
      return {
        component: id,
        from: versionView(restoration.source),
        latest: versionView(restoration.latest),
        notCarried: await notCarriedView(trx, restoration.notCarried),
        refusals: restoration.refusals.map(refusalView),
      };
    },

    restoreVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<RestoreAnswer> => {
      const { id, version } = request.params as RestoreParams;
      const { latest } = request.body as RestoreBody;
      const answer = await restoreVersion(trx, {
        artifactId: id,
        version,
        latest,
        by: principalId,
      });
      switch (answer.answer) {
        case 'restored':
          return { version: versionView(answer.version) };
        case 'artifact.missing':
          throw notFound();
        case 'version.precondition':
          throw refused(
            409,
            'version.precondition',
            'This component has a newer version than the one this restore was previewed against.',
            { current: versionView(answer.current) },
          );
        default:
          throw refuse(answer);
      }
    },
  };
}
