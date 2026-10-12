import type {
  BaselineList,
  BaselinePageView,
  BaselineListQuery,
  BaselineParams,
  BaselineSummaryView,
  BaselineView,
  DocumentParams,
  MakeBaselineBody,
  PublicationRequestView,
  PublishBaselineBody,
  SupersedeBaselineBody,
} from '@alloy-works/api-contract';
import {
  baselineDocument,
  listBaselines,
  makeBaseline,
  loadFactsFor,
  pinnedBindings,
  readableComponents,
  readVersion,
  readBaseline,
  requestBaselinePublication,
  supersedeBaseline,
  type BaselineSummary,
  type Tenant,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  decide,
  readContent,
  readLayout,
  readOutline,
  walkOutline,
  withholdComponents,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, type Authorised } from './access.js';
import { pinnedBindingStates } from './data/bindings.js';
import { refusePublish, requestedView } from './publishing.js';
import { refused } from './wire-codes.js';

const summaryView = (baseline: BaselineSummary): BaselineSummaryView => ({
  id: baseline.id,
  document: baseline.documentId,
  name: baseline.name,
  madeBy: baseline.madeBy,
  madeAt: baseline.madeAt.toISOString(),
  digest: baseline.digest,
  superseded:
    baseline.superseded === null
      ? null
      : {
          by: baseline.superseded.by,
          principal: baseline.superseded.principal,
          at: baseline.superseded.at.toISOString(),
        },
});

async function summaryOf(
  trx: TenantTransaction,
  baselineId: string,
  reader: string,
): Promise<BaselineSummaryView> {
  const read = await readBaseline(trx, baselineId, reader);
  if (!read) throw new Error(`The baseline ${baselineId} was not recorded`);
  return summaryView(read);
}

/**
 * Baselines (docs/design/baselines.md; the BL plan, Task 1): each decided by `authorise` on the
 * document - its path's, or the baseline's (BL-H) - in the transaction the handler then runs in, as a
 * publish is, so no grant changes between the decision and what was resolved.
 */
export function baselineHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    makeBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineSummaryView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as MakeBaselineBody;
      const answer = await makeBaseline(trx, {
        documentId: id,
        version: body.version,
        name: body.name,
        maker: principalId,
      });
      switch (answer.answer) {
        case 'made':
          return summaryOf(trx, answer.baseline, principalId);
        case 'name.invalid':
          throw refused(400, 'name.invalid', `${answer.problem}.`);
        case 'name.taken':
          throw refused(409, 'name.taken', 'This document has a baseline by that name already.');
        // Each place by its node alone, as a publish's failures are (issue #143).
        case 'baseline.unresolved':
          throw refused(
            400,
            'baseline.unresolved',
            `${answer.failures.length === 1 ? 'A place' : `${answer.failures.length} places`} in this document cannot be pinned as you can read it.`,
            { places: answer.failures },
          );
        default:
          return refusePublish(trx, id, answer);
      }
    },

    listBaselines: async (request: FastifyRequest, { trx }: Authorised): Promise<BaselineList> => {
      const { id } = request.params as DocumentParams;
      const { state } = request.query as BaselineListQuery;
      return { baselines: (await listBaselines(trx, id, state)).map(summaryView) };
    },

    getBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineView> => {
      const { id } = request.params as BaselineParams;
      const read = await readBaseline(trx, id, principalId);
      if (!read) throw notFound();
      const { pins, withheld } = read;
      return {
        ...summaryView(read),
        pins: {
          ...pins,
          occurrences: [...pins.occurrences],
          assets: [...pins.assets],
          bindings: pins.bindings.map(({ revisions, ...each }) => ({
            ...each,
            ...(revisions === undefined ? {} : { revisions: [...revisions] }),
          })),
        },
        withheld: { nodes: [...withheld.nodes], assets: withheld.assets },
      };
    },

    /**
     * A publish of the baseline from its pins (BL-F): decided on its document, as a publish is, and
     * asked for in that same transaction; the caller reads everything it pins, or is told by node.
     */
    /**
     * The document as the baseline holds it (STR-047; BL-I): its outline at the pinned version,
     * withheld where the caller may not read a component, as the document's own is; the pinned
     * layout's scheme and words; each readable occurrence's text at its pin; and each of their
     * bindings against the resolution pinned. Nothing here is read at its latest.
     */
    getBaselineView: async (
      request: FastifyRequest,
      authorised: Authorised,
    ): Promise<BaselinePageView> => {
      const { trx, principalId } = authorised;
      const { id } = request.params as BaselineParams;
      const read = await readBaseline(trx, id, principalId);
      if (!read) throw notFound();
      const versionOf = async (version: string) => {
        const found = await readVersion(trx, version);
        if (!found) throw new Error(`The version ${version} a baseline pins is gone`);
        return found;
      };
      const document = await versionOf(read.pins.document.version);
      const outline = readOutline(document.content, {
        artifact: read.documentId,
        version: document.id,
      });
      if (!outline.ok) throw new Error(`The document ${read.documentId} does not read`);
      const components: string[] = [];
      walkOutline(outline.outline.nodes, (node) => {
        if (node.type === 'reference') components.push(node.component);
      });
      const readable = await readableComponents(trx, principalId, components);
      const layoutVersion = await versionOf(read.pins.layout.version);
      const layout = readLayout(layoutVersion.content, {
        artifact: layoutVersion.artifactId,
        version: layoutVersion.id,
      });
      if (!layout.ok) throw new Error(`The layout ${layoutVersion.id} does not read`);
      // `readBaseline` answered only the occurrences the caller may read.
      const texts = [];
      for (const pin of read.pins.occurrences) {
        const version = await versionOf(pin.version);
        const content = readContent(version.content, {
          artifact: version.artifactId,
          version: version.id,
        });
        if (!content.ok) throw new Error(`The component version ${version.id} does not read`);
        texts.push({
          node: pin.node,
          component: version.artifactId,
          version: { id: version.id, number: `${version.revision}.${version.version}` },
          title: content.document.title,
          content: content.document as unknown as Record<string, unknown>,
          document: content.document,
        });
      }
      const shown = new Set(texts.map((each) => each.node));
      // What Review offers here (RR-G): comment on the document, and on each component pinned.
      const commenting = await loadFactsFor(
        trx,
        principalId,
        texts.map((each) => each.component),
      );
      const mayCommentOn = (component: string) => {
        const facts = commenting.get(component);
        return facts !== undefined && decide('comment', facts).allowed;
      };
      const onDocument = decide('comment', authorised.facts).allowed;
      const mayReview =
        onDocument ||
        decide('suggest', authorised.facts).allowed ||
        texts.some((each) => mayCommentOn(each.component));
      const bindings = await pinnedBindingStates(
        trx,
        callerOf(request),
        objects,
        tenantOf(request),
        {
          documentId: read.documentId,
          parameters: document.parameters,
          occurrences: texts.map((each) => ({
            node: each.node,
            component: each.component,
            content: each.document,
          })),
          pinned: (await pinnedBindings(trx, id)).filter((each) => shown.has(each.node)),
        },
      );
      return {
        baseline: summaryView(read),
        version: { id: document.id, number: `${document.revision}.${document.version}` },
        outline: withholdComponents(outline.outline, (component) => readable.has(component)),
        layout: {
          version: {
            id: layoutVersion.id,
            number: `${layoutVersion.revision}.${layoutVersion.version}`,
          },
          scheme: { ...layout.layout.scheme },
          words: { ...layout.layout.words },
        },
        texts: texts.map(({ document: _read, ...each }) => ({
          ...each,
          mayComment: mayCommentOn(each.component),
        })),
        bindings,
        mayComment: onDocument,
        mayReview,
      };
    },

    publishBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<PublicationRequestView> => {
      const { id } = request.params as BaselineParams;
      const { formats } = request.body as PublishBaselineBody;
      const answer = await requestBaselinePublication(trx, {
        baseline: id,
        formats,
        requester: principalId,
      });
      switch (answer.answer) {
        case 'requested':
          return requestedView(trx, answer.request.id);
        case 'baseline.unreadable':
          throw refused(
            400,
            'baseline.unreadable',
            'This baseline pins something you may not read, so you cannot publish it.',
            { nodes: answer.nodes, assets: answer.assets },
          );
        default: {
          const document = await baselineDocument(trx, id);
          return refusePublish(trx, document!, answer);
        }
      }
    },

    supersedeBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineSummaryView> => {
      const { id } = request.params as BaselineParams;
      const { by } = request.body as SupersedeBaselineBody;
      // Decided on this baseline's document, so `by` is read only once it is shown to be of it.
      if ((await baselineDocument(trx, id)) === undefined) throw notFound();
      const answer = await supersedeBaseline(trx, { baseline: id, by, principal: principalId });
      switch (answer.answer) {
        case 'superseded':
          return summaryOf(trx, id, principalId);
        case 'superseder.invalid':
          throw refused(
            400,
            'superseder.invalid',
            'A baseline is superseded only by a later baseline of the same document.',
          );
        case 'superseded.already':
          throw refused(409, 'superseded.already', 'This baseline is superseded already.');
      }
    },
  };
}
