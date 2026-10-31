import { randomUUID } from 'node:crypto';

import type {
  DocumentParams,
  EntryParams,
  EntryStatusView,
  FlaggedSourcesView,
  FromSourceAnswer,
  FromSourceBody,
  ReferenceSearchAnswer,
  ReferenceSearchBody,
  ReferenceSourceBody,
  ReferenceSourceList,
  SourceParams,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  attemptEntryCheck,
  createEntry,
  entryCheckable,
  extensionTarget,
  findEntryMatches,
  flaggedCited,
  latestVersion,
  placedBy,
  readableOf,
  readEntry,
  recordEntryCheck,
  titlesFor,
  setReferenceSource,
  tenantReferenceSources,
  type Tenant,
  type TenantReferenceSource,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  decide,
  entryCheck,
  referenceRequestSchema,
  type ReferenceRequest,
  type ReferenceResult,
  type ReferenceSourceKey,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { createConnectorClient, type ConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { AppError } from '../errors.js';
import { recordSettingsChanged } from '../settings.js';
import { entryView, matchFlags, matchView, refusedEntry, statusView } from './routes.js';

const viewOf = ({ id, name, host, identifier, enabled }: TenantReferenceSource) => ({
  id,
  name,
  host,
  identifier,
  enabled,
});

/** One of the tenant's sources, a reference extension installed and not removed among them (XR-J). */
async function sourceOf(
  trx: TenantTransaction,
  key: ReferenceSourceKey,
): Promise<TenantReferenceSource | undefined> {
  return (await tenantReferenceSources(trx)).find((each) => each.id === key);
}

/**
 * The source, refused `reference_source_off` unless it is switched on (XR-C) and still installed
 * (XR-J).
 */
export async function sourceSwitchedOn(
  trx: TenantTransaction,
  key: ReferenceSourceKey,
): Promise<TenantReferenceSource> {
  const source = await sourceOf(trx, key);
  if (!source?.enabled) {
    throw new AppError(
      409,
      'reference_source_off',
      source
        ? `${source.name} is switched off in this environment.`
        : 'This reference source is no longer installed in this environment.',
    );
  }
  return source;
}

/** What the source answered, mapped to CSL by the connector; its failure the source's. */
export async function askSource(
  client: ConnectorClient | undefined,
  tenant: Tenant,
  source: TenantReferenceSource,
  ask: Omit<ReferenceRequest, 'requestId' | 'tenant' | 'source' | 'extension'>,
): Promise<ReferenceResult[]> {
  const extension = extensionTarget(source);
  const parsed = referenceRequestSchema.safeParse({
    requestId: randomUUID(),
    tenant: tenant.id,
    source: source.id,
    ...ask,
    ...(extension === undefined ? {} : { extension }),
  });
  if (!parsed.success) {
    throw new AppError(
      400,
      'invalid_request',
      ask.op === 'search'
        ? 'The terms are empty, or hold a control character.'
        : `${source.name} fetches by ${source.identifier}, and this is not one.`,
    );
  }
  if (!client) {
    throw new AppError(503, 'connector_unavailable', 'The connector cannot be reached.');
  }
  const answer = await client.reference(parsed.data);
  if ('refused' in answer) {
    throw new AppError(503, answer.refused.code, 'The connector cannot ask the source now.');
  }
  if (answer.answer.type === 'failed') {
    throw new AppError(
      502,
      'reference_unavailable',
      `${source.name} could not be reached, or answered out of shape: ${answer.answer.reason}.`,
    );
  }
  // An extension's fetch or check answers the record asked for alone: another is none (XR-J).
  return extension === undefined || ask.op === 'search'
    ? answer.answer.results
    : answer.answer.results.filter((each) => each.identifier === ask.identifier);
}

/**
 * Reference sources (reference-sources.md; the XR plan, XR-C, XR-D): each switched on or off by an
 * administrator of the environment, and asked through the connector by its id and an operation, so
 * the service names no URL (ADR-0068); a reference extension's, the endpoint its installed manifest
 * declares (XR-J). A source's failure is answered as the source's.
 */
export function referenceSourceHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
) {
  const client = connector ? createConnectorClient(connector) : undefined;
  const switchedOn = sourceSwitchedOn;
  const asked = (
    request: FastifyRequest,
    source: TenantReferenceSource,
    ask: Parameters<typeof askSource>[3],
  ) => askSource(client, tenantOf(request), source, ask);
  /** The source switched on, or 404 where the tenant holds no such one. */
  const held = async (trx: TenantTransaction, key: ReferenceSourceKey) => {
    if (!(await sourceOf(trx, key))) throw notFound();
    return switchedOn(trx, key);
  };

  return {
    listReferenceSources: async (request: FastifyRequest): Promise<ReferenceSourceList> =>
      db.withTenant(tenantOf(request), async (trx) => ({
        items: (await tenantReferenceSources(trx)).map(viewOf),
      })),

    setReferenceSource: async (request: FastifyRequest, { trx }: Authorised) => {
      const { source, enabled } = request.body as ReferenceSourceBody;
      const sources = await tenantReferenceSources(trx);
      const switched = sources.find((each) => each.id === source);
      if (!switched) throw notFound();
      // An extension's by `ext_` and its id's hex, as an audited name is spelled.
      const named = (key: string) => key.replace(/^ext:/, 'ext_').replaceAll('-', '');
      const before = Object.fromEntries(sources.map((each) => [named(each.id), each.enabled]));
      await setReferenceSource(trx, source, enabled);
      // By name, as every settings change is, and nothing where nothing changed (ADM-002).
      await recordSettingsChanged(trx, 'referenceSources', before, {
        ...before,
        [named(source)]: enabled,
      });
      return viewOf({ ...switched, enabled });
    },

    searchReferenceSource: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<ReferenceSearchAnswer> => {
      const { source } = request.params as SourceParams;
      const body = request.body as ReferenceSearchBody;
      const spaceId = body.space.slice('space:'.length);
      const results = await asked(request, await held(trx, source), {
        op: 'search',
        query: body.terms,
      });
      const matched = [];
      for (const each of results) {
        const matches = await findEntryMatches(trx, principalId, spaceId, each.csl);
        // A match its source says is retracted, superseded or corrected is flagged (XR-G).
        const flags = await matchFlags(trx, matches);
        matched.push({ ...each, matches: matches.map((match) => matchView(match, flags)) });
      }
      // Decided at the space, which the search's own read was decided on.
      return { results: matched, mayCreate: decide('edit', facts).allowed };
    },

    createBibliographyEntryFromSource: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<FromSourceAnswer> => {
      const { space } = request.params as SpaceParams;
      const body = request.body as FromSourceBody;
      const source = await held(trx, body.source);
      const found = await asked(request, source, { op: 'fetch', identifier: body.identifier });
      const record = found[0];
      if (record === undefined) {
        throw new AppError(
          422,
          'reference_missing',
          `${source.name} holds no record by that identifier.`,
        );
      }
      const answer = await createEntry(trx, {
        author: principalId,
        spaceId: space,
        entry: {
          csl: record.csl,
          obtained: {
            from: `${body.source}:${record.identifier}`,
            at: new Date().toISOString(),
          },
        },
        ...(body.despiteMatches === undefined ? {} : { despiteMatches: body.despiteMatches }),
      });
      const dropped = [...record.dropped];
      if (answer.answer === 'matched') {
        return { entry: null, matches: answer.matches.map((each) => matchView(each)), dropped };
      }
      if (answer.answer === 'created') {
        return {
          entry: entryView(answer.entry, facts),
          matches: answer.matches.map((each) => matchView(each)),
          dropped,
        };
      }
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        throw new Error(`Making an entry was answered ${answer.answer}`);
      }
      return refusedEntry(answer as Parameters<typeof refusedEntry>[0], facts);
    },

    /**
     * Check now (the XR plan, XR-E): by an editor of the entry, at most once a minute, the attempt
     * kept in a transaction of its own so a failure counts too; its latest version checked against
     * the source it was obtained from, its identifier alone sent, and its status recorded beside it by
     * the system, telling each document's owner of a retraction or correction (XR-F, XR-G).
     */
    checkBibliographyEntry: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<EntryStatusView> => {
      const { id } = request.params as EntryParams;
      if (!(await readEntry(trx, id))) throw notFound();
      const target = await entryCheckable(trx, id);
      if (!target) {
        throw new AppError(
          422,
          'entry_not_obtained',
          'This entry was not obtained from a reference source, so there is nothing to check it against.',
        );
      }
      const source = await switchedOn(trx, target.source);
      if (!(await db.withTenant(tenantOf(request), (own) => attemptEntryCheck(own, id, 60)))) {
        throw new AppError(
          429,
          'entry_checked_recently',
          'This entry was checked within the minute. Try again shortly.',
        );
      }
      const results = await asked(request, source, {
        op: 'check',
        identifier: target.identifier,
      });
      const { status } = await recordEntryCheck(trx, {
        entryId: id,
        source: target.source,
        check: entryCheck(target.csl, results),
      });
      return statusView(status);
    },

    /**
     * A document's flagged sources (XR-G): each retracted, superseded or corrected entry what it places cites, the
     * entry named to a reader of it and its flag alone to anybody else, and the citing components the
     * caller may read.
     */
    getDocumentFlaggedSources: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<FlaggedSourcesView> => {
      const { id } = request.params as DocumentParams;
      if ((await latestVersion(trx, id))?.kind !== 'document') throw notFound();
      const flagged = await flaggedCited(trx, await placedBy(trx, id));
      const entries = await readableOf(
        trx,
        principalId,
        flagged.map((each) => each.entry),
      );
      const components = await titlesFor(
        trx,
        principalId,
        flagged.flatMap((each) => each.components),
      );
      const items = [];
      for (const each of flagged) {
        const read = entries.has(each.entry) ? await readEntry(trx, each.entry) : undefined;
        const shown = each.components.filter((component) => components.has(component));
        items.push({
          flag: each.outcome,
          entry:
            read === undefined
              ? null
              : { id: read.id, key: read.entry.key, title: read.entry.csl.title ?? null },
          components: shown.map((component) => ({
            id: component,
            title: components.get(component)!,
          })),
          unreadable: shown.length < each.components.length,
        });
      }
      return { items };
    },
  };
}
