import type { SecretConsumerKind, SecretFailing, SecretKind } from '@alloy-works/domain';
import { sql } from 'kysely';
import { latestDefinitionsNaming } from './definition-references.js';
import { organisationTenants } from './tenant-lifecycle.js';
import type { TenantTransaction } from './tables.js';

/**
 * A tenant's secrets, each with everything here that uses it (secrets.md; ADM-047; the SA plan, SA-H),
 * read from the rows that hold them and never their values: a sealed value or a hash is never selected.
 */
export interface SecretConsumer {
  readonly kind: SecretConsumerKind;
  readonly id: string | null;
  readonly name: string | null;
}

export interface SecretHeld {
  readonly kind: SecretKind;
  readonly of: { readonly id: string; readonly name: string | null };
  readonly replacedAt: Date | null;
  /** Until when the value it replaced is still accepted. */
  readonly previousUntil: Date | null;
  readonly consumers: readonly SecretConsumer[];
}

const consumer = (
  kind: SecretConsumerKind,
  id: string | null,
  name: string | null,
): SecretConsumer => ({ kind, id, name });

/** A principal's tokens, the newest first: the newest replaced at, the one before it ending. */
async function tokensOf(trx: TenantTransaction, principal: string) {
  const rows = await trx
    .selectFrom('api_token')
    .select(['id', 'created_at', 'ends_at'])
    .where('principal_id', '=', principal)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const now = Date.now();
  const ending = rows
    .slice(1)
    .map((row) => row.ends_at)
    .filter((at): at is Date => at !== null && at.getTime() > now);
  return {
    replacedAt: rows[0]?.created_at ?? null,
    previousUntil:
      ending.length === 0 ? null : new Date(Math.max(...ending.map((at) => at.getTime()))),
    any: rows.length > 0,
  };
}

/** The query definitions naming a connection, and their datasets by name. */
async function connectionConsumers(
  trx: TenantTransaction,
  connection: string,
): Promise<SecretConsumer[]> {
  const definitions = (await latestDefinitionsNaming(trx, connection)).filter(
    (each) => !each.retired,
  );
  const found: SecretConsumer[] = definitions.map((each) =>
    consumer('query_definition', each.id, each.title),
  );
  if (definitions.length === 0) return found;
  const { rows } = await sql<{ id: string; name: string | null }>`
    select d.artifact_id as id,
           (select n.name from dataset_name n where n.dataset_id = d.artifact_id
             order by n.id desc limit 1) as name
      from dataset d
     where d.query_definition = any(${definitions.map((each) => each.id)}::uuid[])
     order by name nulls last, d.artifact_id`.execute(trx);
  return [...found, ...rows.map((row) => consumer('dataset', row.id, row.name))];
}

/** Every secret this tenant holds, in the order `SECRET_KINDS` names them. */
export async function tenantSecrets(trx: TenantTransaction): Promise<SecretHeld[]> {
  const held: SecretHeld[] = [];

  // Providers: a shared one's secret is copied into the organisation's tenants; a copy's is the
  // organisation's to replace, so not listed here.
  const providers = await trx
    .selectFrom('identity_provider')
    .select(['id', 'name', 'shared', 'secret_set_at', 'scim_identity'])
    .where('closed_at', 'is', null)
    .where('sealed_secret', 'is not', null)
    .where('managed_by_organisation', '=', false)
    .orderBy('name')
    .orderBy('id')
    .execute();
  // The organisation's other tenants, each holding a copy (TL-M).
  const own = await sql<{ id: string }>`select substring(current_user::text from 3) as id`.execute(
    trx,
  );
  const members = providers.some((each) => each.shared)
    ? (await organisationTenants(trx)).filter((each) => each.id !== own.rows[0]?.id)
    : [];
  for (const provider of providers) {
    held.push({
      kind: provider.shared ? 'shared_provider_secret' : 'sign_in_client_secret',
      of: { id: provider.id, name: provider.name },
      replacedAt: provider.secret_set_at,
      previousUntil: null,
      consumers: [
        consumer('sign_in', provider.id, provider.name),
        ...(provider.shared
          ? members.map((each) => consumer('member_tenant', each.id, each.name))
          : []),
      ],
    });
  }

  // Connections, the delivery store's among them, with their latest credential.
  const { rows: connections } = await sql<{
    id: string;
    name: string | null;
    set_at: Date;
    spaces: { id: string; name: string }[] | null;
  }>`
    select c.connection_id as id, latest.content ->> 'name' as name, c.set_at,
           (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name, s.id)
              from bridge_settings b join space s on s.id = b.space_id
             where b.connection_id = c.connection_id) as spaces
      from (select distinct on (connection_id) connection_id, set_at
              from connection_credential order by connection_id, id desc) c
      join lateral (
        select v.content from artifact_version v where v.artifact_id = c.connection_id
         order by v.revision_no desc, v.version_no desc limit 1) latest on true
     where coalesce((latest.content ->> 'retired')::boolean, false) = false
     order by name, c.connection_id`.execute(trx);
  for (const connection of connections) {
    const spaces = connection.spaces ?? [];
    held.push({
      kind: spaces.length > 0 ? 'delivery_store_password' : 'connection_credential',
      of: { id: connection.id, name: connection.name },
      replacedAt: connection.set_at,
      previousUntil: null,
      consumers: [
        ...spaces.map((space) => consumer('data_delivery', space.id, space.name)),
        ...(await connectionConsumers(trx, connection.id)),
      ],
    });
  }

  // Model endpoints with a key: every purpose routed to each, the guardrails every call is held to,
  // and the translation policy where machine translation is routed there and on.
  const { rows: endpoints } = await sql<{
    id: string;
    name: string;
    set_at: Date;
    purposes: string[] | null;
  }>`
    select e.id, e.name, k.set_at,
           (select array_agg(r.purpose order by r.purpose) from model_route r
             where r.endpoint_id = e.id) as purposes
      from model_endpoint e
      join lateral (select set_at from model_credential where endpoint_id = e.id
                     order by set_at desc, id desc limit 1) k on true
     where e.retired_at is null
     order by e.name, e.id`.execute(trx);
  const guardrails = await sql<{ any: boolean }>`
    select exists (select from guardrail where retired_at is null) as any`.execute(trx);
  const machine = await sql<{ machine: string }>`
    select machine from translation_policy`.execute(trx);
  for (const endpoint of endpoints) {
    const purposes = endpoint.purposes ?? [];
    held.push({
      kind: 'model_endpoint_key',
      of: { id: endpoint.id, name: endpoint.name },
      replacedAt: endpoint.set_at,
      previousUntil: null,
      consumers: [
        ...purposes.map((purpose) => consumer('purpose', purpose, purpose)),
        ...(purposes.length > 0 && guardrails.rows[0]?.any
          ? [consumer('guardrails', null, null)]
          : []),
        ...(purposes.includes('translate') && (machine.rows[0]?.machine ?? 'off') !== 'off'
          ? [consumer('translation_policy', null, null)]
          : []),
      ],
    });
  }

  const webhooks = await trx
    .selectFrom('webhook_subscription')
    .select(['id', 'url', 'description', 'secret_set_at', 'previous_until'])
    .where('sealed', 'is not', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const webhook of webhooks) {
    const name = webhook.description || webhook.url;
    held.push({
      kind: 'webhook_signing_secret',
      of: { id: webhook.id, name },
      replacedAt: webhook.secret_set_at,
      previousUntil:
        webhook.previous_until !== null && webhook.previous_until.getTime() > Date.now()
          ? webhook.previous_until
          : null,
      consumers: [consumer('webhook_subscription', webhook.id, name)],
    });
  }

  const { rows: extensions } = await sql<{
    id: string;
    name: string | null;
    set_at: Date;
    on: boolean;
  }>`
    select x.id,
           (select v.manifest ->> 'name' from extension_version v where v.extension_id = x.id
             order by v.id desc limit 1) as name,
           k.set_at,
           exists (select from reference_source_policy p
                    where p.source = 'ext:' || x.id::text and p.enabled) as on
      from extension x
      join lateral (select set_at from extension_credential where extension_id = x.id
                     order by set_at desc, id desc limit 1) k on true
     where x.removed_at is null
     order by name, x.id`.execute(trx);
  for (const extension of extensions) {
    held.push({
      kind: 'extension_secret',
      of: { id: extension.id, name: extension.name },
      replacedAt: extension.set_at,
      previousUntil: null,
      consumers: extension.on
        ? [consumer('reference_source', `ext:${extension.id}`, extension.name)]
        : [],
    });
  }

  const mail = await trx
    .selectFrom('mail_channel')
    .select(['id', 'host', 'password_set_at'])
    .where('relay', '=', 'own')
    .where('sealed_password', 'is not', null)
    .executeTakeFirst();
  if (mail) {
    held.push({
      kind: 'mail_relay_password',
      of: { id: mail.id, name: mail.host },
      replacedAt: mail.password_set_at,
      previousUntil: null,
      consumers: [consumer('mail_delivery', null, null)],
    });
  }

  const scim = providers.filter((each) => each.scim_identity !== null);
  for (const provider of scim) {
    const tokens = await tokensOf(trx, provider.scim_identity!);
    if (!tokens.any) continue;
    held.push({
      kind: 'scim_token',
      of: { id: provider.id, name: provider.name },
      replacedAt: tokens.replacedAt,
      previousUntil: tokens.previousUntil,
      consumers: [consumer('provisioning', provider.id, provider.name)],
    });
  }

  const ctStudio = await trx.selectFrom('ct_studio').select('identity_id').executeTakeFirst();
  if (ctStudio) {
    const tokens = await tokensOf(trx, ctStudio.identity_id);
    if (tokens.any) {
      const spaces = await trx
        .selectFrom('bridge_settings as b')
        .innerJoin('space as s', 's.id', 'b.space_id')
        .select(['s.id', 's.name'])
        .orderBy('s.name')
        .orderBy('s.id')
        .execute();
      held.push({
        kind: 'ct_studio_token',
        of: { id: ctStudio.identity_id, name: 'CT Studio' },
        replacedAt: tokens.replacedAt,
        previousUntil: tokens.previousUntil,
        consumers: spaces.map((space) => consumer('ct_studio_space', space.id, space.name)),
      });
    }
  }

  // Every other enabled service identity's tokens, each its own: a new one is issued beside the old.
  const others = [
    ...scim.map((each) => each.scim_identity!),
    ...(ctStudio ? [ctStudio.identity_id] : []),
  ];
  const { rows: tokens } = await sql<{
    id: string;
    name: string;
    created_at: Date;
    identity: string;
    identity_name: string | null;
  }>`
    select t.id, t.name, t.created_at, s.principal_id as identity, p.display_name as identity_name
      from api_token t
      join service_identity s on s.principal_id = t.principal_id
      join principal p on p.id = s.principal_id
     where s.disabled_at is null
       and not (s.principal_id = any(${others}::uuid[]))
     order by p.display_name, t.created_at, t.id`.execute(trx);
  for (const token of tokens) {
    held.push({
      kind: 'service_identity_token',
      of: { id: token.id, name: token.name },
      replacedAt: token.created_at,
      previousUntil: null,
      consumers: [consumer('service_identity', token.identity, token.identity_name)],
    });
  }
  return held;
}

/** A consumer's name as a notice names it: its own, or its kind's where it has none. */
const named = (each: SecretConsumer) => each.name ?? each.kind;

/**
 * Each secret replaced, whether something using it has failed to authenticate since (ADM-047), read
 * from the records its consumers already keep: a connection's runs and tests failing
 * `connection_failed`, an endpoint's runs ending `model_unavailable`, a webhook's attempts answered
 * 401 or 403, the relay's mail failing `auth_failed`. The rest record nothing that says so
 * (`SECRET_CONSUMERS`'s `breaks`). Keyed by the replacement, so the next one's break is told again.
 */
export async function secretsFailing(trx: TenantTransaction): Promise<
  {
    readonly key: string;
    readonly failing: boolean;
    readonly secret: SecretFailing;
  }[]
> {
  const answer = [];
  for (const each of await tenantSecrets(trx)) {
    if (each.replacedAt === null) continue;
    const since = each.replacedAt;
    let failing = false;
    if (each.kind === 'connection_credential' || each.kind === 'delivery_store_password') {
      const { rows } = await sql<{ failing: boolean }>`
        select coalesce((
          select outcome = 'failed' and failure = 'connection_failed' from (
            select at, outcome, failure from query_run
             where connection_id = ${each.of.id} and at >= ${since} and outcome <> 'throttled'
            union all
            select tested_at, outcome, failure from connection_test
             where connection_id = ${each.of.id} and tested_at >= ${since}
          ) runs order by at desc limit 1), false) as failing`.execute(trx);
      failing = rows[0]?.failing ?? false;
    } else if (each.kind === 'model_endpoint_key') {
      const { rows } = await sql<{ failing: boolean }>`
        select coalesce((select outcome = 'model_unavailable' from generation_run
           where endpoint_id = ${each.of.id} and started_at >= ${since} and outcome <> 'running'
           order by started_at desc, id desc limit 1), false) as failing`.execute(trx);
      failing = rows[0]?.failing ?? false;
    } else if (each.kind === 'webhook_signing_secret') {
      const { rows } = await sql<{ failing: boolean }>`
        select coalesce((select a.status in (401, 403) from webhook_attempt a
            join webhook_delivery d on d.id = a.delivery_id
           where d.subscription_id = ${each.of.id} and a.at >= ${since}
           order by a.at desc, a.id desc limit 1), false) as failing`.execute(trx);
      failing = rows[0]?.failing ?? false;
    } else if (each.kind === 'mail_relay_password') {
      const { rows } = await sql<{ failing: boolean }>`
        select coalesce((select failure = 'auth_failed' from email_attempt
           where at >= ${since} order by at desc, id desc limit 1), false) as failing`.execute(trx);
      failing = rows[0]?.failing ?? false;
    } else continue;
    answer.push({
      key: `${each.kind}:${each.of.id}:${since.getTime()}`,
      failing,
      secret: { kind: each.kind, name: each.of.name, consumers: each.consumers.map(named) },
    });
  }
  return answer;
}
