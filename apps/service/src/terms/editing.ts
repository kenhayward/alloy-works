import type {
  ComponentParams,
  TermStandingPreview,
  TermStandingPreviewBody,
} from '@alloy-works/api-contract';
import { latestVersion, readVersion, termsInSpace, type TenantTransaction } from '@alloy-works/db';
import {
  parseContentDocument,
  termPlaces,
  type ContentDocument,
  type Term,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, type Authorised } from '../access.js';
import { refused } from '../wire-codes.js';

/**
 * Terms in the editor (the TM plan, TMc, TM-K): what a save may use, and each used term's standing as
 * its editor flags it (LIB-018).
 */

const usedIn = (content: ContentDocument): Set<string> =>
  new Set(termPlaces(content).map((span) => span.term));

/** The space of an artifact, or null. */
async function spaceOf(trx: TenantTransaction, artifact: string): Promise<string | null> {
  const row = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', artifact)
    .executeTakeFirst();
  return row?.space_id ?? null;
}

/**
 * **A save uses only terms its author may read in the component's space** (TM-K), as `mayCite`: a
 * term mark naming a term the version it opened from did not use is refused `term_unreadable` unless
 * the term is the component's space's and its author may read it. One already used is left alone. A
 * save using a term takes the space's terms lock as it is indexed, so an archive cannot miss it.
 */
export async function mayUseTerms(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<void> {
  if (await usesUnreadableTerm(trx, request, content, openedFrom)) {
    throw refused(
      400,
      'term.unreadable',
      "A term names no term of this component's space that you may read.",
    );
  }
}

/** Whether `mayUseTerms` refuses the content: what a restore's checks ask too. */
export async function usesUnreadableTerm(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  openedFrom: string,
): Promise<boolean> {
  const used = usedIn(content);
  if (used.size === 0) return false;
  const opened = await readVersion(trx, openedFrom);
  if (!opened) return false;
  let before = new Set<string>();
  try {
    before = usedIn(parseContentDocument(opened.content));
  } catch {
    // A version that no longer parses used nothing a save could be measured against.
  }
  return unreadableAmong(trx, request, used, before, await spaceOf(trx, opened.artifactId));
}

/** `mayUseTerms` for a component yet to be made in a space: every term it uses is new. */
export async function mayUseTermsIn(
  trx: TenantTransaction,
  request: FastifyRequest,
  content: ContentDocument,
  space: string,
): Promise<void> {
  if (await unreadableAmong(trx, request, usedIn(content), new Set(), space)) {
    throw refused(
      400,
      'term.unreadable',
      "A term names no term of this component's space that you may read.",
    );
  }
}

/** Whether a term used and not used `before` is no term of the space its caller may read. */
async function unreadableAmong(
  trx: TenantTransaction,
  request: FastifyRequest,
  used: ReadonlySet<string>,
  before: ReadonlySet<string>,
  space: string | null,
): Promise<boolean> {
  const added = [...used].filter((term) => !before.has(term));
  if (added.length === 0) return false;
  const readable =
    space === null
      ? new Map()
      : await termsInSpace(trx, callerOf(request).principalId, space, added);
  return added.some((term) => !readable.has(term));
}

const preferred = (term: Term): string =>
  (term.labels.find((each) => each.language === term.base) ?? term.labels[0])!.preferred;

export function termEditingHandlers() {
  return {
    /**
     * Each term's standing and preferred label, in order, a deprecated one's replacement named where
     * the caller may read it; unavailable where it is no term of the component's space they may read.
     */
    previewComponentTerms: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TermStandingPreview> => {
      const { id } = request.params as ComponentParams;
      const body = request.body as TermStandingPreviewBody;
      const component = await latestVersion(trx, id);
      if (!component || component.kind !== 'component') throw notFound();
      const space = await spaceOf(trx, id);
      const read =
        space === null ? new Map() : await termsInSpace(trx, principalId, space, body.terms);
      const replacements = [...read.values()].flatMap(({ term }) =>
        term.replacedBy === undefined || read.has(term.replacedBy) ? [] : [term.replacedBy],
      );
      const instead =
        space === null || replacements.length === 0
          ? new Map()
          : await termsInSpace(trx, principalId, space, replacements);
      const labelOf = (term: string) => {
        const found = read.get(term) ?? instead.get(term);
        return found === undefined ? null : preferred(found.term);
      };
      return {
        terms: body.terms.map((each) => {
          const found = read.get(each);
          if (found === undefined)
            return { standing: 'unavailable', label: null, replacedBy: null };
          const deprecated = found.standing?.key === 'deprecated';
          // A replacement the caller may not read is not named, by its id or otherwise.
          const instead =
            deprecated && found.term.replacedBy !== undefined
              ? labelOf(found.term.replacedBy)
              : null;
          return {
            standing: deprecated ? 'deprecated' : found.standing?.approved ? 'approved' : 'draft',
            label: preferred(found.term),
            replacedBy: instead === null ? null : { id: found.term.replacedBy!, label: instead },
          };
        }),
      };
    },
  };
}
