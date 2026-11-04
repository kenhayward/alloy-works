import type {
  AuditEventView,
  AuditExportBody,
  AuditExportDownload,
  AuditExportMade,
  AuditExportParams,
  AuditExportView,
  AuditList,
  AuditListQuery,
  TenantExportDownload,
  TenantExportList,
  TenantExportMade,
  TenantExportParams,
  TenantExportRequest,
  TenantExportQuery,
  TenantExportView,
} from '@alloy-works/api-contract';
import {
  auditEntryJson,
  isSnapshot,
  readAuditEvents,
  readAuditExport,
  recordEvent,
  requestAuditExport,
  listTenantExports,
  readTenantExport,
  requestTenantExport,
  type AuditEntry,
  type TenantExport,
  type AuditExport,
  type Tenant,
  type TenantTransaction,
  ownTenantState,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { auditFilterProblem, type AuditFilter } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, notFound, type Authorised } from './access.js';
import { pageLimit } from './components.js';
import { AppError, storageUnavailable } from './errors.js';
import { cursorFor, pageAsked } from './listing.js';
import { DOWNLOAD_SECONDS } from './publishing.js';
import { languageOf } from './listing.js';

/**
 * An audit read's cursor (the AU2 plan, AU-M): the sequence the page ended at and the snapshot the
 * walk's first page took, as base64url JSON. Opaque to a caller; not signed, since a forged one reaches
 * only the log its holder may already read, but its sequence and snapshot are checked to be ones
 * Postgres can cast before either is.
 */
interface Written {
  readonly v: 1;
  readonly q: string;
  readonly n: string;
}

const SEQUENCE = /^[1-9][0-9]{0,18}$/;
const BIGINT_MAX = 9223372036854775807n;

const refusedCursor = () =>
  new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');

/** The cursor for the page after one ending at `sequence`, or null at the end. */
export function auditCursor(sequence: string | null, snapshot: string): string | null {
  if (sequence === null) return null;
  const written: Written = { v: 1, q: sequence, n: snapshot };
  return Buffer.from(JSON.stringify(written), 'utf8').toString('base64url');
}

/** Where a page continues and as of what, from a cursor `auditCursor` gave out; 400 for any other. */
export function auditAfter(
  cursor: string | undefined,
): { readonly after: string; readonly snapshot: string } | undefined {
  if (cursor === undefined) return undefined;
  let written: Partial<Written>;
  try {
    written = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<Written>;
  } catch {
    throw refusedCursor();
  }
  if (
    typeof written !== 'object' ||
    written === null ||
    written.v !== 1 ||
    typeof written.q !== 'string' ||
    !SEQUENCE.test(written.q) ||
    BigInt(written.q) > BIGINT_MAX ||
    typeof written.n !== 'string' ||
    // Every snapshot Postgres would refuse to cast is refused here, as the listings' are (LI-H).
    !isSnapshot(written.n)
  ) {
    throw refusedCursor();
  }
  return { after: written.q, snapshot: written.n };
}

/** What a query's filters say, refused `audit_filter_invalid` where the log cannot take them. */
export function auditFilterOf(query: Omit<AuditListQuery, 'cursor' | 'limit'>): AuditFilter {
  const filter: AuditFilter = {
    ...(query.actor === undefined ? {} : { actor: query.actor }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.from === undefined ? {} : { from: new Date(query.from) }),
    ...(query.to === undefined ? {} : { to: new Date(query.to) }),
    ...(query.subject === undefined ? {} : { subject: query.subject }),
    ...(query.space === undefined ? {} : { space: query.space }),
  };
  const problem = auditFilterProblem(filter);
  if (problem === 'kind') {
    throw new AppError(400, 'audit_filter_invalid', 'The log holds no event of that kind.');
  }
  if (problem === 'dates') {
    throw new AppError(400, 'audit_filter_invalid', 'The first date is after the last.');
  }
  return filter;
}

/** An event as the API shows it, and as an export writes each line (`auditEntryJson`). */
export const auditEventView = (entry: AuditEntry): AuditEventView =>
  auditEntryJson(entry) as AuditEventView;

/** An export as the API shows it. */
function exportView(asked: AuditExport): AuditExportView {
  return {
    id: asked.id,
    state: asked.state,
    requestedAt: asked.requestedAt.toISOString(),
    requestedBy: asked.requestedBy,
    newest: asked.newest,
    events: asked.events,
    bytes: asked.bytes,
    sha256: asked.sha256,
  };
}

/**
 * The audit log's handlers (audit.md, "Reading and export"), run where `administer` was decided:
 * reading, which is no event, and exporting, whose asking and each download handed out are.
 */
export function auditHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    listAuditEvents: async (request: FastifyRequest, { trx }: Authorised): Promise<AuditList> => {
      const query = request.query as AuditListQuery;
      const filter = auditFilterOf(query);
      const at = auditAfter(query.cursor);
      const page = await readAuditEvents(trx, filter, {
        limit: pageLimit(query.limit),
        ...(at === undefined ? {} : at),
      });
      return {
        items: page.items.map(auditEventView),
        next: auditCursor(page.next, page.snapshot),
      };
    },

    requestAuditExport: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<AuditExportMade> => {
      const filter = auditFilterOf(request.body as AuditExportBody);
      const asked = await requestAuditExport(trx, principalId, filter);
      await recordEvent(trx, {
        kind: 'export.produced',
        subject: { kind: 'audit_export', id: asked.id },
        detail: { export: asked.id, of: 'audit' },
      });
      const made = await readAuditExport(trx, asked.id);
      return { export: exportView(made!) };
    },

    getAuditExport: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<AuditExportMade> => {
      const { id } = request.params as AuditExportParams;
      const asked = await readAuditExport(trx, id);
      if (!asked) throw notFound();
      return { export: exportView(asked) };
    },

    downloadAuditExport: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<AuditExportDownload> => {
      const { id } = request.params as AuditExportParams;
      const asked = await readAuditExport(trx, id);
      if (!asked) throw notFound();
      if (asked.state !== 'done' || asked.key === null) {
        throw new AppError(409, 'export_not_ready', 'The export is not written yet, or failed.');
      }
      if (!objects) throw storageUnavailable();
      const store = await objects.forTenant(trx, tenantOf(request));
      // Saved as its id: never its filters, which would reach the store's logs.
      const download = await store.signedLink(asked.key, DOWNLOAD_SECONDS, `audit-${id}.jsonl`);
      await recordEvent(trx, {
        kind: 'export.downloaded',
        subject: { kind: 'audit_export', id },
        detail: { export: id, of: 'audit' },
      });
      return { download };
    },
  };
}

/** While its environment closes no export is swept, so it has no date until deletion (TL-F). */
const keptThroughClosure = async (trx: TenantTransaction) =>
  (await ownTenantState(trx)).state !== 'active';

function tenantExportView(made: TenantExport, kept = false): TenantExportView {
  return {
    id: made.id,
    state: made.state,
    scope: made.scope,
    scopeId: made.scopeId,
    followReferences: made.followReferences,
    requestedAt: made.requestedAt.toISOString(),
    requestedBy: made.requestedBy,
    finishedAt: made.finishedAt?.toISOString() ?? null,
    expiresAt: kept ? null : (made.expiresAt?.toISOString() ?? null),
    bytes: made.bytes,
    sha256: made.sha256,
    counts: made.counts && { ...made.counts },
  };
}

/**
 * The tenant's export (API-044; the R21 plan, R21-B), run where `administer` was decided: asking for
 * one and each download handed out are events, as an audit export's are; reading and listing are not.
 */
/** A whole tenant's archive holds its audit log, so both are asked of one person (IMP-023, EI-J). */
const holdsTheLog = (trx: TenantTransaction, principalId: string, facts: Authorised['facts']) =>
  authoriseAt(trx, { principalId, scopes: facts.scopes }, 'export_audit', { kind: 'tenant' });

export function tenantExportHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    requestTenantExport: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<TenantExportMade> => {
      const asked = (request.body ?? {}) as TenantExportRequest;
      const scope = asked.scope ?? 'tenant';
      const named = scope === 'space' || scope === 'document' || scope === 'publication';
      if (named !== (asked.id !== undefined)) {
        throw new AppError(
          400,
          'export_scope_invalid',
          'A space, document or publication is named by its id, and nothing else is.',
        );
      }
      if (scope === 'tenant') await holdsTheLog(trx, principalId, facts);
      if (asked.id !== undefined) {
        const found =
          scope === 'publication'
            ? await trx
                .selectFrom('publication')
                .select('id')
                .where('id', '=', asked.id)
                .executeTakeFirst()
            : scope === 'space'
              ? await trx
                  .selectFrom('space')
                  .select('id')
                  .where('id', '=', asked.id)
                  .executeTakeFirst()
              : await trx
                  .selectFrom('artifact')
                  .select('id')
                  .where('id', '=', asked.id)
                  .where('kind', '=', 'document')
                  .executeTakeFirst();
        if (!found) throw notFound();
      }
      const made = await requestTenantExport(trx, principalId, {
        scope,
        id: asked.id ?? null,
        followReferences: asked.followReferences ?? false,
      });
      await recordEvent(trx, {
        kind: 'export.produced',
        subject: { kind: 'tenant_export', id: made.id },
        detail: { export: made.id, of: 'tenant' },
      });
      return { export: tenantExportView(made) };
    },

    listTenantExports: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantExportList> => {
      const asked = pageAsked(
        'tenantExports',
        request.query as TenantExportQuery,
        languageOf(request),
      );
      const listed = await listTenantExports(trx, asked);
      const kept = await keptThroughClosure(trx);
      return {
        items: listed.items.map((made) => tenantExportView(made, kept)),
        next: cursorFor(
          'tenantExports',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
      };
    },

    getTenantExport: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TenantExportMade> => {
      const { id } = request.params as TenantExportParams;
      const made = await readTenantExport(trx, id);
      if (!made) throw notFound();
      return { export: tenantExportView(made, await keptThroughClosure(trx)) };
    },

    downloadTenantExport: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<TenantExportDownload> => {
      const { id } = request.params as TenantExportParams;
      const made = await readTenantExport(trx, id);
      if (!made) throw notFound();
      // A part is bounded by what its asker may read, so another reader needs what would let them
      // export it all (EI-J).
      if (made.scope === 'tenant' || made.requestedBy !== principalId) {
        await holdsTheLog(trx, principalId, facts);
      }
      if (made.state !== 'done' || made.key === null) {
        throw new AppError(
          409,
          'export_not_ready',
          'The export is not written yet, failed, or has expired.',
        );
      }
      if (!objects) throw storageUnavailable();
      const store = await objects.forTenant(trx, tenantOf(request));
      const download = await store.signedLink(made.key, DOWNLOAD_SECONDS, `export-${id}.tar`);
      await recordEvent(trx, {
        kind: 'export.downloaded',
        subject: { kind: 'tenant_export', id },
        detail: { export: id, of: 'tenant' },
      });
      return { download };
    },
  };
}
