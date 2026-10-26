import type {
  CreateTermBody,
  ImportTermsBody,
  SpaceParams,
  TermImportAnswer,
  TermListQuery,
  TermParams,
  TermUsesView,
  TermVersionBody,
  TermView,
} from '@alloy-works/api-contract';
import { TERM_IMPORT_CONCEPTS_MOST } from '@alloy-works/api-contract';
import {
  archiveTerm,
  createTerm,
  importTerms,
  listTerms,
  readTerm,
  recordTermVersion,
  termsForExport,
  termUses,
  type StoredTerm,
  type TermAnswer,
  type TermSummary,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { cursorFor, pageAsked } from '../listing.js';
import { refused } from '../wire-codes.js';
import { workflowView } from '../workflows.js';
import { exportSkos, readSkos, SKOS_QUADS_MOST } from './skos.js';
import { languageOf } from '../listing.js';

/** The term routes (terms.md; the TM plan, TM-A, TM-J). Moves are the workflow routes'. */

async function termView(
  trx: TenantTransaction,
  principalId: string,
  stored: StoredTerm,
  facts: AccessFacts,
): Promise<TermView> {
  return {
    id: stored.id,
    space: stored.space,
    version: versionView(stored.version),
    term: stored.term,
    archived: stored.archived,
    deprecated: stored.deprecated,
    mayEdit: decide('edit', facts).allowed,
    mayRetire: decide('retire', facts).allowed,
    ...(await workflowView(trx, stored.id, facts, principalId)),
  };
}

const summaryView = (summary: TermSummary) => ({
  id: summary.id,
  label: summary.label,
  abbreviation: summary.abbreviation,
  term: summary.term,
  version: {
    id: summary.version.id,
    number: `${summary.version.revision}.${summary.version.version}`,
  },
  changedAt: summary.changedAt.toISOString(),
  state: summary.standing,
});

/** A writer's answer that is not a term: refused by name, or absent. */
async function refusedTerm(
  trx: TenantTransaction,
  principalId: string,
  answer: Exclude<TermAnswer, { term: StoredTerm }>,
  facts: AccessFacts,
): Promise<never> {
  switch (answer.answer) {
    case 'term.refused':
      throw refused(400, 'term.invalid', 'The term is not valid.', { problems: answer.problems });
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This term has a newer version than the one this page opened.',
        { current: await termView(trx, principalId, answer.current, facts) },
      );
    case 'space.missing':
    case 'term.missing':
      throw notFound();
  }
}

export function termHandlers() {
  return {
    listTerms: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const query = request.query as TermListQuery;
      const asked = pageAsked('terms', query, languageOf(request));
      const listed = await listTerms(trx, principalId, space, asked, {
        archived: query.archived === 'true',
      });
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map(summaryView),
        next: cursorFor(
          'terms',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
        total: listed.total,
      };
    },

    createTerm: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateTermBody;
      const answer = await createTerm(trx, {
        author: principalId,
        spaceId: space,
        term: body.term,
      });
      // Decided at the space, which a new term inherits from.
      if ('term' in answer) return termView(trx, principalId, answer.term, facts);
      return refusedTerm(trx, principalId, answer, facts);
    },

    importTerms: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TermImportAnswer> => {
      const { space } = request.params as SpaceParams;
      const body = request.body as ImportTermsBody;
      const read = await readSkos(body.format, body.text, body.base);
      if (read === undefined) {
        throw refused(400, 'import.unreadable', 'The text does not read as that format.');
      }
      if (read.tooMany) {
        throw refused(
          400,
          'import.too_many',
          `The text holds more than ${TERM_IMPORT_CONCEPTS_MOST} concepts or ${SKOS_QUADS_MOST} statements; import fewer at a time.`,
        );
      }
      const done = await importTerms(trx, {
        author: principalId,
        spaceId: space,
        concepts: read.concepts,
      });
      if (!done) throw notFound();
      return {
        concepts: done.map((each) => ({
          key: each.key,
          outcome: each.outcome,
          term:
            each.outcome === 'refused'
              ? null
              : {
                  id: each.term.id,
                  label: each.term.term.labels.find(
                    (label) => label.language === each.term.term.base,
                  )!.preferred,
                },
          merged: each.outcome === 'merged' ? [...each.merged] : [],
          message: each.outcome === 'refused' ? each.message : null,
        })),
        unrepresented: read.unrepresented,
        unrepresentedTotal: read.unrepresentedTotal,
      };
    },

    exportTerms: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const terms = await termsForExport(trx, principalId, space);
      if (!terms) throw notFound();
      return { format: 'json-ld' as const, text: JSON.stringify(exportSkos(terms), null, 2) };
    },

    // `authorise` never looks at an artifact's kind; `readTerm` answers nothing for another kind.
    getTerm: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as TermParams;
      const stored = await readTerm(trx, id);
      if (!stored) throw notFound();
      return termView(trx, principalId, stored, facts);
    },

    recordTermVersion: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as TermParams;
      const body = request.body as TermVersionBody;
      const answer = await recordTermVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        term: body.term,
      });
      if ('term' in answer) return termView(trx, principalId, answer.term, facts);
      return refusedTerm(trx, principalId, answer, facts);
    },

    getTermUses: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TermUsesView> => {
      const { id } = request.params as TermParams;
      if (!(await readTerm(trx, id))) throw notFound();
      const uses = await termUses(trx, principalId, id);
      return { named: [...uses.named], unreadable: uses.unreadable };
    },

    archiveTerm: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as TermParams;
      const answer = await archiveTerm(trx, id, principalId, 'archived');
      if (answer === undefined) throw notFound();
      if (answer === 'used') throw refused(409, 'term.used', 'The term is used, so it is kept.');
      return { archived: true };
    },

    unarchiveTerm: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as TermParams;
      if ((await archiveTerm(trx, id, principalId, 'unarchived')) === undefined) throw notFound();
      return { archived: false };
    },
  };
}
