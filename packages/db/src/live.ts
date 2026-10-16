import { walkOutline, readOutline } from '@alloy-works/domain';
import { personView } from './person-view.js';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { isDeleted } from './deletion.js';
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
  /** Somebody asking to take it over, and when its holder's grace ends (COL-047). */
  readonly taking: {
    readonly by: { readonly id: string; readonly name: string | null };
    readonly until: string;
  } | null;
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
    if (await isDeleted(trx, row.id)) return undefined;
    return new Set([row.id]);
  }
  if (!UUID.test(scope.document)) return undefined;
  const document = await readDocument(trx, scope.document);
  if (!document || !mayReadArtifact(readable, { id: document.id, spaceId: document.space.id })) {
    return undefined;
  }
  if (await isDeleted(trx, document.id)) return undefined;
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
          taking:
            lock.taking === null
              ? null
              : {
                  by: { id: lock.taking.by, name: lock.taking.byName },
                  until: lock.taking.until.toISOString(),
                },
        }
      : { component, holder: null, expectedRelease: null, taking: null };
  });
}

/** What a person is doing in a document (COL-002): reading, reviewing or authoring, from its view. */
export type PresenceMode = 'read' | 'review' | 'author';

/** How long a beat counts: a window silent longer is absent (COL-055; the PL plan, PL-C). */
export const PRESENCE_LASTS_MS = 60_000;

/** One window's presence as a stream shows it, its component and mode withheld where unreadable. */
export interface PresenceShown {
  readonly viewer: string;
  readonly person: { readonly id: string; readonly name: string | null };
  readonly component: string | null;
  readonly mode: PresenceMode | null;
  readonly beatAt: string;
  /**
   * How long ago it beat, by the database's own clock when this was read: what a viewer ages it by,
   * so a client clock ahead or behind ages nobody wrongly (the PL final review, finding 5).
   */
  readonly ageMs: number;
}

/**
 * **A window's beat** (COL-001, COL-002; the PL plan, PL-C): who is in which document, in which
 * component and doing what, written now. A window is its principal's alone: a beat naming another's is
 * refused. The caller has decided the person may read the document and the component.
 */
export async function beatPresence(
  trx: TenantTransaction,
  beat: {
    readonly viewer: string;
    readonly principalId: string;
    readonly document: string;
    readonly component: string | null;
    readonly mode: PresenceMode;
  },
): Promise<boolean> {
  const written = await trx
    .insertInto('presence')
    .values({
      viewer: beat.viewer,
      principal_id: beat.principalId,
      document_id: beat.document,
      component_id: beat.component,
      mode: beat.mode,
    })
    .onConflict((conflict) =>
      conflict.columns(['principal_id', 'viewer']).doUpdateSet({
        document_id: beat.document,
        component_id: beat.component,
        mode: beat.mode,
        beat_at: sql<Date>`now()`,
      }),
    )
    .returning('viewer')
    .executeTakeFirst();
  return written !== undefined;
}

/** A window gone: its stream closed, or it said so. Only its principal's own; whether it was there. */
export async function leavePresence(
  trx: TenantTransaction,
  principalId: string,
  viewer: string,
): Promise<boolean> {
  const left = await trx
    .deleteFrom('presence')
    .where('viewer', '=', viewer)
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  return left.numDeletedRows > 0n;
}

/**
 * **Everyone in a document now, as a viewer may see them** (COL-001 to COL-003): each window beaten
 * within the last minute - an older row is absence, whatever the sweep has not yet tidied - with its
 * person's name; a component the viewer may not read, and its mode, withheld, so they are present in the
 * document alone. One window, where `viewer` is given.
 */
export async function presenceShown(
  trx: TenantTransaction,
  document: string,
  readable: ReadonlySet<string>,
  viewer?: string,
): Promise<PresenceShown[]> {
  const rows = await trx
    .selectFrom('presence as r')
    .innerJoin('principal as p', 'p.id', 'r.principal_id')
    .select([
      'r.viewer',
      'r.principal_id',
      'p.display_name',
      'p.kind',
      'r.component_id',
      'r.mode',
      'r.beat_at',
    ])
    .select(
      sql<number>`(extract(epoch from (clock_timestamp() - r.beat_at)) * 1000)::integer`.as(
        'age_ms',
      ),
    )
    .where('r.document_id', '=', document)
    .where('r.beat_at', '>', sql<Date>`now() - ${`${PRESENCE_LASTS_MS} milliseconds`}::interval`)
    .$if(viewer !== undefined, (query) => query.where('r.viewer', '=', viewer!))
    .orderBy('r.beat_at')
    .execute();
  return rows.map((row) => {
    const shown = row.component_id === null || readable.has(row.component_id);
    return {
      viewer: row.viewer,
      person: personView(row.principal_id, row.display_name, row.kind),
      component: shown ? row.component_id : null,
      mode: shown ? (row.mode as PresenceMode) : null,
      beatAt: row.beat_at.toISOString(),
      ageMs: Math.max(0, row.age_ms),
    };
  });
}

/** The worker's tidying (PL-C): rows past a minute, which no stream shows already. */
export async function sweepPresence(trx: TenantTransaction): Promise<number> {
  const swept = await trx
    .deleteFrom('presence')
    .where('beat_at', '<=', sql<Date>`now() - ${`${PRESENCE_LASTS_MS} milliseconds`}::interval`)
    .executeTakeFirst();
  return Number(swept.numDeletedRows);
}
