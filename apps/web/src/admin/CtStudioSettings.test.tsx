import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CtStudioSettings } from './CtStudioSettings.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPACE = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const TEMPLATE = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const SCHEMA = '7c2e0d3f-8c4a-4f9b-8d6e-2a3b4c5d6e7f';
const OWNER_FIELD = '11111111-1111-4111-8111-111111111111';
const TYPE = '22222222-2222-4222-8222-222222222222';

interface Settings {
  componentType: string | null;
  template: string | null;
  propertyMap: Record<string, string | null>;
  data: boolean;
  connection: string | null;
  unlisted: { name: string; firstDelivered: string; lastDelivered: string; deliveries: number }[];
}

/** One space's settings, the tenant's templates and definitions, as the service answers them. */
function service(start: Partial<Settings> = {}, refuse?: unknown) {
  let settings: Settings = {
    componentType: null,
    template: null,
    propertyMap: {},
    data: false,
    connection: null,
    unlisted: [],
    ...start,
  };
  const sent: unknown[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (url === '/v1/templates') {
      return json(200, { items: [{ id: TEMPLATE, name: 'Report' }], next: null });
    }
    if (url === `/v1/templates/${TEMPLATE}`) {
      return json(200, {
        id: TEMPLATE,
        definition: { schemas: [{ schema: SCHEMA, level: 'document', requires: [] }] },
      });
    }
    if (url === '/v1/definitions') {
      return json(200, {
        items: [
          { id: TYPE, kind: 'componentType', name: 'Section', version: { id: 'v', number: '1' } },
          { id: OWNER_FIELD, kind: 'field', name: 'Owner', version: { id: 'v', number: '1' } },
        ],
        next: null,
      });
    }
    if (url === `/v1/definitions/${SCHEMA}`) {
      return json(200, {
        id: SCHEMA,
        kind: 'metadataSchema',
        definition: { entries: [{ field: OWNER_FIELD, required: false, fixed: false }] },
      });
    }
    if (url === `/v1/spaces/${SPACE}/bridge-settings`) {
      if (request.method === 'PUT') {
        const body = (await request.json()) as Omit<Settings, 'connection' | 'unlisted'>;
        sent.push(body);
        if (refuse !== undefined) return json(422, refuse);
        settings = {
          ...settings,
          ...body,
          unlisted: settings.unlisted.filter((each) => !(each.name in body.propertyMap)),
        };
      }
      return json(200, settings);
    }
    return json(404, {});
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

const at = '2026-10-30T09:00:00.000Z';

describe("a space's CT Studio settings", () => {
  it('API-076 a row maps a typed property to a template field or to ignore', async () => {
    const { client, sent } = service({ template: TEMPLATE });
    render(<CtStudioSettings client={client} space={SPACE} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a property' }));
    await screen.findByRole('option', { name: 'Owner' });
    await userEvent.type(screen.getByLabelText('CT Studio property 1'), 'Owner');
    await userEvent.selectOptions(screen.getByLabelText('Fills 1'), 'Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Add a property' }));
    await userEvent.type(screen.getByLabelText('CT Studio property 2'), 'Draft');
    await userEvent.selectOptions(screen.getByLabelText('Fills 2'), 'Ignore');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(sent).toEqual([
      {
        componentType: null,
        template: TEMPLATE,
        propertyMap: { Owner: OWNER_FIELD, Draft: null },
        data: false,
      },
    ]);
  });

  it('API-076 with no template, ignore is the only choice', async () => {
    const { client } = service();
    render(<CtStudioSettings client={client} space={SPACE} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a property' }));
    const fills = screen.getByLabelText('Fills 1');
    expect(
      within(fills)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Ignore']);
  });

  it('API-076 an unlisted property can be mapped or ignored from its list', async () => {
    const { client, sent } = service({
      template: TEMPLATE,
      unlisted: [
        { name: 'Owner', firstDelivered: at, lastDelivered: at, deliveries: 3 },
        { name: 'Draft', firstDelivered: at, lastDelivered: at, deliveries: 1 },
      ],
    });
    render(<CtStudioSettings client={client} space={SPACE} />);
    const list = await screen.findByRole('table', { name: 'Unlisted properties' });
    expect(within(list).getAllByRole('row')).toHaveLength(3);
    const map = screen.getByRole('button', { name: 'Map Owner to a field' });
    await waitFor(() => expect(map).toBeEnabled());
    await userEvent.click(map);
    await userEvent.selectOptions(screen.getByLabelText('Fills 1'), 'Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Ignore Draft' }));
    expect(screen.queryByRole('table', { name: 'Unlisted properties' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(sent).toEqual([
      {
        componentType: null,
        template: TEMPLATE,
        propertyMap: { Owner: OWNER_FIELD, Draft: null },
        data: false,
      },
    ]);
  });

  it('API-076 a refusal shows against its row', async () => {
    const { client } = service(
      { template: TEMPLATE, propertyMap: { Owner: OWNER_FIELD } },
      {
        code: 'bridge_settings_invalid',
        message: 'These settings name something this environment does not have.',
        problems: [{ path: 'propertyMap.Owner', reason: 'field_not_in_template' }],
      },
    );
    render(<CtStudioSettings client={client} space={SPACE} />);
    await screen.findByDisplayValue('Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Owner names a field this template does not give a document.'),
    ).toBeInTheDocument();
  });

  it('in the flow it saves nothing and gives its settings as they change', async () => {
    const { client, sent } = service();
    const given: unknown[] = [];
    render(
      <CtStudioSettings
        client={client}
        space={SPACE}
        mode="flow"
        onChange={(body) => given.push(body)}
      />,
    );
    await userEvent.click(await screen.findByLabelText('Deliver data tables to this space'));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(given.at(-1)).toEqual({
      componentType: null,
      template: null,
      propertyMap: {},
      data: true,
    });
    expect(sent).toEqual([]);
  });
});
