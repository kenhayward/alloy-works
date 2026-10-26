import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import enGB from './en-GB.json';
import { WordsProvider, makeWords, useWords } from './words.js';

const SOURCE = join(process.cwd(), 'src');

/** Every renderer source file, tests left out. */
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function Greeting() {
  const { words } = useWords();
  return <p>{words('language.label')}</p>;
}

describe('the interface’s words (the UI plan, UI-C)', () => {
  it('LOC-005 reads each word in the person’s language, English with no provider', () => {
    render(<Greeting />);
    expect(screen.getByText('Interface language')).toBeInTheDocument();
    render(
      <WordsProvider language="en-XA">
        <Greeting />
      </WordsProvider>,
    );
    expect(screen.getByText(/^\[Îñţéŕƒåçé ļåñĝûåĝé/)).toBeInTheDocument();
  });

  it('LOC-038 formats a date, a number and a list from the bundled locale data, in the person’s language', () => {
    const english = makeWords('en-GB');
    const day = new Date(Date.UTC(2026, 9, 26, 12));
    expect(
      english.date(day, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    ).toBe('26 October 2026');
    expect(english.number(12345.5)).toBe('12,345.5');
    expect(english.list(['Ada', 'Grace', 'Alan'])).toBe('Ada, Grace and Alan');
    // The right-to-left pseudo-locale formats as Arabic, its digits Latin (UI-B).
    expect(makeWords('ar-XB').list(['Ada', 'Grace'])).toContain('و');
  });

  it('LOC-003 compares text as the person’s language orders it, not by its bytes', () => {
    const { compare } = makeWords('en-GB');
    expect(['zebra', 'Écrit', 'apple'].sort(compare)).toEqual(['apple', 'Écrit', 'zebra']);
  });

  it('holds every message as a whole ICU message, with no dash in it, and every key a screen uses', () => {
    for (const [key, message] of Object.entries(enGB)) {
      expect(() => parse(message), key).not.toThrow();
      expect(message, key).not.toMatch(/[–—]/);
    }
    const used = new Set<string>();
    for (const file of sources(SOURCE)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bwords\(\s*'([a-zA-Z0-9.\-]+)'/g)) used.add(match[1]!);
    }
    const known = new Set(Object.keys(enGB));
    expect([...used].filter((key) => !known.has(key))).toEqual([]);
  });
});
