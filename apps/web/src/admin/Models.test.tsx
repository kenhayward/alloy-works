import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Models } from './Models.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HOSTED = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const LOCAL = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
/** An invented key: it must never be shown back once it is sent. */
const KEY = 'sk-invented-0123456789';

const endpoint = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: 'Hosted drafting',
  protocol: 'anthropic',
  baseUrl: 'https://models.example.test',
  model: 'claude-test',
  contextWindow: 200_000,
  priceIn: 3,
  priceOut: 15,
  currency: 'USD',
  boundary: 'outside',
  madeAt: '2026-10-18T09:00:00.000Z',
  changedAt: '2026-10-18T09:00:00.000Z',
  retiredAt: null,
  key: { set: true, setBy: null, setAt: '2026-10-18T09:00:00.000Z', needsSetting: false },
  ...over,
});

/** The model endpoint routes, as the service answers them. */
function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  let routes: { purpose: string; endpoint: string | null }[] = [
    { purpose: 'drafting', endpoint: HOSTED },
    { purpose: 'chat', endpoint: null },
    { purpose: 'summarising', endpoint: null },
    { purpose: 'embedding', endpoint: null },
  ];
  const endpoints = [
    endpoint(HOSTED),
    endpoint(LOCAL, {
      name: 'Our own',
      protocol: 'openai',
      baseUrl: 'http://10.0.4.7:11434/v1',
      boundary: 'inside',
      key: { set: false },
    }),
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    asked.push({ method: request.method, path, body });
    const at = (each: { purpose: string }) => ({ ...each, setBy: null, setAt: null });
    if (request.method === 'GET' && path === '/v1/model-endpoints') {
      return json(200, { items: endpoints });
    }
    if (request.method === 'GET' && path === '/v1/model-routes') {
      return json(200, { items: routes.map(at) });
    }
    if (request.method === 'POST' && path === '/v1/model-endpoints') {
      return json(200, { endpoint: endpoint(LOCAL, body as Record<string, unknown>) });
    }
    if (request.method === 'PUT' && path === `/v1/model-endpoints/${LOCAL}/key`) {
      endpoints[1] = endpoint(LOCAL, {
        ...endpoints[1],
        key: { set: true, setBy: null, setAt: '', needsSetting: false },
      });
      return json(200, { endpoint: endpoints[1] });
    }
    if (request.method === 'POST' && path === `/v1/model-endpoints/${HOSTED}/test`) {
      return json(200, {
        run: '2c4e6a8b-1d3f-4a5b-8c7d-9e0f1a2b3c4d',
        outcome: 'passed',
        reply: 'ready.',
        model: 'claude-test-20260101',
        tokensIn: 12,
        tokensOut: 2,
        cost: '0.000066',
        ms: 840,
      });
    }
    if (request.method === 'PUT' && path.startsWith('/v1/model-routes/')) {
      const purpose = path.split('/').at(-1)!;
      routes = routes.map((each) =>
        each.purpose === purpose
          ? { purpose, endpoint: (body as { endpoint: string | null }).endpoint }
          : each,
      );
      return json(200, { items: routes.map(at) });
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

describe("Administration's Models (the G1 plan, G1-K)", () => {
  it('GEN-031 lists the endpoints, saying which sit outside the data boundary and whether each key is set', async () => {
    const { client } = service();
    render(<Models client={client} />);
    const table = await screen.findByRole('table', { name: 'Model endpoints' });
    const [, hosted, local] = within(table).getAllByRole('row');
    expect(within(hosted!).getByText('Outside your data boundary')).toBeVisible();
    expect(within(hosted!).getByText('Anthropic Messages')).toBeVisible();
    expect(within(local!).getByText('Inside')).toBeVisible();
    expect(within(local!).getByText('Not set')).toBeVisible();
    // An endpoint with no key cannot be tested.
    expect(within(local!).getByRole('button', { name: 'Test Our own' })).toBeDisabled();
  });

  it('GEN-031 refuses to add an endpoint until its data boundary is chosen', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Models client={client} />);
    await screen.findByRole('table', { name: 'Model endpoints' });
    await user.click(screen.getByRole('button', { name: 'Add an endpoint' }));
    const form = screen.getByRole('form', { name: 'Add an endpoint' });
    await user.type(within(form).getByLabelText('Name'), 'Summaries');
    await user.type(within(form).getByLabelText('Base URL'), 'https://models.example.test');
    await user.type(within(form).getByLabelText('Model'), 'claude-test');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Say whether this endpoint sits outside your data boundary.',
    );
    expect(asked.some((each) => each.method === 'POST')).toBe(false);
    await user.selectOptions(within(form).getByLabelText('Data boundary'), 'inside');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Summaries added.'));
    expect(asked.find((each) => each.method === 'POST')?.body).toMatchObject({
      name: 'Summaries',
      boundary: 'inside',
      contextWindow: 200000,
    });
  });

  it('GEN-029 sends a key once and keeps it nowhere on the page after', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Models client={client} />);
    await screen.findByRole('table', { name: 'Model endpoints' });
    await user.click(screen.getByRole('button', { name: 'Set the key for Our own' }));
    const form = screen.getByRole('form', { name: 'Set the key for Our own' });
    const field = within(form).getByLabelText('Key for Our own');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, KEY);
    await user.click(within(form).getByRole('button', { name: 'Save key' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('The key for Our own is set.'),
    );
    expect(asked.find((each) => each.path.endsWith('/key'))?.body).toEqual({ key: KEY });
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('GEN-029 never carries a key typed for one endpoint to another', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Models client={client} />);
    await screen.findByRole('table', { name: 'Model endpoints' });
    await user.click(screen.getByRole('button', { name: 'Set the key for Our own' }));
    await user.type(screen.getByLabelText('Key for Our own'), KEY);
    await user.click(screen.getByRole('button', { name: 'Set the key for Hosted drafting' }));
    expect(screen.getByLabelText('Key for Hosted drafting')).toHaveValue('');
  });

  it('tests an endpoint and says what it answered, as which model, in what time, and at what cost', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Models client={client} />);
    await screen.findByRole('table', { name: 'Model endpoints' });
    await user.click(screen.getByRole('button', { name: 'Test Hosted drafting' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Hosted drafting answered "ready." as claude-test-20260101 in 840 ms: 12 tokens in, 2 out, USD 0.000066.',
      ),
    );
  });

  it('GEN-028 sends each purpose to an endpoint that can be used, or turns it off', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Models client={client} />);
    const routes = await screen.findByRole('table', { name: 'Model routes' });
    const drafting = within(routes).getByRole('combobox', { name: 'Endpoint for Drafting' });
    expect(drafting).toHaveValue(HOSTED);
    // An endpoint without a key is not offered.
    const chat = within(routes).getByRole('combobox', { name: 'Endpoint for Chat' });
    expect(within(chat).queryByRole('option', { name: /Our own/ })).toBeNull();
    expect(
      within(chat).getByRole('option', { name: 'Hosted drafting, outside your data boundary' }),
    ).toBeInTheDocument();
    await user.selectOptions(drafting, '');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Drafting is off.'));
    expect(asked.find((each) => each.path === '/v1/model-routes/drafting')?.body).toEqual({
      endpoint: null,
    });
  });
});
