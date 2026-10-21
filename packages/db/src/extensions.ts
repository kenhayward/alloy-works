import type { ExtensionManifest } from '@alloy-works/domain';
import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/**
 * Extensions (extensions.md; the EX plan, EX-B to EX-E; ADR-0066): an extension and the manifest it
 * has now, its latest of the versions kept by digest.
 */
export interface InstalledExtension {
  readonly id: string;
  readonly url: string;
  readonly digest: string;
  readonly manifest: ExtensionManifest;
  readonly installedBy: string | null;
  readonly installedAt: Date;
  readonly updatedAt: Date;
  readonly removedAt: Date | null;
}

/** A connection that uses an extension, at its latest version, retired or not. */
export interface ExtensionUse {
  readonly connection: string;
  readonly name: string;
  readonly digest: string;
  readonly retired: boolean;
}

type Row = {
  id: string;
  url: string;
  digest: string;
  manifest: unknown;
  installed_by: string | null;
  installed_at: Date;
  fetched_at: Date;
  removed_at: Date | null;
};

const latest = () =>
  sql<Row>`
    select e.id, e.url, v.digest, v.manifest, e.installed_by, e.installed_at, v.fetched_at,
           e.removed_at
      from extension e
      join lateral (select digest, manifest, fetched_at from extension_version
                     where extension_id = e.id order by id desc limit 1) v on true`;

const installed = (row: Row): InstalledExtension => ({
  id: row.id,
  url: row.url,
  digest: row.digest,
  manifest: row.manifest as ExtensionManifest,
  installedBy: row.installed_by,
  installedAt: row.installed_at,
  updatedAt: row.fetched_at,
  removedAt: row.removed_at,
});

/** Records an extension's change (API-059): the extension, the change and its digest, never its URL or words. */
async function recordChange(
  trx: TenantTransaction,
  id: string,
  change: 'installed' | 'updated' | 'removed',
  digest: string,
): Promise<void> {
  await recordEvent(trx, {
    kind: 'extension.changed',
    subject: { kind: 'extension', id },
    detail: { change, digest },
  });
}

/** Installs an extension at the manifest its preview showed. */
export async function installExtension(
  trx: TenantTransaction,
  input: {
    readonly url: string;
    readonly digest: string;
    readonly manifest: ExtensionManifest;
    readonly by: string | null;
  },
): Promise<InstalledExtension> {
  const made = await trx
    .insertInto('extension')
    .values({ url: input.url, installed_by: input.by })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('extension_version')
    .values({
      extension_id: made.id,
      digest: input.digest,
      manifest: JSON.stringify(input.manifest),
      fetched_by: input.by,
    })
    .execute();
  await recordChange(trx, made.id, 'installed', input.digest);
  return (await installedExtension(trx, made.id))!;
}

export async function installedExtension(
  trx: TenantTransaction,
  id: string,
): Promise<InstalledExtension | undefined> {
  const { rows } = await sql<Row>`select * from (${latest()}) x where x.id = ${id}`.execute(trx);
  return rows[0] ? installed(rows[0]) : undefined;
}

/** The extensions installed, removed ones too, a page at a time, by id. */
export async function listExtensions(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<InstalledExtension>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const { rows } = await sql<Row>`
    select * from (${latest()}) x
     where ${page.after === undefined ? sql`true` : sql`x.id > ${page.after}::uuid`}
     order by x.id limit ${page.limit + 1}`.execute(trx);
  return paged(rows.map(installed), page.limit);
}

/**
 * Moves an extension to the manifest its update preview showed (EX-C): a version of its own, every
 * earlier one kept. Answers it unchanged where that digest is already its latest.
 */
export async function updateExtension(
  trx: TenantTransaction,
  id: string,
  input: { readonly digest: string; readonly manifest: ExtensionManifest; readonly by: string },
): Promise<InstalledExtension> {
  const held = (await installedExtension(trx, id))!;
  if (held.digest === input.digest) return held;
  await trx
    .insertInto('extension_version')
    .values({
      extension_id: id,
      digest: input.digest,
      manifest: JSON.stringify(input.manifest),
      fetched_by: input.by,
    })
    .execute();
  await recordChange(trx, id, 'updated', input.digest);
  return (await installedExtension(trx, id))!;
}

/** The connections using an extension, at their latest versions (EX-E). */
export async function extensionUses(
  trx: TenantTransaction,
  id: string,
): Promise<readonly ExtensionUse[]> {
  const { rows } = await sql<{ artifact_id: string; content: Record<string, unknown> }>`
    select artifact_id, content from (
      select distinct on (v.artifact_id) v.artifact_id, v.content
        from artifact_version v join artifact a on a.id = v.artifact_id
       where a.kind = 'connection'
       order by v.artifact_id, v.revision_no desc, v.version_no desc) latest
     where content ->> 'type' = 'extension' and content -> 'source' ->> 'extension' = ${id}
     order by artifact_id`.execute(trx);
  return rows.map((row) => {
    const source = row.content['source'] as { readonly digest?: string };
    return {
      connection: row.artifact_id,
      name: String(row.content['name'] ?? ''),
      digest: String(source.digest ?? ''),
      retired: row.content['retired'] === true,
    };
  });
}

/**
 * Removes an extension once no connection uses it but a retired one (EX-E, API-048): refused with
 * the uses that stand in the way; its versions kept, so what used it still reads.
 */
export async function removeExtension(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<{ readonly removed: true } | { readonly inUse: readonly ExtensionUse[] }> {
  await sql`select 1 from extension where id = ${id} for update`.execute(trx);
  const standing = (await extensionUses(trx, id)).filter((each) => !each.retired);
  if (standing.length > 0) return { inUse: standing };
  const held = (await installedExtension(trx, id))!;
  if (held.removedAt === null) {
    await trx
      .updateTable('extension')
      .set({ removed_at: sql<Date>`now()`, removed_by: by })
      .where('id', '=', id)
      .execute();
    await recordChange(trx, id, 'removed', held.digest);
  }
  return { removed: true };
}
