import {
  REFERENCE_SOURCES,
  type ReferenceExtensionTarget,
  type ReferenceManifest,
  type ReferenceSourceKey,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * A source among the tenant's (the XR plan, XR-C, XR-J): a declared one, or a reference extension
 * installed and not removed, keyed `ext:` and its id, by its latest manifest; its secret as sealed for
 * that manifest's endpoint.
 */
export interface TenantReferenceSource {
  readonly id: ReferenceSourceKey;
  readonly name: string;
  readonly host: string;
  /** What a record is fetched by: a declared source's, or an extension's own identifier. */
  readonly identifier: 'DOI' | 'PMID' | 'Identifier';
  readonly enabled: boolean;
  readonly extension?: {
    readonly endpoint: string;
    readonly search: string;
    readonly fetch: string;
    readonly authenticated: boolean;
    readonly sealed?: string;
  };
}

/** Every source of the tenant's, the declared first and then its reference extensions by id. */
export async function tenantReferenceSources(
  trx: TenantTransaction,
): Promise<TenantReferenceSource[]> {
  const rows = await trx
    .selectFrom('reference_source_policy')
    .select(['source', 'enabled'])
    .execute();
  const switched = new Map(rows.map((row) => [row.source, row.enabled]));
  const { rows: extensions } = await sql<{
    id: string;
    manifest: ReferenceManifest;
    sealed: string | null;
  }>`
    select e.id, v.manifest,
           (select c.sealed from extension_credential c where c.extension_id = e.id
               and c.endpoint = v.manifest ->> 'endpoint'
             order by c.set_at desc, c.id desc limit 1) as sealed
      from extension e
      join lateral (select manifest from extension_version
                     where extension_id = e.id order by id desc limit 1) v on true
     where e.removed_at is null and v.manifest ->> 'kind' = 'reference'
     order by e.id`.execute(trx);
  return [
    ...REFERENCE_SOURCES.map(({ id, name, host, identifier }) => ({
      id,
      name,
      host,
      identifier,
      enabled: switched.get(id) ?? true,
    })),
    ...extensions.map(({ id, manifest, sealed }): TenantReferenceSource => {
      const key = `ext:${id}` as const;
      return {
        id: key,
        name: manifest.name,
        host: new URL(manifest.endpoint).hostname,
        identifier: 'Identifier',
        enabled: switched.get(key) ?? true,
        extension: {
          endpoint: manifest.endpoint,
          search: manifest.reference.search,
          fetch: manifest.reference.fetch,
          authenticated: manifest.authentication !== 'none',
          // None once it declares no authentication, or for an endpoint it has since left.
          ...(sealed === null || manifest.authentication === 'none' ? {} : { sealed }),
        },
      };
    }),
  ];
}

/**
 * Whether each of the tenant's reference sources is on (the XR plan, XR-C): on unless an
 * administrator switched it off. A key it does not hold, a removed extension's among them, is absent.
 */
export async function referenceSourcesOn(
  trx: TenantTransaction,
): Promise<Readonly<Record<string, boolean>>> {
  return Object.fromEntries(
    (await tenantReferenceSources(trx)).map((each) => [each.id, each.enabled]),
  );
}

/** Switches a source on or off for the tenant. */
export async function setReferenceSource(
  trx: TenantTransaction,
  source: ReferenceSourceKey,
  enabled: boolean,
): Promise<void> {
  await trx
    .insertInto('reference_source_policy')
    .values({ source, enabled })
    .onConflict((conflict) => conflict.column('source').doUpdateSet({ enabled }))
    .execute();
}

/** Where the connector reaches an extension source (XR-J): its endpoint, paths and sealed secret. */
export const extensionTarget = (
  source: TenantReferenceSource | undefined,
): ReferenceExtensionTarget | undefined =>
  source?.extension && {
    endpoint: source.extension.endpoint,
    search: source.extension.search,
    fetch: source.extension.fetch,
    ...(source.extension.sealed === undefined ? {} : { sealed: source.extension.sealed }),
  };
