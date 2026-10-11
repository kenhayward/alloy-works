import { walkOutline, readOutline } from '@alloy-works/domain';
import { loadReadableSet } from './access-facts.js';
import { readDocument, readableComponents } from './documents.js';
import { readLocks } from './editing.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a stream ranges over: one document, or one component opened on its own (realtime.md). */
export type StreamScope = { readonly document: string } | { readonly component: string };

/** A held lock as a stream says it: whose, and when it is expected back (COL-007). */
export interface LockShown {
  readonly component: string;
  readonly holder: { readonly id: string; readonly name: string | null } | null;
  readonly expectedRelease: string | null;
}

/**
 * **What a viewer's stream may hear of** (the PL plan, PL-B): the components in its scope the viewer
 * may read - a document's referenced components, or the one component - or undefined where the
 * viewer may not read the scope itself, which the stream answers as nothing there. Read when the stream
 * opens, and again when its document's outline changes.
 */
export async function streamScope(
  trx: TenantTransaction,
  principalId: string,
  scope: StreamScope,
): Promise<ReadonlySet<string> | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  if ('component' in scope) {
    if (!UUID.test(scope.component)) return undefined;
    const row = await trx
      .selectFrom('artifact')
      .select(['id', 'space_id'])
      .where('id', '=', scope.component)
      .where('kind', '=', 'component')
      .executeTakeFirst();
    if (!row || !mayReadArtifact(readable, { id: row.id, spaceId: row.space_id })) return undefined;
    return new Set([row.id]);
  }
  if (!UUID.test(scope.document)) return undefined;
  const document = await readDocument(trx, scope.document);
  if (!document || !mayReadArtifact(readable, { id: document.id, spaceId: document.space.id })) {
    return undefined;
  }
  const read = readOutline(document.version.content, {
    artifact: document.id,
    version: document.version.id,
  });
  if (!read.ok) return new Set();
  const components: string[] = [];
  walkOutline(read.outline.nodes, (node) => {
    if (node.type === 'reference') components.push(node.component);
  });
  return readableComponents(trx, principalId, components);
}

/** Each held lock among these components, with its holder's name, as a stream shows it. */
export async function locksShown(
  trx: TenantTransaction,
  components: Iterable<string>,
): Promise<LockShown[]> {
  const asked = [...components];
  const held = await readLocks(trx, asked);
  return asked.map((component) => {
    const lock = held.get(component);
    return lock
      ? {
          component,
          holder: { id: lock.holder, name: lock.holderName },
          expectedRelease: lock.expiresAt.toISOString(),
        }
      : { component, holder: null, expectedRelease: null };
  });
}
