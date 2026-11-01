import { referencesIn } from '@alloy-works/domain';
import { sql } from 'kysely';
import { lockBibliography } from './bibliography-lock.js';
import { lockTerms } from './term-lock.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const indexKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether the tenant keeps the reference index yet (0102): a migration's test reaches older schemas. */
export async function referencesStored(trx: TenantTransaction): Promise<boolean> {
  const known = indexKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('reference') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  indexKnown.set(trx, present);
  return present;
}

/**
 * The index's rows for an artifact's newest version (relationships.md, "References"; the R2 plan,
 * R2-A), replacing those of the version before, in the transaction that cut it. Each target is
 * written only where it is an artifact of the kind named, and a pin only where it is a version of
 * it: content its writer checked names nothing else, and the index never holds a dangling row.
 */
export async function indexReferences(
  trx: TenantTransaction,
  version: {
    readonly id: string;
    readonly artifactId: string;
    readonly kind: string;
    readonly content: unknown;
  },
): Promise<void> {
  if (!(await referencesStored(trx))) return;
  await trx.deleteFrom('reference').where('from_id', '=', version.artifactId).execute();
  const found = referencesIn(version.kind, version.content);

  // An image names an asset version: the index keeps its asset, pinned to it or following it.
  const assetVersions = [
    ...new Set(
      found.flatMap((each) =>
        'version' in each.target && UUID.test(each.target.version) ? [each.target.version] : [],
      ),
    ),
  ];
  const assetOf = new Map(
    assetVersions.length === 0
      ? []
      : (
          await trx
            .selectFrom('artifact_version')
            .select(['id', 'artifact_id'])
            .where('id', 'in', assetVersions)
            .where('kind', '=', 'asset')
            .execute()
        ).map((row) => [row.id, row.artifact_id]),
  );
  const named = [
    ...new Set(
      found.flatMap((each) =>
        'artifact' in each.target && UUID.test(each.target.artifact) ? [each.target.artifact] : [],
      ),
    ),
  ];
  const targets =
    named.length === 0
      ? []
      : await trx
          .selectFrom('artifact')
          .select(['id', 'kind', 'space_id'])
          .where('id', 'in', named)
          .execute();
  const kindOf = new Map(targets.map((row) => [row.id, row.kind]));
  // A version citing an entry and an archive of it serialise (`archiveEntry`), in one order.
  const bibliographies = targets.flatMap((row) =>
    row.kind === 'bibliographyEntry' && row.space_id !== null ? [row.space_id] : [],
  );
  for (const space of [...new Set(bibliographies)].sort()) await lockBibliography(trx, space);
  // And one using a term and an archive of it (`archiveTerm`), likewise.
  const glossaries = targets.flatMap((row) =>
    row.kind === 'term' && row.space_id !== null ? [row.space_id] : [],
  );
  for (const space of [...new Set(glossaries)].sort()) await lockTerms(trx, space);
  const pins = [
    ...new Set(
      found.flatMap((each) => (each.version && UUID.test(each.version) ? [each.version] : [])),
    ),
  ];
  const pinOf = new Map(
    pins.length === 0
      ? []
      : (
          await trx
            .selectFrom('artifact_version')
            .select(['id', 'artifact_id'])
            .where('id', 'in', pins)
            .execute()
        ).map((row) => [row.id, row.artifact_id]),
  );

  type Row = {
    node: string | null;
    to_id: string;
    to_kind: string;
    mode: 'latest' | 'approved' | 'pinned';
    to_version: string | null;
  };
  const rows = found.flatMap((each): Row[] => {
    if ('version' in each.target) {
      const asset = assetOf.get(each.target.version);
      return asset === undefined
        ? []
        : [
            {
              node: each.node,
              to_id: asset,
              to_kind: 'asset',
              // Following its asset (AL-M) follows it, as a latest reference to a component does.
              mode: each.mode === 'latest' ? ('latest' as const) : ('pinned' as const),
              to_version: each.mode === 'latest' ? null : each.target.version,
            },
          ];
    }
    const { artifact, kind } = each.target;
    if (kindOf.get(artifact) !== kind) return [];
    const pinned =
      each.mode === 'pinned' && each.version !== undefined && pinOf.get(each.version) === artifact;
    if (each.mode === 'pinned' && !pinned) return [];
    return [
      {
        node: each.node,
        to_id: artifact,
        to_kind: kind,
        mode: each.mode,
        to_version: pinned ? each.version! : null,
      },
    ];
  });
  if (rows.length > 0) {
    await trx
      .insertInto('reference')
      .values(
        rows.map((row) => ({ ...row, from_id: version.artifactId, from_version: version.id })),
      )
      .execute();
  }
  if (version.kind === 'document') await indexTemplateOf(trx, version.artifactId);
}

/**
 * A document's reference to its template version: the one its latest move took it to, else the one
 * it was made from. Written again wherever either is recorded, as each is after the version it binds.
 */
export async function indexTemplateOf(trx: TenantTransaction, documentId: string): Promise<void> {
  if (!(await referencesStored(trx))) return;
  await trx
    .deleteFrom('reference')
    .where('from_id', '=', documentId)
    .where('to_kind', '=', 'template')
    .execute();
  await sql`
    insert into reference (from_id, from_version, node, to_id, to_kind, mode, to_version)
    select ${documentId}::uuid, latest.id, null, t.artifact_id, 'template', 'pinned', t.id
      from document_template d
      join artifact_version t on t.id = coalesce(
        (select m.to_version_id from document_template_move m
          where m.document_id = d.document_id order by m.id desc limit 1),
        d.template_version_id)
      cross join lateral (
        select v.id from artifact_version v where v.artifact_id = d.document_id
         order by v.revision_no desc, v.version_no desc limit 1
      ) latest
     where d.document_id = ${documentId}`.execute(trx);
}
