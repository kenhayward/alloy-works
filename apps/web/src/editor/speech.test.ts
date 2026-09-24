import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeEquation, SPOKEN_LANGUAGES, speechLanguage } from './speech.js';

const NS = 'http://www.w3.org/1998/Math/MathML';
const SQUARED = `<math xmlns="${NS}"><msup><mi>x</mi><mn>2</mn></msup></math>`;
/**
 * A fraction, whose words are the same here as in a browser. A square is not: jsdom's XPath answers
 * one of the engine's questions differently, and it is spoken as _x raised to the 2 power_ rather
 * than _x squared_, so it is not used where the words are the point.
 */
const FRACTION = `<math xmlns="${NS}"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>`;

const ENGLISH = 'the fraction with numerator a plus b and denominator c';

afterEach(() => vi.restoreAllMocks());

describe("an equation's alternative, written by the speech rule engine (equations 1, ruling R7)", () => {
  // First in the file: the engine is loaded once, by whichever test asks first, and what it fetches
  // as it loads is the point.
  it("loads the engine when first asked, with its languages from the product's own files and nothing fetched", async () => {
    const opened = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const fetched = vi.spyOn(globalThis, 'fetch');
    const scripts: Node[] = [];
    const watching = new MutationObserver((records) =>
      records.forEach((record) =>
        record.addedNodes.forEach((node) => {
          if (node.nodeName.toLowerCase() === 'script') scripts.push(node);
        }),
      ),
    );
    watching.observe(document, { childList: true, subtree: true });

    expect(await describeEquation(FRACTION, 'en-GB')).toBe(ENGLISH);
    // The engine sets itself up a second time a moment after it is loaded, on a timer of its own;
    // that is waited out too, since it is the one that would reach for its default languages.
    await new Promise((settle) => setTimeout(settle, 50));
    watching.disconnect();

    expect(opened).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
    expect(scripts).toEqual([]);
  });

  it("speaks the component's language where the engine has it, and nothing where it has not", async () => {
    expect(await describeEquation(FRACTION, 'de-AT')).toBe(
      'Bruch mit Zähler a plus b und Nenner c',
    );
    expect(await describeEquation(FRACTION, 'fr-CA')).toBe(
      'fraction avec numérateur a plus b et dénominateur c',
    );
    // Norwegian as its macrolanguage is written as Bokmål unless it says Nynorsk.
    expect(await describeEquation(FRACTION, 'no')).toBe('brøk med teller a pluss b og nevner c');
    expect(await describeEquation(FRACTION, 'nn')).toBe('brøk med tellar a pluss b og nemnar c');
    expect(await describeEquation(FRACTION, 'EN-us')).toBe(ENGLISH);
    // Spanish has MathSpeak alone, which the engine chooses for itself.
    expect(await describeEquation(FRACTION, 'es')).toBe(
      'empezar fracción a más b entre c finalizar fracción',
    );
    expect(await describeEquation(SQUARED, 'cy-GB')).toBeNull();
    expect(await describeEquation(SQUARED, 'ja')).toBeNull();
  });

  it('answers each request in its own language when two are asked at once', async () => {
    expect(
      await Promise.all([describeEquation(FRACTION, 'sv'), describeEquation(FRACTION, 'en')]),
    ).toEqual(['bråket med täljare a plus b och nämnare c', ENGLISH]);
  });

  it('knows the thirteen languages the engine speaks, by their primary language subtag', () => {
    expect(SPOKEN_LANGUAGES).toEqual([
      'af',
      'ca',
      'da',
      'de',
      'en',
      'es',
      'fr',
      'hi',
      'it',
      'ko',
      'nb',
      'nn',
      'sv',
    ]);
    expect(speechLanguage('pt-BR')).toBeNull();
    expect(speechLanguage('nn-NO')).toBe('nn');
    expect(speechLanguage('hi')).toBe('hi');
    // A tag the model would not take is no language at all.
    expect(speechLanguage('')).toBeNull();
    expect(speechLanguage('en_GB')).toBeNull();
  });
});
