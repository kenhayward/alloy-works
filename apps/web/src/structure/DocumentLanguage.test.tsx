import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentLanguage } from './DocumentLanguage.js';

const NONE = { notPermitted: 0, locked: 0, pinnedBehind: 0, translated: 0, missing: 0 };

function service(status: number, answer: unknown) {
  const sent: unknown[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    sent.push({ path: new URL(request.url).pathname, body: await request.clone().json() });
    return new Response(JSON.stringify(answer), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.example.test', fetch }), sent };
}

function opened(client: ReturnType<typeof createApiClient>) {
  const act: RefObject<(() => void) | null> = createRef();
  const onChanged = vi.fn();
  const onStale = vi.fn();
  render(
    <DocumentLanguage
      act={act}
      client={client}
      id="d1"
      version="v1"
      language="en-GB"
      onChanged={onChanged}
      onStale={onStale}
    />,
  );
  return { act, onChanged, onStale };
}

const open = async (act: RefObject<(() => void) | null>) => {
  await waitFor(() => expect(act.current).not.toBeNull());
  act.current!();
  return screen.findByRole('dialog', { name: 'Language of this document' });
};

describe("a document's language", () => {
  it('changes the document alone unless asked, showing what it is now', async () => {
    const after = { id: 'd1' };
    const { client, sent } = service(200, {
      document: after,
      components: { changed: [], skipped: NONE },
    });
    const { act, onChanged } = opened(client);
    await open(act);

    const field = screen.getByRole('combobox', { name: 'Language' });
    expect(field).toHaveValue('en-GB');
    expect(screen.getByRole('checkbox', { name: /Also set the language/ })).not.toBeChecked();
    await userEvent.clear(field);
    await userEvent.type(field, 'fr-FR');
    await userEvent.click(screen.getByRole('button', { name: 'Change language' }));

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(after, 'The document is now in fr-FR.', []),
    );
    expect(sent).toEqual([
      {
        path: '/v1/documents/d1/language',
        body: { openedFrom: 'v1', language: 'fr-FR', components: false },
      },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sets its components too when asked, and says what it changed and what it left', async () => {
    const { client, sent } = service(200, {
      document: { id: 'd1' },
      components: {
        changed: ['c1', 'c2', 'c3'],
        skipped: { notPermitted: 1, locked: 2, pinnedBehind: 1, translated: 1, missing: 0 },
      },
    });
    const { act, onChanged } = opened(client);
    await open(act);

    await userEvent.clear(screen.getByRole('combobox', { name: 'Language' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Language' }), 'fr-FR');
    await userEvent.click(screen.getByRole('checkbox', { name: /Also set the language/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Change language' }));

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(
        { id: 'd1' },
        'The document is now in fr-FR. 3 components changed. Left as they were: 1 you may not edit, 2 being edited, 1 pinned to an older version, 1 already translated into it.',
        ['c1', 'c2', 'c3'],
      ),
    );
    expect(sent).toEqual([
      expect.objectContaining({
        body: { openedFrom: 'v1', language: 'fr-FR', components: true },
      }),
    ]);
  });

  it('will not send what is not a tag, and says of one outside the declared list', async () => {
    const { client, sent } = service(200, {});
    const { act } = opened(client);
    const dialog = await open(act);

    const field = screen.getByRole('combobox', { name: 'Language' });
    await userEvent.clear(field);
    await userEvent.type(field, 'english');
    await userEvent.click(screen.getByRole('button', { name: 'Change language' }));
    expect(dialog).toHaveTextContent('A language tag looks like en-GB.');
    expect(sent).toEqual([]);

    await userEvent.clear(field);
    await userEvent.type(field, 'tlh');
    expect(dialog).toHaveTextContent('tlh is not a declared language.');
  });

  it('says why where a title is translated into it, and stays open', async () => {
    const { client } = service(400, {
      code: 'outline_invalid',
      message: 'x',
      reason: 'A title is translated into fr-FR: clear that translation first',
      traceId: 't',
    });
    const { act, onChanged } = opened(client);
    const dialog = await open(act);
    await userEvent.clear(screen.getByRole('combobox', { name: 'Language' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Language' }), 'fr-FR');
    await userEvent.click(screen.getByRole('button', { name: 'Change language' }));

    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        'A title is already translated into that language. Clear that translation first.',
      ),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('hands back a document since changed by somebody else', async () => {
    const { client } = service(409, { code: 'version_precondition', current: { id: 'd1' } });
    const { act, onStale } = opened(client);
    await open(act);
    await userEvent.clear(screen.getByRole('combobox', { name: 'Language' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Language' }), 'fr-FR');
    await userEvent.click(screen.getByRole('button', { name: 'Change language' }));

    await waitFor(() => expect(onStale).toHaveBeenCalledWith({ id: 'd1' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
