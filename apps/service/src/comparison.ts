import type {
  BaselineComparisonQuery,
  BaselineComparisonView,
  BaselineParams,
  ComponentComparisonQuery,
  ComponentComparisonView,
  ComponentParams,
} from '@alloy-works/api-contract';
import {
  latestVersion,
  readBaseline,
  readableComponents,
  readVersion,
  resolveOccurrences,
  versionTitles,
  type StoredVersion,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  compareContent,
  compareOutlines,
  readContent,
  readOutline,
  walkOutline,
  withholdComponents,
  type ContentDocument,
  type OutlineDocument,
  type UnitChange,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';

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
export function comparisonHandlers() {
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
