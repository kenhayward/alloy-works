import type {
  ComponentVersionView,
  DocumentVersionView,
  RestoreParams,
} from '@alloy-works/api-contract';
import {
  headVersion,
  isArchived,
  latestVersionsOf,
  readableComponents,
  readVersion,
  resolveOccurrences,
  versionTitles,
  type StoredVersion,
  type TenantTransaction,
} from '@alloy-works/db';
import { readContent, readOutline, walkOutline, withholdComponents } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { shownVersionView } from './components.js';

/** The version a path names, of the artifact it names and of `kind`; not found otherwise. */
async function versionAt(
  trx: TenantTransaction,
  request: FastifyRequest,
  kind: 'component' | 'document',
): Promise<StoredVersion> {
  const { id, version } = request.params as RestoreParams;
  const found = await readVersion(trx, version);
  if (found?.artifactId !== id || found.kind !== kind) throw notFound();
  return found;
}

/** Its heading: number, note, when, and who by their name now, an erased person's the erased label. */
async function headingOf(trx: TenantTransaction, version: StoredVersion) {
  const author =
    version.author === null
      ? undefined
      : await trx
          .selectFrom('principal')
          .select('display_name')
          .where('id', '=', version.author)
          .executeTakeFirst();
  // A line's version by the number people see, against its line's latest (LOC-012; ADR-0063).
  const onLine =
    version.line === null ? undefined : await headVersion(trx, version.artifactId, version.line);
  const latest = onLine
    ? { id: onLine.id, number: (await shownVersionView(trx, onLine)).number }
    : (await latestVersionsOf(trx, [version.artifactId])).get(version.artifactId);
  if (!latest) throw new Error(`The artifact ${version.artifactId} has no latest version`);
  return {
    version: {
      id: version.id,
      number: (await shownVersionView(trx, version)).number,
      createdAt: version.createdAt.toISOString(),
      note: version.note,
      author:
        version.author === null ? null : { id: version.author, name: author?.display_name ?? null },
    },
    latest: { id: latest.id, number: latest.number },
    archived: await isArchived(trx, version.artifactId),
  };
}

/**
 * One version, read only (the SV plan, SV-H; SCH-058): decided `read` on the artifact by the route,
 * which answers a deleted one 410 before this runs.
 */
export function versionHandlers() {
  return {
    getComponentVersion: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ComponentVersionView> => {
      const version = await versionAt(trx, request, 'component');
      const read = readContent(version.content, {
        artifact: version.artifactId,
        version: version.id,
      });
      if (!read.ok) throw new Error(`The component version ${version.id} does not read`);
      return {
        component: version.artifactId,
        title: read.document.title,
        ...(await headingOf(trx, version)),
        content: read.document as unknown as Record<string, unknown>,
        values: { ...version.values },
      };
    },

    /** Its outline withheld as the document view's is (documents.ts), and no component's text. */
    getDocumentVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<DocumentVersionView> => {
      const version = await versionAt(trx, request, 'document');
      const read = readOutline(version.content, {
        artifact: version.artifactId,
        version: version.id,
      });
      if (!read.ok) throw new Error(`The document version ${version.id} does not read`);
      const components: string[] = [];
      walkOutline(read.outline.nodes, (node) => {
        if (node.type === 'reference') components.push(node.component);
      });
      const readable = await readableComponents(trx, principalId, components);
      const placed = (await resolveOccurrences(trx, read.outline, principalId)).flatMap((each) =>
        each.outcome === 'resolved' ? [{ node: each.node, version: each.version }] : [],
      );
      const titleOf = await versionTitles(
        trx,
        placed.map((each) => each.version),
      );
      return {
        document: version.artifactId,
        title: read.outline.title,
        ...(await headingOf(trx, version)),
        outline: withholdComponents(read.outline, (component) =>
          readable.has(component),
        ) as unknown as Record<string, unknown>,
        titles: placed.map(({ node, version: placedVersion }) => ({
          node,
          title: titleOf.get(placedVersion) ?? '',
        })),
        values: { ...version.values },
      };
    },
  };
}
