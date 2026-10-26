import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LinesControl } from '../lifecycle/Lines.js';
import { sourceOf, TranslationsButton } from './Translations.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const POND = 'cccccccc-0000-4000-8000-000000000001';
const FR = '11111111-1111-4111-8111-111111111111';
const DE = '22222222-2222-4222-8222-222222222222';
const SOURCE = { id: 'eeeeeeee-0000-4000-8000-000000000002', number: '1.2' };
const EARLIER = { id: 'eeeeeeee-0000-4000-8000-000000000001', number: '1.1' };

function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? undefined : ((await request.json()) as unknown);
    asked.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === `/v1/components/${POND}/translations` && request.method === 'GET') {
      return json(200, {
        source: { language: 'en-GB', latest: SOURCE },
        translations: [
          {
            line: FR,
            language: 'fr-FR',
            head: { id: 'ffffffff-0000-4000-8000-000000000001', number: 'fr-FR 1.1' },
            translates: EARLIER,
            status: { status: 'outOfDate', retranslate: true },
          },
          {
            line: DE,
            language: 'de-DE',
            head: null,
            translates: null,
            status: { status: 'untranslated' },
          },
        ],
      });
    }
    if (url.pathname === `/v1/components/${POND}/translations` && request.method === 'POST') {
      return json(200, {
        line: 'aaaaaaaa-0000-4000-8000-000000000003',
        language: 'es-ES',
        head: null,
        translates: null,
        status: { status: 'untranslated' },
      });
    }
    if (url.pathname === `/v1/components/${POND}/translations/${FR}/source-changes`) {
      return json(200, {
        translates: EARLIER,
        current: SOURCE,
        changes: [{ block: 'b1', change: 'changed', words: 'Twelve ponds were sampled.' }],
      });
    }
    if (url.pathname === `/v1/components/${POND}/translations/${FR}/current`) {
      return json(200, {});
    }
    if (url.pathname === `/v1/components/${POND}/versions/${SOURCE.id}/retranslate`) {
      return json(200, { version: SOURCE.id, retranslate: false });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://translations.test', fetch: fetching }),
    asked,
  };
}

describe('translations on a component page (the TR plan, TRa)', () => {
  it('lists each translation with its status, and begins one by whoever may edit', async () => {
    const { client, asked } = service();
    const go = vi.fn();
    render(
      <TranslationsButton
        client={client}
        componentId={POND}
        line={undefined}
        mayEdit
        translatable
        onGo={go}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Translations' }));
    const listed = await screen.findByRole('list', { name: 'Translations' });
    expect(
      within(listed)
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual(['fr-FR: Out of date, needs retranslating, translates 1.1', 'de-DE: Untranslated']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Language' }), 'es-ES');
    await userEvent.click(screen.getByRole('button', { name: 'Begin a translation' }));
    expect(asked.at(-1)).toMatchObject({ method: 'POST', body: { language: 'es-ES' } });
    expect(go).toHaveBeenCalledWith(
      `#/components/${POND}/lines/aaaaaaaa-0000-4000-8000-000000000003`,
    );
  });

  it('LOC-031 lets whoever may edit declare the source version needs no retranslation', async () => {
    const { client, asked } = service();
    render(
      <TranslationsButton
        client={client}
        componentId={POND}
        line={undefined}
        mayEdit
        translatable
        onGo={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Translations' }));
    await userEvent.click(await screen.findByRole('button', { name: 'No retranslation needed' }));
    expect(asked.find((each) => each.method === 'PUT')).toEqual({
      method: 'PUT',
      path: `/v1/components/${POND}/versions/${SOURCE.id}/retranslate`,
      body: { retranslate: false },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This version needs no retranslation.',
    );
  });

  it('LOC-040 shows a translator the source words changed since, and marks it current against the latest', async () => {
    const { client, asked } = service();
    render(
      <TranslationsButton
        client={client}
        componentId={POND}
        line={FR}
        mayEdit
        translatable
        onGo={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Translations' }));
    const changes = await screen.findByRole('region', { name: 'Source changes' });
    expect(await within(changes).findByText('Twelve ponds were sampled.')).toBeInTheDocument();
    // On a language line nothing is begun or declared: those are the source's.
    expect(screen.queryByRole('button', { name: 'Begin a translation' })).toBeNull();
    await userEvent.click(within(changes).getByRole('button', { name: 'Mark current' }));
    expect(asked.find((each) => each.path.endsWith('/current'))?.body).toEqual({
      translates: SOURCE.id,
    });
  });

  it('keeps a translation out of the Line chooser, and reads the source a language line names', () => {
    render(
      <LinesControl
        client={service().client}
        componentId={POND}
        line={undefined}
        lines={[
          {
            id: FR,
            name: 'fr-FR',
            divergedFrom: { revision: 1, version: EARLIER.id },
            at: '2026-10-23T09:00:00.000Z',
            closed: false,
            language: 'fr-FR',
          },
        ]}
        revision={null}
        mayEdit={false}
        onGo={vi.fn()}
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Line' })).toBeNull();
    expect(sourceOf({ source: SOURCE })).toBe(SOURCE.id);
    expect(sourceOf({})).toBeUndefined();
  });
});

describe('a machine draft on a translation (the XL plan, XLc)', () => {
  it('LOC-023 LOC-024 drafts a translation by machine, says the terms it missed, and accepts it', async () => {
    let drafted = false;
    let accepted = false;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === `/v1/components/${POND}/translations` && request.method === 'GET') {
        return json(200, {
          source: { language: 'en-GB', latest: SOURCE },
          translations: [
            {
              line: FR,
              language: 'fr-FR',
              head: drafted ? { id: SOURCE.id, number: 'fr-FR 1.1' } : null,
              translates: drafted ? SOURCE : null,
              status: {
                status:
                  drafted && !accepted ? 'machineDrafted' : drafted ? 'translated' : 'untranslated',
              },
              machine:
                drafted && !accepted
                  ? {
                      version: { id: SOURCE.id, number: 'fr-FR 1.1' },
                      missedTerms: [
                        { term: 'aaaaaaaa-0000-4000-8000-0000000000aa', label: 'pond' },
                      ],
                    }
                  : null,
            },
          ],
        });
      }
      if (url.pathname.endsWith('/machine-draft/accept')) {
        accepted = true;
        return json(200, {});
      }
      return json(404, {});
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://translations.test', fetch: fetching });
    const streamed: string[] = [];
    const stream = vi.fn(
      async (options: { url: string; onEvent: (event: string, data: unknown) => void }) => {
        streamed.push(options.url);
        options.onEvent('run', { run: 'r1' });
        options.onEvent('drafted', {
          version: { id: SOURCE.id, number: 'fr-FR 1.1' },
          missedTerms: [],
        });
        options.onEvent('ended', { outcome: 'finished' });
        drafted = true;
        return { kind: 'streamed' as const };
      },
    );
    render(
      <TranslationsButton
        client={client}
        componentId={POND}
        line={FR}
        mayEdit
        translatable
        onGo={vi.fn()}
        stream={stream}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Translations' }));
    const machine = await screen.findByRole('region', { name: 'Machine draft' });
    await userEvent.click(within(machine).getByRole('button', { name: 'Draft by machine' }));
    expect(streamed).toEqual([`/v1/components/${POND}/translations/${FR}/machine-draft`]);
    expect(
      await within(machine).findByText(
        'Drafted by machine as fr-FR 1.1. It is not published until a person accepts it.',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Version fr-FR 1.1 was drafted by machine and waits to be accepted.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not translated by their labels: pond.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept the machine draft' }));
    expect(await screen.findByText('The machine draft is accepted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the machine draft' })).toBeNull();
  });
});
