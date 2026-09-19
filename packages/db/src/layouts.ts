import { readLayout, type Layout } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

/**
 * The layout every environment starts with, seeded by 0018 as 0015 seeds the starter component type:
 * a definition in no space, identified by its artifact row, with no author because nobody made it.
 */
export const DEFAULT_LAYOUT_ID = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501';

/** A layout at one version, as the chain holds it and as it reads. */
export interface StoredLayout {
  readonly artifactId: string;
  readonly versionId: string;
  /** `revision.version`, as VER-009 presents it. */
  readonly number: string;
  readonly layout: Layout;
}

/**
 * The environment's declared layout at its latest version. Throws if its content does not read, or if
 * the environment declares none: both are a broken store, since 0018 declares one in every environment
 * and nothing removes it.
 */
export async function defaultLayout(trx: TenantTransaction): Promise<StoredLayout> {
  const declared = await trx.selectFrom('layout_default').select('layout_id').executeTakeFirst();
  if (!declared) throw new Error('This environment declares no layout');
  const stored = await latestVersion(trx, declared.layout_id);
  if (!stored) throw new Error(`The declared layout ${declared.layout_id} has no version`);
  const read = readLayout(stored.content, { artifact: stored.artifactId, version: stored.id });
  if (!read.ok) {
    throw new Error(
      `The layout ${read.artifact} at ${read.version} does not read: ${read.failure}`,
    );
  }
  return {
    artifactId: stored.artifactId,
    versionId: stored.id,
    number: `${stored.revision}.${stored.version}`,
    layout: read.layout,
  };
}
