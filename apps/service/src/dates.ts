import type { DatesBody, DatesView, TransitionParams } from '@alloy-works/api-contract';
import {
  datesStored,
  dayOf,
  loadFactsFor,
  localIso,
  readDates,
  readLocalInstant,
  setDates,
  type ArtifactDates,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/**
 * Dates (workflow.md; the WF5 plan, WF5-A, WF5-H): a component's or document's effective and review-by
 * dates and its review's owner, set on `edit` and shown to whoever reads it, with whether its review is
 * past and, where its latest revision waits to take effect, when.
 */

/** Whether a review-by day has passed, on `now`'s day in UTC. */
export const pastReview = (reviewBy: string | null | undefined, now: Date = new Date()) =>
  reviewBy !== null && reviewBy !== undefined && reviewBy < dayOf(now);

/** Which of these artifacts are past review now (LIF-018). */
export async function pastReviewOf(
  trx: TenantTransaction,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const dates = await readDates(trx, ids);
  return new Set([...dates].flatMap(([id, each]) => (pastReview(each.reviewBy, now) ? [id] : [])));
}

/** Its latest revision's effective instant, where it is still to come (WF5-C). */
async function effectiveFrom(
  trx: TenantTransaction,
  id: string,
  now: Date,
): Promise<string | null> {
  // A failed query would end the transaction: an older schema is asked first.
  if (!(await datesStored(trx))) return null;
  const row = await trx
    .selectFrom('revision_effective')
    .select('effective_at')
    .where('artifact_id', '=', id)
    .where('effective_at', '>', now)
    .orderBy('effective_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? row.effective_at.toISOString() : null;
}

function viewOf(
  dates: ArtifactDates | undefined,
  owner: { id: string; name: string | null } | null,
  from: string | null,
  now: Date,
): DatesView {
  return {
    effectiveAt: dates?.effective ? localIso(dates.effective) : null,
    reviewBy: dates?.reviewBy ?? null,
    owner,
    pastReview: pastReview(dates?.reviewBy, now),
    effectiveFrom: from,
  };
}

async function ownerOf(trx: TenantTransaction, id: string | null | undefined) {
  if (!id) return null;
  const row = await trx
    .selectFrom('principal')
    .select(['id', 'display_name'])
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? { id: row.id, name: row.display_name } : null;
}

/** A component's or document's dates, for its view. */
export async function datesView(
  trx: TenantTransaction,
  id: string,
  now: Date = new Date(),
): Promise<{ dates: DatesView }> {
  const dates = (await readDates(trx, [id])).get(id);
  return {
    dates: viewOf(dates, await ownerOf(trx, dates?.owner), await effectiveFrom(trx, id, now), now),
  };
}

/** `PUT /v1/{components|documents}/{id}/dates`, decided on `edit` by the route. */
export function datesHandlers() {
  const setting =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<DatesView> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as DatesBody;
      const effective = body.effectiveAt === null ? null : readLocalInstant(body.effectiveAt);
      if (body.effectiveAt !== null && effective === null) {
        throw refused(400, 'dates.invalid', 'An effective date names its offset.');
      }
      // The owner is somebody who may read it, or none (WF5-A).
      if (body.owner !== null) {
        const facts = (await loadFactsFor(trx, body.owner, [id])).get(id);
        const exists = await ownerOf(trx, body.owner);
        if (!exists || !facts || !decide('read', facts).allowed) {
          throw refused(400, 'owner.invalid', 'The owner is somebody who may read it.');
        }
      }
      const answer = await setDates(trx, {
        artifactId: id,
        kind,
        effective,
        reviewBy: body.reviewBy,
        owner: body.owner,
        by: principalId,
      });
      switch (answer.answer) {
        case 'artifact.missing':
          throw notFound();
        case 'artifact.archived':
          throw refused(409, 'artifact.archived', 'It is archived, and keeps its dates.');
        case 'set':
        case 'unchanged':
          return (await datesView(trx, id)).dates;
      }
    };
  return {
    setComponentDates: setting('component'),
    setDocumentDates: setting('document'),
  };
}
