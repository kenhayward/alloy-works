import type {
  MakeSuggestionBody,
  ResolvedSuggestions,
  ResolveSuggestionsBody,
  SuggestionList,
  SuggestionListQuery,
  SuggestionParams,
  SuggestionSummaryView,
  SuggestionView,
} from '@alloy-works/api-contract';
import {
  acceptSuggestion,
  applying,
  latestVersion,
  listSuggestions,
  loadFactsFor,
  makeSuggestion,
  readSuggestion,
  readVersion,
  rejectSuggestion,
  resolveOccurrences,
  withdrawSuggestion,
  type ResolveAnswer,
  type StoredSuggestion,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, readOutline, type ContentDocument } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { mayNameColumns, storableContent } from './editing.js';
import { AppError } from './errors.js';
import { keysetAfter, keysetCursor } from './keyset.js';
import { refused } from './wire-codes.js';

const PAGE = 50;
/** The most pending suggestions one bulk act takes (SG-H). */
const BULK_MAX = 200;

/** A person as the view names them, from outside the organisation said so (IAM-045; R13-A). */
const person = (who: {
  readonly id: string;
  readonly name: string | null;
  readonly external?: true;
}) => ({
  id: who.id,
  name: who.name,
  ...(who.external ? { external: true as const } : {}),
});

/** A suggestion as a list shows it, a pending one's stale places computed now (SG-D). */
async function summaryOf(
  trx: TenantTransaction,
  suggestion: StoredSuggestion,
): Promise<SuggestionSummaryView> {
  let stale: SuggestionSummaryView['stale'] = null;
  if (suggestion.resolution === null) {
    const merged = await applying(trx, suggestion);
    stale = merged === undefined || merged.applied.applies ? [] : [...merged.applied.stale];
  }
  return {
    id: suggestion.id,
    component: suggestion.component,
    madeAgainst: suggestion.madeAgainst,
    madeBy: person(suggestion.madeBy),
    madeAt: suggestion.madeAt.toISOString(),
    state: suggestion.resolution?.act ?? 'pending',
    stale,
    resolution:
      suggestion.resolution === null
        ? null
        : {
            by: person(suggestion.resolution.by),
            at: suggestion.resolution.at.toISOString(),
            version: suggestion.resolution.version,
          },
  };
}

/** A suggestion with what its redline is drawn from (SG-I). */
async function viewOf(trx: TenantTransaction, id: string): Promise<SuggestionView> {
  const suggestion = await readSuggestion(trx, id);
  if (!suggestion) throw new Error(`The suggestion ${id} was not recorded`);
  const summary = await summaryOf(trx, suggestion);
  const merged = suggestion.resolution === null ? await applying(trx, suggestion) : undefined;
  if (merged?.applied.applies) {
    return {
      ...summary,
      drawnOver: {
        version: merged.current.id,
        content: merged.current.content as Record<string, unknown>,
      },
      drawn: merged.applied.content as unknown as Record<string, unknown>,
    };
  }
  // A resolved one, or one that no longer fits: the version it was made against and the draft.
  const base = merged?.base ?? (await readVersion(trx, suggestion.madeAgainst));
  return {
    ...summary,
    drawnOver: {
      version: suggestion.madeAgainst,
      content: (base?.content ?? suggestion.proposed) as Record<string, unknown>,
    },
    drawn: suggestion.proposed as unknown as Record<string, unknown>,
  };
}

/** A store's refusal of a resolving act, as the wire carries it. */
function refuse(
  answer: Exclude<ResolveAnswer, { answer: 'accepted' | 'rejected' | 'withdrawn' }>,
): AppError {
  switch (answer.answer) {
    case 'missing':
      return notFound();
    case 'suggestion.resolved':
      return refused(409, 'suggestion.resolved', 'This suggestion is resolved already.');
    case 'suggestion.not_yours':
      return refused(403, 'suggestion.not_yours', 'Only its author withdraws a suggestion.');
    case 'lock.held':
      return refused(409, 'lock.held', 'This component is being edited in another session.', {
        holder: { id: answer.lock.holder, name: answer.lock.holderName },
        expectedRelease: answer.lock.expiresAt.toISOString(),
      });
    case 'edits.pending':
      return refused(
        409,
        'edits.pending',
        'You have saved changes to this component. Make a version or discard them first.',
      );
    case 'suggestion.stale':
      return refused(409, 'suggestion.stale', 'This suggestion no longer fits the component.', {
        stale: answer.stale,
      });
    case 'values.invalid':
      return refused(400, 'values.invalid', 'A fixed value differs from its default now.', {
        failures: answer.failures,
      });
  }
}

/** The kind of the artifact a path names, which a route of the other kind answers as not found. */
async function kindOf(trx: TenantTransaction, id: string): Promise<string | undefined> {
  const row = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.kind;
}

/** Every component a document's latest outline places that the caller may read (SG-H, listing). */
async function placedReadable(
  trx: TenantTransaction,
  document: string,
  principalId: string,
): Promise<string[]> {
  const latest = await latestVersion(trx, document);
  if (!latest) return [];
  const outline = readOutline(latest.content, { artifact: document, version: latest.id });
  if (!outline.ok) throw new Error(`The document ${document} does not read`);
  const resolved = await resolveOccurrences(trx, outline.outline, principalId);
  return [
    ...new Set(resolved.flatMap((each) => (each.outcome === 'resolved' ? [each.component] : []))),
  ];
}

/**
 * Suggestions (collaboration.md, Suggestions; the SG plan, Task 2): each route decided by `authorise`
 * on the component - its path's, or the suggestion's - in the transaction the handler runs in. Making
 * one needs no lock (COL-025); accepting cuts a version as the accepter (SG-G).
 */
export function suggestionHandlers() {
  const list =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<SuggestionList> => {
      const { id } = request.params as { id: string };
      if ((await kindOf(trx, id)) !== kind) throw notFound();
      const query = request.query as SuggestionListQuery;
      const limit = query.limit === undefined ? PAGE : Number(query.limit);
      const after = keysetAfter('suggestions', query.cursor);
      const on = kind === 'component' ? [id] : await placedReadable(trx, id, principalId);
      const page = await listSuggestions(trx, {
        on,
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.author === undefined ? {} : { author: query.author }),
        ...(after === undefined ? {} : { after }),
        limit: limit + 1,
      });
      const shown = page.slice(0, limit);
      const last = shown[shown.length - 1];
      return {
        suggestions: await Promise.all(shown.map((each) => summaryOf(trx, each))),
        next:
          page.length > limit && last
            ? keysetCursor('suggestions', { at: last.madeAt, id: last.id })
            : null,
      };
    };

  return {
    makeSuggestion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SuggestionView> => {
      const { id } = request.params as { id: string };
      if ((await kindOf(trx, id)) !== 'component') throw notFound();
      const body = request.body as MakeSuggestionBody;
      const proposed: ContentDocument = storableContent(body.content);
      // The version is the component's before anything is read against it (the SG final review).
      const opened = await readVersion(trx, body.version);
      if (opened?.artifactId !== id) {
        throw refused(400, 'version.not_held', 'That version is not one of this component’s.');
      }
      await mayNameColumns(trx, request, proposed, body.version);
      const answer = await makeSuggestion(trx, {
        component: id,
        version: body.version,
        proposed,
        by: principalId,
      });
      switch (answer.answer) {
        case 'made':
          return viewOf(trx, answer.suggestion);
        case 'missing':
          throw refused(400, 'version.not_held', 'That version is not one of this component’s.');
        case 'suggestion.empty':
          throw refused(400, 'suggestion.empty', 'The draft is the version it was made from.');
        case 'suggestion.resolved':
          throw refused(
            409,
            'suggestion.resolved',
            'You sent this draft before, and it has been resolved. Change it to suggest again.',
          );
        case 'suggestion.limit':
          throw refused(
            400,
            'suggestion.limit',
            'You have 20 suggestions pending on this component already.',
          );
      }
    },

    listComponentSuggestions: list('component'),
    listDocumentSuggestions: list('document'),

    getSuggestion: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<SuggestionView> => {
      const { id } = request.params as SuggestionParams;
      if (!(await readSuggestion(trx, id))) throw notFound();
      return viewOf(trx, id);
    },

    acceptSuggestion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SuggestionView> => {
      const { id } = request.params as SuggestionParams;
      const answer = await acceptSuggestion(trx, {
        suggestion: id,
        by: principalId,
        // The save's checks, again, for whoever accepts (SG-B).
        check: async (content, current) => {
          storableContent(content);
          await mayNameColumns(trx, request, content, current.id);
        },
      });
      if (answer.answer !== 'accepted') throw refuse(answer as never);
      return viewOf(trx, id);
    },

    rejectSuggestion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SuggestionView> => {
      const { id } = request.params as SuggestionParams;
      const answer = await rejectSuggestion(trx, { suggestion: id, by: principalId });
      if (answer.answer !== 'rejected') throw refuse(answer as never);
      return viewOf(trx, id);
    },

    withdrawSuggestion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SuggestionView> => {
      const { id } = request.params as SuggestionParams;
      const answer = await withdrawSuggestion(trx, { suggestion: id, by: principalId });
      if (answer.answer !== 'withdrawn') throw refuse(answer as never);
      return viewOf(trx, id);
    },

    /**
     * Every pending suggestion in scope, accepted or rejected (COL-022; SG-H): decided per component,
     * each needing `edit`, components taken in identifier order so two bulk acts never wait on each
     * other crosswise, suggestions oldest first, each accepted its own version. One that cannot be is
     * left pending, said why.
     */
    resolveSuggestions: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<ResolvedSuggestions> => {
      const body = request.body as ResolveSuggestionsBody;
      const scope = body.scope.slice('artifact:'.length);
      const kind = await kindOf(trx, scope);
      if (kind !== 'component' && kind !== 'document') {
        throw refused(
          400,
          'suggestion.scope',
          'Suggestions are resolved on a component or a document.',
        );
      }
      const components = (
        kind === 'component' ? [scope] : await placedReadable(trx, scope, principalId)
      ).sort();
      const pending = (
        await listSuggestions(trx, {
          on: components,
          state: 'pending',
          ...(body.author === undefined ? {} : { author: body.author }),
          limit: BULK_MAX + 1,
        })
      ).sort(
        (a, b) =>
          a.component.localeCompare(b.component) ||
          a.madeAt.getTime() - b.madeAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      if (pending.length > BULK_MAX) {
        throw refused(
          400,
          'suggestion.scope',
          `More than ${BULK_MAX} suggestions are pending here. Resolve them by component or by author.`,
        );
      }
      const known = await loadFactsFor(trx, principalId, components);
      const mayEdit = (component: string) => {
        const facts_ = known.get(component);
        return facts_ !== undefined && decide('edit', { ...facts_, scopes: facts.scopes }).allowed;
      };
      const result: ResolvedSuggestions = { resolved: [], left: [] };
      for (const suggestion of pending) {
        if (!mayEdit(suggestion.component)) {
          result.left.push({ suggestion: suggestion.id, why: 'not_permitted' });
          continue;
        }
        let answer: ResolveAnswer;
        try {
          answer =
            body.act === 'accept'
              ? await acceptSuggestion(trx, {
                  suggestion: suggestion.id,
                  by: principalId,
                  check: async (content, current) => {
                    storableContent(content);
                    await mayNameColumns(trx, request, content, current.id);
                  },
                })
              : await rejectSuggestion(trx, { suggestion: suggestion.id, by: principalId });
        } catch (error) {
          // The save's checks refusing one, for this caller: it is left, and the rest go on. Only
          // our own refusals are caught; a failed statement still ends the whole act.
          if (!(error instanceof AppError)) throw error;
          result.left.push({ suggestion: suggestion.id, why: 'not_permitted' });
          continue;
        }
        switch (answer.answer) {
          case 'accepted':
            result.resolved.push({ suggestion: suggestion.id, version: answer.version.id });
            break;
          case 'rejected':
            result.resolved.push({ suggestion: suggestion.id, version: null });
            break;
          case 'suggestion.stale':
            result.left.push({ suggestion: suggestion.id, why: 'stale', stale: [...answer.stale] });
            break;
          case 'lock.held':
            result.left.push({
              suggestion: suggestion.id,
              why: 'lock_held',
              holder: { id: answer.lock.holder, name: answer.lock.holderName },
            });
            break;
          case 'edits.pending':
            result.left.push({ suggestion: suggestion.id, why: 'edits_pending' });
            break;
          case 'values.invalid':
            result.left.push({ suggestion: suggestion.id, why: 'values_invalid' });
            break;
          default:
            // Withdrawn or resolved by somebody else since it was listed: nothing to do.
            break;
        }
      }
      return result;
    },
  };
}
