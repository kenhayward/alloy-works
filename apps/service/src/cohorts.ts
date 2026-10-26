import { createHash } from 'node:crypto';
import type {
  CohortList,
  CohortListQuery,
  CohortParams,
  CohortRun,
  CohortSpaceParams,
  CohortView,
  RerunCohortBody,
  SubmitCohortBody,
} from '@alloy-works/api-contract';
import {
  listReadableCohorts,
  readCohortAs,
  readVersion,
  rerunCohort,
  submitCohort,
  type StoredCohort,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { canonicalResultSchema, parseProvenance } from '@alloy-works/domain';
import { tenantPrefix, type ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, type Authorised } from './access.js';
import { storageUnavailable } from './errors.js';
import { refused } from './wire-codes.js';
import { jobView } from './jobs.js';
import { cursorFor, pageAsked } from './listing.js';
import { languageOf } from './listing.js';

export function cohortView(cohort: StoredCohort): CohortView {
  return {
    id: cohort.id,
    space: cohort.spaceId,
    template: { ...cohort.template },
    title: cohort.title,
    source: { ...cohort.source },
    requestedAt: cohort.requestedAt.toISOString(),
    onFailure: cohort.onFailure,
    stoppedAt: cohort.stoppedAt,
    rows: cohort.rows.map((each) => ({
      row: each.row,
      parameters: { ...each.parameters },
      state: each.state,
      document: each.document,
      failure: each.failure && { ...each.failure },
      attempts: each.attempts,
    })),
  };
}

const rowsRefused = (detail: string) =>
  refused(400, 'rows.invalid', `These rows cannot be made into documents: ${detail}.`, { detail });

/**
 * A query result's rows as parameter sets (REU-032; the R7 plan, R7-B): one parameter for each column,
 * by its name, a null cell giving none; read from the store and held to its checksum, as a binding's
 * result is. The caller must read the result's dataset.
 */
async function datasetRows(
  trx: TenantTransaction,
  request: FastifyRequest,
  tenant: Tenant,
  objects: ObjectStores | undefined,
  version: string,
): Promise<Record<string, unknown>[]> {
  const held = await readVersion(trx, version);
  if (!held || held.kind !== 'dataset') throw notFound();
  await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: held.artifactId });
  if (!objects) throw storageUnavailable();
  const provenance = parseProvenance(held.content);
  const store = await objects.forTenant(trx, tenant);
  const bytes = await store.get(`${tenantPrefix(tenant)}sha256/${provenance.checksum}`);
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.checksum) {
    throw rowsRefused('the query result could not be read');
  }
  const parsed = canonicalResultSchema.safeParse(JSON.parse(bytes.toString('utf8')));
  if (!parsed.success) throw rowsRefused('the query result could not be read');
  const names = parsed.data.columns.map(([name]) => name);
  return parsed.data.rows.map((row) =>
    Object.fromEntries(
      row.flatMap((value, at) => (value === null ? [] : [[names[at]!, value] as const])),
    ),
  );
}

/** Cohorts through the API (REU-031 to REU-035; the R7 plan, R7-A to R7-G). */
export function cohortHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  /**
   * A cohort in a space the caller may read, its documents named only where they may read them; and,
   * where its rows came from a query result, only to a caller who may read that result, since its rows
   * are the result's (the R7 final review). Otherwise not found.
   */
  const visible = async (trx: TenantTransaction, request: FastifyRequest, id: string) => {
    const caller = callerOf(request);
    const cohort = await readCohortAs(trx, id, caller.principalId);
    if (!cohort) throw notFound();
    await authoriseAt(trx, caller, 'read', { kind: 'space', id: cohort.spaceId });
    if ('dataset' in cohort.source) {
      const result = await readVersion(trx, cohort.source.dataset);
      if (!result) throw notFound();
      await authoriseAt(trx, caller, 'read', { kind: 'artifact', id: result.artifactId });
    }
    return cohort;
  };
  return {
    submitCohort: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CohortRun> => {
      const { space } = request.params as CohortSpaceParams;
      const body = request.body as SubmitCohortBody;
      const rows =
        body.rows ?? (await datasetRows(trx, request, tenantOf(request), objects, body.dataset!));
      const answer = await submitCohort(trx, {
        by: principalId,
        spaceId: space,
        template: body.template,
        title: body.title,
        language: body.language,
        direction: body.direction,
        rows,
        source: body.rows ? { rows: rows.length } : { dataset: body.dataset! },
        ...(body.onFailure === undefined ? {} : { onFailure: body.onFailure }),
      });
      switch (answer.answer) {
        case 'submitted':
          return { cohort: cohortView(answer.cohort), job: jobView(answer.job) };
        case 'space.missing':
        case 'template.missing':
          throw notFound();
        case 'content.invalid':
          throw refused(
            400,
            'content.invalid',
            'That language or direction is not one a document can take.',
          );
        case 'template.unresolved':
          throw refused(
            400,
            'template.unresolved',
            'This template names a definition that no longer resolves, so no document can be made from it.',
            { unresolved: answer.unresolved },
          );
        case 'rows.invalid':
          throw rowsRefused(answer.detail);
        case 'cohort.bound':
          throw refused(
            409,
            'cohort.bound',
            "This template's required components run queries, which documents made in bulk cannot run yet. Make each document on its own.",
          );
      }
    },

    /** The cohorts the caller may read, sorted, filtered and paged (SCH-065; the R14 plan, R14-A). */
    listCohorts: async (request: FastifyRequest): Promise<CohortList> => {
      const query = request.query as CohortListQuery;
      const asked = pageAsked('cohorts', query, languageOf(request));
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableCohorts(trx, callerOf(request).principalId, asked, {
          ...(query.template === undefined ? {} : { template: query.template }),
          ...(query.state === undefined ? {} : { state: query.state }),
        }),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((each) => ({
          id: each.id,
          title: each.title,
          template: { ...each.template },
          space: { ...each.space },
          requestedAt: each.requestedAt.toISOString(),
          rows: { ...each.rows },
        })),
        next: cursorFor(
          'cohorts',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
      };
    },

    getCohort: async (request: FastifyRequest): Promise<CohortView> => {
      const { id } = request.params as CohortParams;
      return db.withTenant(tenantOf(request), async (trx) =>
        cohortView(await visible(trx, request, id)),
      );
    },

    rerunCohort: async (request: FastifyRequest): Promise<CohortRun> => {
      const { id } = request.params as CohortParams;
      const body = (request.body ?? {}) as RerunCohortBody;
      const principal = callerOf(request);
      return db.withTenant(tenantOf(request), async (trx) => {
        const cohort = await visible(trx, request, id);
        await authoriseAt(trx, principal, 'create', { kind: 'space', id: cohort.spaceId });
        const corrections = Object.fromEntries(
          Object.entries(body.corrections ?? {}).map(([row, parameters]) => [
            Number(row),
            parameters,
          ]),
        );
        const answer = await rerunCohort(trx, id, principal.principalId, corrections);
        switch (answer.answer) {
          case 'submitted':
            return {
              cohort: cohortView((await readCohortAs(trx, id, principal.principalId))!),
              job: jobView(answer.job),
            };
          case 'missing':
            throw notFound();
          case 'none.failed':
            throw refused(409, 'cohort.complete', 'No row of this cohort has failed.');
          case 'rows.invalid':
            throw rowsRefused(answer.detail);
        }
      });
    },
  };
}
