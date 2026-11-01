import {
  callsTools,
  costMicros,
  endpointKind,
  readsImages,
  modelCredentialContext,
  type ModelEndpoint,
  type RoutedPurpose,
  type RunPurpose,
} from '@alloy-works/domain';
import { sql } from 'kysely';

import { recordEvent } from './audit.js';
import { alertSpend } from './generation-budget.js';
import type { TenantTransaction } from './tables.js';

/**
 * A tenant's model endpoints, their keys and routes, and every model call's run (generation.md,
 * "Endpoints" and "The run"; the G1 plan, G1-A, G1-B, G1-G, G1-M). An endpoint is a mutable row,
 * each change audited; its key is sealed by the connector, never readable here but as the sealed
 * text a call is sent with; a run is ended once and kept.
 */

/** An endpoint as stored: its settings, and whether it is retired. */
export interface StoredModelEndpoint extends ModelEndpoint {
  readonly id: string;
  readonly madeAt: Date;
  readonly changedAt: Date;
  readonly retiredAt: Date | null;
}

/** Whether an endpoint's key is set, and whether it was set for where the endpoint now points. */
export type ModelKeyState =
  | { readonly set: false }
  | {
      readonly set: true;
      readonly setBy: string | null;
      readonly setAt: Date;
      /** The base URL's origin changed after it was set: it opens nothing until set again. */
      readonly needsSetting: boolean;
    };

interface EndpointRow {
  id: string;
  name: string;
  protocol: ModelEndpoint['protocol'];
  base_url: string;
  model: string;
  context_window: number;
  price_in_micros: string;
  price_out_micros: string;
  /** Absent from a schema before 0134. */
  price_cached_micros?: string | null;
  currency: string;
  boundary: ModelEndpoint['boundary'];
  /** Absent from a schema before 0182, as the three after it are. */
  kind?: NonNullable<ModelEndpoint['kind']>;
  timeout_seconds?: number | null;
  supports_tools?: boolean;
  supports_images?: boolean;
  /** Absent from a schema before 0185. */
  turns_per_run?: number | null;
  tool_calls_per_run?: number | null;
  made_at: Date;
  changed_at: Date;
  retired_at: Date | null;
}

const fromMicros = (micros: string) => Number(micros) / 1e6;
const toMicros = (price: number) => Math.round(price * 1e6);

const endpointOf = (row: EndpointRow): StoredModelEndpoint => ({
  id: row.id,
  name: row.name,
  protocol: row.protocol,
  baseUrl: row.base_url,
  model: row.model,
  contextWindow: row.context_window,
  priceIn: fromMicros(row.price_in_micros),
  priceOut: fromMicros(row.price_out_micros),
  ...(row.price_cached_micros == null ? {} : { priceCached: fromMicros(row.price_cached_micros) }),
  currency: row.currency,
  boundary: row.boundary,
  kind: row.kind ?? 'llm',
  ...(row.timeout_seconds == null ? {} : { timeoutSeconds: row.timeout_seconds }),
  supportsTools: row.supports_tools ?? true,
  supportsImages: row.supports_images ?? false,
  ...(row.turns_per_run == null ? {} : { turnsPerRun: row.turns_per_run }),
  ...(row.tool_calls_per_run == null ? {} : { toolCallsPerRun: row.tool_calls_per_run }),
  madeAt: row.made_at,
  changedAt: row.changed_at,
  retiredAt: row.retired_at,
});

/** What a key is sealed for beside the endpoint's id: kept, to see a changed origin (G1-M). */
const sealedFor = (endpoint: Pick<ModelEndpoint, 'protocol' | 'baseUrl'>) =>
  modelCredentialContext('', endpoint);

async function event(
  trx: TenantTransaction,
  kind:
    | 'model_endpoint.made'
    | 'model_endpoint.changed'
    | 'model_endpoint.credential_set'
    | 'model_endpoint.tested'
    | 'model_endpoint.retired',
  id: string,
  detail: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await recordEvent(trx, { kind, subject: { kind: 'model_endpoint', id }, detail });
}

export async function listModelEndpoints(trx: TenantTransaction): Promise<StoredModelEndpoint[]> {
  const { rows } = await sql<EndpointRow>`select * from model_endpoint
    order by retired_at is not null, lower(name), id`.execute(trx);
  return rows.map(endpointOf);
}

/**
 * An endpoint by id; `held` locks it for share, so it is neither retired nor changed until the
 * transaction ends, as a route set to it needs (the final review).
 */
export async function readModelEndpoint(
  trx: TenantTransaction,
  id: string,
  held = false,
): Promise<StoredModelEndpoint | undefined> {
  const { rows } = await sql<EndpointRow>`select * from model_endpoint where id = ${id}
    ${held ? sql`for share` : sql``}`.execute(trx);
  return rows[0] && endpointOf(rows[0]);
}

export type EndpointWritten =
  | { readonly answer: 'written'; readonly endpoint: StoredModelEndpoint }
  | { readonly answer: 'name.taken' | 'endpoint.missing' | 'endpoint.retired' | 'protocol.fixed' };

/**
 * Whether another endpoint in use holds the name, asked first: a unique violation would end the
 * transaction the write is part of. The partial index still holds two writers apart.
 */
async function nameTaken(trx: TenantTransaction, name: string, except?: string): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`select id from model_endpoint
    where lower(name) = lower(${name}) and retired_at is null
      and id is distinct from ${except ?? null}::uuid`.execute(trx);
  return rows.length > 0;
}

export async function makeModelEndpoint(
  trx: TenantTransaction,
  endpoint: ModelEndpoint,
  by: string,
): Promise<EndpointWritten> {
  if (await nameTaken(trx, endpoint.name)) return { answer: 'name.taken' };
  // The cached price only where one is given, so a schema before 0134 still takes an endpoint.
  const cachedColumn = endpoint.priceCached === undefined ? sql`` : sql`, price_cached_micros`;
  const cachedValue =
    endpoint.priceCached === undefined ? sql`` : sql`, ${toMicros(endpoint.priceCached)}`;
  // Likewise each of 0182's only where it is said, so a schema before it still takes one.
  const said = CAPABILITIES.filter(([member]) => endpoint[member] !== undefined);
  const capabilityColumns = sql.join(
    said.map(([, column]) => sql`, ${sql.ref(column)}`),
    sql``,
  );
  const capabilityValues = sql.join(
    said.map(([member]) => sql`, ${endpoint[member]}`),
    sql``,
  );
  const { rows } = await sql<EndpointRow>`insert into model_endpoint
        (name, protocol, base_url, model, context_window, price_in_micros, price_out_micros,
         currency, boundary, made_by${cachedColumn}${capabilityColumns})
      values (${endpoint.name}, ${endpoint.protocol}, ${endpoint.baseUrl}, ${endpoint.model},
        ${endpoint.contextWindow}, ${toMicros(endpoint.priceIn)}, ${toMicros(endpoint.priceOut)},
        ${endpoint.currency}, ${endpoint.boundary}, ${by}${cachedValue}${capabilityValues})
      returning *`.execute(trx);
  const made = endpointOf(rows[0]!);
  await event(trx, 'model_endpoint.made', made.id);
  return { answer: 'written', endpoint: made };
}

/** The settings an endpoint's change names, by member, for its audit detail: never a value. */
const SETTING_MEMBERS = [
  'name',
  'baseUrl',
  'model',
  'contextWindow',
  'priceIn',
  'priceOut',
  'priceCached',
  'currency',
  'boundary',
  'kind',
  'timeoutSeconds',
  'supportsTools',
  'supportsImages',
  'turnsPerRun',
  'toolCallsPerRun',
] as const;

/** 0182's settings and 0185's, and their columns. */
const CAPABILITIES = [
  ['kind', 'kind'],
  ['timeoutSeconds', 'timeout_seconds'],
  ['supportsTools', 'supports_tools'],
  ['supportsImages', 'supports_images'],
  ['turnsPerRun', 'turns_per_run'],
  ['toolCallsPerRun', 'tool_calls_per_run'],
] as const;

export async function changeModelEndpoint(
  trx: TenantTransaction,
  id: string,
  settings: ModelEndpoint,
): Promise<EndpointWritten> {
  // A setting of 0182's left out is its default, as a new endpoint's is.
  const next: ModelEndpoint = {
    ...settings,
    kind: endpointKind(settings),
    supportsTools: callsTools(settings),
    supportsImages: readsImages(settings),
  };
  const { rows: held } = await sql<EndpointRow>`select * from model_endpoint where id = ${id}
    for update`.execute(trx);
  if (!held[0]) return { answer: 'endpoint.missing' };
  const before = endpointOf(held[0]);
  if (before.retiredAt !== null) return { answer: 'endpoint.retired' };
  if (before.protocol !== next.protocol) return { answer: 'protocol.fixed' };
  const changed = SETTING_MEMBERS.filter((member) => before[member] !== next[member]);
  if (changed.length === 0) return { answer: 'written', endpoint: before };
  if (changed.includes('name') && (await nameTaken(trx, next.name, id))) {
    return { answer: 'name.taken' };
  }
  const { rows } = await sql<EndpointRow>`update model_endpoint set name = ${next.name},
        base_url = ${next.baseUrl}, model = ${next.model}, context_window = ${next.contextWindow},
        price_in_micros = ${toMicros(next.priceIn)}, price_out_micros = ${toMicros(next.priceOut)},
        currency = ${next.currency}, boundary = ${next.boundary}, changed_at = now()
        ${
          changed.includes('priceCached')
            ? sql`, price_cached_micros = ${next.priceCached === undefined ? null : toMicros(next.priceCached)}`
            : sql``
        }
        ${sql.join(
          CAPABILITIES.filter(([member]) => changed.includes(member)).map(
            ([member, column]) => sql`, ${sql.ref(column)} = ${next[member] ?? null}`,
          ),
          sql``,
        )}
      where id = ${id} returning *`.execute(trx);
  await event(trx, 'model_endpoint.changed', id, { settings: [...changed] });
  return { answer: 'written', endpoint: endpointOf(rows[0]!) };
}

/** Retired, it routes nothing: every route to it is cleared with it (G1-A). */
export async function retireModelEndpoint(
  trx: TenantTransaction,
  id: string,
): Promise<EndpointWritten> {
  const { rows } = await sql<EndpointRow>`update model_endpoint
    set retired_at = coalesce(retired_at, now()), changed_at = now()
    where id = ${id} returning *`.execute(trx);
  if (!rows[0]) return { answer: 'endpoint.missing' };
  const { rows: cleared } = await sql<{ purpose: string }>`delete from model_route
    where endpoint_id = ${id} returning purpose`.execute(trx);
  for (const { purpose } of cleared) {
    await recordEvent(trx, {
      kind: 'model_route.set',
      subject: { kind: 'model_route', id },
      detail: { purpose, endpoint: null },
    });
  }
  await event(trx, 'model_endpoint.retired', id);
  return { answer: 'written', endpoint: endpointOf(rows[0]) };
}

export async function setModelCredential(
  trx: TenantTransaction,
  endpoint: StoredModelEndpoint,
  sealed: string,
  by: string,
): Promise<void> {
  await sql`insert into model_credential (endpoint_id, sealed, sealed_for, set_by)
    values (${endpoint.id}, ${sealed}, ${sealedFor(endpoint)}, ${by})`.execute(trx);
  await event(trx, 'model_endpoint.credential_set', endpoint.id);
}

interface CredentialRow {
  sealed: string;
  sealed_for: string;
  set_by: string | null;
  set_at: Date;
}

async function latestCredential(
  trx: TenantTransaction,
  id: string,
): Promise<CredentialRow | undefined> {
  const { rows } = await sql<CredentialRow>`select sealed, sealed_for, set_by, set_at
    from model_credential where endpoint_id = ${id}
    order by set_at desc, id desc limit 1`.execute(trx);
  return rows[0];
}

export async function modelKeyState(
  trx: TenantTransaction,
  endpoint: StoredModelEndpoint,
): Promise<ModelKeyState> {
  const latest = await latestCredential(trx, endpoint.id);
  if (!latest) return { set: false };
  return {
    set: true,
    setBy: latest.set_by,
    setAt: latest.set_at,
    needsSetting: latest.sealed_for !== sealedFor(endpoint),
  };
}

/** The sealed key a call is sent with, where one is set for where the endpoint points. */
export async function usableModelKey(
  trx: TenantTransaction,
  endpoint: StoredModelEndpoint,
): Promise<string | undefined> {
  const latest = await latestCredential(trx, endpoint.id);
  return latest && latest.sealed_for === sealedFor(endpoint) ? latest.sealed : undefined;
}

export interface ModelRoute {
  readonly purpose: RoutedPurpose;
  readonly endpointId: string;
  readonly setBy: string | null;
  readonly setAt: Date;
}

export async function listModelRoutes(trx: TenantTransaction): Promise<ModelRoute[]> {
  const { rows } = await sql<{
    purpose: RoutedPurpose;
    endpoint_id: string;
    set_by: string | null;
    set_at: Date;
  }>`select * from model_route order by purpose`.execute(trx);
  return rows.map((row) => ({
    purpose: row.purpose,
    endpointId: row.endpoint_id,
    setBy: row.set_by,
    setAt: row.set_at,
  }));
}

/**
 * Routes a purpose to an endpoint, or to none (`null` deletes its row; G1-M). Audited where it
 * changes anything; the caller has checked the endpoint is usable.
 */
export async function setModelRoute(
  trx: TenantTransaction,
  purpose: RoutedPurpose,
  endpointId: string | null,
  by: string,
): Promise<void> {
  const { rows } = await sql<{ endpoint_id: string }>`select endpoint_id from model_route
    where purpose = ${purpose} for update`.execute(trx);
  if ((rows[0]?.endpoint_id ?? null) === endpointId) return;
  if (endpointId === null) {
    await sql`delete from model_route where purpose = ${purpose}`.execute(trx);
  } else {
    await sql`insert into model_route (purpose, endpoint_id, set_by) values (${purpose}, ${endpointId}, ${by})
      on conflict (purpose) do update set endpoint_id = excluded.endpoint_id,
        set_by = excluded.set_by, set_at = now()`.execute(trx);
  }
  await recordEvent(trx, {
    kind: 'model_route.set',
    subject: { kind: 'model_route', id: endpointId ?? rows[0]!.endpoint_id },
    detail: { purpose, endpoint: endpointId },
  });
}

/** A run as it was recorded. */
export interface GenerationRun {
  readonly id: string;
  readonly purpose: RunPurpose;
  readonly endpointId: string;
  readonly endpoint: Readonly<Record<string, unknown>>;
  readonly promptVersion: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly contextDigest: string;
  readonly context: readonly unknown[];
  readonly steps: readonly unknown[];
  readonly requestedBy: string | null;
  readonly documentId: string | null;
  /** The person's words and the model's (GN-I): null for a run made before 0126, or without them. */
  readonly ask: string | null;
  readonly reply: string | null;
  readonly startedAt: Date;
  readonly outcome: string;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  /** Of those in, how many the provider read from its prompt cache (G6-E). */
  readonly tokensCached: number | null;
  /** The run of the requester's this one reused, made with no call (G6-E). */
  readonly cachedFrom: string | null;
  readonly costMicros: bigint | null;
  readonly finishedAt: Date | null;
  /** As it ends: true where its budget alert could not be sent (G6-D), for the caller to log. */
  readonly alertFailed?: true;
}

interface RunRow {
  id: string;
  purpose: RunPurpose;
  endpoint_id: string;
  endpoint: Record<string, unknown>;
  prompt_version: string | null;
  parameters: Record<string, unknown>;
  context_digest: string;
  context: unknown[];
  steps: unknown[];
  requested_by: string | null;
  document_id: string | null;
  ask?: string | null;
  reply?: string | null;
  started_at: Date;
  outcome: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  /** Absent from a schema before 0134. */
  tokens_cached?: number | null;
  cached_from?: string | null;
  cost_micros: string | null;
  finished_at: Date | null;
}

const runOf = (row: RunRow): GenerationRun => ({
  id: row.id,
  purpose: row.purpose,
  endpointId: row.endpoint_id,
  endpoint: row.endpoint,
  promptVersion: row.prompt_version,
  parameters: row.parameters,
  contextDigest: row.context_digest,
  context: row.context,
  steps: row.steps,
  requestedBy: row.requested_by,
  documentId: row.document_id,
  ask: row.ask ?? null,
  reply: row.reply ?? null,
  startedAt: row.started_at,
  outcome: row.outcome,
  model: row.model,
  tokensIn: row.tokens_in,
  tokensOut: row.tokens_out,
  tokensCached: row.tokens_cached ?? null,
  cachedFrom: row.cached_from ?? null,
  costMicros: row.cost_micros === null ? null : BigInt(row.cost_micros),
  finishedAt: row.finished_at,
});

/** A run started before its call (G1-G), the endpoint's settings copied as they are now. */
export async function startRun(
  trx: TenantTransaction,
  input: {
    readonly purpose: RunPurpose;
    readonly endpoint: StoredModelEndpoint;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly contextDigest: string;
    readonly context?: readonly unknown[];
    /** Its requester; none for an embedding whose version's author was erased (G7-F). */
    readonly by: string | null;
    readonly documentId?: string | null;
    readonly promptVersion?: string | null;
    /** The person's words, kept with the run (GN-I). */
    readonly ask?: string;
    /** The conversation it is a turn of (G5-A). */
    readonly conversationId?: string;
    /** The requester's earlier run this one reuses, calling nothing (G6-E). */
    readonly cachedFrom?: string;
  },
): Promise<string> {
  const e = input.endpoint;
  const settings: ModelEndpoint = {
    name: e.name,
    protocol: e.protocol,
    baseUrl: e.baseUrl,
    model: e.model,
    contextWindow: e.contextWindow,
    priceIn: e.priceIn,
    priceOut: e.priceOut,
    ...(e.priceCached === undefined ? {} : { priceCached: e.priceCached }),
    currency: e.currency,
    boundary: e.boundary,
  };
  // The ask only where one is given, so a schema before 0126 still takes a run without one.
  const ask = input.ask === undefined ? sql`` : sql`, ask`;
  const asked = input.ask === undefined ? sql`` : sql`, ${input.ask}`;
  const on = input.conversationId === undefined ? sql`` : sql`, conversation_id`;
  const conversation = input.conversationId === undefined ? sql`` : sql`, ${input.conversationId}`;
  const reusing = input.cachedFrom === undefined ? sql`` : sql`, cached_from`;
  const reused = input.cachedFrom === undefined ? sql`` : sql`, ${input.cachedFrom}`;
  const { rows } = await sql<{ id: string }>`insert into generation_run
      (purpose, endpoint_id, endpoint, prompt_version, parameters, context_digest, context,
       requested_by, document_id${ask}${on}${reusing})
    values (${input.purpose}, ${input.endpoint.id}, ${JSON.stringify(settings)}::jsonb,
      ${input.promptVersion ?? null}, ${JSON.stringify(input.parameters)}::jsonb,
      ${input.contextDigest}, ${JSON.stringify(input.context ?? [])}::jsonb, ${input.by},
      ${input.documentId ?? null}${asked}${conversation}${reused})
    returning id`.execute(trx);
  return rows[0]!.id;
}

/**
 * Ends a run, once (G1-G): its outcome, the model the reply named, its tokens and their cost at the
 * prices it was started with, and its steps. A run already ended is refused by the table's trigger.
 */
export async function endRun(
  trx: TenantTransaction,
  id: string,
  ended: {
    readonly outcome: string;
    readonly model?: string | null;
    readonly usage?: {
      readonly in: number;
      readonly out: number;
      readonly cached?: number | undefined;
    } | null;
    readonly steps?: readonly unknown[];
    /** What the model was last given, as it ends (the G2 plan, G2-J): its digest, and what it read. */
    readonly contextDigest?: string;
    readonly context?: readonly unknown[];
    /** The model's words, kept with the run (GN-I). */
    readonly reply?: string;
  },
): Promise<GenerationRun> {
  const { rows: started } =
    await sql<RunRow>`select * from generation_run where id = ${id}`.execute(trx);
  const run = started[0];
  if (!run) throw new Error('generation_run: no such run');
  // Prices as the run started with them: one started before 0134 has no cached price.
  const prices = run.endpoint as { priceIn: number; priceOut: number; priceCached?: number };
  const cost = ended.usage ? costMicros(ended.usage, prices) : null;
  const { rows } = await sql<RunRow>`update generation_run set outcome = ${ended.outcome},
      model = ${ended.model ?? null}, tokens_in = ${ended.usage?.in ?? null},
      tokens_out = ${ended.usage?.out ?? null},
      ${ended.usage?.cached === undefined ? sql`` : sql`tokens_cached = ${ended.usage.cached},`}
      cost_micros = ${cost === null ? null : cost.toString()},
      steps = ${JSON.stringify(ended.steps ?? run.steps)}::jsonb,
      context_digest = ${ended.contextDigest ?? run.context_digest},
      context = ${JSON.stringify(ended.context ?? run.context)}::jsonb, finished_at = now()
      ${ended.reply === undefined ? sql`` : sql`, reply = ${ended.reply}`}
    where id = ${id} returning *`.execute(trx);
  // What it cost counts towards the month's budget, and may cross an alert (G6-D), never un-ending it.
  const alerted = cost !== null && cost > 0n ? await alertSpend(trx) : { told: 0 };
  return { ...runOf(rows[0]!), ...('failed' in alerted ? { alertFailed: true as const } : {}) };
}

/** How long a finished run of a person's may be reused for them (G6-E). */
export const RESULT_REUSED_HOURS = 24;

/**
 * A finished run of the requester's own to reuse in place of calling (G6-E; GEN-036): the same prompt
 * version and purpose, the same call (its digest: model, instructions, context), the same parameters,
 * and the same endpoint pointing where it did, with the same boundary; within the hours it is reused
 * for. Keyed by the requester, so no other person's result is reachable. None before 0134.
 */
export async function reusableRun(
  trx: TenantTransaction,
  input: {
    readonly by: string;
    readonly purpose: RunPurpose;
    readonly promptVersion: string;
    readonly contextDigest: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly endpoint: StoredModelEndpoint;
  },
): Promise<
  { readonly id: string; readonly reply: string; readonly model: string | null } | undefined
> {
  const { rows: held } = await sql<{ found: boolean }>`
    select exists (select 1 from information_schema.columns
      where table_schema = current_schema() and table_name = 'generation_run'
        and column_name = 'cached_from') as found`.execute(trx);
  if (held[0]?.found !== true) return undefined;
  const e = input.endpoint;
  const { rows } = await sql<{ id: string; reply: string; model: string | null }>`
    select id, reply, model from generation_run
     where requested_by = ${input.by} and purpose = ${input.purpose}
       and prompt_version = ${input.promptVersion} and outcome = 'finished' and cached_from is null
       and context_digest = ${input.contextDigest}
       and parameters = ${JSON.stringify(input.parameters)}::jsonb
       and endpoint_id = ${e.id} and endpoint ->> 'baseUrl' = ${e.baseUrl}
       and endpoint ->> 'model' = ${e.model} and endpoint ->> 'boundary' = ${e.boundary}
       and coalesce(reply, '') <> '' and steps -> 0 ? 'proposal'
       and started_at > now() - make_interval(hours => ${RESULT_REUSED_HOURS})
     order by started_at desc limit 1`.execute(trx);
  return rows[0];
}

export async function readRun(
  trx: TenantTransaction,
  id: string,
): Promise<GenerationRun | undefined> {
  const { rows } = await sql<RunRow>`select * from generation_run where id = ${id}`.execute(trx);
  return rows[0] && runOf(rows[0]);
}

/** A test's record (G1-J): the run it made, and how it ended. */
export async function recordEndpointTest(
  trx: TenantTransaction,
  endpointId: string,
  run: string,
  outcome: string,
): Promise<void> {
  await event(trx, 'model_endpoint.tested', endpointId, { run, outcome });
}

/**
 * A step of a run while it runs (the G2 plan, G2-B): each tool call, its arguments and its result,
 * appended as it is made, so a run that never ends still says what it did (GEN-010).
 */
export async function noteStep(
  trx: TenantTransaction,
  id: string,
  step: Readonly<Record<string, unknown>>,
): Promise<void> {
  await sql`update generation_run set steps = steps || ${JSON.stringify([step])}::jsonb
    where id = ${id} and outcome = 'running'`.execute(trx);
}

/** The runs left running past `olderThanMs`, ended `abandoned` (the worker's sweep; G2-B). */
export async function sweepAbandonedRuns(
  trx: TenantTransaction,
  olderThanMs = 60 * 60 * 1000,
): Promise<number> {
  const { rows } = await sql<{ id: string }>`update generation_run
    set outcome = 'abandoned', finished_at = now()
    where outcome = 'running' and started_at < now() - ${`${olderThanMs} milliseconds`}::interval
    returning id`.execute(trx);
  return rows.length;
}

/** A run of the assistant ended (LIF-071): its own event, as its requester's. */
export async function recordGenerationRun(
  trx: TenantTransaction,
  run: GenerationRun,
): Promise<void> {
  await recordEvent(trx, {
    kind: 'generation.run',
    subject: { kind: 'generation_run', id: run.id },
    detail: { run: run.id, outcome: run.outcome, purpose: run.purpose },
  });
}

/** A person's runs this calendar month, UTC, and what they cost (GEN-037). */
export async function runsThisMonth(
  trx: TenantTransaction,
  by: string,
): Promise<{
  readonly runs: number;
  readonly costs: readonly { currency: string; micros: bigint }[];
}> {
  const { rows } = await sql<{ currency: string; runs: string; micros: string | null }>`
    select endpoint ->> 'currency' as currency, count(*) as runs, sum(cost_micros) as micros
      from generation_run
     where requested_by = ${by} and purpose <> 'test'
       and started_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
     group by 1 order by 1`.execute(trx);
  return {
    runs: rows.reduce((total, row) => total + Number(row.runs), 0),
    costs: rows.map((row) => ({ currency: row.currency, micros: BigInt(row.micros ?? '0') })),
  };
}
