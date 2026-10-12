import type {
  BaselineComparisonQuery,
  BaselineComparisonView,
  BaselineParams,
  ComponentComparisonQuery,
  BindingStateView,
  ComponentComparisonView,
  ComponentParams,
  ResolvedComparisonView,
} from '@alloy-works/api-contract';
import {
  documentLayout,
  documentTemplate,
  documentTheme,
  latestVersion,
  pinnedBindings,
  readBaseline,
  readableComponents,
  readVersion,
  resolveOccurrences,
  versionTitles,
  type StoredVersion,
  type Tenant,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  compareContent,
  compareOutlines,
  compareResolved,
  readContent,
  readOutline,
  walkOutline,
  withholdComponents,
  type ContentDocument,
  type OutlineDocument,
  type ResolvedSide,
  type ResolvedValue,
  type UnitChange,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, type Authorised } from './access.js';
import { liveBindingStates, pinnedBindingStates } from './data/bindings.js';

const numberOf = (version: StoredVersion) => `${version.revision}.${version.version}`;
const sideOf = (version: StoredVersion) => ({ id: version.id, number: numberOf(version) });
const changesView = (changes: readonly UnitChange[]) =>
  changes.map((each) => ({ ...each })) as ComponentComparisonView['changes'];

/** A component's version read as content, or nothing where it is not one of `component`'s. */
async function componentVersion(
  trx: TenantTransaction,
  component: string,
  version: string,
): Promise<{ stored: StoredVersion; content: ContentDocument } | undefined> {
  const stored = await readVersion(trx, version);
  if (!stored || stored.artifactId !== component || stored.kind !== 'component') return undefined;
  const read = readContent(stored.content, { artifact: component, version });
  if (!read.ok) throw new Error(`The component ${component} at ${version} does not read`);
  return { stored, content: read.document };
}

/** One side of a document's comparison: its version, outline, and each node's component version. */
interface DocumentSide {
  readonly baseline: { readonly id: string; readonly name: string } | null;
  readonly version: StoredVersion;
  readonly outline: OutlineDocument;
  /** Each node the caller may read, by its component's version. */
  readonly occurrences: ReadonlyMap<string, string>;
}

/**
 * Comparison (comparison.md; the CP plan, Task 2): every answer read as its caller (VER-050). A
 * component they may not read is its node alone, in an outline withheld as the document's own is:
 * where it stands, never whether it changed.
 */
export function comparisonHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    compareComponentVersions: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ComponentComparisonView> => {
      const { id } = request.params as ComponentParams;
      const { from, to } = request.query as ComponentComparisonQuery;
      const older = await componentVersion(trx, id, from);
      const newer = await componentVersion(trx, id, to);
      if (!older || !newer) throw notFound();
      return {
        component: id,
        from: sideOf(older.stored),
        to: sideOf(newer.stored),
        older: older.content as unknown as Record<string, unknown>,
        newer: newer.content as unknown as Record<string, unknown>,
        changes: changesView(compareContent(older.content, newer.content).changes),
      };
    },

    /**
     * What a publish of each side would print, compared (VER-024's third level, VER-031, VER-045;
     * CP-G): each side's layout, theme, template and definitions, and each readable node's component
     * version, definitions and printed values - a baseline's from its pins, the document now's from
     * its latest resolutions - and `compareResolved` naming each difference's cause.
     */
    compareBaselineResolved: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ResolvedComparisonView> => {
      const { id } = request.params as BaselineParams;
      const { with: other } = request.query as BaselineComparisonQuery;
      const caller = callerOf(request);
      const tenant = tenantOf(request);
      const definitionsOf = (version: StoredVersion) =>
        version.definitions.map((each) => each.version);
      /** Each readable node's resolution, its values taken from these bindings' states. */
      const nodesOf = async (
        occurrences: ReadonlyMap<string, string>,
        states: (
          contents: readonly { node: string; component: string; content: ContentDocument }[],
        ) => Promise<readonly BindingStateView[]>,
      ) => {
        const read: {
          node: string;
          component: string;
          content: ContentDocument;
          stored: StoredVersion;
        }[] = [];
        for (const [node, version] of occurrences) {
          const stored = await readVersion(trx, version);
          if (!stored || stored.kind !== 'component') continue;
          const content = readContent(stored.content, { artifact: stored.artifactId, version });
          if (!content.ok) throw new Error(`The component version ${version} does not read`);
          read.push({ node, component: stored.artifactId, content: content.document, stored });
        }
        const values = new Map<string, Map<string, ResolvedValue>>();
        for (const state of await states(read)) {
          const taken = state.held?.taken ?? null;
          const printed =
            taken === null
              ? null
              : 'value' in taken
                ? String(taken.value)
                : 'image' in taken
                  ? `image ${taken.image}`
                  : JSON.stringify(taken);
          if (!values.has(state.node)) values.set(state.node, new Map());
          values.get(state.node)!.set(state.binding.id, {
            dataset: state.held?.version ?? null,
            printed,
          });
        }
        return new Map(
          read.map((each) => [
            each.node,
            {
              component: each.component,
              version: each.stored.id,
              definitions: definitionsOf(each.stored),
              values: values.get(each.node) ?? new Map(),
            },
          ]),
        );
      };

      const baselineSide = async (baseline: string) => {
        const read = await readBaseline(trx, baseline, principalId);
        if (!read) return undefined;
        const document = await readVersion(trx, read.pins.document.version);
        if (!document) throw new Error(`The version ${read.pins.document.version} is gone`);
        const pinned = await pinnedBindings(trx, baseline);
        const side: ResolvedSide = {
          layout: read.pins.layout.version,
          theme: read.pins.theme.version,
          template: read.pins.template?.version ?? null,
          definitions: definitionsOf(document),
          nodes: await nodesOf(
            new Map(read.pins.occurrences.map((each) => [each.node, each.version])),
            (contents) =>
              pinnedBindingStates(trx, caller, objects, tenant, {
                documentId: read.documentId,
                parameters: document.parameters,
                occurrences: contents,
                pinned: pinned.filter((each) => contents.some((one) => one.node === each.node)),
              }),
          ),
        };
        return { side, documentId: read.documentId };
      };

      const older = await baselineSide(id);
      if (!older) throw notFound();
      let newer: ResolvedSide;
      if (other === 'now') {
        const version = await latestVersion(trx, older.documentId);
        if (!version) throw new Error(`The document ${older.documentId} is gone`);
        const resolved = await resolveOccurrences(
          trx,
          outlineOf(version, older.documentId),
          principalId,
        );
        const live =
          (await liveBindingStates(trx, caller, objects, tenant, older.documentId)) ?? [];
        newer = {
          layout: (await documentLayout(trx, older.documentId)).versionId,
          theme: (await documentTheme(trx, older.documentId)).versionId,
          template: (await documentTemplate(trx, older.documentId))?.version ?? null,
          definitions: definitionsOf(version),
          nodes: await nodesOf(
            new Map(
              resolved.flatMap((each) =>
                each.outcome === 'resolved' ? [[each.node, each.version] as const] : [],
              ),
            ),
            async () => live,
          ),
        };
      } else {
        const found = await baselineSide(other);
        if (!found || found.documentId !== older.documentId) throw notFound();
        newer = found.side;
      }

      const compared = compareResolved(older.side, newer);
      const titleOf = await versionTitles(
        trx,
        compared.nodes.flatMap((each) => {
          const node = newer.nodes.get(each.node);
          return node ? [node.version] : [];
        }),
      );
      return {
        document: [...compared.document],
        nodes: compared.nodes.map((each) => ({
          node: each.node,
          title: titleOf.get(newer.nodes.get(each.node)!.version) ?? '',
          causes: [...each.causes],
          values: each.values.map((value) => ({ ...value })),
        })),
      };
    },

    compareBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineComparisonView> => {
      const { id } = request.params as BaselineParams;
      const { with: other } = request.query as BaselineComparisonQuery;
      const baselineSide = async (baseline: string): Promise<DocumentSide | undefined> => {
        const read = await readBaseline(trx, baseline, principalId);
        if (!read) return undefined;
        const version = await readVersion(trx, read.pins.document.version);
        if (!version) throw new Error(`The version ${read.pins.document.version} is gone`);
        return {
          baseline: { id: read.id, name: read.name },
          version,
          outline: outlineOf(version, read.documentId),
          // `readBaseline` answers only the occurrences the caller may read.
          occurrences: new Map(read.pins.occurrences.map((each) => [each.node, each.version])),
        };
      };
      const older = await baselineSide(id);
      if (!older) throw notFound();
      const documentId = older.version.artifactId;
      let newer: DocumentSide | undefined;
      if (other === 'now') {
        // The document as it resolves now, as the caller reads it, without a publish's gate (CP-D).
        const version = await latestVersion(trx, documentId);
        if (!version) throw new Error(`The document ${documentId} is gone`);
        const outline = outlineOf(version, documentId);
        const resolved = await resolveOccurrences(trx, outline, principalId);
        newer = {
          baseline: null,
          version,
          outline,
          occurrences: new Map(
            resolved.flatMap((each) =>
              each.outcome === 'resolved' ? [[each.node, each.version] as const] : [],
            ),
          ),
        };
      } else {
        newer = await baselineSide(other);
        if (!newer || newer.version.artifactId !== documentId) throw notFound();
      }

      // Both outlines withheld by one readable set, so a withheld node compares equal to itself.
      const references: string[] = [];
      for (const side of [older, newer]) {
        walkOutline(side.outline.nodes, (node) => {
          if (node.type === 'reference') references.push(node.component);
        });
      }
      const readable = await readableComponents(trx, principalId, references);
      const withheld = (outline: OutlineDocument) =>
        withholdComponents(outline, (component) => readable.has(component));
      const olderOutline = withheld(older.outline);
      const newerOutline = withheld(newer.outline);

      // Each readable reference's title, from the newer side's version where it has one.
      const placed = new Map([...older.occurrences, ...newer.occurrences]);
      const titleOf = await versionTitles(trx, [...placed.values()]);
      const titles = [...placed].map(([node, version]) => ({
        node,
        title: titleOf.get(version) ?? '',
      }));

      const components: BaselineComparisonView['components'] = [];
      for (const [node, version] of newer.occurrences) {
        const was = older.occurrences.get(node);
        if (was === undefined || was === version) continue;
        const before = await readVersion(trx, was);
        const after = await readVersion(trx, version);
        if (!before || !after || before.artifactId !== after.artifactId) continue;
        const component = after.artifactId;
        if (!readable.has(component)) continue;
        const left = await componentVersion(trx, component, was);
        const right = await componentVersion(trx, component, version);
        if (!left || !right) continue;
        components.push({
          node,
          component,
          from: sideOf(left.stored),
          to: sideOf(right.stored),
          older: left.content as unknown as Record<string, unknown>,
          newer: right.content as unknown as Record<string, unknown>,
          changes: changesView(compareContent(left.content, right.content).changes),
        });
      }
      return {
        older: {
          baseline: older.baseline,
          version: sideOf(older.version),
          outline: olderOutline as unknown as Record<string, unknown>,
        },
        newer: {
          baseline: newer.baseline,
          version: sideOf(newer.version),
          outline: newerOutline as unknown as Record<string, unknown>,
        },
        structure: changesView(compareOutlines(olderOutline, newerOutline).changes),
        titles,
        components,
      };
    },
  };
}

function outlineOf(version: StoredVersion, document: string): OutlineDocument {
  const read = readOutline(version.content, { artifact: document, version: version.id });
  if (!read.ok) throw new Error(`The document ${document} at ${version.id} does not read`);
  return read.outline;
}
