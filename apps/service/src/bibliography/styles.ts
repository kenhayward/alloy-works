import type {
  CreateStyleBody,
  PreviewStyleBody,
  StylePreview,
  StyleParams,
  StyleVersionBody,
  StyleView,
} from '@alloy-works/api-contract';
import {
  createStyle,
  listStyles,
  readStyle,
  recordStyleVersion,
  type StoredStyle,
  type StyleAnswer,
} from '@alloy-works/db';
import { decide, type AccessFacts, type PublishedRun } from '@alloy-works/domain';
import {
  checkStyle,
  renderCitations,
  SAMPLE_CITATIONS,
  SAMPLE_ENTRIES,
  styleTitle,
  variablesUsed,
} from '@alloy-works/domain/citations';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { refused } from '../wire-codes.js';

/**
 * The citation style routes (citations.md, "The style"; the CI plan, CI-D): the environment's, as
 * prompt libraries are, `design` here uploading and changing one. citeproc-js runs here, never in the
 * browser: the page's preview and proposed `requires` are this service's.
 */

function styleView(stored: StoredStyle, facts: AccessFacts): StyleView {
  return {
    id: stored.id,
    version: versionView(stored.version),
    style: stored.style,
    seeded: stored.seeded,
    mayEdit: decide('design', facts).allowed,
  };
}

function refusedStyle(
  answer: Exclude<StyleAnswer, { style: StoredStyle }>,
  facts: AccessFacts,
): never {
  switch (answer.answer) {
    case 'style.refused':
      throw refused(400, 'style.invalid', 'The citation style is not valid.', {
        problems: answer.problems,
      });
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This citation style has a newer version than the one this page opened.',
        { current: styleView(answer.current, facts) },
      );
    default:
      throw notFound();
  }
}

/** Runs as the wire carries them. */
const runsView = (runs: readonly PublishedRun[]) =>
  runs.map((run) => ({
    text: run.text,
    marks: run.marks.map((mark) =>
      mark.kind === 'hyperlink' ? { kind: mark.kind, href: mark.href } : { kind: mark.kind },
    ),
  }));

/** The invented sample entries rendered in a style, and what it would be refused for. */
export function previewStyle(csl: string, language?: string): StylePreview {
  const problems = checkStyle(csl);
  if (problems.length > 0) return { problems, proposed: {}, sample: null };
  const title = styleTitle(csl);
  const rendered = renderCitations({
    style: csl,
    ...(language === undefined ? {} : { language }),
    entries: SAMPLE_ENTRIES,
    citations: SAMPLE_CITATIONS,
  });
  return {
    ...(title === undefined ? {} : { title }),
    problems: [],
    proposed: variablesUsed(csl),
    sample: {
      citations: rendered.citations.map(runsView),
      bibliography: rendered.bibliography.map((each) => ({
        entry: each.entry,
        ...(each.label === undefined ? {} : { label: runsView(each.label) }),
        runs: runsView(each.runs),
      })),
    },
  };
}

export function citationStyleHandlers() {
  return {
    listCitationStyles: async (_request: FastifyRequest, { trx }: Authorised) => ({
      items: (await listStyles(trx)).map((each) => ({
        id: each.id,
        name: each.style.name,
        seeded: each.seeded,
        version: { id: each.version.id, number: versionView(each.version).number },
      })),
    }),

    createCitationStyle: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { style } = request.body as CreateStyleBody;
      const answer = await createStyle(trx, { author: principalId, style });
      if (answer.answer !== 'created') {
        return refusedStyle(answer as Exclude<StyleAnswer, { style: StoredStyle }>, facts);
      }
      return styleView(answer.style, facts);
    },

    previewCitationStyle: async (request: FastifyRequest) => {
      const { csl, language } = request.body as PreviewStyleBody;
      return previewStyle(csl, language);
    },

    getCitationStyle: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as StyleParams;
      const stored = await readStyle(trx, id);
      if (!stored) throw notFound();
      return styleView(stored, facts);
    },

    recordCitationStyleVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as StyleParams;
      const body = request.body as StyleVersionBody;
      const answer = await recordStyleVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        style: body.style,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return styleView(answer.style, facts);
      }
      return refusedStyle(answer as Exclude<StyleAnswer, { style: StoredStyle }>, facts);
    },
  };
}
