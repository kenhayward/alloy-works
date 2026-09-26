import { describe, expect, it } from 'vitest';
import { heldSentence } from './held.js';

/** The time a reader's clock shows for an instant, as the sentence writes it. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

describe('who holds a component, as a reader is told it', () => {
  it("names the holder and the time they are expected back, in the reader's own time", () => {
    const now = new Date('2026-09-26T09:00:00.000Z');
    const back = new Date(now.getTime() + 30 * 60_000).toISOString();
    expect(heldSentence({ name: 'Grace', expectedRelease: back }, now)).toBe(
      `Grace is editing this component, expected back at ${clock(back)}.`,
    );
  });

  it('adds the day where they are expected back on another one', () => {
    const now = new Date('2026-09-26T09:00:00.000Z');
    const back = '2026-09-29T09:00:00.000Z';
    const day = new Date(back).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    expect(heldSentence({ name: 'Grace', expectedRelease: back }, now)).toBe(
      `Grace is editing this component, expected back at ${clock(back)} on ${day}.`,
    );
  });

  it('says someone else where the holder has no name, and no time where none is known', () => {
    expect(heldSentence({ name: null, expectedRelease: '' })).toBe(
      'Someone else is editing this component.',
    );
  });
});
