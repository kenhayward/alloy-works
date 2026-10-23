import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpaceTranslations } from './SpaceTranslations.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
const POND = 'cccccccc-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(report: unknown) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (url === '/v1/spaces') {
      return json(200, { items: [{ id: SPACE, name: 'General' }], next: null });
    }
    if (url === `/v1/spaces/${SPACE}/translations`) return json(200, report);
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://report.test', fetch: fetching });
}

describe('a space’s translations (the TR plan, TR-M)', () => {
  it('reports each translated component of a space with each language’s status', async () => {
    render(
      <SpaceTranslations
        client={service({
          items: [
            {
              component: { id: POND, title: 'Sampling' },
              translations: [
                { language: 'fr-FR', status: { status: 'translated' } },
                { language: 'de-DE', status: { status: 'outOfDate', retranslate: true } },
              ],
            },
          ],
          capped: false,
        })}
      />,
    );
    const table = await screen.findByRole('table', { name: 'Translated components' });
    const row = within(table).getByRole('row', { name: /Sampling/ });
    expect(within(row).getByRole('link', { name: 'Sampling' })).toHaveAttribute(
      'href',
      `#/components/${POND}`,
    );
    expect(row).toHaveTextContent('fr-FR: Translated; de-DE: Out of date, needs retranslating');
  });

  it('says when nothing is translated', async () => {
    render(<SpaceTranslations client={service({ items: [], capped: false })} />);
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
