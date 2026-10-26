import { createHash, randomUUID } from 'node:crypto';

import {
  endRun,
  lineNumbers,
  listGuardrails,
  listModelRoutes,
  readLine,
  readLock,
  readModelEndpoint,
  recordGenerationRun,
  recordMachineDraft,
  startRun,
  termsInSpace,
  translationPolicy,
  translationSource,
  usableModelKey,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
  type TenantTransaction,
  type TermInSpace,
} from '@alloy-works/db';
import {
  TRANSLATE_INSTRUCTIONS_VERSION,
  TRANSLATE_MAX_TOKENS,
  canonicalCall,
  guardrailMatch,
  machineAllowed,
  missedTerms,
  parseContentDocument,
  speaksFor,
  termLabel,
  tooLarge,
  translationCall,
  translationPieces,
  writeXliff,
  xliffInReply,
  xliffTarget,
  xliffUnits,
  type GenerationFailure,
  type XliffPart,
} from '@alloy-works/domain';
import { readXliff } from '@alloy-works/readers/xliff';
import type { FastifyRequest } from 'fastify';

import { notFound, type Authorised } from '../access.js';
import { Streamed } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { watchAuthority } from '../authority.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { AppError } from '../errors.js';
import { refused } from '../wire-codes.js';
import { RateLimited, rateLimitedWords, refuseOverLimit, startLimited } from './limits.js';

/**
 * **Machine drafts** (docs/design/translation.md, "Machine drafts"; the XL plan, XL-H to XL-K): a
 * translation drafted by the tenant's `translate` endpoint. Everything that could refuse it is decided
 * in the route's transaction, before any call: the policy against the endpoint's boundary, the route,
 * each piece's size and the guardrails on what it sends, the hourly limit, the line's lock. Then, after
 * it commits, each piece a run; each reply read back by the XLIFF mapping, so a code missing, repeated
 * or invented refuses the whole draft; the guardrails on what came back; and the draft cut and marked.
 */

/** A piece's call's deadline. */
const PIECE_MS = 120_000;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const WORDS: Readonly<Record<string, string>> = {
  model_unavailable: 'The model endpoint did not answer, refused its key, or failed.',
  model_mismatch: 'The endpoint answered as a model other than the one it names.',
  context_too_large: 'The endpoint said what it was sent is more than the model accepts.',
  timeout: 'A piece did not finish in time.',
  connector_error: 'The connector failed while it called the endpoint.',
  connector_busy: 'The connector is calling as many models as it may at once. Try again shortly.',
  connector_unavailable: 'The connector could not be reached.',
  translation_unreadable:
    'The model did not answer with the file, or changed its codes, so nothing is drafted.',
};

export function machineDraftHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
  events?: TenantListener,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  /** Everything decided before any call, in the route's transaction. */
  async function prepare(
    trx: TenantTransaction,
    input: { readonly principalId: string; readonly artifactId: string; readonly line: string },
  ) {
    const line = await readLine(trx, input.artifactId, input.line);
    if (!line || line.closed || line.language === null) throw notFound();
    const language = line.language;
    const policy = await translationPolicy(trx);
    if (policy.machine === 'off') {
      throw refused(
        409,
        'translation.machine_off',
        'This environment sends nothing to machine translation.',
      );
    }
    const route = (await listModelRoutes(trx)).find((each) => each.purpose === 'translate');
    if (!route) {
      throw new AppError(409, 'model_unconfigured', 'No model endpoint is set up for translate.');
    }
    const endpoint = await readModelEndpoint(trx, route.endpointId);
    const sealed =
      endpoint && endpoint.retiredAt === null ? await usableModelKey(trx, endpoint) : undefined;
    if (!endpoint || sealed === undefined) {
      throw new AppError(409, 'endpoint_unusable', 'The endpoint is retired, or has no key set.');
    }
    if (!machineAllowed(policy.machine, endpoint.boundary)) {
      throw refused(
        409,
        'translation.machine_outside',
        'This environment sends content to machine translation only inside the data boundary.',
      );
    }
    if (await readLock(trx, input.artifactId, line.id)) {
      throw refused(409, 'lock.held', 'Somebody is editing this translation. Try again later.');
    }
    const source = await translationSource(trx, input.artifactId);
    if (!source || source.kind !== 'component') throw notFound();
    const content = parseContentDocument(source.content);
    const pieces = translationPieces(content);
    if (pieces.length === 0) {
      throw refused(
        409,
        'translation.nothing_to_translate',
        'The source has no text to translate.',
      );
    }
    // The space's terms the source uses, by its label and the target's, given and then checked (XL-J).
    const space = await trx
      .selectFrom('artifact')
      .select('space_id')
      .where('id', '=', input.artifactId)
      .executeTakeFirst();
    const used = [...new Set(xliffUnits(content).flatMap((unit) => unit.terms))];
    const terms =
      space?.space_id && used.length > 0
        ? await termsInSpace(trx, input.principalId, space.space_id, used)
        : new Map<string, TermInSpace>();
    const glossary = new Map(
      [...terms].map(([id, { term }]) => [
        id,
        {
          source: termLabel(term, content.language).preferred,
          target: term.labels.find((label) => speaksFor(label.language, language))?.preferred,
        },
      ]),
    );
    const labels = new Map(
      [...terms].map(([id, { term }]) => {
        const label = term.labels.find((each) => speaksFor(each.language, language));
        return [id, label ? [label.preferred, ...label.alternatives] : []];
      }),
    );
    const sourceLabels = new Map([...glossary].map(([id, labels]) => [id, labels.source]));
    const calls = pieces.map((units) =>
      translationCall(
        endpoint.model,
        writeXliff({
          job: `draft-${line.id}`,
          source: content.language,
          target: language,
          files: [{ component: input.artifactId, title: content.title, type: '', content, units }],
          terms: glossary,
        }),
      ),
    );
    const guardrails = await listGuardrails(trx);
    for (const call of calls) {
      const over = tooLarge(call, endpoint.contextWindow);
      if (over) {
        throw new AppError(
          409,
          'context_too_large',
          `A piece of this component is about ${over.tokens.toLocaleString('en-GB')} tokens, more than the endpoint's ${over.window.toLocaleString('en-GB')}.`,
        );
      }
      const text = call.messages
        .flatMap((message) =>
          message.content.map((block) => (block.type === 'text' ? block.text : '')),
        )
        .join(' ');
      const rule = guardrailMatch(guardrails, 'sent', text);
      if (rule)
        throw new AppError(409, 'guardrail_refused', `A guardrail refused this: ${rule.reason}`);
    }
    await refuseOverLimit(trx, input.principalId);
    return {
      line,
      language,
      endpoint,
      sealed,
      source,
      content,
      calls,
      guardrails,
      labels,
      sourceLabels,
    };
  }

  return {
    draftComponentTranslation: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ) => {
      const { id, line: lineId } = request.params as { id: string; line: string };
      const prepared = await prepare(trx, { principalId, artifactId: id, line: lineId });
      if (!client) throw new AppError(503, 'connector_unavailable', WORDS.connector_unavailable!);
      const asking = client;
      const tenant = tenantOf(request);
      const context = contextOf(request);
      const credential = request.credential ?? null;
      const { endpoint, sealed, calls, guardrails, language, source, content } = prepared;

      return new Streamed(async (send, closed) => {
        const authority = watchAuthority({ db, tenant, credential, events });
        const stopped = AbortSignal.any([closed, authority.signal]);
        const runs: string[] = [];
        const targets = new Map<string, readonly XliffPart[]>();
        let tokensIn = 0;
        let tokensOut = 0;
        let model: string | null = null;
        let failure: { code: string; message: string; reason?: string } | undefined;
        try {
          for (const [index, call] of calls.entries()) {
            const run = await db.withTenant(
              tenant,
              (inner) =>
                startLimited(inner, principalId, () =>
                  startRun(inner, {
                    purpose: 'translate',
                    endpoint,
                    parameters: {
                      maxTokens: TRANSLATE_MAX_TOKENS,
                      instructions: TRANSLATE_INSTRUCTIONS_VERSION,
                      component: id,
                      piece: index,
                    },
                    contextDigest: sha256(canonicalCall(call)),
                    by: principalId,
                  }),
                ),
              context,
            );
            runs.push(run);
            send('run', { run, endpoint: { name: endpoint.name, boundary: endpoint.boundary } });
            let said = '';
            let ending = 'finished';
            let pieceFailure: GenerationFailure | undefined;
            let usage: { in: number; out: number; cached?: number | undefined } | null = null;
            try {
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
                  call,
                  deadlineMs: PIECE_MS,
                },
                (event) => {
                  if (event.type === 'text') said += event.text;
                },
                stopped,
              );
              if (stopped.aborted) ending = 'cancelled';
              else if ('refused' in answer) pieceFailure = { code: answer.refused.code };
              else if (answer.answer.type === 'failed') pieceFailure = answer.answer.failure;
              else {
                model = answer.answer.model;
                usage = answer.answer.usage ?? null;
              }
            } catch (error) {
              request.log.error({ err: error }, 'a machine draft piece failed');
              pieceFailure = { code: 'connector_error' };
            }
            const refusedBy =
              pieceFailure === undefined && ending === 'finished'
                ? guardrailMatch(guardrails, 'returned', said)
                : undefined;
            // The reply read back by the mapping, strictly: any trouble refuses the whole draft.
            let unreadable = false;
            if (pieceFailure === undefined && ending === 'finished' && !refusedBy) {
              const file = xliffInReply(said);
              const read =
                file === undefined ? undefined : readXliff(new TextEncoder().encode(file));
              const units = read?.ok ? read.files.get(`f.${id}`) : undefined;
              if (
                !units ||
                read?.ok !== true ||
                read.target?.toLowerCase() !== language.toLowerCase()
              ) {
                unreadable = true;
              } else {
                for (const [unit, parts] of units) {
                  if (parts === null) unreadable = true;
                  else targets.set(unit, parts);
                }
              }
            }
            const outcome = refusedBy
              ? 'guardrail_refused'
              : (pieceFailure?.code ?? (unreadable ? 'translation_unreadable' : ending));
            await db.withTenant(
              tenant,
              async (inner) => {
                const ended = await endRun(inner, run, {
                  outcome: outcome === 'translation_unreadable' ? 'finished' : outcome,
                  model,
                  usage,
                  reply: refusedBy ? '' : said,
                  steps: [
                    {
                      output: refusedBy ? '' : said,
                      ...(refusedBy ? { refused: 'guardrail', rule: refusedBy.id } : {}),
                      ...(unreadable ? { refused: WORDS.translation_unreadable! } : {}),
                    },
                  ],
                });
                await recordGenerationRun(inner, ended);
                tokensIn += ended.tokensIn ?? 0;
                tokensOut += ended.tokensOut ?? 0;
              },
              context,
            );
            if (refusedBy) {
              failure = {
                code: 'guardrail_refused',
                reason: refusedBy.reason,
                message: `A guardrail refused this: ${refusedBy.reason}`,
              };
            } else if (pieceFailure) {
              failure = {
                code: pieceFailure.code,
                message: WORDS[pieceFailure.code] ?? WORDS.connector_error!,
              };
            } else if (ending !== 'finished') {
              failure = { code: 'cancelled', message: 'The draft was cancelled.' };
            } else if (unreadable) {
              failure = { code: 'translation_unreadable', message: WORDS.translation_unreadable! };
            }
            if (failure) break;
          }
          if (!failure) {
            const read = xliffTarget(content, targets, language);
            if (!read.ok) {
              failure = { code: 'translation_unreadable', message: WORDS.translation_unreadable! };
            } else {
              const missed = missedTerms(read.content, prepared.labels);
              const cut = await db.withTenant(
                tenant,
                async (inner) => {
                  const made = await recordMachineDraft(inner, {
                    artifactId: id,
                    line: prepared.line.id,
                    content: read.content,
                    translates: source.id,
                    runs,
                    missedTerms: missed,
                    by: principalId,
                  });
                  return made.answer === 'recorded'
                    ? {
                        ...made,
                        number:
                          (await lineNumbers(inner, [made.version.id])).get(made.version.id)
                            ?.number ?? language,
                      }
                    : made;
                },
                context,
              );
              if (cut.answer === 'recorded') {
                send('drafted', {
                  version: { id: cut.version.id, number: cut.number },
                  missedTerms: missed.map((term) => ({
                    term,
                    label: prepared.sourceLabels.get(term) ?? term,
                  })),
                });
              } else if (cut.answer === 'lock.held') {
                failure = {
                  code: 'lock_held',
                  message:
                    'Somebody began editing this translation meanwhile, so nothing is drafted.',
                };
              } else {
                failure = {
                  code: 'translation_unreadable',
                  message: WORDS.translation_unreadable!,
                };
              }
            }
          }
        } catch (error) {
          if (error instanceof RateLimited) {
            failure = { code: 'model_rate_limited', message: rateLimitedWords(error.resetsAt) };
          } else {
            request.log.error({ err: error }, 'a machine draft failed');
            failure = { code: 'connector_error', message: WORDS.connector_error! };
          }
        } finally {
          authority.stop();
        }
        if (failure) send('failed', failure);
        else {
          send('ended', {
            outcome: 'finished',
            model,
            tokensIn,
            tokensOut,
            cost: null,
            currency: endpoint.currency,
            citations: [],
            dropped: [],
          });
        }
      });
    },
  };
}
