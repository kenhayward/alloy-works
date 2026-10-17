import type { QueryUsageQuery, QueryUsageView } from '@alloy-works/api-contract';
import { queryRunsBetween, queryUsage, type UsageTotal } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import type { BinaryBody } from './assets.js';
import { AppError } from './errors.js';

const DAY = 86_400_000;
/** The longest period asked for: the 13 months runs are kept (the R18 plan, R18-D). */
const LONGEST_DAYS = 397;

/** The period asked for: the last 30 days unless named, and never one that ends first or runs long. */
function periodOf(query: QueryUsageQuery): { readonly from: Date; readonly to: Date } {
  const to = query.to === undefined ? new Date() : new Date(query.to);
  const from = query.from === undefined ? new Date(to.getTime() - 30 * DAY) : new Date(query.from);
  if (from.getTime() >= to.getTime() || to.getTime() - from.getTime() > LONGEST_DAYS * DAY) {
    throw new AppError(
      400,
      'invalid_request',
      'Choose a period that ends after it starts and is no longer than 13 months.',
    );
  }
  return { from, to };
}

const totalView = (each: UsageTotal) => ({ ...each });

/** A CSV field, quoted where it must be, and never read as a formula (OWASP's CSV injection). */
function field(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Query usage (data.md, "Limits and cost"; the R18 plan, R18-E), for whoever administers. */
export function queryUsageHandlers() {
  return {
    getQueryUsage: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<QueryUsageView> => {
      const period = periodOf(request.query as QueryUsageQuery);
      const usage = await queryUsage(trx, period);
      return {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        byQueryDefinition: usage.byQueryDefinition.map(totalView),
        byDocument: usage.byDocument.map(totalView),
      };
    },

    getQueryRunsCsv: async (request: FastifyRequest, { trx }: Authorised): Promise<BinaryBody> => {
      const period = periodOf(request.query as QueryUsageQuery);
      const runs = await queryRunsBetween(trx, period);
      const lines = [
        'at,act,outcome,failure,principal,connection,query_definition,document,duration_ms,rows,bytes',
        ...runs.map((run) =>
          [
            run.at.toISOString(),
            run.act,
            run.outcome,
            run.failure,
            run.principal,
            run.connection,
            run.queryDefinition,
            run.document,
            run.durationMs,
            run.rows,
            run.bytes,
          ]
            .map(field)
            .join(','),
        ),
      ];
      return {
        contentType: 'text/csv',
        bytes: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
        immutable: false,
        attachment: `query-runs-${period.from.toISOString().slice(0, 10)}-${period.to.toISOString().slice(0, 10)}.csv`,
      };
    },
  };
}
