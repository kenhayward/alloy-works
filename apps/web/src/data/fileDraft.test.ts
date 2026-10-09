import { describe, expect, it } from 'vitest';

import { fileDraftOf } from './fileDraft.js';

const fetchWith = (where: object) =>
  ({
    kind: 'file',
    format: { kind: 'csv', header: true },
    key: [{ text: 'sites.csv' }],
    where,
  }) as never;

describe("a file's filters as the page holds them", () => {
  it('DAT-119 opens a stored contains filter with Match case ticked unless it ignores case', () => {
    const text = { literal: 'Pf', type: { base: 'text' } };
    const read = (where: object) => {
      const draft = fileDraftOf(fetchWith(where));
      if ('reason' in draft) throw new Error(draft.reason);
      return draft.filters[0];
    };
    expect(read({ column: 'site', is: 'contains', to: text })).toMatchObject({ matchCase: true });
    expect(
      read({ column: 'site', is: 'contains', to: text, ignoreCase: true })?.matchCase,
    ).toBeUndefined();
    // Is has no choice: case always counts.
    expect(read({ column: 'site', is: 'equal', to: text })?.matchCase).toBeUndefined();
  });
});
