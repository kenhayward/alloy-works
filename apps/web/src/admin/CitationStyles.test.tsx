import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CitationStyles, Drawn } from './CitationStyles.js';

const HARVARD = 'a6c1e2f4-3b5d-4e7a-8c9b-1d2e3f4a5b6c';
const CSL = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">...</style>';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const run = (text: string, italic = false) => ({
  text,
  marks: italic ? [{ kind: 'emphasis' }] : [],
});

const preview = {
  title: 'Journal of Coastal Studies',
  problems: [],
  proposed: { book: ['publisher', 'title'] },
  sample: {
    citations: [[run('(Marlow, 2020a)')]],
    bibliography: [
      {
        entry: 'marlow-sediment',
        runs: [run('Marlow, A. (2020a) '), run('Sediment and its movement', true), run('.')],
      },
    ],
  },
};

const view = (id: string, name: string, number = '0.1') => ({
  id,
  version: { id: `${id.slice(0, 8)}-0000-4000-8000-000000000000`, number },
  style: { schemaVersion: 1, name, csl: CSL, requires: {} },
  seeded: id === HARVARD,
  mayEdit: true,
});

function service(answers: { refuse?: boolean; refusedPreview?: boolean } = {}) {
  const sent: { path: string; body: unknown }[] = [];
  let items = [
    { id: HARVARD, name: 'Harvard', seeded: true, version: { id: 'v1', number: '0.1' } },
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (answers.refuse) return json(403, { code: 'forbidden', message: 'This needs design.' });
    if (request.method === 'GET' && path === '/v1/citation-styles') return json(200, { items });
    if (request.method === 'GET' && path === `/v1/citation-styles/${HARVARD}`) {
      return json(200, view(HARVARD, 'Harvard'));
    }
    if (request.method === 'POST') {
      const body = await request.json();
      sent.push({ path, body });
      if (path === '/v1/citation-styles/preview') {
        return json(
          200,
          answers.refusedPreview
            ? {
                problems: [
                  {
                    rule: 'style_invalid',
                    path: 'csl',
                    message: 'The style declares no citation form',
                  },
                ],
                proposed: {},
                sample: null,
              }
            : preview,
        );
      }
      if (path === '/v1/citation-styles') {
        const made = view('b1b2b3b4-0000-4000-8000-000000000001', 'Journal of Coastal Studies');
        items = [
          ...items,
          { id: made.id, name: made.style.name, seeded: false, version: made.version },
        ];
        return json(200, made);
      }
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Citation styles", () => {
  it('STY-023 uploads a CSL file, previewing the sample entries in it and proposing what it requires', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<CitationStyles client={client} />);
    const table = await screen.findByRole('table', { name: 'Citation styles' });
    expect(within(table).getByText('Harvard')).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText('CSL file'),
      new File([CSL], 'coastal.csl', { type: 'application/xml' }),
    );
    const shown = await screen.findByRole('region', { name: 'Preview' });
    expect(within(shown).getByText('(Marlow, 2020a)')).toBeInTheDocument();
    expect(within(shown).getByText('Sediment and its movement').tagName).toBe('EM');
    expect(sent[0]).toEqual({ path: '/v1/citation-styles/preview', body: { csl: CSL } });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Journal of Coastal Studies');
    expect(
      JSON.parse(
        (screen.getByRole('textbox', { name: 'What each type requires' }) as HTMLTextAreaElement)
          .value,
      ),
    ).toEqual({ book: ['publisher', 'title'] });

    await user.click(screen.getByRole('button', { name: 'Add style' }));
    expect(sent[1]).toEqual({
      path: '/v1/citation-styles',
      body: {
        style: {
          schemaVersion: 1,
          name: 'Journal of Coastal Studies',
          csl: CSL,
          requires: { book: ['publisher', 'title'] },
        },
      },
    });
    expect(await screen.findByText('Journal of Coastal Studies is added, at 0.1.')).toBeVisible();
    expect(await within(table).findByText('Journal of Coastal Studies')).toBeInTheDocument();
  });

  it('says why a file would be refused, and adds nothing', async () => {
    const user = userEvent.setup();
    const { client, sent } = service({ refusedPreview: true });
    render(<CitationStyles client={client} />);
    await user.upload(
      await screen.findByLabelText('CSL file'),
      new File(['<style/>'], 'broken.csl', { type: 'application/xml' }),
    );
    expect(await screen.findByText('The style declares no citation form')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add style' })).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('previews a style the environment holds', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<CitationStyles client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Preview Harvard' }));
    const shown = await screen.findByRole('region', { name: 'Preview' });
    expect(within(shown).getByText('(Marlow, 2020a)')).toBeInTheDocument();
    expect(sent).toEqual([{ path: '/v1/citation-styles/preview', body: { csl: CSL } }]);
  });

  it('links a run only to an http or https address, never a script a style or entry names', () => {
    render(
      <Drawn
        run={{ text: 'unsafe', marks: [{ kind: 'hyperlink', href: 'javascript:alert(1)' }] }}
      />,
    );
    render(
      <Drawn
        run={{ text: 'safe', marks: [{ kind: 'hyperlink', href: 'https://example.org/a' }] }}
      />,
    );
    expect(screen.getByText('unsafe').closest('a')).toBeNull();
    const link = screen.getByRole('link', { name: 'safe' });
    expect(link).toHaveAttribute('href', 'https://example.org/a');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says so to somebody who may not read the environment', async () => {
    const { client } = service({ refuse: true });
    render(<CitationStyles client={client} />);
    expect(await screen.findByText('You may not manage access here.')).toBeInTheDocument();
  });
});
