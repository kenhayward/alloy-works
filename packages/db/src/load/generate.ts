import type { ContentDocument } from '@alloy-works/domain';

/** mulberry32: a seeded generator, so a run on Windows and a run on Linux load the same rows. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A class of content size, in bytes of canonical JSON, drawn log-uniformly between its bounds. */
export interface SizeClass {
  readonly name: string;
  readonly share: number;
  readonly min: number;
  readonly max: number;
}

export interface VersionCountClass {
  readonly share: number;
  readonly min: number;
  readonly max: number;
}

export function pick<T extends { readonly share: number }>(
  classes: readonly T[],
  random: () => number,
): T {
  let roll = random();
  for (const each of classes) {
    if (roll < each.share) return each;
    roll -= each.share;
  }
  return classes[classes.length - 1]!;
}

export function logUniform(min: number, max: number, random: () => number): number {
  return Math.round(Math.exp(Math.log(min) + random() * (Math.log(max) - Math.log(min))));
}

export function uniformInt(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1));
}

// Invented syllables, so no generated word is anybody's data.
const SYLLABLES = ['ka', 'lo', 'mi', 'ren', 'sa', 'tu', 'vel', 'dor', 'ine', 'qua', 'bro', 'ste'];

function word(random: () => number): string {
  const length = uniformInt(1, 4, random);
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
  }
  return text;
}

function sentence(words: number, random: () => number): string {
  const parts: string[] = [];
  for (let index = 0; index < words; index += 1) parts.push(word(random));
  return `${parts.join(' ')}.`;
}

/**
 * A component's content of roughly `bytes` bytes as canonical JSON: paragraphs of generated text with
 * the occasional mark, and above 32 KB a table as well, because large components in a regulated
 * document are tables more often than prose. It parses as a `ContentDocument`.
 */
export function generateContent(bytes: number, random: () => number): ContentDocument {
  const blocks: ContentDocument['content'][number][] = [];
  let size = 120;
  let next = 1;
  const id = () => `b${next++}`;

  if (bytes > 32_000) {
    const rows: {
      cells: { content: ContentDocument['content']; colspan: number; rowspan: number }[];
    }[] = [];
    let tableSize = 0;
    while (tableSize < bytes * 0.6) {
      const cells = [0, 1, 2, 3].map(() => {
        const text = sentence(uniformInt(1, 6, random), random);
        tableSize += text.length + 90;
        return {
          content: [
            {
              type: 'paragraph' as const,
              id: id(),
              style: 'body',
              content: [{ type: 'text' as const, value: text, marks: [] }],
            },
          ],
          colspan: 1,
          rowspan: 1,
        };
      });
      rows.push({ cells });
    }
    blocks.push({
      type: 'table',
      id: id(),
      style: 'table',
      caption: [{ type: 'text' as const, value: sentence(5, random), marks: [] }],
      headerRows: 1,
      headerColumns: 0,
      rows,
    });
    size += tableSize;
  }

  while (size < bytes || blocks.length === 0) {
    const text = sentence(uniformInt(12, 60, random), random);
    const marked = random() < 0.2;
    blocks.push({
      type: 'paragraph',
      id: id(),
      style: 'body',
      content: marked
        ? [
            { type: 'text', value: text, marks: [] },
            {
              type: 'text',
              value: ` ${word(random)}`,
              marks: [{ type: 'strong', id: `m${next}` }],
            },
          ]
        : [{ type: 'text', value: text, marks: [] }],
    });
    size += text.length + (marked ? 160 : 70);
  }

  return {
    schemaVersion: 1,
    title: sentence(4, random),
    language: 'en-GB',
    direction: 'ltr',
    content: blocks,
  };
}
