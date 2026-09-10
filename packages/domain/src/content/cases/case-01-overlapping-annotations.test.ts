import { describe, expect, it } from 'vitest';

import { condition, doc, markTypes, paragraph, suggestion, text } from '../document.js';
import {
  acceptSuggestion,
  fragmentsOf,
  plainText,
  rejectSuggestion,
  resolveConditions,
} from '../resolve.js';

/**
 * Case 1 of the content model spike - a GATE.
 * See docs/specification/Content_Model_Spike.md.
 *
 * A reviewer's suggested deletion covers a range that begins inside a conditional block and ends
 * outside it. The two ranges overlap without nesting, which is the ordinary situation in review
 * and the thing ADR-0005 claims tree markup cannot represent without leaving its own model.
 *
 * Passing means: the overlap needs no construct of its own, each annotation keeps ONE identity
 * across the fragments the overlap creates, and accept/reject/exclude each act once over the
 * whole annotation rather than per fragment.
 */

const ukOnly = condition('c1', { axis: 'region', values: ['UK'] });
const adaDeletes = suggestion('s1', { operation: 'delete', author: 'Ada' });

//   The site is registered under section 4.
//            |-- s1 ----|
//               |--- c1 -----|
const sentence = () =>
  doc([
    paragraph([
      text('The site '),
      text('is ', [adaDeletes]),
      text('registered', [adaDeletes, ukOnly]),
      text(' under', [ukOnly]),
      text(' section 4.'),
    ]),
  ]);

describe('case 1 - overlapping annotations', () => {
  it('holds two annotations over overlapping ranges without nesting them', () => {
    const fragments = fragmentsOf(sentence(), 's1');

    expect(fragments.map((fragment) => fragment.text)).toEqual(['is ', 'registered']);
    expect(fragmentsOf(sentence(), 'c1').map((fragment) => fragment.text)).toEqual([
      'registered',
      ' under',
    ]);
  });

  it('carries both annotations on the text they share', () => {
    const shared = fragmentsOf(sentence(), 's1').find((fragment) => fragment.text === 'registered');

    expect(shared?.marks.map((mark) => mark.id).sort()).toEqual(['c1', 's1']);
  });

  it('accepts a suggested deletion in one action, across every fragment it covers', () => {
    const accepted = acceptSuggestion(sentence(), 's1');

    expect(plainText(accepted)).toBe('The site  under section 4.');
    expect(fragmentsOf(accepted, 's1')).toEqual([]);
  });

  it('rejects a suggested deletion in one action, leaving the text and no residue', () => {
    const rejected = rejectSuggestion(sentence(), 's1');

    expect(plainText(rejected)).toBe('The site is registered under section 4.');
    expect(fragmentsOf(rejected, 's1')).toEqual([]);
  });

  it('excludes conditional content the profile does not select, and keeps what it does', () => {
    expect(plainText(resolveConditions(sentence(), { region: ['US'] }))).toBe(
      'The site is  section 4.',
    );
    expect(plainText(resolveConditions(sentence(), { region: ['UK'] }))).toBe(
      'The site is registered under section 4.',
    );
  });

  /**
   * The gate. If the overlap were represented by splitting an annotation into independent pieces,
   * these two orders would diverge - accepting first would leave a fragment of the condition
   * behind, or excluding first would strand half a suggestion. One id per annotation is what makes
   * the two operations commute.
   */
  it('resolves the overlap identically whichever operation runs first', () => {
    const acceptedThenExcluded = resolveConditions(acceptSuggestion(sentence(), 's1'), {
      region: ['US'],
    });
    const excludedThenAccepted = acceptSuggestion(
      resolveConditions(sentence(), { region: ['US'] }),
      's1',
    );

    expect(plainText(acceptedThenExcluded)).toBe('The site  section 4.');
    expect(plainText(excludedThenAccepted)).toBe(plainText(acceptedThenExcluded));
  });

  /**
   * The other half of the pass criterion: no schema construct exists whose only purpose is to
   * represent the overlap. Every mark is a semantic annotation - none is a positional marker with
   * a matching partner elsewhere in the tree, which is what standoff markup would need.
   */
  it('has no mark type that exists only to represent an overlap', () => {
    expect([...markTypes].sort()).toEqual(['comment', 'condition', 'suggestion']);
  });
});
