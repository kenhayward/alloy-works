import {
  createComponent,
  makeCreationProposal,
  type GenerationProposal,
  TRAY_PARTS_MOST,
  addToTray,
  latestVersion,
  removeFromTray,
  trayOf,
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
  CONVERSATION_INSTRUCTIONS,
  CONVERSATION_INSTRUCTIONS_VERSION,
  CONVERSATION_TOOLS,
  DOCUMENT_CONVERSATION_TOOLS,
  proposeComponentInputSchema,
  conversationToolInputSchemas,
  isConversationTool,
  applyEdits,
  asData,
  citationsIn,
  componentAsText,
  isAssistantTool,
  parseContentDocument,
  toolInputSchemas,
  type ContentDocument,
  type ModelMessage,
  type OutlineDocument,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { StartConversationBody, TurnBody } from '@alloy-works/api-contract';
import type { FastifyRequest } from 'fastify';

import { authoriseAt, callerOf, notFound, type Authorised } from '../access.js';
import { contextOf } from '../audit.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { liveBindingStates } from '../data/bindings.js';
import { mayCite } from '../bibliography/citing.js';
import { mayNameColumns, storableContent } from '../editing.js';
import { markdownReader } from '../markdown.js';
import { AppError } from '../errors.js';
import type { SessionPrincipal } from '../sessions.js';
import { failureWords, microsText, streamedRun, type ToolAnswer } from './run-loop.js';
import { refuseOverLimit } from './limits.js';

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

  /**
   * A conversation's tray as its person may read it now (G5-D; GEN-053): each part decided again,
   * never trusted for having been read before; on a document, at the version placed there, else at
   * its latest. A part they may no longer read is left out and named.
   */
  async function readTray(
    trx: TenantTransaction,
    request: FastifyRequest,
    conversation: Conversation,
    principal: string,
  ) {
    const parts = await trayOf(trx, conversation.id);
    const found =
      conversation.documentId === null
        ? undefined
        : await placed(trx, conversation.documentId, principal);
    const read: { component: string; version: string; number: string; content: ContentDocument }[] =
      [];
    const dropped: string[] = [];
    for (const part of parts) {
      let version: string | undefined;
      if (found) version = found.readable.get(part.component);
      else {
        try {
          await authoriseAt(trx, callerOf(request), 'read', {
            kind: 'artifact',
            id: part.component,
          });
          const latest = await latestVersion(trx, part.component);
          version = latest?.kind === 'component' ? latest.id : undefined;
        } catch {
          version = undefined;
        }
      }
      const content =
        version === undefined ? undefined : (await versionContents(trx, [version])).get(version);
      if (version === undefined || !content) {
        dropped.push(part.component);
        continue;
      }
      read.push({
        component: part.component,
        version,
        number: `${content.revision}.${content.version}`,
        content: content.content as ContentDocument,
      });
    }
    return { read, dropped };
  }

  /**
   * A component proposed to be made (G5-E; GEN-052), as the person, where they may create now: its
   * Markdown admitted as content is, its type one of the environment's. Nothing is made until they
   * accept it.
   */
  async function proposeComponent(
    trx: TenantTransaction,
    request: FastifyRequest,
    run: string,
    input: { space: string; type?: string | undefined; title: string; markdown: string },
    written: { language: string; direction: 'ltr' | 'rtl' },
  ): Promise<ToolAnswer> {
    try {
      await authoriseAt(trx, callerOf(request), 'create', { kind: 'space', id: input.space });
    } catch {
      return {
        ok: false,
        content: 'You may not make a component in that space, or there is none by that identifier.',
        summary: 'Not yours to make',
      };
    }
    if (input.type !== undefined) {
      const type = await latestVersion(trx, input.type);
      if (type?.kind !== 'componentType') {
        return {
          ok: false,
          content: 'There is no component type by that identifier.',
          summary: 'No such type',
        };
      }
    }
    const blank: ContentDocument = {
      schemaVersion: 1,
      title: input.title,
      language: written.language,
      direction: written.direction,
      content: [],
    } as unknown as ContentDocument;
    const blocks = markdownReader(blank)(input.markdown);
    if (typeof blocks === 'string') return { ok: false, content: blocks, summary: 'Text refused' };
    const proposal = await makeCreationProposal(trx, {
      run,
      creates: {
        space: input.space,
        ...(input.type === undefined ? {} : { componentType: input.type }),
        title: input.title,
        language: written.language,
        direction: written.direction,
      },
      proposed: { ...blank, content: [...blocks] },
    });
    return {
      ok: true,
      content: `Proposal ${proposal.number} made. Nothing is made until the author accepts it.`,
      summary: `Proposal ${proposal.number}`,
      proposal,
    };
  }

  /** A conversation's tools on a document: the assistant's, and proposing a component (G5-E). */
  function documentTools(
    request: FastifyRequest,
    document: string,
    principal: string,
    run: string,
  ) {
    const assistant = tools(request, document, principal, run);
    return async (name: string, input: unknown): Promise<ToolAnswer> => {
      if (name !== 'propose_component') return assistant(name, input);
      const parsed = proposeComponentInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          content: 'The arguments are not what this tool takes.',
          summary: 'Arguments refused',
        };
      }
      return db.withTenant(
        tenantOf(request),
        async (trx) => {
          await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: document });
          // Written in the document's language and direction.
          const outline = (await readDocument(trx, document))?.version.content as
            { language?: string; direction?: 'ltr' | 'rtl' } | undefined;
          return proposeComponent(trx, request, run, parsed.data, {
            language: outline?.language ?? 'en-GB',
            direction: outline?.direction ?? 'ltr',
          });
        },
        contextOf(request),
      );
    };
  }

  /** A conversation's tools where it has no document (G5-D), each as its person, deciding again. */
  function looseTools(request: FastifyRequest, principal: string, run: string) {
    const tenant = tenantOf(request);
    const caller = callerOf(request);
    const context = contextOf(request);
    const missing: ToolAnswer = {
      ok: false,
      content: 'There is no component by that identifier that you can read.',
      summary: 'No such component',
    };
    const readable = async (trx: TenantTransaction, component: string) => {
      try {
        await authoriseAt(trx, caller, 'read', { kind: 'artifact', id: component });
      } catch {
        return undefined;
      }
      const latest = await latestVersion(trx, component);
      return latest?.kind === 'component' ? latest : undefined;
    };
    return async (name: string, input: unknown): Promise<ToolAnswer> => {
      if (!isConversationTool(name)) {
        return { ok: false, content: `There is no tool ${name}.`, summary: 'No such tool' };
      }
      const parsed = conversationToolInputSchemas[name].safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          content: 'The arguments are not what this tool takes.',
          summary: 'Arguments refused',
        };
      }
      return db.withTenant(
        tenant,
        async (trx): Promise<ToolAnswer> => {
          switch (name) {
            case 'search_components': {
              const { query } = parsed.data as { query: string };
              const answer = await searchWords(trx, principal, query, {
                limit: 20,
                filters: { kinds: ['component'] },
              });
              const hits =
                typeof answer === 'object' && answer.outcome === 'results'
                  ? answer.items.slice(0, 10)
                  : [];
              const text = hits
                .map(
                  (hit) =>
                    `Component ${hit.artifactId}: ${hit.passage.map((piece) => piece.text).join('')}`,
                )
                .join('\n');
              return {
                ok: true,
                content: asData('search', null, text === '' ? 'Nothing matched.' : capped(text)),
                summary: `${hits.length} found`,
              };
            }
            case 'read_component': {
              const { component } = parsed.data as { component: string };
              const latest = await readable(trx, component);
              if (!latest) return missing;
              const content = latest.content as ContentDocument;
              const number = `${latest.revision}.${latest.version}`;
              return {
                ok: true,
                content: asData(`component:${component}`, number, capped(componentAsText(content))),
                summary: `${content.content.length} blocks, version ${number}`,
                read: {
                  component,
                  version: latest.id,
                  blocks: content.content.map((block) => block.id),
                },
              };
            }
            case 'declined':
              // The run's loop answers it, and streams its notice (GC-E): never reached.
              return { ok: false, content: `There is no tool ${name}.`, summary: 'No such tool' };
            case 'propose_component':
              return proposeComponent(
                trx,
                request,
                run,
                parsed.data as { space: string; type?: string; title: string; markdown: string },
                { language: 'en-GB', direction: 'ltr' },
              );
            case 'propose_edit': {
              const { component, edits } = parsed.data as {
                component: string;
                edits: Parameters<typeof applyEdits>[1];
              };
              const latest = await readable(trx, component);
              if (!latest) return missing;
              try {
                await authoriseAt(trx, caller, 'suggest', { kind: 'artifact', id: component });
              } catch {
                return {
                  ok: false,
                  content: 'You may not suggest changes to this component.',
                  summary: 'Not yours to change',
                };
              }
              let content: ContentDocument;
              try {
                content = parseContentDocument(latest.content);
              } catch {
                return missing;
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
                against: latest.id,
                proposed: outcome.content,
              });
              return {
                ok: true,
                content: `Proposal ${proposal.number} made. Nothing changes until the author accepts it.`,
                summary: `Proposal ${proposal.number}`,
                proposal,
              };
            }
          }
        },
        context,
      );
    };
  }

  return {
    startAssistantRun: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as { id: string };
      const { ask, component } = request.body as { ask: string; component?: string };
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      await refuseOverLimit(trx, principalId);
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
                : `${ask}\n\n(The author has component ${component} open.)`,
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

    getConversationContext: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const conversation = await own(trx, request, principalId);
        const tray = await readTray(trx, request, conversation, principalId);
        return trayView(tray);
      }),

    addConversationContext: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const conversation = await own(trx, request, principalId);
        const { component } = request.body as { component: string };
        // Read as the person now, at the version they would be sent, or not added at all.
        await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: component });
        const latest = await latestVersion(trx, component);
        if (latest?.kind !== 'component') throw notFound();
        if (conversation.documentId !== null) {
          const found = await placed(trx, conversation.documentId, principalId);
          if (!found?.readable.has(component)) throw notFound();
        }
        const added = await addToTray(trx, { conversation: conversation.id, component });
        if (added === 'full') {
          throw new AppError(
            409,
            'tray_full',
            `A conversation reads ${TRAY_PARTS_MOST} parts at most.`,
          );
        }
        return trayView(await readTray(trx, request, conversation, principalId));
      }),

    removeConversationContext: (request: FastifyRequest) =>
      asCaller(request, async (trx, principalId) => {
        const conversation = await own(trx, request, principalId);
        const { component } = request.params as { component: string };
        if (!(await removeFromTray(trx, conversation.id, component))) throw notFound();
        return trayView(await readTray(trx, request, conversation, principalId));
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
          // Only the turns that finished count: a refused or failed turn replays nothing.
          if (
            turns.filter((each) => each.outcome === 'finished').length >= CONVERSATION_TURNS_MOST
          ) {
            throw new AppError(
              409,
              'conversation_too_long',
              `A conversation takes ${CONVERSATION_TURNS_MOST} turns. Start another to go on.`,
            );
          }
          await refuseOverLimit(trx, principalId);
          const endpoint = await endpointFor(trx, named);
          const sealed = await usableModelKey(trx, endpoint);
          if (sealed === undefined) {
            throw new AppError(409, 'endpoint_unusable', 'The endpoint has no key set.');
          }
          return {
            conversation,
            turns,
            endpoint,
            sealed,
            guardrails: await listGuardrails(trx),
            tray: await readTray(trx, request, conversation, principalId),
          };
        },
        contextOf(request),
      );
      if (!client) {
        throw new AppError(503, 'connector_unavailable', failureWords('connector_unavailable'));
      }
      const { conversation, turns, endpoint, sealed, guardrails, tray } = prepared;
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
      const asked =
        component === undefined ? ask : `${ask}\n\n(The author has component ${component} open.)`;
      // The tray's parts, as data, before the words (G5-D): re-read as the person this turn.
      const words =
        tray.read.length === 0
          ? asked
          : [
              'What you may read:',
              ...tray.read.map((each) =>
                asData(
                  `component:${each.component}`,
                  each.number,
                  capped(componentAsText(each.content)),
                ),
              ),
              asked,
            ].join('\n\n');
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
          instructions: CONVERSATION_INSTRUCTIONS_VERSION,
          turn: turns.length + 1,
        },
        documentId: document,
        conversationId: conversation.id,
        ask,
        system: CONVERSATION_INSTRUCTIONS,
        // On a document, the assistant's tools; with none, the person's own search, reads and proposals.
        tools: document === null ? CONVERSATION_TOOLS : DOCUMENT_CONVERSATION_TOOLS,
        messages: [...earlier, { role: 'user', content: [{ type: 'text', text: words }] }],
        limits: ASSISTANT_LIMITS,
        tool: (run) =>
          document === null
            ? looseTools(request, principalId, run)
            : documentTools(request, document, principalId, run),
        started: {
          conversation: conversation.id,
          tray: { read: tray.read.map((each) => each.component), dropped: tray.dropped },
        },
        context: tray.read.map((each) => ({
          component: each.component,
          version: each.version,
          blocks: each.content.content.map((block) => block.id),
        })),
        // A tool's read joins the tray, so later turns read it again (G5-D).
        onRead: (run, read) =>
          db
            .withTenant(
              tenant,
              (inner) =>
                addToTray(inner, { conversation: conversation.id, component: read.component, run }),
              contextOf(request),
            )
            .then(() => undefined),
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
        // On no document, a run is its requester's own; on one, while they may still read it.
        let mayRead = true;
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

  /**
   * An act on a proposal to make a component (G5-E; GEN-052): accepted, it is made at 0.1 as its
   * requester, where they may create now, its text the proposal's; discarded, nothing is made. Never
   * kept: a suggestion is against a component that exists.
   */
  async function actOnCreation(
    request: FastifyRequest,
    trx: TenantTransaction,
    principalId: string,
    proposal: GenerationProposal,
    act: 'accepted' | 'kept' | 'discarded',
  ) {
    const creates = proposal.creates!;
    if (proposal.state !== 'open') {
      throw new AppError(
        409,
        'proposal_resolved',
        'This proposal has been accepted or discarded already.',
      );
    }
    if (proposal.runOutcome === 'running') {
      throw new AppError(409, 'run_running', 'The run that made this proposal has not ended yet.');
    }
    if (act === 'kept') {
      throw new AppError(
        409,
        'proposal_creates',
        'A proposal to make a component is accepted or discarded: there is nothing yet to suggest on.',
      );
    }
    if (act === 'discarded') {
      await actOnProposal(trx, { proposal, act, by: principalId });
      return { proposal: { id: proposal.id, state: 'discarded' as const, suggestion: null } };
    }
    await authoriseAt(trx, callerOf(request), 'create', { kind: 'space', id: creates.space });
    const proposed = storableContent(proposal.proposed);
    const made = await createComponent(trx, {
      spaceId: creates.space,
      ...(creates.componentType === undefined ? {} : { componentTypeId: creates.componentType }),
      title: creates.title,
      language: creates.language,
      direction: creates.direction,
      author: principalId,
      blocks: proposed.content,
    });
    if (made.answer !== 'created') {
      throw new AppError(409, made.answer.replace(/\./g, '_'), 'The component could not be made.');
    }
    await actOnProposal(trx, {
      proposal,
      act: 'accepted',
      by: principalId,
      made: { component: made.version.artifactId, version: made.version.id },
    });
    return {
      proposal: {
        id: proposal.id,
        state: 'accepted' as const,
        suggestion: null,
        component: made.version.artifactId,
      },
    };
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
    if (proposal.creates !== null) return actOnCreation(request, trx, principalId, proposal, act);
    await authoriseAt(
      trx,
      caller,
      act === 'accepted' ? 'edit' : act === 'kept' ? 'suggest' : 'read',
      {
        kind: 'artifact',
        id: proposal.componentId!,
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
    await mayNameColumns(trx, request, proposed, proposal.madeAgainst!);
    await mayCite(trx, request, proposed, proposal.madeAgainst!);
    const made = await makeSuggestion(trx, {
      component: proposal.componentId!,
      version: proposal.madeAgainst!,
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
          await mayCite(trx, request, content, current.id);
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

/** A tray as the routes answer it: what is read, and what its person may no longer read. */
function trayView(tray: {
  readonly read: readonly { component: string; version: string; number: string }[];
  readonly dropped: readonly string[];
}) {
  return {
    items: [
      ...tray.read.map((each) => ({
        component: each.component,
        version: each.number,
        readable: true,
      })),
      ...tray.dropped.map((component) => ({ component, version: null, readable: false })),
    ],
  };
}
