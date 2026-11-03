import type { StoredThread } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { threadView } from './threads.js';

const ada = { id: 'a', name: 'Ada' };
const thread = (model: string | null): StoredThread => ({
  id: 't',
  on: 'c',
  onKind: 'component',
  anchor: { kind: 'component' },
  madeAgainst: 'v',
  createdBy: ada,
  internal: false,
  createdAt: new Date('2026-11-03T09:00:00Z'),
  resolution: null,
  comments: [
    {
      id: 'm',
      author: ada,
      createdAt: new Date('2026-11-03T09:00:00Z'),
      drafted: { model },
      texts: [{ parts: [{ text: 'Which tray?' }], writtenAt: new Date('2026-11-03T09:00:00Z') }],
    },
  ],
});

describe('a thread on the wire', () => {
  it('GEN-063 names the model that drafted a comment to a reader inside, and to nobody from outside', () => {
    expect(threadView(thread('stand-in-1'), false).comments[0]!.drafted).toEqual({
      model: 'stand-in-1',
    });
    expect(threadView(thread('stand-in-1'), true).comments[0]!.drafted).toEqual({ model: null });
  });
});
