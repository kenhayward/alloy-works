import type * as SpeechRuleEngine from 'speech-rule-engine/mjs/index.js';
import { describe, expect, it, vi } from 'vitest';

import { describeEquation } from './speech.js';

/**
 * The engine's first load failing once, as a chunk that does not arrive would: its setup rejects the
 * first time it is asked for and runs as it does otherwise after that. A file of its own, since the
 * engine is loaded once per page, and in `speech.test.ts` it is loaded for real.
 */
vi.mock('speech-rule-engine/mjs/index.js', async (importOriginal) => {
  const engine = await importOriginal<typeof SpeechRuleEngine>();
  let first = true;
  return {
    ...engine,
    engineReady: () => {
      if (!first) return engine.engineReady();
      first = false;
      return Promise.reject(new Error('The chunk did not load.'));
    },
  };
});

const NS = 'http://www.w3.org/1998/Math/MathML';
const FRACTION = `<math xmlns="${NS}"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>`;

describe("an equation's alternative, when the engine fails to load (equations 1, ruling R7)", () => {
  it('tries the engine again on the next request, rather than failing every one until the page is reloaded', async () => {
    // The final whole-branch review's L4: the failed load was kept, and every later request failed.
    await expect(describeEquation(FRACTION, 'en')).rejects.toThrow('The chunk did not load.');
    expect(await describeEquation(FRACTION, 'en')).toBe(
      'the fraction with numerator a plus b and denominator c',
    );
  });
});
