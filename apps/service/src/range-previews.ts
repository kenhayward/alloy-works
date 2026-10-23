import type {
  RangePageParams,
  RangePreviewParams,
  RangePreviewView,
  RequestRangePreviewBody,
} from '@alloy-works/api-contract';
import {
  readRangePage,
  readRangePreview,
  refreshRangePreview,
  requestRangePreview,
  type RangePreview,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import type { BinaryBody } from './assets.js';
import { refused } from './wire-codes.js';
import { refusePublish } from './publishing.js';

/**
 * PUB-080's words: what the pages are, said to assistive technology on each and on screen beside
 * them, naming the tagged PDF as the accessible way to read the document (the R22 plan, R22-D).
 */
export const UNTAGGED =
  'These pages are pictures drawn as you edit, untagged, so assistive technology cannot read them. For an accessible copy, choose Preview, which makes the tagged PDF.';
const alternative = (page: number) =>
  `Page ${page}, an untagged picture of the preview. For assistive technology, choose Preview, which makes the tagged PDF.`;

export function rangeView(range: RangePreview): RangePreviewView {
  const images =
    range.range === null
      ? []
      : Array.from({ length: range.range.to - range.range.from + 1 }, (_, at) => {
          const page = range.range!.from + at;
          return { page, alternative: alternative(page) };
        });
  return {
    id: range.id,
    // Waiting while a refresh asked for is not drawn; failed only once none is and the last failed, or
    // where nothing can refresh it (the R22 final review).
    state: range.ended
      ? 'failed'
      : range.made < range.wanted
        ? 'waiting'
        : range.failure !== null
          ? 'failed'
          : 'ready',
    node: range.node,
    sequence: range.sequence,
    pages: range.pages,
    images,
    untagged: UNTAGGED,
    failure: range.failure,
  };
}

/**
 * The warm range preview's routes (CNT-186, PUB-080; the R22 plan, R22-B): `read` on the document
 * decided by `authorise` at every one, as a preview's, and each range its asker's alone - anybody
 * else is answered as if there were none.
 */
export function rangePreviewHandlers() {
  const theirs = async (request: FastifyRequest, { trx, principalId }: Authorised) => {
    const { id, range } = request.params as RangePreviewParams;
    const found = await readRangePreview(trx, range, principalId);
    if (!found || found.documentId !== id) throw notFound();
    return found;
  };
  return {
    requestRangePreview: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<RangePreviewView> => {
      const { id } = request.params as { id: string };
      const body = request.body as RequestRangePreviewBody;
      const answer = await requestRangePreview(trx, {
        documentId: id,
        version: body.version,
        node: body.node,
        session: body.session,
        requester: principalId,
        ...(body.profile === undefined ? {} : { profile: body.profile }),
        ...(body.language === undefined ? {} : { language: body.language }),
      });
      if (answer.answer === 'node.missing') {
        throw refused(400, 'node.missing', 'That version places no component at that node.');
      }
      if (answer.answer !== 'requested') return refusePublish(trx, id, answer);
      return rangeView(answer.range);
    },

    getRangePreview: async (request: FastifyRequest, authorised: Authorised) =>
      rangeView(await theirs(request, authorised)),

    refreshRangePreview: async (
      request: FastifyRequest,
      authorised: Authorised,
    ): Promise<RangePreviewView> => {
      const found = await theirs(request, authorised);
      const asked = await refreshRangePreview(authorised.trx, found.id, authorised.principalId);
      if (!asked) throw notFound();
      return rangeView(asked);
    },

    getRangePage: async (request: FastifyRequest, authorised: Authorised): Promise<BinaryBody> => {
      const found = await theirs(request, authorised);
      const { page } = request.params as RangePageParams;
      const png = await readRangePage(
        authorised.trx,
        found.id,
        authorised.principalId,
        Number(page),
      );
      if (!png) throw notFound();
      // A page is drawn again at each refresh: never kept by the browser.
      return { contentType: 'image/png', bytes: png, immutable: false };
    },
  };
}
