import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  RESTORATION_MAX_BYTES,
  type TenantRestorationAnswers,
  type TenantRestorationList,
  type TenantRestorationParams,
  type TenantRestorationView,
  type RestoreReview,
} from '@alloy-works/api-contract';
import {
  answerRestoration,
  beginRestoration,
  createRestoration,
  endRestoreReview,
  listRestorations,
  readRestoration,
  receiveRestorationArchive,
  recordEvent,
  restoreReview,
  type TenantRestoration,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AfterCommit } from './after-commit.js';
import { contextOf } from './audit.js';
import { AppError, storageUnavailable } from './errors.js';

/**
 * **Restoring an environment** (the EI plan, EIc): what the service does is keep the archive and the
 * answers. The check and the apply are the `restorer` process's, the one that may become the owner.
 */

const notWaiting = () =>
  new AppError(
    409,
    'restoration_not_previewed',
    'This restoration is not waiting for its answers.',
  );
const tooLarge = () =>
  new AppError(413, 'archive_too_large', 'An archive to restore may be up to 5 GiB.');

async function viewOf(
  trx: TenantTransaction,
  made: TenantRestoration,
): Promise<TenantRestorationView> {
  const rows = await trx
    .selectFrom('identity_provider')
    .select('issuer')
    .orderBy('issuer')
    .execute();
  return {
    id: made.id,
    state: made.state,
    requestedAt: made.requestedAt.toISOString(),
    finishedAt: made.finishedAt?.toISOString() ?? null,
    plan: made.plan as TenantRestorationView['plan'],
    answers: made.answers as TenantRestorationView['answers'],
    refusal: made.refusal,
    providers: rows.map((row) => row.issuer),
  };
}

/** Every provider and every secret the plan names, answered, and each answer naming something real. */
const answersMeetPlan = (
  plan: NonNullable<TenantRestoration['plan']>,
  answers: TenantRestorationAnswers,
  providers: readonly string[],
) => {
  const secrets = new Set(answers.switchedOff);
  return (
    plan.issuers.every(({ issuer }) => issuer in answers.issuers) &&
    Object.values(answers.issuers).every((to) => to === null || providers.includes(to)) &&
    plan.secrets.every(({ reference }) => secrets.has(reference))
  );
};

const reviewView = (found: Awaited<ReturnType<typeof restoreReview>>): RestoreReview => ({
  restoredAt: found?.restoredAt?.toISOString() ?? null,
  underReview: found?.underReview ?? false,
  datesPast: found?.datesPast ?? 0,
  reviewDatesPast: found?.reviewDatesPast ?? 0,
});

export function restorationHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  const held = async (trx: TenantTransaction, request: FastifyRequest) => {
    const { id } = request.params as TenantRestorationParams;
    const found = await readRestoration(trx, id);
    if (!found) throw notFound();
    return found;
  };
  return {
    createTenantRestoration: async (
      _request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TenantRestorationView> => viewOf(trx, await createRestoration(trx, principalId)),

    listTenantRestorations: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantRestorationList> => {
      const items = await listRestorations(trx);
      return { items: await Promise.all(items.map((each) => viewOf(trx, each))) };
    },

    getTenantRestoration: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantRestorationView> => viewOf(trx, await held(trx, request)),

    /**
     * Decided first, and only then read: the body is an unread stream here, so nobody without the
     * permission puts a byte on this disk, and no transaction stays open for as long as it takes.
     */
    sendTenantRestorationArchive: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<AfterCommit<TenantRestorationView>> => {
      const found = await held(trx, request);
      if (found.state !== 'awaiting_archive') {
        throw new AppError(409, 'restoration_filled', 'This restoration already has its archive.');
      }
      if (!objects) throw storageUnavailable();
      if (Number(request.headers['content-length'] ?? 0) > RESTORATION_MAX_BYTES) throw tooLarge();
      const body = request.body;
      if (!(body instanceof Readable)) {
        throw new AppError(400, 'archive_expected', 'Send the archive as application/x-tar.');
      }
      const tenant = tenantOf(request);
      return new AfterCommit(async () => {
        const folder = await mkdtemp(join(tmpdir(), 'aw-archive-'));
        try {
          const path = join(folder, 'archive.tar');
          let bytes = 0;
          await pipeline(
            body,
            new Transform({
              transform(chunk: Buffer, _encoding, done) {
                bytes += chunk.length;
                done(bytes > RESTORATION_MAX_BYTES ? tooLarge() : null, chunk);
              },
            }),
            createWriteStream(path),
          );
          const store = await db.withTenant(tenant, (inner) => objects.forTenant(inner, tenant));
          const stored = await store.putFile(path, 'application/x-tar');
          return await db.withTenant(
            tenant,
            async (inner) => {
              const received = await receiveRestorationArchive(inner, found.id, stored);
              if (!received) {
                throw new AppError(
                  409,
                  'restoration_filled',
                  'This restoration already has its archive.',
                );
              }
              return viewOf(inner, received);
            },
            contextOf(request),
          );
        } finally {
          await rm(folder, { recursive: true, force: true });
        }
      });
    },

    answerTenantRestoration: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantRestorationView> => {
      const found = await held(trx, request);
      if (found.state !== 'previewed' || !found.plan) throw notWaiting();
      const answers = request.body as TenantRestorationAnswers;
      const providers = await trx.selectFrom('identity_provider').select('issuer').execute();
      if (
        !answersMeetPlan(
          found.plan,
          answers,
          providers.map((row) => row.issuer),
        )
      ) {
        throw new AppError(
          400,
          'restoration_answer_invalid',
          'Answer for every provider and every secret, naming a provider this environment has.',
        );
      }
      const answered = await answerRestoration(trx, found.id, answers);
      if (!answered) throw notWaiting();
      return viewOf(trx, answered);
    },

    applyTenantRestoration: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantRestorationView> => {
      const found = await held(trx, request);
      if (found.state !== 'previewed' || !found.plan) throw notWaiting();
      if (!found.answers) {
        throw new AppError(
          409,
          'restoration_unanswered',
          'Answer for every provider and secret first.',
        );
      }
      const begun = await beginRestoration(trx, found.id);
      if (!begun) throw notWaiting();
      return viewOf(trx, begun);
    },

    getRestoreReview: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<RestoreReview> => reviewView(await restoreReview(trx)),

    endRestoreReview: async (
      _request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<RestoreReview> => {
      const restoration = await endRestoreReview(trx, principalId);
      if (restoration !== undefined) {
        await recordEvent(trx, {
          kind: 'import.review_ended',
          subject: { kind: 'restoration', id: restoration },
          detail: { restoration },
        });
      }
      return reviewView(await restoreReview(trx));
    },
  };
}
