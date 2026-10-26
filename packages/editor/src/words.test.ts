import { afterEach, describe, expect, it } from 'vitest';

import { EDITOR_WORDS, listOf, say, sayWith } from './words.js';

describe("the editor's words (the UI plan, UIb)", () => {
  afterEach(() => sayWith(null));

  it('says English with no renderer, its placeholders and plurals filled', () => {
    expect(say('footnote.mark')).toBe('Footnote');
    expect(say('bound-table.more-rows', { count: 1 })).toBe('and 1 more row');
    expect(say('bound-table.more-rows', { count: 3 })).toBe('and 3 more rows');
    expect(say('citation.flagged', { flag: 'retracted' })).toBe('Its source says it is retracted');
  });

  it("says the renderer's words once it gives them, by the same key", () => {
    sayWith({
      words: (key, values) => `[${key}${values ? ` ${JSON.stringify(values)}` : ''}]`,
      list: (values) => values.join(' + '),
    });
    expect(say('footnote.mark')).toBe('[footnote.mark]');
    expect(say('bound-table.more-rows', { count: 2 })).toBe('[bound-table.more-rows {"count":2}]');
    expect(listOf(['a', 'b'], 'conjunction')).toBe('a + b');
  });

  it('holds each message with no en or em dash, and joins a list as the renderer does', () => {
    for (const [key, message] of Object.entries(EDITOR_WORDS)) {
      expect(message, key).not.toMatch(/[–—]/);
    }
    expect(listOf(['north', 'south'], 'disjunction')).toBe('north or south');
  });
});
