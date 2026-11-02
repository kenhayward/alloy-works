import { createHash, randomUUID } from 'node:crypto';

import {
  actOnProposal,
  endRun,
  noteStep,
  recordGenerationRun,
  startRun,
  type GenerationProposal,
  type StoredModelEndpoint,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
} from '@alloy-works/db';
import {
  DECLINED,
  callsTools,
  canonicalCall,
  modelDeadlineMs,
  declinedInputSchema,
  guardrailMatch,
  watchesReplies,
  type GuardrailRule,
  type GenerationFailure,
  type ModelCall,
  type ModelMessage,
  type ModelTool,
  type RunPurpose,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';

import { Streamed } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { watchAuthority } from '../authority.js';
import type { createConnectorClient } from '../data/connector.js';
import { RateLimited, rateLimitedWords, startLimited } from './limits.js';
import { microsText } from './money.js';

/**
 * A run's loop (generation.md, "The run"; the G2 plan, G2-B; the G5 plan, G5-A): turns through the
 * connector, each tool call run as the requester and kept as a step, the stream sent after the
 * route's deciding transaction commits, the run started before its first call and ended once, its
 * transcript kept. The assistant's, and a conversation's turn.
 */

/**
 * A step said for a person, by code and its values, worded in their language by the renderer (the UI
 * plan, UI-L). A tool's own refusal is its error's code.
 */
export interface ToolSaid {
  readonly code: string;
  readonly count?: number;
  readonly number?: number;
  readonly version?: string;
}

/** A step's summary in English, for an integrator: the code itself where it has no words. */
export function toolSummary(said: ToolSaid): string {
  const fixed: Record<string, string> = {
    not_yours_to_change: 'Not yours to change',
    not_yours_to_make: 'Not yours to make',
    no_such_component: 'No such component',
    no_such_type: 'No such type',
    no_such_tool: 'No such tool',
    citation_refused: 'Citation refused',
    arguments_refused: 'Arguments refused',
    edit_refused: 'Edit refused',
    text_refused: 'Text refused',
    changes_nothing: 'Changes nothing',
    too_many_calls: 'Too many calls',
    declined: 'Declined',
  };
  switch (said.code) {
    case 'found':
      return `${said.count} found`;
    case 'components':
      return `${said.count} components`;
    case 'blocks':
      return `${said.count} blocks, version ${said.version}`;
    case 'values':
      return `${said.count} values`;
    case 'proposal':
      return `Proposal ${said.number}`;
    default:
      return fixed[said.code] ?? said.code;
  }
}

/** What a tool answers the model, the step it records, and what it did said for the page. */
export interface ToolAnswer {
  readonly ok: boolean;
  readonly content: string;
  readonly said: ToolSaid;
  /** The blocks a read answered, which a citation may name (G2-G). */
  readonly read?: {
    readonly component: string;
    readonly version: string;
    readonly blocks: readonly string[];
  };
  readonly proposal?: GenerationProposal;
}

export interface RunLimits {
  readonly turns: number;
  readonly toolCalls: number;
  readonly runMs: number;
  readonly maxTokens: number;
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

/** What a failure says to the person, by its code. */
export const failureWords = (code: GenerationFailure['code']) => WORDS[code];

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export { microsText };

export function streamedRun(input: {
  readonly request: FastifyRequest;
  readonly db: TenantDatabase;
  readonly tenant: Tenant;
  readonly events: TenantListener | undefined;
  readonly asking: ReturnType<typeof createConnectorClient>;
  readonly endpoint: StoredModelEndpoint;
  readonly sealed: Parameters<ReturnType<typeof createConnectorClient>['model']>[0]['sealed'];
  readonly principalId: string;
  readonly purpose: RunPurpose;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly documentId: string | null;
  /** The person's words, kept with the run (GN-I). */
  readonly ask: string;
  /** The conversation it is a turn of, where it is one (G5-A). */
  readonly conversationId?: string;
  readonly system: string;
  readonly tools: readonly ModelTool[];
  /** What the first call sends: the earlier turns' words, where there are any, then this one's. */
  readonly messages: readonly ModelMessage[];
  readonly limits: RunLimits;
  /** Each tool, as the requester, given the run it is a step of. */
  readonly tool: (run: string) => (name: string, input: unknown) => Promise<ToolAnswer>;
  /** What `ended` says beyond the run's own, from its words and what it read. */
  readonly ended?: (
    said: string,
    read: ReadonlyMap<string, ReadonlySet<string>>,
  ) => Readonly<Record<string, unknown>>;
  /** What `run` says beyond the run and its endpoint. */
  readonly started?: Readonly<Record<string, unknown>>;
  /** The tenant's guardrails in force, checked on what is sent and what returns (G5-F). */
  readonly guardrails?: readonly GuardrailRule[];
  /** What the run reads before any tool does: a conversation's tray, recorded as read (G5-D). */
  readonly context?: readonly { component: string; version: string; blocks: readonly string[] }[];
  /** Each read a tool made, as it is made: a conversation keeps it in its tray (G5-D). */
  readonly onRead?: (
    run: string,
    read: { readonly component: string; readonly version: string },
  ) => Promise<void>;
}): Streamed {
  const { request, db, tenant, endpoint, sealed, limits } = input;
  const context = contextOf(request);
  const credential = request.credential ?? null;
  return new Streamed(async (send, closed) => {
    const authority = watchAuthority({ db, tenant, credential, events: input.events });
    const stopped = AbortSignal.any([closed, authority.signal]);
    const started = Date.now();
    const messages: ModelMessage[] = [...input.messages];
    // A model that calls no tools is sent none: it answers from what it is given.
    const tools = callsTools(endpoint) ? input.tools : [];
    const callOf = (): ModelCall => ({
      model: endpoint.model,
      system: input.system,
      messages: [...messages],
      ...(tools.length === 0 ? {} : { tools: [...tools] }),
      parameters: { maxTokens: limits.maxTokens },
    });
    let run: string;
    try {
      run = await db.withTenant(
        tenant,
        (inner) =>
          startLimited(inner, input.principalId, () =>
            startRun(inner, {
              purpose: input.purpose,
              endpoint,
              parameters: input.parameters,
              contextDigest: sha256(canonicalCall(callOf())),
              by: input.principalId,
              documentId: input.documentId,
              ask: input.ask,
              ...(input.conversationId === undefined
                ? {}
                : { conversationId: input.conversationId }),
            }),
          ),
        context,
      );
    } catch (error) {
      authority.stop();
      if (error instanceof RateLimited) {
        send('failed', {
          code: 'model_rate_limited',
          message: rateLimitedWords(error.resetsAt),
          resetsAt: error.resetsAt.toISOString(),
        });
        return;
      }
      request.log.error({ err: error }, 'a run could not start');
      send('failed', { code: 'connector_error', message: 'The assistant could not start.' });
      return;
    }
    send('run', {
      run,
      endpoint: { name: endpoint.name, boundary: endpoint.boundary },
      ...input.started,
    });
    const tool = input.tool(run);
    const offersDeclined = tools.some((each) => each.name === DECLINED.name);
    // The reply's pieces as they arrive, about a token each: said with each piece sent.
    let received = 0;
    // `last`: what the last call took in, the whole conversation as it then stood (the DP plan).
    const usage = { in: 0, out: 0, last: 0, reported: false };
    const read = new Map<string, Set<string>>();
    const readContext: { component: string; version: string; blocks: readonly string[] }[] = [
      ...(input.context ?? []),
    ];
    for (const each of input.context ?? []) read.set(each.component, new Set(each.blocks));
    let said = '';
    let model: string | null = null;
    let calls = 0;
    let outcome = 'finished';
    let failure: GenerationFailure | undefined;
    // Every turn its model allows taken, the last answering tools still (issue #872): not a timeout.
    let spent = false;
    // A guardrail that refused the run, by its rule (G5-F): never a connector's failure.
    let refusedBy: GuardrailRule | undefined;
    const rules = input.guardrails ?? [];
    // Where a rule watches replies, each answer is held until it is checked, and sent once cleared.
    const holding = watchesReplies(rules);
    const proposed: GenerationProposal[] = [];
    let last = callOf();
    try {
      for (let turn = 0; turn < limits.turns; turn += 1) {
        if (stopped.aborted) {
          outcome = 'cancelled';
          break;
        }
        const left = limits.runMs - (Date.now() - started);
        if (left < 1000) {
          failure = { code: 'timeout' };
          break;
        }
        // What this turn gives the model, which is what the run's digest is over if it is the last.
        last = callOf();
        // Everything it is about to be sent, the tools' results among it, checked first (G5-F).
        refusedBy = guardrailMatch(rules, 'sent', sentText(last));
        if (refusedBy) break;
        let text = '';
        const calledFor: { id: string; name: string; input: Record<string, unknown> }[] = [];
        const answer = await input.asking.model(
          {
            requestId: randomUUID(),
            tenant: tenant.id,
            endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
            sealed,
            call: last,
            deadlineMs: modelDeadlineMs(endpoint, left),
          },
          (event) => {
            if (event.type === 'text') {
              text += event.text;
              received += 1;
              if (!holding) send('text', { text: event.text, tokens: received });
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
          usage.last = ended.usage.in;
          usage.reported = true;
        }
        if (holding && text !== '') {
          refusedBy = guardrailMatch(rules, 'returned', text);
          if (refusedBy) break;
          send('text', { text, tokens: received });
        }
        said += text;
        const content: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
        if (text !== '') content.push({ type: 'text', text });
        for (const each of calledFor) content.push({ type: 'tool_use', ...each });
        if (content.length > 0) messages.push({ role: 'assistant', content });
        // What the model wrote into a tool's arguments returns from it too: a proposal's text, say.
        refusedBy = calledFor
          .map((each) => guardrailMatch(rules, 'returned', JSON.stringify(each.input)))
          .find((each) => each !== undefined);
        if (refusedBy) break;
        if (calledFor.length === 0 || ended.stop !== 'tool_use') break;
        const results: Extract<ModelMessage, { role: 'user' }>['content'] = [];
        for (const each of calledFor) {
          // Nothing more is done for a caller who has gone, or whose authority ended.
          if (stopped.aborted) break;
          calls += 1;
          send('tool_call', each);
          const answered: ToolAnswer =
            calls > limits.toolCalls
              ? {
                  ok: false,
                  content: 'This run has made all the tool calls it may.',
                  said: { code: 'too_many_calls' },
                }
              : each.name === DECLINED.name && offersDeclined
                ? declined(each.input, send)
                : await tool(each.name, each.input);
          if (answered.read) {
            const blocks = read.get(answered.read.component) ?? new Set<string>();
            for (const block of answered.read.blocks) blocks.add(block);
            read.set(answered.read.component, blocks);
            readContext.push(answered.read);
            await input.onRead?.(run, answered.read);
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
            summary: toolSummary(answered.said),
            said: answered.said,
            result: answered.content,
          });
          if (answered.proposal) {
            proposed.push(answered.proposal);
            send('proposal', {
              id: answered.proposal.id,
              number: answered.proposal.number,
              component: answered.proposal.componentId,
              against: answered.proposal.madeAgainst,
              creates: answered.proposal.creates,
              cites:
                answered.proposal.cites === null
                  ? null
                  : {
                      source: answered.proposal.cites.source,
                      identifier: answered.proposal.cites.identifier,
                      title: answered.proposal.cites.csl.title ?? null,
                    },
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
        if (stopped.aborted) {
          outcome = 'cancelled';
          break;
        }
        messages.push({ role: 'user', content: results });
        if (turn === limits.turns - 1) spent = true;
      }
    } catch (error) {
      // A failure of the product's own, never said as a finished run (the final review).
      request.log.error({ err: error }, 'a run failed');
      failure = { code: 'connector_error' };
    } finally {
      authority.stop();
      const ending = refusedBy
        ? 'guardrail_refused'
        : (failure?.code ?? (spent ? 'turns_spent' : outcome));
      const recorded = await db
        .withTenant(
          tenant,
          async (inner) => {
            // A refused run's proposals are the model's output too, and are discarded with it.
            if (refusedBy) {
              for (const proposal of proposed) {
                await actOnProposal(inner, { proposal, act: 'discarded', by: input.principalId });
              }
            }
            const ended = await endRun(inner, run, {
              outcome: ending,
              model,
              usage: usage.reported ? { in: usage.in, out: usage.out } : null,
              contextDigest: sha256(canonicalCall(last)),
              context: readContext,
              reply: said,
            });
            await recordGenerationRun(inner, ended);
            if (ended.alertFailed) request.log.error('a budget alert could not be sent');
            return ended;
          },
          context,
        )
        .catch((error: unknown) => {
          request.log.error({ err: error }, 'a run could not be recorded as ended');
          failure ??= { code: 'connector_error' };
          return undefined;
        });
      if (refusedBy) {
        send('failed', {
          code: 'guardrail_refused',
          reason: refusedBy.reason,
          rule: refusedBy.id,
          message: `A guardrail refused this: ${refusedBy.reason}`,
        });
      } else if (failure) {
        send('failed', {
          code: failure.code,
          ...(failure.reason ? { reason: failure.reason } : {}),
          message: WORDS[failure.code],
        });
      } else if (spent) {
        send('failed', {
          code: 'turns_spent',
          message: 'The run took all the turns its model allows.',
        });
      } else {
        send('ended', {
          outcome: ending,
          model,
          tokensIn: recorded?.tokensIn ?? null,
          tokensOut: recorded?.tokensOut ?? null,
          contextTokens: usage.reported ? usage.last : null,
          cost: recorded?.costMicros == null ? null : microsText(recorded.costMicros),
          currency: endpoint.currency,
          ...input.ended?.(said, read),
        });
      }
    }
  });
}

/**
 * An instruction found in content, declined aloud (the GC plan, GC-E; GEN-021): a notice beside the
 * turn, its words bounded and sent as data, and the model told it was noted. Nothing else is done.
 */
function declined(input: unknown, send: (event: string, data: unknown) => void): ToolAnswer {
  const parsed = declinedInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      content: 'The arguments are not what this tool takes.',
      said: { code: 'arguments_refused' },
    };
  }
  send('notice', { where: parsed.data.where, instruction: parsed.data.instruction });
  return { ok: true, content: 'noted', said: { code: 'declined' } };
}

/** Everything a call sends but the product's own instructions: the words, tool calls and results. */
function sentText(call: ModelCall): string {
  return call.messages
    .flatMap((message) =>
      message.content.map((block) =>
        block.type === 'text'
          ? block.text
          : block.type === 'tool_result'
            ? block.content
            : JSON.stringify(block.input),
      ),
    )
    .join('\n');
}
