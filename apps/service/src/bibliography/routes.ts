import type {
  CreateEntryAnswer,
  CreateEntryBody,
  EntryListQuery,
  EntryParams,
  EntryUsesView,
  EntryVersionBody,
  EntryView,
  ExportQuery,
  ImportAnswer,
  ImportEntriesBody,
  SpaceParams,
} from '@alloy-works/api-contract';
import { IMPORT_RECORDS_MOST } from '@alloy-works/api-contract';
import {
  archiveEntry,
  citedFlags,
  createEntry,
  entriesForExport,
  entryUses,
  importEntries,
  listEntries,
  readEntry,
  readEntryStatus,
  recordEntryVersion,
  type EntryAnswer,
  type EntryInput,
  type EntryMatch,
  type EntryFlag,
  type EntryStatus,
  type EntrySummary,
  type StoredEntry,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { cursorFor, pageAsked } from '../listing.js';
import { refused } from '../wire-codes.js';
import { formatEntries, notCarried, readRecords } from './interchange.js';
import { languageOf } from '../listing.js';

/** The bibliography routes (citations.md, "The entry"; the CI plan, CI-B, CI-C). */

export function entryView(stored: StoredEntry, facts: AccessFacts): EntryView {
  return {
    id: stored.id,
    space: stored.space,
    version: versionView(stored.version),
    entry: stored.entry,
    archived: stored.archived,
    mayEdit: decide('edit', facts).allowed,
    mayRetire: decide('retire', facts).allowed,
  };
}

/** An entry's status, as the API shows it (XR-F). */
export const statusView = (status: EntryStatus) => ({
  source: status.source,
  checkedAt: status.checkedAt.toISOString(),
  outcome: status.outcome,
  differs: [...status.differs],
  notice: status.notice,
});

const summaryView = (summary: EntrySummary, flags?: ReadonlyMap<string, EntryFlag>) => ({
  ...(flags === undefined ? {} : { flag: flags.get(summary.id) ?? null }),
  id: summary.id,
  key: summary.key,
  csl: summary.csl,
  version: {
    id: summary.version.id,
    number: `${summary.version.revision}.${summary.version.version}`,
  },
  changedAt: summary.changedAt.toISOString(),
});

export const matchView = (match: EntryMatch, flags?: ReadonlyMap<string, EntryFlag>) => ({
  by: match.by,
  entry: summaryView(match.entry, flags),
});

/** The flags of the entries matched (XR-G), to show beside each. */
export const matchFlags = (trx: TenantTransaction, matches: readonly EntryMatch[]) =>
  citedFlags(
    trx,
    matches.map((each) => each.entry.id),
  );

/** What a stored entry is summarised as. */
const summaryOf = (stored: StoredEntry): EntrySummary => ({
  id: stored.id,
  key: stored.entry.key,
  csl: stored.entry.csl,
  version: {
    id: stored.version.id,
    revision: stored.version.revision,
    version: stored.version.version,
  },
  changedAt: stored.version.createdAt,
});

/** A writer's answer that is not an entry: refused by name, or absent. */
export function refusedEntry(
  answer: Extract<
    EntryAnswer,
    { answer: 'entry.refused' | 'version.precondition' | 'space.missing' | 'entry.missing' }
  >,
  facts: AccessFacts,
): never {
  switch (answer.answer) {
    case 'entry.refused':
      throw refused(400, 'entry.invalid', 'The entry is not valid.', { problems: answer.problems });
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This entry has a newer version than the one this page opened.',
        { current: entryView(answer.current, facts) },
      );
    case 'space.missing':
    case 'entry.missing':
      throw notFound();
  }
}

/** The body's entry, as the db takes it. */
const inputOf = (entry: CreateEntryBody['entry']): EntryInput => entry as EntryInput;

export function bibliographyHandlers() {
  return {
    listBibliographyEntries: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const query = request.query as EntryListQuery;
      const asked = pageAsked('bibliography', query, languageOf(request));
      const listed = await listEntries(trx, principalId, space, asked, {
        archived: query.archived === 'true',
      });
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      // Each flagged where its source says it is retracted or corrected (XR-G).
      const flags = await citedFlags(
        trx,
        listed.items.map((each) => each.id),
      );
      return {
        items: listed.items.map((each) => summaryView(each, flags)),
        next: cursorFor(
          'bibliography',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
        total: listed.total,
      };
    },

    createBibliographyEntry: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<CreateEntryAnswer> => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateEntryBody;
      const answer = await createEntry(trx, {
        author: principalId,
        spaceId: space,
        entry: inputOf(body.entry),
        ...(body.despiteMatches === undefined ? {} : { despiteMatches: body.despiteMatches }),
      });
      if (answer.answer === 'matched') {
        return { entry: null, matches: answer.matches.map((each) => matchView(each)) };
      }
      if (answer.answer === 'created') {
        // Decided at the space, which a new entry inherits from.
        return {
          entry: entryView(answer.entry, facts),
          matches: answer.matches.map((each) => matchView(each)),
        };
      }
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        throw new Error(`Making an entry was answered ${answer.answer}`);
      }
      return refusedEntry(answer as Parameters<typeof refusedEntry>[0], facts);
    },

    importBibliographyEntries: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ImportAnswer> => {
      const { space } = request.params as SpaceParams;
      const body = request.body as ImportEntriesBody;
      const records = readRecords(body.format, body.text);
      if (records === undefined) {
        throw refused(400, 'import.unreadable', 'The text holds no record in that format.');
      }
      if (records.length > IMPORT_RECORDS_MOST) {
        throw refused(
          400,
          'import.too_many',
          `The text holds ${records.length} records; import at most ${IMPORT_RECORDS_MOST} at a time.`,
        );
      }
      const done = await importEntries(trx, { author: principalId, spaceId: space, records });
      if (!done) throw notFound();
      return {
        records: done.map((each) => ({
          outcome: each.outcome,
          entry: each.outcome === 'refused' ? null : summaryView(summaryOf(each.entry), undefined),
          by: each.outcome === 'merged' ? each.by : null,
          merged: each.outcome === 'merged' ? [...each.merged] : [],
          dropped: [...each.dropped],
          message: each.outcome === 'refused' ? each.message : null,
        })),
      };
    },

    exportBibliographyEntries: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ) => {
      const { space } = request.params as SpaceParams;
      const query = request.query as ExportQuery;
      const entries = await entriesForExport(
        trx,
        principalId,
        space,
        query.ids === undefined ? undefined : query.ids.split(','),
      );
      if (!entries) throw notFound();
      const text = formatEntries(query.format, entries);
      return { format: query.format, text, notCarried: notCarried(query.format, entries, text) };
    },

    // `authorise` never looks at an artifact's kind; `readEntry` answers nothing for another kind.
    getBibliographyEntry: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as EntryParams;
      const stored = await readEntry(trx, id);
      if (!stored) throw notFound();
      const status = await readEntryStatus(trx, id);
      return {
        ...entryView(stored, facts),
        status: status === undefined ? null : statusView(status),
      };
    },

    recordBibliographyEntryVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as EntryParams;
      const body = request.body as EntryVersionBody;
      const answer = await recordEntryVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        entry: inputOf(body.entry),
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return entryView(answer.entry, facts);
      }
      if (answer.answer === 'created' || answer.answer === 'matched') {
        throw new Error(`A version was answered ${answer.answer}`);
      }
      return refusedEntry(answer as Parameters<typeof refusedEntry>[0], facts);
    },

    getBibliographyEntryUses: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<EntryUsesView> => {
      const { id } = request.params as EntryParams;
      if (!(await readEntry(trx, id))) throw notFound();
      const uses = await entryUses(trx, principalId, id);
      return {
        components: { named: [...uses.components.named], unreadable: uses.components.unreadable },
        baselines: { named: [...uses.baselines.named], unreadable: uses.baselines.unreadable },
      };
    },

    archiveBibliographyEntry: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as EntryParams;
      const answer = await archiveEntry(trx, id, principalId, 'archived');
      if (answer === undefined) throw notFound();
      if (answer === 'cited') {
        throw refused(409, 'entry.cited', 'The entry is cited, so it is kept.');
      }
      return { archived: true };
    },

    unarchiveBibliographyEntry: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ) => {
      const { id } = request.params as EntryParams;
      if ((await archiveEntry(trx, id, principalId, 'unarchived')) === undefined) throw notFound();
      return { archived: false };
    },
  };
}
