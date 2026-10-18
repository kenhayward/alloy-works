import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  actOnProposal,
  acceptSuggestion,
  endRun,
  listModelRoutes,
  makeProposal,
  makeSuggestion,
  noteStep,
  proposalsOfRun,
  readDocument,
  readModelEndpoint,
  readProposal,
  readRun,
  recordGenerationRun,
  resolveOccurrences,
  runsThisMonth,
  searchWords,
  startRun,
  usableModelKey,
  versionContents,
  type GenerationProposal,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ASSISTANT_INSTRUCTIONS,
  ASSISTANT_INSTRUCTIONS_VERSION,
  ASSISTANT_TOOLS,
  admit,
  applyEdits,
  asData,
  blockIdentifierFrom,
  canonicalCall,
  citationsIn,
  componentAsText,
  isAssistantTool,
  parseContentDocument,
  toolInputSchemas,
  type BlockNode,
  type ContentDocument,
  type GenerationFailure,
  type ModelCall,
  type ModelMessage,
  type OutlineDocument,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import { readMarkdown } from '@alloy-works/readers/markdown';
import type { FastifyRequest } from 'fastify';

import { authoriseAt, callerOf, notFound, type Authorised } from '../access.js';
import { Streamed } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { watchAuthority } from '../authority.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { liveBindingStates } from '../data/bindings.js';
import { AppError } from '../errors.js';
import type { SessionPrincipal } from '../sessions.js';

/**
 * The drafting assistant (generation.md, "The assistant"; the G2 plan): a run against the open
 * document, its loop in the service, each turn a model call through the connector (ADR-0064), each
 * tool call run as the requester in a transaction of its own that decides again (GEN-008), and every
 * change a proposal the requester acts on (GEN-009).
 */

/** The run's limits (G2-B): within the stream's five minutes. */
export const ASSISTANT_LIMITS = {
  turns: 6,
  toolCalls: 12,
  turnMs: 60_000,
  runMs: 240_000,
  maxTokens: 4096,
} as const;

/** What a tool answers the model, the step it records, and a short summary for the page. */
interface ToolAnswer {
  readonly ok: boolean;
  readonly content: string;
  readonly summary: string;
  /** The blocks a `read_component` answered, which a citation may name (G2-G). */
  readonly read?: {
    readonly component: string;
    readonly version: string;
    readonly blocks: readonly string[];
  };
  readonly proposal?: GenerationProposal;
}

const WORDS: Readonly<Record<GenerationFailure['code'], string>> = {
  model_unavailable: 'The model endpoint did not answer, refused its key, or failed.',
  model_mismatch: 'The endpoint answered as a model other than the one it names.',
  context_too_large: 'The endpoint said what it was sent is more than the model accepts.',
  timeout: 'The assistant did not finish in time.',
  connector_error: 'The connector failed while it called the endpoint.',
  connector_busy: 'The connector is calling as many models as it may at once. Try again shortly.',
  connector_unavailable: 'The connector could not be reached.',
};

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A component's latest blocks, as Markdown admitted into them (G2-D). */
function markdownReader(document: ContentDocument) {
  return (markdown: string): readonly BlockNode[] | string => {
    const reading = readMarkdown(markdown);
    if (!reading.ok) return 'The Markdown could not be read.';
    const admitted = admit(reading.input, {
      document,
      conditionAxes: [],
      newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
    });
    return admitted.ok ? admitted.content : 'The Markdown could not be admitted as content.';
  };
}

/** The text a section title's inline content says. */
const titleOf = (title: readonly unknown[]) =>
  title
    .map((node) =>
      typeof node === 'object' && node !== null && (node as { type?: string }).type === 'text'
        ? String((node as { value?: unknown }).value ?? '')
        : '',
    )
    .join('');

export function assistantHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  connector?: ConnectorOptions,
  objects?: ObjectStores,
  events?: TenantListener,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /** The occurrences of the document the requester may read, decided now. */
  async function placed(trx: TenantTransaction, document: string, principal: string) {
    const stored = await readDocument(trx, document);
    if (!stored) return undefined;
    const outline = stored.version.content as OutlineDocument;
    const resolved = await resolveOccurrences(trx, outline, principal);
    const readable = new Map<string, string>();
    for (const each of resolved) {
      if (each.outcome === 'resolved') readable.set(each.component, each.version);
    }
    return { outline, readable };
  }

  /** Each tool, as the requester, in a transaction of its own that decides `read` again (G2-C). */
  function tools(request: FastifyRequest, document: string, principal: string, run: string) {
    const tenant = tenantOf(request);
    const caller = callerOf(request);
    const context = contextOf(request);
    const inDocument = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
      db.withTenant(
        tenant,
        async (trx) => {
          await authoriseAt(trx, caller, 'read', { kind: 'artifact', id: document });
          return work(trx);
        },
        context,
      );
    const missing = (what: string): ToolAnswer => ({
      ok: false,
      content: `There is no ${what} in this document that you can read.`,
      summary: `No such ${what}`,
    });

    return async (name: string, input: unknown): Promise<ToolAnswer> => {
      if (!isAssistantTool(name)) {
        return { ok: false, content: `There is no tool ${name}.`, summary: 'No such tool' };
      }
      const parsed = toolInputSchemas[name].safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          content: 'The arguments are not what this tool takes.',
          summary: 'Arguments refused',
        };
      }
      try {
        switch (name) {
          case 'read_outline':
            return await inDocument(async (trx) => {
              const found = await placed(trx, document, principal);
              if (!found) return missing('document');
              const lines: string[] = [`Document: ${found.outline.title}`];
              const visit = (nodes: readonly unknown[], depth: number) => {
                for (const raw of nodes) {
                  const node = raw as {
                    type: string;
                    title?: unknown[];
                    component?: string;
                    children?: unknown[];
                  };
                  const indent = '  '.repeat(depth);
                  if (node.type === 'section') {
                    lines.push(`${indent}Section: ${titleOf(node.title ?? [])}`);
                  } else if (node.component !== undefined && found.readable.has(node.component)) {
                    lines.push(`${indent}Component ${node.component}`);
                  }
                  visit(node.children ?? [], depth + 1);
                }
              };
              visit(found.outline.nodes, 0);
              return {
                ok: true,
                content: asData(`document:${document}`, null, lines.join('\n')),
                summary: `${found.readable.size} components`,
              };
            });
          case 'read_component': {
            const { component } = parsed.data as { component: string };
            return await inDocument(async (trx) => {
              const found = await placed(trx, document, principal);
              const version = found?.readable.get(component);
              if (version === undefined) return missing('component');
              const contents = await versionContents(trx, [version]);
              const read = contents.get(version);
              if (!read) return missing('component');
              const content = read.content as ContentDocument;
              const number = `${read.revision}.${read.version}`;
              return {
                ok: true,
                content: asData(`component:${component}`, number, componentAsText(content)),
                summary: `${content.content.length} blocks, version ${number}`,
                read: { component, version, blocks: content.content.map((block) => block.id) },
              };
            });
          }
          case 'search_document': {
            const { query } = parsed.data as { query: string };
            return await inDocument(async (trx) => {
              const found = await placed(trx, document, principal);
              if (!found) return missing('document');
              const answer = await searchWords(trx, principal, query, { limit: 50 });
              const hits =
                typeof answer === 'object' && answer.outcome === 'results'
                  ? answer.items.filter((item) => found.readable.has(item.artifactId)).slice(0, 10)
                  : [];
              const text = hits
                .map(
                  (hit) =>
                    `Component ${hit.artifactId}: ${hit.passage.map((piece) => piece.text).join('')}`,
                )
                .join('\n');
              return {
                ok: true,
                content: asData(
                  `search:${document}`,
                  null,
                  text === '' ? 'Nothing matched.' : text,
                ),
                summary: `${hits.length} found`,
              };
            });
          }
          case 'read_values':
            return await inDocument(async (trx) => {
              const views = await liveBindingStates(trx, caller, objects, tenant, document);
              if (!views) return missing('document');
              // One line a value, as the page shows it: its place, the query it came from, and what
              // it holds, never the provenance around it.
              const values = views.map((view) => {
                const held = view.held as { taken?: { value?: unknown } | null } | null;
                const value = held?.taken?.value;
                const shown =
                  value === undefined || value === null
                    ? 'nothing held'
                    : typeof value === 'object'
                      ? JSON.stringify(value)
                      : String(value);
                return `At ${view.node}, from ${view.definition?.title ?? 'a query you may not read'}: ${shown}`;
              });
              return {
                ok: true,
                content: asData(
                  `values:${document}`,
                  null,
                  values.length === 0 ? 'The document binds no values.' : values.join('\n'),
                ),
                summary: `${values.length} values`,
              };
            });
          case 'propose_edit': {
            const { component, edits } = parsed.data as {
              component: string;
              edits: Parameters<typeof applyEdits>[1];
            };
            return await inDocument(async (trx) => {
              const found = await placed(trx, document, principal);
              const version = found?.readable.get(component);
              if (version === undefined) return missing('component');
              try {
                await authoriseAt(trx, caller, 'suggest', { kind: 'artifact', id: component });
              } catch {
                return {
                  ok: false,
                  content: 'You may not suggest changes to this component.',
                  summary: 'Not yours to change',
                };
              }
              const read = (await versionContents(trx, [version])).get(version);
              if (!read) return missing('component');
              let content: ContentDocument;
              try {
                content = parseContentDocument(read.content);
              } catch {
                return missing('component');
              }
              const outcome = applyEdits(content, edits, markdownReader(content));
              if (!outcome.ok)
                return { ok: false, content: outcome.problem, summary: 'Edit refused' };
              if (JSON.stringify(outcome.content) === JSON.stringify(content)) {
                return {
                  ok: false,
                  content: 'These edits change nothing.',
                  summary: 'Changes nothing',
                };
              }
              const proposal = await makeProposal(trx, {
                run,
                component,
                against: version,
                proposed: outcome.content,
              });
              return {
                ok: true,
                content: `Proposal ${proposal.number} made. Nothing changes until the author accepts it.`,
                summary: `Proposal ${proposal.number}`,
                proposal,
              };
            });
          }
        }
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return missing('document');
        throw error;
      }
    };
  }

  return {
    startAssistantRun: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as { id: string };
      const { ask, component } = request.body as { ask: string; component?: string };
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const route = (await listModelRoutes(trx)).find((each) => each.purpose === 'drafting');
      if (!route) {
        throw new AppError(409, 'model_unconfigured', 'No model endpoint is set up for drafting.');
      }
      const endpoint = await readModelEndpoint(trx, route.endpointId);
      const sealed =
        endpoint && endpoint.retiredAt === null ? await usableModelKey(trx, endpoint) : undefined;
      if (!endpoint || sealed === undefined) {
        throw new AppError(
          409,
          'endpoint_unusable',
          'The drafting endpoint is retired, or has no key set.',
        );
      }
      if (!client) throw new AppError(503, 'connector_unavailable', WORDS.connector_unavailable);
      const asking = client;
      const tenant = tenantOf(request);
      const context = contextOf(request);
      const credential = request.credential ?? null;

      return new Streamed(async (send, closed) => {
        const authority = watchAuthority({ db, tenant, credential, events });
        const stopped = AbortSignal.any([closed, authority.signal]);
        const started = Date.now();
        const first: ModelMessage = {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                component === undefined
                  ? ask
                  : `${ask}\n\n(The author has component ${component} open.)`,
            },
          ],
        };
        const messages: ModelMessage[] = [first];
        const callOf = (): ModelCall => ({
          model: endpoint.model,
          system: ASSISTANT_INSTRUCTIONS,
          messages: [...messages],
          tools: [...ASSISTANT_TOOLS],
          parameters: { maxTokens: ASSISTANT_LIMITS.maxTokens },
        });
        const run = await db.withTenant(
          tenant,
          (inner) =>
            startRun(inner, {
              purpose: 'drafting',
              endpoint,
              parameters: {
                maxTokens: ASSISTANT_LIMITS.maxTokens,
                instructions: ASSISTANT_INSTRUCTIONS_VERSION,
              },
              contextDigest: sha256(canonicalCall(callOf())),
              by: principalId,
              documentId: id,
            }),
          context,
        );
        send('run', { run, endpoint: { name: endpoint.name, boundary: endpoint.boundary } });
        const tool = tools(request, id, principalId, run);
        const usage = { in: 0, out: 0, reported: false };
        const read = new Map<string, Set<string>>();
        const context_: { component: string; version: string; blocks: readonly string[] }[] = [];
        let said = '';
        let model: string | null = null;
        let calls = 0;
        let outcome = 'finished';
        let failure: GenerationFailure | undefined;
        let last = callOf();
        try {
          for (let turn = 0; turn < ASSISTANT_LIMITS.turns; turn += 1) {
            if (stopped.aborted) {
              outcome = 'cancelled';
              break;
            }
            last = callOf();
            const left = ASSISTANT_LIMITS.runMs - (Date.now() - started);
            if (left < 1000) {
              failure = { code: 'timeout' };
              break;
            }
            let text = '';
            const calledFor: { id: string; name: string; input: Record<string, unknown> }[] = [];
            const answer = await asking.model(
              {
                requestId: randomUUID(),
                tenant: tenant.id,
                endpoint: {
                  id: endpoint.id,
                  protocol: endpoint.protocol,
                  baseUrl: endpoint.baseUrl,
                },
                sealed,
                call: last,
                deadlineMs: Math.min(ASSISTANT_LIMITS.turnMs, left),
              },
              (event) => {
                if (event.type === 'text') {
                  text += event.text;
                  send('text', { text: event.text });
                } else if (event.type === 'tool_call') {
                  calledFor.push({ id: event.id, name: event.name, input: event.input });
                }
              },
              stopped,
            );
            if (stopped.aborted) {
              outcome = 'cancelled';
              break;
            }
            if ('refused' in answer) {
              failure = { code: answer.refused.code };
              break;
            }
            if (answer.answer.type === 'failed') {
              failure = answer.answer.failure;
              break;
            }
            const ended = answer.answer;
            model = ended.model;
            if (ended.usage) {
              usage.in += ended.usage.in;
              usage.out += ended.usage.out;
              usage.reported = true;
            }
            said += text;
            const content: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
            if (text !== '') content.push({ type: 'text', text });
            for (const each of calledFor) content.push({ type: 'tool_use', ...each });
            if (content.length > 0) messages.push({ role: 'assistant', content });
            if (calledFor.length === 0 || ended.stop !== 'tool_use') break;
            const results: Extract<ModelMessage, { role: 'user' }>['content'] = [];
            for (const each of calledFor) {
              calls += 1;
              send('tool_call', each);
              const answered: ToolAnswer =
                calls > ASSISTANT_LIMITS.toolCalls
                  ? {
                      ok: false,
                      content: 'This run has made all the tool calls it may.',
                      summary: 'Too many calls',
                    }
                  : await tool(each.name, each.input);
              if (answered.read) {
                const blocks = read.get(answered.read.component) ?? new Set<string>();
                for (const block of answered.read.blocks) blocks.add(block);
                read.set(answered.read.component, blocks);
                context_.push(answered.read);
              }
              await db.withTenant(
                tenant,
                (inner) =>
                  noteStep(inner, run, {
                    tool: each.name,
                    arguments: each.input,
                    ok: answered.ok,
                    result: answered.content,
                  }),
                context,
              );
              send('tool_result', {
                id: each.id,
                name: each.name,
                ok: answered.ok,
                summary: answered.summary,
                result: answered.content,
              });
              if (answered.proposal) {
                send('proposal', {
                  id: answered.proposal.id,
                  number: answered.proposal.number,
                  component: answered.proposal.componentId,
                  against: answered.proposal.madeAgainst,
                  proposed: answered.proposal.proposed,
                });
              }
              results.push({
                type: 'tool_result',
                toolUseId: each.id,
                content: answered.content,
                ...(answered.ok ? {} : { isError: true }),
              });
            }
            messages.push({ role: 'user', content: results });
            if (turn === ASSISTANT_LIMITS.turns - 1) failure = { code: 'timeout' };
          }
        } finally {
          authority.stop();
          const cited = citationsIn(said);
          const kept = cited.filter((each) => read.get(each.component)?.has(each.block) === true);
          const dropped = cited.filter((each) => !kept.includes(each));
          const ending = failure?.code ?? outcome;
          const recorded = await db
            .withTenant(
              tenant,
              async (inner) => {
                const ended = await endRun(inner, run, {
                  outcome: ending,
                  model,
                  usage: usage.reported ? { in: usage.in, out: usage.out } : null,
                  contextDigest: sha256(canonicalCall(last)),
                  context: context_,
                });
                await recordGenerationRun(inner, ended);
                return ended;
              },
              context,
            )
            .catch(() => undefined);
          if (failure) {
            send('failed', {
              code: failure.code,
              ...(failure.reason ? { reason: failure.reason } : {}),
              message: WORDS[failure.code],
            });
          } else {
            send('ended', {
              outcome: ending,
              model,
              tokensIn: recorded?.tokensIn ?? null,
              tokensOut: recorded?.tokensOut ?? null,
              cost: recorded?.costMicros == null ? null : microsText(recorded.costMicros),
              currency: endpoint.currency,
              citations: kept,
              dropped,
            });
          }
        }
      });
    },

    getAssistantRun: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const { id } = request.params as { id: string };
        const run = await readRun(trx, id);
        // Its requester's alone (GEN-016): anybody else is told there is none.
        if (!run || run.requestedBy !== principalId || run.purpose === 'test') throw notFound();
        const proposals = await proposalsOfRun(trx, id);
        return {
          run: {
            id: run.id,
            document: run.documentId,
            endpoint: {
              name: String(run.endpoint.name ?? ''),
              boundary: String(run.endpoint.boundary ?? ''),
            },
            model: run.model,
            outcome: run.outcome,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            tokensIn: run.tokensIn,
            tokensOut: run.tokensOut,
            cost: run.costMicros === null ? null : microsText(run.costMicros),
            currency: String(run.endpoint.currency ?? ''),
            contextDigest: run.contextDigest,
            read: [...run.context],
            steps: [...run.steps],
            proposals: proposals.map((each) => ({
              id: each.id,
              number: each.number,
              component: each.componentId,
              state: each.state,
              suggestion: each.suggestionId,
            })),
          },
        };
      }),

    getAssistantUsage: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const month = await runsThisMonth(trx, principalId);
        return {
          runs: month.runs,
          costs: month.costs.map((each) => ({
            currency: each.currency,
            cost: microsText(each.micros),
          })),
        };
      }),

    acceptProposal: (request: FastifyRequest) =>
      asCaller(request, (trx, principalId) => actOn(request, trx, principalId, 'accepted')),
    keepProposal: (request: FastifyRequest) =>
      asCaller(request, (trx, principalId) => actOn(request, trx, principalId, 'kept')),
    discardProposal: (request: FastifyRequest) =>
      asCaller(request, (trx, principalId) => actOn(request, trx, principalId, 'discarded')),
  };

  /** A session-checked route's work, as the caller, in a transaction of its own. */
  function asCaller<T>(
    request: FastifyRequest,
    work: (trx: TenantTransaction, principalId: string) => Promise<T>,
  ): Promise<T> {
    const principalId = principalOf(request).principalId;
    return db.withTenant(tenantOf(request), (trx) => work(trx, principalId), contextOf(request));
  }

  /**
   * An act on a proposal (G2-E), its requester's alone, decided on its component here: accepting
   * needs `edit`, keeping `suggest`, discarding nothing more. Once, from open.
   */
  async function actOn(
    request: FastifyRequest,
    trx: TenantTransaction,
    principalId: string,
    act: 'accepted' | 'kept' | 'discarded',
  ) {
    const { id } = request.params as { id: string };
    const proposal = await readProposal(trx, id, true);
    if (!proposal || proposal.requestedBy !== principalId) throw notFound();
    const caller = callerOf(request);
    await authoriseAt(
      trx,
      caller,
      act === 'accepted' ? 'edit' : act === 'kept' ? 'suggest' : 'read',
      {
        kind: 'artifact',
        id: proposal.componentId,
      },
    );
    if (proposal.state !== 'open') {
      throw new AppError(
        409,
        'proposal_resolved',
        'This proposal has been accepted, kept or discarded already.',
      );
    }
    if (act === 'discarded') {
      await actOnProposal(trx, { proposal, act, by: principalId });
      return { proposal: { id, state: 'discarded' as const, suggestion: null } };
    }
    const made = await makeSuggestion(trx, {
      component: proposal.componentId,
      version: proposal.madeAgainst,
      proposed: proposal.proposed,
      by: principalId,
      generated: { run: proposal.runId, digest: proposal.contextDigest },
    });
    if (made.answer !== 'made') throw suggestionRefused(made.answer);
    if (act === 'accepted') {
      const accepted = await acceptSuggestion(trx, {
        suggestion: made.suggestion,
        by: principalId,
      });
      if (accepted.answer !== 'accepted') throw suggestionRefused(accepted.answer);
    }
    await actOnProposal(trx, { proposal, act, suggestion: made.suggestion, by: principalId });
    return { proposal: { id, state: act, suggestion: made.suggestion } };
  }
}

/** Millionths of a currency's unit, written to six places. */
function microsText(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const part = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${part}`;
}

/** A suggestion's refusal, said for a proposal (G2-E). */
function suggestionRefused(answer: string): AppError {
  switch (answer) {
    case 'suggestion.empty':
      return new AppError(
        409,
        'suggestion.empty',
        'This proposal changes nothing in the component as it is.',
      );
    case 'suggestion.limit':
      return new AppError(
        409,
        'suggestion.limit',
        'You have as many suggestions waiting on this component as you may.',
      );
    case 'suggestion.stale':
      return new AppError(
        409,
        'suggestion.stale',
        'The component has changed where this proposal edits it.',
      );
    case 'lock.held':
      return new AppError(409, 'lock.held', 'Somebody else is editing this component.');
    case 'edits.pending':
      return new AppError(
        409,
        'edits.pending',
        'You have changes to this component not yet made into a version.',
      );
    case 'values.invalid':
      return new AppError(409, 'values.invalid', "The component's fields would not be valid.");
    case 'missing':
      return notFound();
    default:
      return new AppError(409, answer.replace(/\./g, '_'), 'The proposal could not be acted on.');
  }
}
