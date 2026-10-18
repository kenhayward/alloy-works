import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PromptRunBody, PromptTrialBody } from '@alloy-works/api-contract';
import {
  listGuardrails,
  documentLibrary,
  endRun,
  libraryPrompts,
  listModelRoutes,
  makeProposal,
  readDocument,
  readLibrary,
  readModelEndpoint,
  readVersion,
  recordGenerationRun,
  resolveContext,
  startRun,
  usableModelKey,
  type GenerationProposal,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  PROMPT_RUN_INSTRUCTIONS_VERSION,
  PROMPT_RUN_MAX_TOKENS,
  acceptsModel,
  guardrailMatch,
  watchesReplies,
  type GuardrailRule,
  admit,
  applyEdits,
  blockIdentifierFrom,
  canonicalCall,
  editableProblem,
  parsePrompt,
  promptCall,
  tooLarge,
  wholeText,
  type BlockNode,
  type ContentDocument,
  type GenerationFailure,
  type Prompt,
  type ResolvedContext,
} from '@alloy-works/domain';
import { readMarkdown } from '@alloy-works/readers/markdown';
import type { FastifyRequest } from 'fastify';

import { authoriseAt, callerOf, notFound, type Authorised } from '../access.js';
import { Streamed } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { watchAuthority } from '../authority.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { AppError } from '../errors.js';

/**
 * A prompt's runs (generation.md, "Prompts"; the G4 plan, G4-H and G4-I): its context resolved and
 * recorded before any call, as the requester reads it (GEN-057, GEN-058); one call through the
 * connector, no tools (GEN-003); the reply the part's whole text, a proposal (GEN-009), or for a trial
 * kept on the run and proposed nowhere (GN-F).
 */

const WORDS: Readonly<Record<GenerationFailure['code'], string>> = {
  model_unavailable: 'The model endpoint did not answer, refused its key, or failed.',
  model_mismatch: 'The endpoint answered as a model other than the one it names.',
  context_too_large: 'The endpoint said what it was sent is more than the model accepts.',
  timeout: 'The prompt did not finish in time.',
  connector_error: 'The connector failed while it called the endpoint.',
  connector_busy: 'The connector is calling as many models as it may at once. Try again shortly.',
  connector_unavailable: 'The connector could not be reached.',
};

/** A run's one call's deadline: within the stream's five minutes. */
const RUN_MS = 120_000;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Markdown admitted into a component's blocks (G2-D). */
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

/** Millionths of a currency's unit, written to six places. */
function microsText(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const part = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${part}`;
}

export function promptRunHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
  events?: TenantListener,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /**
   * Everything decided before a run starts, in the route's transaction (G4-I): the endpoint its
   * purpose goes to and that it accepts that endpoint's model (GEN-005), its context resolved as the
   * requester reads it, the call and that it fits; and for a run that proposes, that the part is one
   * a proposal can write and the requester may suggest on.
   */
  async function prepare(
    request: FastifyRequest,
    trx: TenantTransaction,
    input: {
      readonly principalId: string;
      readonly document: string;
      readonly node: string;
      readonly prompt: Prompt;
      readonly proposes: boolean;
    },
  ) {
    const route = (await listModelRoutes(trx)).find(
      (each) => each.purpose === input.prompt.models.purpose,
    );
    if (!route) {
      throw new AppError(
        409,
        'model_unconfigured',
        `No model endpoint is set up for ${input.prompt.models.purpose}.`,
      );
    }
    const endpoint = await readModelEndpoint(trx, route.endpointId);
    const sealed =
      endpoint && endpoint.retiredAt === null ? await usableModelKey(trx, endpoint) : undefined;
    if (!endpoint || sealed === undefined) {
      throw new AppError(409, 'endpoint_unusable', 'The endpoint is retired, or has no key set.');
    }
    if (!acceptsModel(input.prompt, endpoint.model)) {
      throw new AppError(
        409,
        'model_mismatch',
        `The endpoint runs ${endpoint.model}, which this prompt does not accept.`,
      );
    }
    const resolved = await resolveContext(trx, {
      principal: input.principalId,
      documentId: input.document,
      node: input.node,
      prompt: input.prompt,
    });
    switch (resolved.answer) {
      case 'part.missing':
        throw notFound();
      case 'context.empty':
        throw new AppError(409, 'context_empty', 'What this prompt reads resolved to nothing.');
      case 'context.too_many':
        throw new AppError(
          409,
          'context_too_large',
          `What this prompt reads is ${resolved.parts} parts, more than a run takes.`,
        );
    }
    const context: ResolvedContext = resolved.context;
    const call = promptCall(endpoint.model, input.prompt, context);
    const over = tooLarge(call, endpoint.contextWindow);
    if (over) {
      throw new AppError(
        409,
        'context_too_large',
        `What this prompt sends is about ${over.tokens.toLocaleString('en-GB')} tokens, more than the endpoint's ${over.window.toLocaleString('en-GB')}.`,
      );
    }
    if (input.proposes) {
      const problem = context.part.content.content
        .map((block) => editableProblem(block))
        .find((each) => each !== undefined);
      if (problem) throw new AppError(409, 'part_not_writable', problem);
      await authoriseAt(trx, callerOf(request), 'suggest', {
        kind: 'artifact',
        id: context.part.component,
      });
    }
    // What it sends, checked against the tenant's guardrails before any call (G5-F).
    const guardrails = await listGuardrails(trx);
    const sentRule = guardrailMatch(
      guardrails,
      'sent',
      call.messages
        .flatMap((message) =>
          message.content.map((block) => (block.type === 'text' ? block.text : '')),
        )
        .join(' '),
    );
    if (sentRule) {
      throw new AppError(409, 'guardrail_refused', `A guardrail refused this: ${sentRule.reason}`);
    }
    return { endpoint, sealed, context, call, record: resolved.record, guardrails };
  }

  /** The run itself, streamed after the route's transaction commits (G2-B's machinery, one turn). */
  function streamed(
    request: FastifyRequest,
    input: {
      readonly principalId: string;
      readonly document: string;
      readonly promptVersion: string;
      readonly trial: boolean;
      readonly prepared: Awaited<ReturnType<typeof prepare>>;
      readonly prompt: Prompt;
    },
  ): Streamed {
    if (!client) throw new AppError(503, 'connector_unavailable', WORDS.connector_unavailable);
    const asking = client;
    const tenant = tenantOf(request);
    const context = contextOf(request);
    const credential = request.credential ?? null;
    const caller = callerOf(request);
    const { endpoint, sealed, call, record, guardrails } = input.prepared;
    // Where a rule watches replies, the reply is held until it is checked (G5-F).
    const holding = watchesReplies(guardrails);
    const part = input.prepared.context.part;
    return new Streamed(async (send, closed) => {
      const authority = watchAuthority({ db, tenant, credential, events });
      const stopped = AbortSignal.any([closed, authority.signal]);
      let run: string;
      try {
        run = await db.withTenant(
          tenant,
          (inner) =>
            startRun(inner, {
              purpose: input.trial ? 'trial' : input.prompt.models.purpose,
              endpoint,
              parameters: {
                maxTokens: PROMPT_RUN_MAX_TOKENS,
                instructions: PROMPT_RUN_INSTRUCTIONS_VERSION,
                node: part.component,
              },
              contextDigest: sha256(canonicalCall(call)),
              context: record,
              by: input.principalId,
              documentId: input.document,
              promptVersion: input.promptVersion,
            }),
          context,
        );
      } catch (error) {
        authority.stop();
        request.log.error({ err: error }, 'a prompt run could not start');
        send('failed', { code: 'connector_error', message: 'The prompt could not start.' });
        return;
      }
      send('run', {
        run,
        endpoint: { name: endpoint.name, boundary: endpoint.boundary },
        trial: input.trial,
      });
      let said = '';
      let model: string | null = null;
      let usage: { in: number; out: number } | null = null;
      let outcome = 'finished';
      let failure: GenerationFailure | undefined;
      let refusedBy: GuardrailRule | undefined;
      let proposal: GenerationProposal | undefined;
      let problem: string | undefined;
      try {
        const answer = await asking.model(
          {
            requestId: randomUUID(),
            tenant: tenant.id,
            endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
            sealed,
            call,
            deadlineMs: RUN_MS,
          },
          (event) => {
            if (event.type === 'text') {
              said += event.text;
              if (!holding) send('text', { text: event.text });
            }
          },
          stopped,
        );
        if (stopped.aborted) outcome = 'cancelled';
        else if ('refused' in answer) failure = { code: answer.refused.code };
        else if (answer.answer.type === 'failed') failure = answer.answer.failure;
        else {
          model = answer.answer.model;
          usage = answer.answer.usage ?? null;
          refusedBy = guardrailMatch(guardrails, 'returned', said);
          if (holding && !refusedBy && said !== '') send('text', { text: said });
          if (!input.trial && !refusedBy) {
            // The part's whole text, proposed against the version the context read, as the
            // requester, who must still read the document and suggest on the part.
            const made =
              said.trim() === ''
                ? { problem: 'The model wrote nothing, so nothing is proposed.' }
                : await db.withTenant(
                    tenant,
                    async (inner) => {
                      await authoriseAt(inner, caller, 'read', {
                        kind: 'artifact',
                        id: input.document,
                      });
                      await authoriseAt(inner, caller, 'suggest', {
                        kind: 'artifact',
                        id: part.component,
                      });
                      const edited = applyEdits(
                        part.content,
                        wholeText(part.content, said.trim()),
                        markdownReader(part.content),
                      );
                      if (!edited.ok) return { problem: edited.problem };
                      // Nothing written is no text to propose: a part is never emptied by a blank reply.
                      return {
                        proposal: await makeProposal(inner, {
                          run,
                          component: part.component,
                          against: part.version,
                          proposed: edited.content,
                        }),
                      };
                    },
                    context,
                  );
            if ('proposal' in made) proposal = made.proposal;
            else problem = made.problem;
          }
        }
      } catch (error) {
        request.log.error({ err: error }, 'a prompt run failed');
        failure = { code: 'connector_error' };
      } finally {
        authority.stop();
        const ending = refusedBy ? 'guardrail_refused' : (failure?.code ?? outcome);
        const recorded = await db
          .withTenant(
            tenant,
            async (inner) => {
              const ended = await endRun(inner, run, {
                outcome: ending,
                model,
                usage,
                // A reply a guardrail refused is kept nowhere, so no read of the run shows it (G5-F).
                reply: refusedBy ? '' : said,
                // A trial's output is kept on the run (GN-F); a run's is its proposal.
                steps: [
                  {
                    output: refusedBy ? '' : said,
                    ...(refusedBy ? { refused: 'guardrail', rule: refusedBy.id } : {}),
                    ...(proposal ? { proposal: proposal.id } : {}),
                    ...(problem ? { refused: problem } : {}),
                  },
                ],
              });
              await recordGenerationRun(inner, ended);
              return ended;
            },
            context,
          )
          .catch((error: unknown) => {
            // A run whose end is not recorded says so, and never reads as finished.
            request.log.error({ err: error }, 'a prompt run could not be recorded as ended');
            failure ??= { code: 'connector_error' };
            return undefined;
          });
        if (proposal) {
          send('proposal', {
            id: proposal.id,
            number: proposal.number,
            component: proposal.componentId,
            against: proposal.madeAgainst,
            proposed: proposal.proposed,
          });
        }
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
        } else {
          send('ended', {
            outcome: ending,
            model,
            tokensIn: recorded?.tokensIn ?? null,
            tokensOut: recorded?.tokensOut ?? null,
            cost: recorded?.costMicros == null ? null : microsText(recorded.costMicros),
            currency: endpoint.currency,
            citations: [],
            dropped: [],
            ...(problem ? { refused: problem } : {}),
          });
        }
      }
    });
  }

  return {
    listDocumentPrompts: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as { id: string };
      if (!(await readDocument(trx, id))) throw notFound();
      const library = await documentLibrary(trx, id);
      const stored = await readLibrary(trx, library);
      return {
        library: { id: library, isDefault: stored?.isDefault ?? true },
        prompts: stored ? await libraryPrompts(trx, principalId, stored.library) : [],
      };
    },

    startPromptRun: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as { id: string };
      const body = request.body as PromptRunBody;
      if (!(await readDocument(trx, id))) throw notFound();
      // Only a prompt its library lists, at its latest approved revision (G4-F).
      const stored = await readLibrary(trx, await documentLibrary(trx, id));
      const listed = stored
        ? (await libraryPrompts(trx, principalId, stored.library)).find(
            (each) => each.id === body.prompt,
          )
        : undefined;
      if (listed?.state !== 'approved') throw notFound();
      const prepared = await prepare(request, trx, {
        principalId,
        document: id,
        node: body.node,
        prompt: listed.prompt,
        proposes: true,
      });
      return streamed(request, {
        principalId,
        document: id,
        promptVersion: listed.revision.versionId,
        trial: false,
        prepared,
        prompt: listed.prompt,
      });
    },

    startPromptTrial: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id, version } = request.params as { id: string; version: string };
      const body = request.body as PromptTrialBody;
      const read = await readVersion(trx, version);
      if (!read || read.kind !== 'prompt' || read.artifactId !== id) throw notFound();
      const prompt = parsePrompt(read.content);
      await authoriseAt(trx, callerOf(request), 'read', { kind: 'artifact', id: body.document });
      if (!(await readDocument(trx, body.document))) throw notFound();
      const prepared = await prepare(request, trx, {
        principalId,
        document: body.document,
        node: body.node,
        prompt,
        proposes: false,
      });
      return streamed(request, {
        principalId,
        document: body.document,
        promptVersion: version,
        trial: true,
        prepared,
        prompt,
      });
    },
  };
}
