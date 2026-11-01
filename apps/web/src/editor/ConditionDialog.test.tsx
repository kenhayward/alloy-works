import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ALTERNATIVE_SAID, ConditionDialog } from './ConditionDialog.js';
import { phaseAxisAnswer } from './test/phaseAxis.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const version = { id: '00000000-0000-4000-8000-0000000000f1', number: '0.1' };
const AUDIENCE = '00000000-0000-4000-8000-0000000000a1';

/** The environment's one axis, Audience, beside a field the dialog leaves out. */
function service() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/definitions') {
      return json(200, {
        items: [
          { id: 'f1', kind: 'field', name: 'Next review', version },
          { id: AUDIENCE, kind: 'conditionAxis', name: 'Audience', key: 'audience', version },
        ],
        next: null,
      });
    }
    if (url.pathname === `/v1/definitions/${AUDIENCE}`) {
      return json(200, {
        id: AUDIENCE,
        kind: 'conditionAxis',
        version: { id: version.id, number: '0.1' },
        definition: {
          name: 'Audience',
          key: 'audience',
          values: [
            { key: 'regulator', label: 'Regulator' },
            { key: 'internal', label: 'Internal' },
          ],
        },
      });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://conditions.test', fetch: fetching });
}

describe('the Condition dialog (the R6 plan, R6-H)', () => {
  it('REU-021 sets a condition chosen from the declared axes and their values', async () => {
    const set = vi.fn();
    render(
      <ConditionDialog
        client={service()}
        held={[]}
        onSet={set}
        onAlternative={() => undefined}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Regulator' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set condition' }));
    expect(set).toHaveBeenCalledWith({ axis: 'audience', values: ['regulator'] });
    // Nothing to add an alternative to, or to take off.
    expect(screen.queryByRole('button', { name: 'Add alternative' })).toBeNull();
  });

  it('REU-047 offers an alternative for the other values where the text is already conditioned, saying what it is for', async () => {
    const alternative = vi.fn();
    const removed = vi.fn();
    render(
      <ConditionDialog
        client={service()}
        held={[{ axis: 'audience', values: ['regulator'] }]}
        onSet={() => undefined}
        onAlternative={alternative}
        onRemove={removed}
        onCancel={() => undefined}
      />,
    );
    expect(await screen.findByText(ALTERNATIVE_SAID())).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Regulator' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Add alternative' }));
    expect(alternative).toHaveBeenCalledWith({ axis: 'audience', values: ['internal'] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove condition' }));
    expect(removed).toHaveBeenCalledWith('audience');
  });
});

/** The one axis, Phase, drawing on a vocabulary (VO-E). */
function vocabularyService() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return phaseAxisAnswer(new URL(request.url).pathname) ?? json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://conditions.test', fetch: fetching });
}

describe('the Condition dialog on an axis drawing on a vocabulary (the VO plan, VO-E, VO-F)', () => {
  it("offers the vocabulary's values by label, a deprecated one marked with its replacement and a retired one never", async () => {
    const set = vi.fn();
    render(
      <ConditionDialog
        client={vocabularyService()}
        held={[]}
        onSet={set}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await screen.findByRole('checkbox', { name: 'Phase I' });
    expect(
      screen.getAllByRole('checkbox').map((each) => each.closest('label')?.textContent),
    ).toEqual(['Phase I', 'Early (deprecated: use Phase I)']);
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Early (deprecated: use Phase I)' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set condition' }));
    expect(set).toHaveBeenCalledWith({ axis: 'phase', values: ['early'] });
  });

  it('shows a retired value the text already carries, marked, and offers no alternative for it', async () => {
    const alternative = vi.fn();
    render(
      <ConditionDialog
        client={vocabularyService()}
        held={[{ axis: 'phase', values: ['pilot'] }]}
        onSet={() => undefined}
        onAlternative={alternative}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: 'Pilot (retired)' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Add alternative' }));
    expect(alternative).toHaveBeenCalledWith({ axis: 'phase', values: ['one', 'early'] });
  });
});

const SITES = '00000000-0000-4000-8000-0000000000d2';
const SITE = '00000000-0000-4000-8000-0000000000a3';

/** One axis, Site, drawing on a vocabulary of `values`, its base language French. */
function siteService(values: readonly unknown[]) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/definitions') {
      return json(200, {
        items: [{ id: SITE, kind: 'conditionAxis', name: 'Site', key: 'site', version }],
        next: null,
      });
    }
    if (path === `/v1/definitions/${SITE}`) {
      return json(200, {
        id: SITE,
        kind: 'conditionAxis',
        version,
        definition: { name: 'Site', key: 'site', vocabulary: SITES },
      });
    }
    if (path === `/v1/vocabularies/${SITES}`) {
      return json(200, {
        version,
        vocabulary: {
          schemaVersion: 1,
          id: SITES,
          name: 'Sites',
          key: 'site',
          base: 'fr',
          order: 'declared',
          values,
        },
      });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://conditions.test', fetch: fetching });
}

const site = (id: string, en: string, descriptions: { language: string; text: string }[] = []) => ({
  id,
  labels: [
    { language: 'fr', text: `${en} (fr)` },
    { language: 'en', text: en },
  ],
  descriptions,
  state: 'active',
});

describe('the Condition dialog choosing vocabulary values as the field form does (the VO plan, VO-F)', () => {
  it("LIB-054 shows each axis value's description where it is chosen", async () => {
    render(
      <ConditionDialog
        client={siteService([
          site('north', 'North', [
            { language: 'fr', text: 'Au nord' },
            { language: 'en', text: 'Above the river' },
          ]),
          site('south', 'South', [{ language: 'fr', text: 'Au sud' }]),
          site('east', 'East'),
        ])}
        held={[]}
        onSet={() => undefined}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // In the reader's language, the base language's where it has none.
    expect(await screen.findByRole('checkbox', { name: 'North' })).toHaveAccessibleDescription(
      'Above the river',
    );
    expect(screen.getByRole('checkbox', { name: 'South' })).toHaveAccessibleDescription('Au sud');
    expect(screen.getByRole('checkbox', { name: 'East' })).toHaveAccessibleDescription('');
  });

  it('LIB-063 says at once that a chosen deprecated axis value is deprecated, naming its replacement, and offers Use replacement', async () => {
    const set = vi.fn();
    render(
      <ConditionDialog
        client={vocabularyService()}
        held={[]}
        onSet={set}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const early = await screen.findByRole('checkbox', { name: 'Early (deprecated: use Phase I)' });
    expect(screen.queryByRole('button', { name: /^Use replacement/ })).toBeNull();
    await userEvent.click(early);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Early is deprecated: use Phase I instead',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use replacement, Phase I' }));
    expect(early).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Phase I' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'Set condition' }));
    expect(set).toHaveBeenCalledWith({ axis: 'phase', values: ['one'] });
  });

  it('searches an axis of more than twenty values as it is typed, each chosen kept as a checkbox', async () => {
    const set = vi.fn();
    const cancelled = vi.fn();
    render(
      <ConditionDialog
        client={siteService(
          Array.from({ length: 25 }, (_, n) =>
            site(
              `s${n + 1}`,
              `Site ${n + 1}`,
              n === 23 ? [{ language: 'en', text: 'By the sea' }] : [],
            ),
          ),
        )}
        held={[]}
        onSet={set}
        onRemove={() => undefined}
        onCancel={cancelled}
      />,
    );
    const search = await screen.findByRole('combobox', { name: 'Find a value' });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await userEvent.type(search, 'site 2');
    const offered = screen.getByRole('listbox', { name: 'Site' });
    expect(within(offered).getAllByRole('option')).toHaveLength(7);
    await userEvent.type(search, '4');
    expect(
      within(offered)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Site 24 By the sea']);
    // Escape shuts the list, not the dialog.
    await userEvent.keyboard('{Escape}');
    expect(cancelled).not.toHaveBeenCalled();
    await userEvent.type(search, 'site 24{Enter}');
    expect(screen.getByRole('checkbox', { name: 'Site 24' })).toBeChecked();
    expect(search).toHaveValue('');
    await userEvent.type(search, 'site 3{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Set condition' }));
    expect(set).toHaveBeenCalledWith({ axis: 'site', values: ['s24', 's3'] });
  });
});
