import { formats, words } from '../words/words.js';

/**
 * A run's own sentences worded from their codes (the UI plan, UI-L): a step, a prompt's refusal and a
 * failure. A code with no words here falls back to the service's English, which it always sends.
 */

/** What a step did, as `tool_result.said` codes it. */
export interface StepSaid {
  readonly code: string;
  readonly count?: number;
  readonly number?: number;
  readonly version?: string;
}

const STEP_CODES = [
  'not_yours_to_change',
  'not_yours_to_make',
  'no_such_component',
  'no_such_type',
  'no_such_tool',
  'citation_refused',
  'arguments_refused',
  'edit_refused',
  'text_refused',
  'changes_nothing',
  'too_many_calls',
  'declined',
] as const;

export function stepWords(
  said: StepSaid | undefined,
  summary: string | undefined,
): string | undefined {
  if (said === undefined) return summary;
  switch (said.code) {
    case 'found':
      return words('assistant.step.found', { count: said.count ?? 0 });
    case 'components':
      return words('assistant.step.components', { count: said.count ?? 0 });
    case 'values':
      return words('assistant.step.values', { count: said.count ?? 0 });
    case 'blocks':
      return words('assistant.step.blocks', {
        count: said.count ?? 0,
        version: said.version ?? '',
      });
    case 'proposal':
      return words('assistant.step.proposal', { number: said.number ?? 0 });
    default:
      return (STEP_CODES as readonly string[]).includes(said.code)
        ? words(`assistant.step.${said.code as (typeof STEP_CODES)[number]}`)
        : (summary ?? said.code);
  }
}

/** Why a prompt's run proposed nothing, as `ended.refusal` codes it. */
export function proposedNothingWords(refusal: string | undefined, refused: string | undefined) {
  switch (refusal) {
    case 'nothing_written':
      return words('assistant.refusal.nothing-written');
    case 'edit_refused':
      return words('assistant.refusal.edit-refused');
    default:
      return refused;
  }
}

const FAILURES = [
  'model_unavailable',
  'model_mismatch',
  'context_too_large',
  'timeout',
  'connector_error',
  'connector_busy',
  'connector_unavailable',
] as const;

/** A run's `failed` frame: its code worded, a guardrail's reason and a limit's time as data. */
export function failedWords(frame: {
  readonly code?: unknown;
  readonly reason?: unknown;
  readonly resetsAt?: unknown;
  readonly message?: unknown;
}): string {
  const code = String(frame.code);
  if (code === 'guardrail_refused' && typeof frame.reason === 'string') {
    return words('assistant.failed.guardrail-refused', { reason: frame.reason });
  }
  if (code === 'model_rate_limited' && typeof frame.resetsAt === 'string') {
    return words('assistant.failed.model-rate-limited', {
      at: formats().date(new Date(frame.resetsAt), { dateStyle: 'medium', timeStyle: 'short' }),
    });
  }
  return (FAILURES as readonly string[]).includes(code)
    ? words(`assistant.failed.${code as (typeof FAILURES)[number]}`)
    : String(frame.message);
}
