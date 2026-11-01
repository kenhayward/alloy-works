import { rightsAtPublish, type Licence, type PublishFailure } from '@alloy-works/domain';
import { currentAssetRights, imagesPolicy } from './assets.js';
import { readDefinitionLatest } from './definitions.js';
import type { TenantTransaction } from './tables.js';

/** An image placed where the publisher may read it: by node and block, its asset's id. */
export interface PlacedImage {
  readonly node: string;
  readonly block: string;
  readonly asset: string;
}

/**
 * What a publish reports of an image's rights without stopping it (AST-052, AST-053; AL-F), by the
 * figure placing it, as its failures name one (issue #143).
 */
export interface RightsWarning {
  readonly code: 'asset_undeclared' | 'asset_licence_expired';
  readonly node: string;
  readonly block: string;
}

/** The rights row each image was published under, and the licence version it named (AL-F). */
export interface ReadRights {
  readonly asset: string;
  readonly rights: string;
  readonly licenceVersion: string | null;
}

/**
 * **The images' rights at publish** (AST-023, AST-052, AST-053; the AL plan, AL-F): each image's current
 * rights against its licence at its latest version and the environment's policy, on today's date in
 * UTC. A finding that refuses is a failure naming the figure, `detail` the licence's name where it has
 * one; one that does not is a warning; each said once a block. A preview is internal use, and finds
 * nothing; every publish and baseline records what it read.
 */
export async function resolveRights(
  trx: TenantTransaction,
  placed: readonly PlacedImage[],
  kind: 'publish' | 'preview' | 'range',
  today = new Date().toISOString().slice(0, 10),
): Promise<{
  readonly failures: readonly PublishFailure[];
  readonly warnings: readonly RightsWarning[];
  readonly read: readonly ReadRights[];
}> {
  if (placed.length === 0) return { failures: [], warnings: [], read: [] };
  const current = await currentAssetRights(
    trx,
    placed.map((each) => each.asset),
  );
  const licences = new Map<string, { readonly licence: Licence; readonly version: string }>();
  for (const { rights } of current.values()) {
    if (rights.kind !== 'declared' || licences.has(rights.licence)) continue;
    const stored = await readDefinitionLatest(trx, rights.licence);
    if (stored?.kind === 'licence') {
      licences.set(rights.licence, {
        licence: stored.definition as Licence,
        version: stored.version.id,
      });
    }
  }
  const read = [...current].map(([asset, { id, rights }]) => ({
    asset,
    rights: id,
    licenceVersion:
      rights.kind === 'declared' ? (licences.get(rights.licence)?.version ?? null) : null,
  }));
  if (kind !== 'publish') return { failures: [], warnings: [], read };

  const { undeclared: policy } = await imagesPolicy(trx);
  const failures: PublishFailure[] = [];
  const warnings: RightsWarning[] = [];
  const said = new Set<string>();
  for (const each of placed) {
    // An image with no rights row is one recorded before 0180, read as undeclared.
    const rights = current.get(each.asset)?.rights ?? { kind: 'undeclared' as const };
    const held = rights.kind === 'declared' ? licences.get(rights.licence) : undefined;
    const finding = rightsAtPublish(rights, held?.licence, today, policy);
    if (finding === null) continue;
    const place = `${each.node} ${each.block} ${finding.code}`;
    if (said.has(place)) continue;
    said.add(place);
    if (finding.refuses) {
      failures.push({
        stage: 'resolve',
        code: finding.code,
        node: each.node,
        block: each.block,
        detail: held?.licence.name ?? null,
      });
    } else {
      // A licence forbidding publication always refuses, so only these two are ever reported.
      const code = finding.code as RightsWarning['code'];
      warnings.push({ code, node: each.node, block: each.block });
    }
  }
  return { failures, warnings, read };
}

/** The rights a request's images were read under, recorded with it while it is queued (AL-F). */
export async function recordRequestRights(
  trx: TenantTransaction,
  requestId: string,
  read: readonly ReadRights[],
): Promise<void> {
  if (read.length === 0) return;
  await trx
    .insertInto('publication_request_rights')
    .values(
      read.map((each) => ({
        request_id: requestId,
        asset_id: each.asset,
        rights_id: each.rights,
        licence_version_id: each.licenceVersion,
      })),
    )
    .execute();
}
