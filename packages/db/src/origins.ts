import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * **The origin record** (REU-059; the ND plan, ND-M): what a component was copied from, a component at a
 * version, a template at a version, or both, where a template copied one it names. Written once, by a
 * template's copies and by Duplicate; not in the relationship graph.
 */
export interface Origin {
  readonly from: string | null;
  readonly version: string | null;
  readonly template: { readonly id: string; readonly version: string } | null;
  /** Whether what it was made from has a newer version: the component where there is one, else the template. */
  readonly changedSince: boolean;
}

/** Records a copy's origin, in the caller's transaction. */
export async function recordOrigin(
  trx: TenantTransaction,
  copy: string,
  origin: {
    readonly from?: { readonly id: string; readonly version: string } | undefined;
    readonly template?: { readonly id: string; readonly version: string } | undefined;
  },
): Promise<void> {
  await trx
    .insertInto('artifact_origin')
    .values({
      artifact_id: copy,
      from_artifact: origin.from?.id ?? null,
      from_version: origin.from?.version ?? null,
      template_id: origin.template?.id ?? null,
      template_version: origin.template?.version ?? null,
    })
    .execute();
}

/** An artifact's origin, or undefined where it was not copied from anything. */
export async function originOf(
  trx: TenantTransaction,
  artifact: string,
): Promise<Origin | undefined> {
  if (!UUID.test(artifact)) return undefined;
  const row = await trx
    .selectFrom('artifact_origin')
    .selectAll()
    .where('artifact_id', '=', artifact)
    .executeTakeFirst();
  if (!row) return undefined;
  const source =
    row.from_artifact !== null
      ? { id: row.from_artifact, version: row.from_version! }
      : { id: row.template_id!, version: row.template_version! };
  const latest = await latestVersion(trx, source.id);
  return {
    from: row.from_artifact,
    version: row.from_version,
    template:
      row.template_id === null ? null : { id: row.template_id, version: row.template_version! },
    changedSince: latest !== undefined && latest.id !== source.version,
  };
}

/** Which of these components a template copied for the document placing them (REU-057's exemption). */
export async function templateCopiesAmong(
  trx: TenantTransaction,
  components: readonly string[],
): Promise<ReadonlySet<string>> {
  if (components.length === 0) return new Set();
  const rows = await trx
    .selectFrom('artifact_origin')
    .select('artifact_id')
    .where('artifact_id', 'in', [...components])
    .where('template_id', 'is not', null)
    .execute();
  return new Set(rows.map((row) => row.artifact_id));
}
