import { describe, expect, it } from 'vitest';

import {
  guardrailMatch,
  guardrailSchema,
  matchable,
  watchesReplies,
  type GuardrailRule,
} from './guardrail.js';

const rule = (over: Partial<GuardrailRule> = {}): GuardrailRule => ({
  id: 'r1',
  phrase: 'Project Kestrel',
  applies: 'both',
  reason: 'An unannounced project',
  ...over,
});

describe('a guardrail', () => {
  it('matches its phrase as words are read: any case, any spacing, composed', () => {
    expect(matchable('  Project\n\tKESTREL  ')).toBe('project kestrel');
    expect(guardrailMatch([rule()], 'sent', 'What is project   kestrel?')?.id).toBe('r1');
    // The same letter written decomposed is the same phrase.
    const decomposed = `Caf${String.fromCharCode(0x65, 0x301)}`;
    expect(
      guardrailMatch([rule({ phrase: 'Café' })], 'returned', `At the ${decomposed}.`),
    ).toBeDefined();
    expect(guardrailMatch([rule()], 'sent', 'Project Kes trel')).toBeUndefined();
  });

  it('watches the side it names, or both', () => {
    const sent = rule({ id: 's', applies: 'sent' });
    const returned = rule({ id: 'r', applies: 'returned' });
    expect(guardrailMatch([sent, returned], 'sent', 'project kestrel')?.id).toBe('s');
    expect(guardrailMatch([sent, returned], 'returned', 'project kestrel')?.id).toBe('r');
    expect(watchesReplies([sent])).toBe(false);
    expect(watchesReplies([sent, returned])).toBe(true);
  });

  it('is a phrase and a reason, refused empty or holding a control character', () => {
    expect(guardrailSchema.safeParse({ phrase: 'x', applies: 'sent', reason: 'y' }).success).toBe(
      true,
    );
    expect(guardrailSchema.safeParse({ phrase: ' ', applies: 'sent', reason: 'y' }).success).toBe(
      false,
    );
    expect(
      guardrailSchema.safeParse({ phrase: 'a\u0007b', applies: 'sent', reason: 'y' }).success,
    ).toBe(false);
    expect(guardrailSchema.safeParse({ phrase: 'x', applies: 'tools', reason: 'y' }).success).toBe(
      false,
    );
  });
});
