import { randomBytes } from 'node:crypto';

import {
  CONVERSATION_TURNS_MOST,
  listGuardrails,
  listConversations,
  listModelEndpoints,
  readConversation,
  startConversation,
  turnsOf,
  type Conversation,
  type StoredModelEndpoint,
  actOnProposal,
  acceptSuggestion,
  listModelRoutes,
  makeProposal,
  makeSuggestion,
  proposalsOfRun,
  readDocument,
  readModelEndpoint,
  readProposal,
  readRun,
  resolveOccurrences,
  runsThisMonth,
  searchWords,
  usableModelKey,
  versionContents,
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
  citationsIn,
  componentAsText,
  isAssistantTool,
  parseContentDocument,
  toolInputSchemas,
  type BlockNode,
  type ContentDocument,
  type ModelMessage,
  type OutlineDocument,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import { readMarkdown } from '@alloy-works/readers/markdown';
import type { StartConversationBody, TurnBody } from '@alloy-works/api-contract';
import type { FastifyRequest } from 'fastify';

import { authoriseAt, callerOf, notFound, type Authorised } from '../access.js';
import { contextOf } from '../audit.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { liveBindingStates } from '../data/bindings.js';
import { mayNameColumns, storableContent } from '../editing.js';
import { AppError } from '../errors.js';
import type { SessionPrincipal } from '../sessions.js';
import { failureWords, microsText, streamedRun, type ToolAnswer } from './run-loop.js';

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

/** The most of one tool's answer the model is given, in characters: past it, cut and said so. */
const TOOL_ANSWER_MAX = 40_000;

const capped = (text: string) =>
  text.length <= TOOL_ANSWER_MAX
    ? text
    : `${text.slice(0, TOOL_ANSWER_MAX)}\n[Cut short: the rest is not shown.]`;

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
const titleOf = (title: readonly unknown[]): string =>
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
                    lines.push(
                      `${indent}Section: ${titleOf(node.title ?? []).replace(/\s+/g, ' ')}`,
                    );
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
                content: asData(`component:${component}`, number, capped(componentAsText(content))),
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
                  text === '' ? 'Nothing matched.' : capped(text),
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
                  values.length === 0 ? 'The document binds no values.' : capped(values.join('\n')),
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
      if (!client) {
        throw new AppError(503, 'connector_unavailable', failureWords('connector_unavailable'));
      }
      const first: ModelMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              component === undefined
                ? ask
                : `${ask}

(The author has component ${component} open.)`,
          },
        ],
      };
      const guardrails = await listGuardrails(trx);
      return streamedRun({
        guardrails,
        request,
        db,
        tenant: tenantOf(request),
        events,
        asking: client,
        endpoint,
        sealed,
        principalId,
        purpose: 'drafting',
        parameters: {
          maxTokens: ASSISTANT_LIMITS.maxTokens,
          instructions: ASSISTANT_INSTRUCTIONS_VERSION,
        },
        documentId: id,
        ask,
        system: ASSISTANT_INSTRUCTIONS,
        tools: ASSISTANT_TOOLS,
        messages: [first],
        limits: ASSISTANT_LIMITS,
        tool: (run) => tools(request, id, principalId, run),
        ended: (said, read) => {
          const cited = citationsIn(said);
          const kept = cited.filter((each) => read.get(each.component)?.has(each.block) === true);
          return { citations: kept, dropped: cited.filter((each) => !kept.includes(each)) };
        },
      });
    },

    listConversationEndpoints: (request: FastifyRequest) =>
      asCaller(request, async (trx) => {
        const fallback = await defaultEndpoint(trx);
        const items = [];
        for (const each of await listModelEndpoints(trx)) {
          if (each.retiredAt !== null || (await usableModelKey(trx, each)) === undefined) continue;
          items.push({
            id: each.id,
            name: each.name,
            model: each.model,
            boundary: each.boundary,
            isDefault: each.id === fallback,
          });
        }
        return { items };
      }),

    startConversation: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const { document, title } = request.body as StartConversationBody;
        if (document !== undefined) {
          await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: document });
          if (!(await readDocument(trx, document))) throw notFound();
        }
        const made = await startConversation(trx, {
          owner: principalId,
          documentId: document ?? null,
          title,
        });
        return { conversation: { ...conversationView(made), turns: [] } };
      }),

    listConversations: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const { document } = request.query as { document?: string };
        const items = await listConversations(
          trx,
          principalId,
          document === undefined ? {} : { documentId: document },
        );
        return { items: items.map(conversationView) };
      }),

    getConversation: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const conversation = await own(trx, request, principalId);
        return {
          conversation: {
            ...conversationView(conversation),
            turns: (await turnsOf(trx, conversation.id)).map((each) => ({
              ...each,
              startedAt: each.startedAt.toISOString(),
            })),
          },
        };
      }),

    takeTurn: async (request: FastifyRequest) => {
      const principalId = principalOf(request).principalId;
      const tenant = tenantOf(request);
      const { ask, endpoint: named, component } = request.body as TurnBody;
      const prepared = await db.withTenant(
        tenant,
        async (trx) => {
          const conversation = await own(trx, request, principalId);
          const turns = await turnsOf(trx, conversation.id);
          if (turns.some((each) => each.outcome === 'running')) {
            throw new AppError(
              409,
              'turn_running',
              'A turn of this conversation has not ended yet.',
            );
          }
          if (turns.length >= CONVERSATION_TURNS_MOST) {
            throw new AppError(
              409,
              'conversation_too_long',
              `A conversation takes ${CONVERSATION_TURNS_MOST} turns. Start another to go on.`,
            );
          }
          const endpoint = await endpointFor(trx, named);
          const sealed = await usableModelKey(trx, endpoint);
          if (sealed === undefined) {
            throw new AppError(409, 'endpoint_unusable', 'The endpoint has no key set.');
          }
          return { conversation, turns, endpoint, sealed, guardrails: await listGuardrails(trx) };
        },
        contextOf(request),
      );
      if (!client) {
        throw new AppError(503, 'connector_unavailable', failureWords('connector_unavailable'));
      }
      const { conversation, turns, endpoint, sealed, guardrails } = prepared;
      const document = conversation.documentId;
      // The earlier finished turns' words, never their tool results (G5-A).
      const earlier: ModelMessage[] = turns.flatMap((each): ModelMessage[] =>
        each.outcome === 'finished' && each.ask !== null && each.reply !== null && each.reply !== ''
          ? [
              { role: 'user', content: [{ type: 'text', text: each.ask }] },
              { role: 'assistant', content: [{ type: 'text', text: each.reply }] },
            ]
          : [],
      );
      const words =
        component === undefined
          ? ask
          : `${ask}

(The author has component ${component} open.)`;
      return streamedRun({
        guardrails,
        request,
        db,
        tenant,
        events,
        asking: client,
        endpoint,
        sealed,
        principalId,
        purpose: 'chat',
        parameters: {
          maxTokens: ASSISTANT_LIMITS.maxTokens,
          instructions: ASSISTANT_INSTRUCTIONS_VERSION,
          turn: turns.length + 1,
        },
        documentId: document,
        conversationId: conversation.id,
        ask,
        system: ASSISTANT_INSTRUCTIONS,
        // On a document, the assistant's tools, as the requester; with none, words alone (G5-D adds).
        tools: document === null ? [] : ASSISTANT_TOOLS,
        messages: [...earlier, { role: 'user', content: [{ type: 'text', text: words }] }],
        limits: ASSISTANT_LIMITS,
        tool: (run) =>
          document === null
            ? async (name) => ({
                ok: false,
                content: `There is no tool ${name}.`,
                summary: 'No such tool',
              })
            : tools(request, document, principalId, run),
        started: { conversation: conversation.id },
        ended: (said, read) => {
          const cited = citationsIn(said);
          const kept = cited.filter((each) => read.get(each.component)?.has(each.block) === true);
          return { citations: kept, dropped: cited.filter((each) => !kept.includes(each)) };
        },
      });
    },

    getAssistantRun: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const { id } = request.params as { id: string };
        const run = await readRun(trx, id);
        // Its requester's alone (GEN-016): anybody else is told there is none.
        if (!run || run.requestedBy !== principalId || run.purpose === 'test') throw notFound();
        // What it read is held back from a requester who may no longer read the document.
        let mayRead = run.documentId !== null;
        if (run.documentId !== null) {
          try {
            await authoriseAt(trx, callerOf(request), 'read', {
              kind: 'artifact',
              id: run.documentId,
            });
          } catch {
            mayRead = false;
          }
        }
        const proposals = await proposalsOfRun(trx, id);
        return {
          run: {
            id: run.id,
            document: run.documentId,
            purpose: run.purpose,
            promptVersion: run.promptVersion,
            parameters: { ...run.parameters },
            endpoint: {
              name: String(run.endpoint.name ?? ''),
              boundary: String(run.endpoint.boundary ?? ''),
            },
            ask: run.ask,
            reply: mayRead ? run.reply : null,
            model: run.model,
            outcome: run.outcome,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            tokensIn: run.tokensIn,
            tokensOut: run.tokensOut,
            cost: run.costMicros === null ? null : microsText(run.costMicros),
            currency: String(run.endpoint.currency ?? ''),
            contextDigest: run.contextDigest,
            read: mayRead ? [...run.context] : [],
            steps: mayRead ? [...run.steps] : [],
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

  /** A conversation of the caller's, whose document they may still read; anybody else's is not found. */
  async function own(
    trx: TenantTransaction,
    request: FastifyRequest,
    principalId: string,
  ): Promise<Conversation> {
    const { id } = request.params as { id: string };
    const conversation = await readConversation(trx, id);
    if (!conversation || conversation.owner !== principalId) throw notFound();
    if (conversation.documentId !== null) {
      await authoriseAt(trx, callerOf(request), 'read', {
        kind: 'artifact',
        id: conversation.documentId,
      });
    }
    return conversation;
  }

  /** The endpoint a turn naming none runs on (G5-C): the chat route's, else drafting's. */
  async function defaultEndpoint(trx: TenantTransaction): Promise<string | undefined> {
    const routes = await listModelRoutes(trx);
    return (
      routes.find((each) => each.purpose === 'chat') ??
      routes.find((each) => each.purpose === 'drafting')
    )?.endpointId;
  }

  /** The endpoint a turn runs on: the one named, in use, or the default (G5-C; GEN-051). */
  async function endpointFor(
    trx: TenantTransaction,
    named: string | undefined,
  ): Promise<StoredModelEndpoint> {
    const id = named ?? (await defaultEndpoint(trx));
    if (id === undefined) {
      throw new AppError(
        409,
        'model_unconfigured',
        'No model endpoint is set up for a conversation.',
      );
    }
    const endpoint = await readModelEndpoint(trx, id);
    if (!endpoint || endpoint.retiredAt !== null) {
      throw new AppError(
        409,
        'endpoint_unusable',
        'That endpoint is retired, or is not one of this environment’s.',
      );
    }
    return endpoint;
  }

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
    // Acted on once its run has ended, so what it carries is the run's last digest (the final review).
    if (proposal.runOutcome === 'running') {
      throw new AppError(409, 'run_running', 'The run that made this proposal has not ended yet.');
    }
    if (act === 'discarded') {
      await actOnProposal(trx, { proposal, act, by: principalId });
      return { proposal: { id, state: 'discarded' as const, suggestion: null } };
    }
    // The save's checks, as a person's suggestion meets them (SG-B; the final review).
    const proposed = storableContent(proposal.proposed);
    await mayNameColumns(trx, request, proposed, proposal.madeAgainst);
    const made = await makeSuggestion(trx, {
      component: proposal.componentId,
      version: proposal.madeAgainst,
      proposed,
      by: principalId,
      generated: { run: proposal.runId, digest: proposal.contextDigest },
    });
    if (made.answer !== 'made') throw suggestionRefused(made.answer);
    if (act === 'accepted') {
      const accepted = await acceptSuggestion(trx, {
        suggestion: made.suggestion,
        by: principalId,
        check: async (content, current) => {
          storableContent(content);
          await mayNameColumns(trx, request, content, current.id);
        },
      });
      if (accepted.answer !== 'accepted') throw suggestionRefused(accepted.answer);
    }
    await actOnProposal(trx, { proposal, act, suggestion: made.suggestion, by: principalId });
    return { proposal: { id, state: act, suggestion: made.suggestion } };
  }
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

/** A conversation as the routes answer it, without its turns. */
function conversationView(conversation: Conversation) {
  return {
    id: conversation.id,
    document: conversation.documentId,
    title: conversation.title,
    madeAt: conversation.madeAt.toISOString(),
  };
}
