import type { FollowOptions } from '@alloy-works/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import { marksWords } from './OutlinePanel.js';
import {
  client,
  DOCUMENT,
  INTRODUCTION,
  outline,
  PRINTER,
  reference,
  section,
  service,
} from './test/documentPage.js';

shimRangeMeasurement();

const ADA = 'ffffffff-0000-4000-8000-000000000001';
const GRACE = 'ffffffff-0000-4000-8000-000000000002';
const NODE = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';

/** The document's stream, which the test speaks for. */
function fakeStream() {
  const opened: FollowOptions[] = [];
  return {
    follow: (options: FollowOptions) => {
      opened.push(options);
      return () => undefined;
    },
    say: (event: string, data: unknown) =>
      act(() => {
        for (const each of opened.filter((options) => options.url.includes('document='))) {
          each.onEvent!(event, data);
        }
      }),
  };
}

function openLive(fetch: typeof globalThis.fetch, follow: (options: FollowOptions) => () => void) {
  return render(
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} principalId={ADA} follow={follow} />
    </StrictMode>,
  );
}

describe('the contents, as others change the document', () => {
  it('STR-066 shows another person’s change to the outline as soon as the stream says so, without a reload', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    const stream = fakeStream();
    openLive(fake.fetch, stream.follow);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    stream.say('snapshot', { locks: [], presence: [] });

    fake.theirs({
      operation: 'insert',
      parent: null,
      position: 1,
      node: { type: 'section', title: [{ type: 'text', value: 'Method', marks: [] }] },
    });
    expect(screen.queryByRole('treeitem', { name: 'Method' })).toBeNull();
    stream.say('outline', { document: DOCUMENT });
    expect(await screen.findByRole('treeitem', { name: 'Method' })).toBeInTheDocument();
  });

  it('STR-038 marks in the contents a component somebody else holds, as the stream says', async () => {
    const fake = service(outline([{ ...reference(NODE, 'latest') }]));
    const stream = fakeStream();
    openLive(fake.fetch, stream.follow);
    const row = await screen.findByRole('treeitem', { name: /./ });
    stream.say('snapshot', {
      locks: [
        {
          component: PRINTER,
          holder: { id: GRACE, name: 'Grace' },
          expectedRelease: '2026-10-11T12:15:00.000Z',
          taking: null,
        },
      ],
      presence: [],
    });
    await waitFor(() => expect(row).toHaveAccessibleDescription(/Held by Grace/));
    stream.say('lock', {
      component: PRINTER,
      holder: null,
      expectedRelease: null,
      taking: null,
    });
    await waitFor(() => expect(row).not.toHaveAccessibleDescription(/Held by/));
  });

  it('STR-038 says each mark in words: who holds it, how many references are broken and values failed', () => {
    expect(marksWords({ heldBy: 'Grace', brokenReferences: 1, failedValues: 2 })).toEqual([
      'Held by Grace',
      '1 broken reference',
      '2 failed values',
    ]);
    expect(marksWords({ brokenReferences: 0 })).toEqual([]);
    expect(marksWords(undefined)).toEqual([]);
  });
});
