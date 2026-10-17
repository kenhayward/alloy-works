import { describe, expect, it } from 'vitest';
import type { ContentDocument } from '../content/model/document.js';
import { bringBack, lineDifferences } from './lines.js';

const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});
const doc = (...content: ReturnType<typeof para>[]) =>
  ({
    schemaVersion: 1,
    title: 'Label the drum',
    language: 'en-GB',
    direction: 'ltr',
    content,
  }) as unknown as ContentDocument;

describe('bringing a line back, block by block (the R16 plan, R16-F)', () => {
  const main = doc(para('a', 'Intro'), para('b', 'Central dose'), para('c', 'Central only'));
  const line = doc(para('a', 'Intro'), para('b', 'US dose'), para('d', 'US only'));

  it('LIF-045 lists each block that differs between the lines, and how', () => {
    expect(lineDifferences(main, line)).toEqual([
      { block: 'b', change: 'changed' },
      { block: 'c', change: 'main' },
      { block: 'd', change: 'line' },
    ]);
  });

  it("LIF-045 takes the line's side of each block carried and keeps the main line's of every other", () => {
    // Carrying b and d: the US dose replaces the central one, US only follows it, and Central only
    // stays, left behind as the main line's.
    expect(bringBack(main, line, ['b', 'd']).content).toEqual([
      para('a', 'Intro'),
      para('b', 'US dose'),
      para('d', 'US only'),
      para('c', 'Central only'),
    ]);
    // Carrying c, which only the main line holds: the line's side is its absence.
    expect(bringBack(main, line, ['c']).content).toEqual([
      para('a', 'Intro'),
      para('b', 'Central dose'),
    ]);
    // Carrying nothing changes nothing.
    expect(bringBack(main, line, [])).toEqual(main);
  });
});
