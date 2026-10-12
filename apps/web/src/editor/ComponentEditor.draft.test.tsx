import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftKey } from './draft.js';
import { ADA, COMPONENT, json, open, opened } from './test/componentEditor.js';

afterEach(() => {
  window.sessionStorage.clear();
});

/** The editor as a reviewer's draft (the SG plan, SG-J): a reviewer who may not edit the component. */
function drafting(onSend = vi.fn(async (_content: unknown) => true), onDiscard = vi.fn()) {
  const { asked, surface } = open(
    { 'GET /v1/components/{id}': () => json(200, opened({ mayEdit: false })) },
    undefined,
    false,
    { draft: { onSend, onDiscard, mayUpload: false } },
  );
  return { asked, surface, onSend, onDiscard };
}

describe('a suggestion’s draft, in the component editor', () => {
  it('COL-020 COL-025 edits the component with no lock and nothing sent, keeps the draft in the tab, and sends it whole', async () => {
    const { asked, surface, onSend } = drafting();
    const view = await surface();
    act(() => {
      view.dispatch(view.state.tr.insertText(' Carefully.', view.state.doc.content.size - 1));
    });
    await waitFor(() =>
      expect(window.sessionStorage.getItem(draftKey(COMPONENT, ADA))).toContain('Carefully.'),
    );
    // Nothing asked of the service but the component itself: no lock, no session, no save.
    expect(
      asked.map((each) => each.route).filter((route) => route !== 'GET /v1/presentation'),
    ).toEqual(['GET /v1/components/{id}']);
    expect(screen.queryByRole('button', { name: 'Done editing' })).toBeNull();
    // An image is the reviewer's to add only where they may add one to the space.
    expect(screen.getByRole('button', { name: 'Image' })).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(JSON.stringify(onSend.mock.calls[0]![0])).toContain('Unbox the printer. Carefully.');
    await waitFor(() => expect(window.sessionStorage.getItem(draftKey(COMPONENT, ADA))).toBeNull());
  });

  it('opens the draft this tab kept, made from the version that opens, and discards it', async () => {
    window.sessionStorage.setItem(
      draftKey(COMPONENT, ADA),
      JSON.stringify({
        version: 'v1',
        content: {
          ...(opened().content as object),
          title: 'Install the printer',
          content: [
            {
              type: 'paragraph',
              id: 'b1',
              style: 'body',
              content: [{ type: 'text', value: 'Kept words.', marks: [] }],
            },
          ],
        },
      }),
    );
    const { surface, onDiscard } = drafting();
    const view = await surface();
    expect(view.state.doc.textContent).toContain('Kept words.');
    await userEvent.click(screen.getByRole('button', { name: 'Discard suggestion' }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(draftKey(COMPONENT, ADA))).toBeNull();
  });
});
