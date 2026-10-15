import { walkOutline, type OutlineDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';
import type { StoredVersion } from './versions.js';

/**
 * **Waivers** (templates.md; the WF6 plan, WF6-B; TPL-029): a section the template requires, removed
 * with a stated reason, kept on the document as a row: no longer missing at publish (TPL-013) or at a
 * gate, and listed among its departures with its reason (TPL-028).
 */

const waiversKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether this schema has 0100's table: migration tests run this code on older ones. */
async function waiversStored(trx: TenantTransaction): Promise<boolean> {
  const known = waiversKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('section_waiver') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  waiversKnown.set(trx, present);
  return present;
}

/** Each required key removed from a document with a reason, and the latest reason given for it. */
export async function waivedKeys(
  trx: TenantTransaction,
  documentId: string,
): Promise<Map<string, string>> {
  if (!(await waiversStored(trx))) return new Map();
  const rows = await trx
    .selectFrom('section_waiver')
    .distinctOn('key')
    .select(['key', 'reason'])
    .where('document_id', '=', documentId)
    .orderBy('key')
    .orderBy('id', 'desc')
    .execute();
  return new Map(rows.map((row) => [row.key, row.reason]));
}

const originsOf = (outline: OutlineDocument) => {
  const origins = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'section' && node.origin !== undefined) origins.add(node.origin);
  });
  return origins;
};

/** The required keys `before` holds and `after` does not: what a removal took. */
export function requiredRemoved(
  before: OutlineDocument,
  after: OutlineDocument,
  required: readonly string[],
): string[] {
  const was = originsOf(before);
  const now = originsOf(after);
  return required.filter((key) => was.has(key) && !now.has(key));
}

/**
 * Records each required key `keys` with `reason`, against the version that removed it, audited
 * `section.waived` with its key alone (the reason stays on the row, as a rejection's does).
 */
export async function recordWaivers(
  trx: TenantTransaction,
  input: {
    readonly version: StoredVersion;
    readonly keys: readonly string[];
    readonly reason: string;
    readonly by: string;
  },
): Promise<void> {
  if (input.keys.length === 0) return;
  const place = await artifactPlace(trx, input.version.artifactId, input.version.id);
  for (const key of input.keys) {
    await trx
      .insertInto('section_waiver')
      .values({
        document_id: input.version.artifactId,
        key,
        reason: input.reason.normalize('NFC').trim(),
        version_id: input.version.id,
        by: input.by,
      })
      .execute();
    await recordEvent(
      trx,
      {
        kind: 'section.waived',
        subject: { kind: 'document', id: input.version.artifactId, version: input.version.id },
        space: place.space,
        detail: { key },
      },
      place.labels,
    );
  }
}
