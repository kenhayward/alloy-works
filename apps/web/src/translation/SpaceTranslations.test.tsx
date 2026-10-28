import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SpaceTranslations } from './SpaceTranslations.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
const POND = 'cccccccc-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The report's pages, by the cursor each follows; every query the renderer sent, kept. */
function service(pages: Record<string, unknown>, asked: URLSearchParams[] = []) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/spaces') {
      return json(200, { items: [{ id: SPACE, name: 'General' }], next: null });
    }
    if (url.pathname === `/v1/spaces/${SPACE}/translations`) {
      asked.push(url.searchParams);
      return json(200, pages[url.searchParams.get('cursor') ?? ''] ?? { items: [], next: null });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://report.test', fetch: fetching });
}

const SAMPLING = {
  component: { id: POND, title: 'Sampling' },
  translations: [
    { language: 'fr-FR', status: { status: 'translated' } },
    { language: 'de-DE', status: { status: 'outOfDate', retranslate: true } },
  ],
};

describe('a space’s translations (the TR plan, TR-M; the TE plan, TE-C)', () => {
  it('LOC-016 reports each translated component of a space with each language’s status, out of date first, a page at a time', async () => {
    const asked: URLSearchParams[] = [];
    render(
      <SpaceTranslations
        client={service(
          {
            '': { items: [SAMPLING], next: 'second' },
            second: {
              items: [
                {
                  component: { id: 'cccccccc-0000-4000-8000-000000000002', title: 'Survey' },
                  translations: [{ language: 'fr-FR', status: { status: 'untranslated' } }],
                },
              ],
              next: null,
            },
          },
          asked,
        )}
      />,
    );
    const table = await screen.findByRole('table', { name: 'Translated components' });
    const row = within(table).getByRole('row', { name: /Sampling/ });
    expect(within(row).getByRole('link', { name: 'Sampling' })).toHaveAttribute(
      'href',
      `#/components/${POND}`,
    );
    expect(
      within(row)
        .getAllByText(/^(fr|de)-/)
        .map((each) => each.textContent),
    ).toEqual(['de-DE: Out of date, needs retranslating', 'fr-FR: Translated']);
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await within(table).findByRole('row', { name: /Survey/ })).toHaveTextContent(
      'fr-FR: Untranslated',
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(asked.at(-1)?.get('cursor')).toBe('second');
  });

  it('LOC-016 narrows the report to a language and a status, asking the service for them', async () => {
    const asked: URLSearchParams[] = [];
    render(
      <SpaceTranslations client={service({ '': { items: [SAMPLING], next: null } }, asked)} />,
    );
    await screen.findByRole('table', { name: 'Translated components' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Language' }), 'de-DE');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Out of date');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    await vi.waitFor(() => {
      expect(Object.fromEntries(asked.at(-1)!)).toEqual({
        language: 'de-DE',
        status: 'outOfDate',
      });
    });
  });

  it('says when no translation matches the filters', async () => {
    render(<SpaceTranslations client={service({})} />);
    await screen.findByText(/No component of this space is translated yet/);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Status' }),
      'In translation',
    );
    expect(await screen.findByText('No translation of this space matches.')).toBeInTheDocument();
  });

  it('says when nothing is translated', async () => {
    render(<SpaceTranslations client={service({})} />);
    expect(
      await screen.findByText(/No component of this space is translated yet/),
    ).toBeInTheDocument();
  });

  it('says when there is no space to report on', async () => {
    const empty = vi.fn(async () =>
      json(200, { items: [], next: null }),
    ) as unknown as typeof fetch;
    render(
      <SpaceTranslations
        client={createApiClient({ baseUrl: 'http://report.test', fetch: empty })}
      />,
    );
    expect(
      await screen.findByText('There is no space you may read to report on.'),
    ).toBeInTheDocument();
  });
});
