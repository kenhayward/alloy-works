import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Vocabularies } from './Vocabularies.js';

const PHASE = 'c3d4e5f6-0000-4000-8000-000000000001';
const SITES = 'c3d4e5f6-0000-4000-8000-000000000002';
const OPENED = 'd1d2d3d4-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const value = (
  id: string,
  labels: Record<string, string>,
  rest: { state?: 'active' | 'deprecated' | 'retired'; replacedBy?: string } = {},
) => ({
  id,
  labels: Object.entries(labels).map(([language, text]) => ({ language, text })),
  descriptions: [],
  state: rest.state ?? 'active',
  ...(rest.replacedBy === undefined ? {} : { replacedBy: rest.replacedBy }),
});

const phase = {
  schemaVersion: 1,
  id: PHASE,
  name: 'Trial phase',
  key: 'trial_phase',
  base: 'en',
  order: 'declared',
  values: [
    value('one', { en: 'Phase one', fr: 'Phase un' }),
    value('two', { en: 'Phase two' }),
    value('pilot', { en: 'Pilot' }),
  ],
};

const sites = {
  schemaVersion: 1,
  id: SITES,
  name: 'Trial site',
  key: 'trial_site',
  base: 'en',
  order: 'label',
  values: [value('zurich', { en: 'Zurich' }), value('aberdeen', { en: 'Aberdeen' })],
};

type Saving = 'ok' | 'conflict' | 'refused';

function service(options: { manages?: boolean; saving?: Saving } = {}) {
  const sent: { path: string; body: unknown }[] = [];
  const held = new Map<string, typeof phase>([
    [PHASE, phase],
    [SITES, sites],
  ]);
  const view = (id: string, number = '0.1') => ({
    id,
    version: { id: OPENED, number },
    vocabulary: held.get(id),
  });
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') {
      if (path === '/v1/access') {
        return json(200, {
          target: 'tenant',
          permissions: [{ permission: 'manage_definitions', allowed: options.manages !== false }],
        });
      }
      if (path === '/v1/vocabularies') {
        return json(200, {
          items: [...held.values()].map((each) => ({
            id: each.id,
            key: each.key,
            name: each.name,
            version: { id: OPENED, number: '0.1' },
            values: each.values.length,
          })),
        });
      }
      const exported = /^\/v1\/vocabularies\/([0-9a-f-]+)\/export$/.exec(path);
      if (exported) return json(200, { format: 'json-ld', text: '{"@graph":[]}' });
      const one = /^\/v1\/vocabularies\/([0-9a-f-]+)$/.exec(path);
      if (one && held.has(one[1]!)) return json(200, view(one[1]!));
    }
    if (request.method === 'POST') {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({ path, body });
      if (path === '/v1/definitions') {
        const made = {
          ...(body['definition'] as typeof phase),
          id: 'c3d4e5f6-0000-4000-8000-000000000003',
        };
        held.set(made.id, made);
        return json(200, {
          id: made.id,
          kind: 'vocabulary',
          version: { id: OPENED, number: '0.1' },
          definition: made,
        });
      }
      if (path === `/v1/definitions/${PHASE}/versions`) {
        if (options.saving === 'conflict') {
          return json(409, {
            code: 'version_precondition',
            message: 'This definition has a newer version than the one this page opened.',
            traceId: 't',
          });
        }
        if (options.saving === 'refused') {
          return json(400, {
            code: 'definition_invalid',
            message: 'This definition is refused: each failure says why.',
            traceId: 't',
            failures: [
              {
                code: 'metadata.fixed',
                field: 'pilot',
                rule: 'fixed',
                schemas: [],
                detail: 'A vocabulary keeps every value: retire pilot rather than remove it',
              },
            ],
          });
        }
        held.set(PHASE, { ...(body['definition'] as typeof phase), id: PHASE });
        return json(200, {
          id: PHASE,
          kind: 'vocabulary',
          version: { id: 'd1d2d3d4-0000-4000-8000-000000000002', number: '0.2' },
          definition: held.get(PHASE),
        });
      }
      if (path === '/v1/vocabularies/import') {
        return json(200, {
          answer: 'recorded',
          vocabulary: view(PHASE, '0.2'),
          kept: ['pilot'],
          notRepresented: ['urn:x:odd: a concept with no notation'],
          notRepresentedTotal: 3,
        });
      }
    }
    return json(404, { code: 'not_found', message: 'Not found', traceId: 't' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

/** The values as listed, each by its legend. */
const valuesShown = () =>
  within(screen.getByRole('list', { name: 'Values' }))
    .getAllByRole('group')
    .map((each) => each.getAttribute('aria-label'));

const opened = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `Open ${name}` }));
  return screen.findByRole('region', { name });
};

/** What the last version recorded carried. */
const savedValues = (sent: { path: string; body: unknown }[]) =>
  (sent.at(-1)!.body as { definition: typeof phase }).definition.values;

describe("Administration's Vocabularies", () => {
  it('lists every vocabulary with its key, how many values it holds and its version', async () => {
    const { client } = service();
    render(<Vocabularies client={client} />);
    const table = await screen.findByRole('table', { name: 'Vocabularies' });
    expect(
      within(table).getByRole('row', { name: /^Trial phase trial_phase 3 0\.1/ }),
    ).toBeVisible();
    expect(within(table).getByRole('row', { name: /^Trial site trial_site 2 0\.1/ })).toBeVisible();
  });

  it('makes a vocabulary with a name, a key, a base language and an order, then opens it', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New vocabulary' }));
    const form = screen.getByRole('form', { name: 'New vocabulary' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Dosage form');
    await user.type(within(form).getByRole('textbox', { name: 'Key' }), 'dosage_form');
    await user.clear(within(form).getByRole('textbox', { name: 'Base language' }));
    await user.type(within(form).getByRole('textbox', { name: 'Base language' }), 'fr');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Order' }), 'By label');
    await user.click(within(form).getByRole('button', { name: 'Make vocabulary' }));
    expect(sent[0]).toEqual({
      path: '/v1/definitions',
      body: {
        kind: 'vocabulary',
        definition: {
          schemaVersion: 1,
          name: 'Dosage form',
          key: 'dosage_form',
          base: 'fr',
          order: 'label',
          values: [],
        },
      },
    });
    expect(await screen.findByRole('region', { name: 'Dosage form' })).toBeVisible();
  });

  it('LIB-024 shows each value labelled in each language, and adds a label in another', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    const one = within(shown).getByRole('group', { name: 'Phase one (one)' });
    expect(within(one).getByRole('textbox', { name: 'Label in en' })).toHaveValue('Phase one');
    expect(within(one).getByRole('textbox', { name: 'Label in fr' })).toHaveValue('Phase un');

    await user.type(within(one).getByRole('textbox', { name: 'Language of a new label' }), 'de');
    await user.type(within(one).getByRole('textbox', { name: 'New label' }), 'Phase eins');
    await user.click(within(one).getByRole('button', { name: 'Add label' }));
    expect(within(one).getByRole('textbox', { name: 'Label in de' })).toHaveValue('Phase eins');
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved, at 0.2.');
    expect(savedValues(sent)[0]!.labels).toEqual([
      { language: 'en', text: 'Phase one' },
      { language: 'fr', text: 'Phase un' },
      { language: 'de', text: 'Phase eins' },
    ]);
  });

  it('LIB-053 shows the values in their declared order, and moves one up and down by its buttons', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    expect(valuesShown()).toEqual(['Phase one (one)', 'Phase two (two)', 'Pilot (pilot)']);
    expect(within(shown).getByRole('button', { name: 'Move Phase one up' })).toBeDisabled();

    await user.click(within(shown).getByRole('button', { name: 'Move Pilot up' }));
    await user.click(within(shown).getByRole('button', { name: 'Move Pilot up' }));
    expect(valuesShown()).toEqual(['Pilot (pilot)', 'Phase one (one)', 'Phase two (two)']);
    await user.click(within(shown).getByRole('button', { name: 'Move Phase one down' }));
    expect(valuesShown()).toEqual(['Pilot (pilot)', 'Phase two (two)', 'Phase one (one)']);

    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved, at 0.2.');
    expect(sent.at(-1)!.path).toBe(`/v1/definitions/${PHASE}/versions`);
    expect((sent.at(-1)!.body as { openedFrom: string }).openedFrom).toBe(OPENED);
    expect(savedValues(sent).map((each) => each.id)).toEqual(['pilot', 'two', 'one']);
  });

  it('LIB-053 shows a vocabulary ordered by label in that order, with nothing to move', async () => {
    const { client } = service();
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial site');
    expect(valuesShown()).toEqual(['Aberdeen (aberdeen)', 'Zurich (zurich)']);
    expect(within(shown).queryByRole('button', { name: /^Move / })).toBeNull();
  });

  it('adds a value by its id and its label in the base language, and never offers to delete one', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    expect(within(shown).getByText(/A value is never deleted/)).toBeVisible();
    expect(within(shown).queryByRole('button', { name: /delete|remove pilot/i })).toBeNull();

    await user.type(within(shown).getByRole('textbox', { name: 'Id of the new value' }), 'three');
    await user.type(
      within(shown).getByRole('textbox', { name: 'Label of the new value' }),
      'Phase three',
    );
    await user.click(within(shown).getByRole('button', { name: 'Add value' }));
    expect(valuesShown().at(-1)).toBe('Phase three (three)');
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved, at 0.2.');
    expect(savedValues(sent).at(-1)).toEqual(value('three', { en: 'Phase three' }));
  });

  it('LIB-055 deprecates a value naming its replacement from the others, and retires another', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    const pilot = within(shown).getByRole('group', { name: 'Pilot (pilot)' });
    await user.selectOptions(within(pilot).getByRole('combobox', { name: 'State' }), 'Deprecated');
    const replacement = within(pilot).getByRole('combobox', { name: 'Replaced by' });
    expect(
      within(replacement)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['No replacement', 'Phase one', 'Phase two']);
    await user.selectOptions(replacement, 'Phase one');
    const two = within(shown).getByRole('group', { name: 'Phase two (two)' });
    await user.selectOptions(within(two).getByRole('combobox', { name: 'State' }), 'Retired');
    expect(within(two).queryByRole('combobox', { name: 'Replaced by' })).toBeNull();

    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved, at 0.2.');
    expect(savedValues(sent)).toEqual([
      value('one', { en: 'Phase one', fr: 'Phase un' }),
      value('two', { en: 'Phase two' }, { state: 'retired' }),
      value('pilot', { en: 'Pilot' }, { state: 'deprecated', replacedBy: 'one' }),
    ]);

    // Reactivated, it names no replacement.
    await user.selectOptions(within(pilot).getByRole('combobox', { name: 'State' }), 'Active');
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savedValues(sent)[2]).toEqual(value('pilot', { en: 'Pilot' })));
  });

  it('says, by value, what the page refuses before it sends, and each failure the service names', async () => {
    const user = userEvent.setup();
    const { client, sent } = service({ saving: 'refused' });
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    const one = within(shown).getByRole('group', { name: 'Phase one (one)' });
    await user.clear(within(one).getByRole('textbox', { name: 'Label in en' }));
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    const why = await within(shown).findByRole('list', { name: 'Why it was not saved' });
    expect(within(why).getByText(/^one: /)).toBeVisible();
    expect(sent).toHaveLength(0);

    await user.type(within(one).getByRole('textbox', { name: 'Label in en' }), 'Phase one');
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    expect(
      await within(shown).findByText(
        'pilot: A vocabulary keeps every value: retire pilot rather than remove it',
      ),
    ).toBeVisible();
    expect(screen.getByText('This definition is refused: each failure says why.')).toBeVisible();
  });

  it('says somebody else saved the vocabulary since it was opened', async () => {
    const user = userEvent.setup();
    const { client } = service({ saving: 'conflict' });
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    await user.click(within(shown).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Somebody else saved this vocabulary after you opened it. Open it again to see theirs; what you changed here is not saved.',
      ),
    ).toBeVisible();
  });

  it('shows somebody who may not manage definitions every vocabulary, and nothing to change', async () => {
    const { client } = service({ manages: false });
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    expect(within(shown).getByText('Phase un (fr)')).toBeVisible();
    expect(within(shown).queryByRole('textbox')).toBeNull();
    expect(within(shown).queryByRole('combobox')).toBeNull();
    expect(within(shown).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(shown).queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New vocabulary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });

  it('exports a vocabulary as SKOS JSON-LD, saved as a file', async () => {
    const user = userEvent.setup();
    const { client } = service();
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:vocabulary';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<Vocabularies client={client} />);
    const shown = await opened('Trial phase');
    await user.click(within(shown).getByRole('button', { name: 'Export as SKOS' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(await saved[0]!.text()).toBe('{"@graph":[]}');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('trial_phase.jsonld');
    click.mockRestore();
  });

  it('imports SKOS pasted as Turtle, saying what it came to, what it kept and what it could not hold', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Vocabularies client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const form = screen.getByRole('form', { name: 'Import a vocabulary' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Format' }), 'SKOS Turtle');
    await user.type(within(form).getByRole('textbox', { name: 'SKOS' }), '@prefix skos: <x> .');
    await user.click(within(form).getByRole('button', { name: 'Import vocabulary' }));
    expect(sent[0]).toEqual({
      path: '/v1/vocabularies/import',
      body: { format: 'turtle', text: '@prefix skos: <x> .' },
    });
    const answer = await screen.findByRole('region', { name: 'Imported' });
    expect(within(answer).getByText('Trial phase is recorded, at 0.2.')).toBeVisible();
    expect(within(answer).getByText('Kept, as every value is: pilot')).toBeVisible();
    expect(within(answer).getByText('3 things could not be represented:')).toBeVisible();
    expect(within(answer).getByText('urn:x:odd: a concept with no notation')).toBeVisible();
  });
});
