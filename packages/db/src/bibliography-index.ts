import { entryIdentities, EntryRefused, parseEntry } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/**
 * An entry version's key and identities (citations.md, "The entry", "Duplicates"), in the transaction
 * that cuts it: the key held from the first version, and refused on any later one that changes it
 * (LIB-046); the identities replaced by the new version's (LIB-045), as the reference index is.
 */
export async function indexEntry(
  trx: TenantTransaction,
  version: { readonly artifactId: string; readonly content: unknown },
): Promise<void> {
  const entry = parseEntry(version.content);
  const { space_id: spaceId } = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  const held = await trx
    .selectFrom('bibliography_key')
    .select('key')
    .where('entry_id', '=', version.artifactId)
    .executeTakeFirst();
  if (held === undefined) {
    await trx
      .insertInto('bibliography_key')
      .values({ entry_id: version.artifactId, space_id: spaceId!, key: entry.key })
      .execute();
  } else if (held.key !== entry.key) {
    throw new EntryRefused([
      { rule: 'entry_invalid', path: 'key', message: `The key is ${held.key}, and never changes` },
    ]);
  }
  await trx
    .deleteFrom('bibliography_identity')
    .where('entry_id', '=', version.artifactId)
    .execute();
  const identities = entryIdentities(entry.csl);
  if (identities.length > 0) {
    await trx
      .insertInto('bibliography_identity')
      .values(
        identities.map((each) => ({
          entry_id: version.artifactId,
          space_id: spaceId!,
          by: each.by,
          value: each.value,
        })),
      )
      .execute();
  }
}
