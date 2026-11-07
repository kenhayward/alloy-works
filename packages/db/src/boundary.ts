import { bucketHost, type OutboundWay } from '@alloy-works/domain';
import { sql } from 'kysely';
import { tenantReferenceSources } from './reference-sources.js';
import type { TenantTransaction } from './tables.js';

/**
 * One thing configured to leave a tenant by a way out (secrets.md, "The boundary"; ADM-041): its
 * name, whether it is on, an address's host alone (a path or query can carry a key), an endpoint's
 * declared boundary, and a word more where one helps: a connection's type, a relay's owner.
 */
export interface BoundaryItem {
  readonly id: string;
  readonly name: string;
  readonly on: boolean;
  readonly host: string | null;
  readonly boundary: 'inside' | 'outside' | null;
  readonly detail: string | null;
}

export interface BoundaryWay {
  readonly on: boolean;
  readonly items: readonly BoundaryItem[];
}

const GENERATING = ['drafting', 'chat', 'summarising'];

/** An address's host, and never its path, query or user. */
function hostOf(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  try {
    return new URL(address).hostname || null;
  } catch {
    return null;
  }
}

const item = (
  id: string,
  name: string,
  on: boolean,
  more: Partial<Pick<BoundaryItem, 'host' | 'boundary' | 'detail'>> = {},
): BoundaryItem => ({
  id,
  name,
  on,
  host: more.host ?? null,
  boundary: more.boundary ?? null,
  detail: more.detail ?? null,
});

const way = (items: readonly BoundaryItem[]): BoundaryWay => ({
  on: items.some((each) => each.on),
  items,
});

interface ConnectionSource {
  readonly host?: string;
  readonly baseUrl?: string;
  readonly endpoint?: string;
  readonly bucket?: string;
  readonly pathStyle?: boolean;
}

function connectionHost(type: string, source: ConnectionSource | null): string | null {
  if (source === null) return null;
  if (type === 'postgres') return source.host ?? null;
  if (type === 'http') return hostOf(source.baseUrl);
  if (type === 's3' && source.endpoint !== undefined && source.bucket !== undefined) {
    try {
      return bucketHost({
        endpoint: source.endpoint,
        bucket: source.bucket,
        pathStyle: source.pathStyle ?? false,
      }).host;
    } catch {
      return null;
    }
  }
  return hostOf(source.endpoint);
}

/**
 * What this tenant has configured for each way out, read from the rows that configure it and never a
 * sealed value: each endpoint, source, connection, subscription, relay, extension, vocabulary source
 * and space CT Studio delivers to.
 */
export async function tenantBoundary(
  trx: TenantTransaction,
): Promise<Record<OutboundWay, BoundaryWay>> {
  const { rows: endpoints } = await sql<{
    id: string;
    name: string;
    base_url: string;
    boundary: 'inside' | 'outside';
    purposes: string[] | null;
  }>`
    select e.id, e.name, e.base_url, e.boundary,
           (select array_agg(r.purpose order by r.purpose) from model_route r
             where r.endpoint_id = e.id) as purposes
      from model_endpoint e
     where e.retired_at is null
     order by e.name, e.id`.execute(trx);
  const routed = (purpose: string) =>
    endpoints.filter((each) => (each.purposes ?? []).includes(purpose));
  const endpointItem = (each: (typeof endpoints)[number], on: boolean, detail?: string) =>
    item(each.id, each.name, on, {
      host: hostOf(each.base_url),
      boundary: each.boundary,
      ...(detail === undefined ? {} : { detail }),
    });

  const policy = await sql<{ machine: 'off' | 'inside' | 'any' }>`
    select machine from translation_policy`.execute(trx);
  const machine = policy.rows[0]?.machine ?? 'off';

  const references = await tenantReferenceSources(trx);

  const { rows: connections } = await sql<{
    id: string;
    name: string | null;
    type: string;
    source: ConnectionSource | null;
  }>`
    select a.id, latest.content ->> 'name' as name, latest.content ->> 'type' as type,
           latest.content -> 'source' as source
      from artifact a
      join lateral (
        select v.content from artifact_version v where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc limit 1) latest on true
     where a.kind = 'connection'
       and coalesce((latest.content ->> 'retired')::boolean, false) = false
     order by name, a.id`.execute(trx);

  const webhooks = await trx
    .selectFrom('webhook_subscription')
    .select(['id', 'url', 'description', 'disabled_at'])
    .orderBy('created_at')
    .orderBy('id')
    .execute();

  const mail = await trx
    .selectFrom('mail_channel')
    .select(['id', 'enabled', 'relay', 'host'])
    .executeTakeFirst();

  const { rows: extensions } = await sql<{
    id: string;
    url: string;
    name: string | null;
    kind: string | null;
  }>`
    select x.id, x.url, v.manifest ->> 'name' as name, v.manifest ->> 'kind' as kind
      from extension x
      join lateral (select manifest from extension_version where extension_id = x.id
                     order by id desc limit 1) v on true
     where x.removed_at is null
     order by name, x.id`.execute(trx);

  const { rows: vocabularies } = await sql<{ id: string; name: string; url: string }>`
    select a.id, latest.content ->> 'name' as name, latest.content -> 'source' ->> 'url' as url
      from artifact a
      join lateral (
        select v.content from artifact_version v where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc limit 1) latest on true
     where a.kind = 'vocabulary' and latest.content -> 'source' ->> 'kind' = 'skos'
     order by name, a.id`.execute(trx);

  const ctStudio = await trx.selectFrom('ct_studio').select('identity_id').executeTakeFirst();
  const delivered = ctStudio
    ? await trx
        .selectFrom('bridge_settings as b')
        .innerJoin('space as s', 's.id', 'b.space_id')
        .select(['s.id', 's.name'])
        .orderBy('s.name')
        .orderBy('s.id')
        .execute()
    : [];

  return {
    model_endpoint: way(
      endpoints.map((each) =>
        endpointItem(
          each,
          (each.purposes ?? []).some((purpose) => GENERATING.includes(purpose)),
        ),
      ),
    ),
    embedding: way(routed('embedding').map((each) => endpointItem(each, true))),
    // Sent only where the policy allows the routed endpoint's boundary (LOC-026).
    translation: way(
      routed('translate').map((each) =>
        endpointItem(
          each,
          machine === 'any' || (machine === 'inside' && each.boundary === 'inside'),
          machine,
        ),
      ),
    ),
    reference_source: way(
      references.map((each) => item(each.id, each.name, each.enabled, { host: each.host })),
    ),
    malware_scanning: way([]),
    data_connection: way(
      connections.map((each) =>
        item(each.id, each.name ?? each.id, true, {
          host: connectionHost(each.type, each.source),
          detail: each.type,
        }),
      ),
    ),
    webhook: way(
      webhooks.map((each) => {
        const host = hostOf(each.url);
        return item(each.id, each.description || host || each.id, each.disabled_at === null, {
          host,
        });
      }),
    ),
    mail: way(
      mail === undefined
        ? []
        : [
            item(
              mail.id,
              mail.relay === 'own' ? (mail.host ?? mail.relay) : mail.relay,
              mail.enabled,
              {
                host: mail.relay === 'own' ? mail.host : null,
                detail: mail.relay,
              },
            ),
          ],
    ),
    extension: way(
      extensions.map((each) =>
        item(each.id, each.name ?? hostOf(each.url) ?? each.id, true, {
          host: hostOf(each.url),
          detail: each.kind,
        }),
      ),
    ),
    vocabulary_source: way(
      vocabularies.map((each) => item(each.id, each.name, true, { host: hostOf(each.url) })),
    ),
    ct_studio: way(delivered.map((space) => item(space.id, space.name, true))),
  };
}
