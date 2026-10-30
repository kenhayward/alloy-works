import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CtStudio, defaultAddress, defaultSinkId, sinkEntry } from './CtStudio.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GENERAL = { id: '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41', name: 'General' };
const QUALITY = { id: '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d', name: 'Quality' };
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const BY_HAND = '33333333-3333-4333-8333-333333333333';
const SOON = '44444444-4444-4444-8444-444444444444';
const LATER = '55555555-5555-4555-8555-555555555555';
const TOKEN = '66666666-6666-4666-8666-666666666666';
const DAY = 86_400_000;

interface Status {
  bridgeOn: boolean;
  identity: { id: string; name: string; disabled: boolean } | null;
  token: { id: string; name: string; expiresAt: string } | null;
  spaces: { id: string; name: string; granted: boolean; data: boolean }[];
  hostnames: string[];
  address: string | null;
  sinkId: string | null;
}

const fresh: Status = {
  bridgeOn: true,
  identity: null,
  token: null,
  spaces: [],
  hostnames: ['dev.acme.localhost'],
  address: null,
  sinkId: null,
};
const connected: Status = {
  ...fresh,
  identity: { id: IDENTITY, name: 'CT Studio deliveries', disabled: false },
  token: {
    id: TOKEN,
    name: 'CT Studio',
    expiresAt: new Date(Date.now() + 300 * DAY).toISOString(),
  },
  spaces: [{ ...GENERAL, granted: true, data: false }],
  address: 'https://dev.acme.localhost',
  sinkId: 'alloy-dev',
};
const issued = {
  id: TOKEN,
  name: 'CT Studio',
  scopes: ['create', 'edit'],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * DAY).toISOString(),
  lastUsedAt: null,
  secret: 'awt_aSecretShownOnceOnlyaSecretShownOnceOnly1',
};
const blankSettings = {
  componentType: null,
  template: null,
  propertyMap: {},
  data: false,
  connection: null,
  unlisted: [],
};

/** The service as the section and its flow call it; every write is kept in `sent`. */
function service(status: Status) {
  let now = status;
  const sent: { url: string; body: unknown }[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (request.method !== 'GET') {
      const body = request.headers.get('content-type') ? await request.json() : undefined;
      sent.push({ url, body });
    }
    if (url === '/v1/ct-studio') return json(200, now);
    if (url === '/v1/ct-studio/connections') {
      const body = sent.at(-1)!.body as { space: string; identity: unknown };
      const space = [GENERAL, QUALITY].find((each) => each.id === body.space)!;
      const first = body.identity !== null && 'make' in (body.identity as object);
      now = {
        ...connected,
        spaces: [
          ...connected.spaces.filter((each) => each.id !== space.id),
          { ...space, granted: true, data: false },
        ],
      };
      return json(200, {
        status: now,
        issued: first ? issued : null,
        space,
        settings: blankSettings,
      });
    }
    if (url === '/v1/ct-studio/tokens') return json(200, { status: now, issued });
    if (url === '/v1/spaces') {
      return json(200, {
        items: [GENERAL, QUALITY].map((each) => ({ ...each, archived: false })),
        next: null,
      });
    }
    if (url === '/v1/service-identities') {
      return json(200, {
        items: [
          {
            id: BY_HAND,
            name: 'By hand',
            description: '',
            createdBy: null,
            createdAt: new Date().toISOString(),
            disabledAt: null,
            tokens: 2,
          },
        ],
        next: null,
      });
    }
    if (url === `/v1/principals/${BY_HAND}/tokens`) {
      return json(200, {
        items: [
          {
            ...issued,
            id: SOON,
            name: 'Soon',
            expiresAt: new Date(Date.now() + 10 * DAY).toISOString(),
          },
          {
            ...issued,
            id: LATER,
            name: 'Later',
            expiresAt: new Date(Date.now() + 90 * DAY).toISOString(),
          },
        ],
        next: null,
      });
    }
    if (url.endsWith('/bridge-settings')) return json(200, blankSettings);
    if (url === '/v1/templates' || url === '/v1/definitions')
      return json(200, { items: [], next: null });
    return json(404, {});
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

/** Through the flow to its hand-off: the space, the identity if asked, the settings, the address. */
async function connectSpace(space: string, identity?: 'make' | 'adopt') {
  await userEvent.click(await screen.findByRole('button', { name: 'Connect a space' }));
  await userEvent.selectOptions(await screen.findByLabelText('Space'), space);
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  if (identity === 'make') {
    await userEvent.click(await screen.findByLabelText('Make a new identity'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  }
  if (identity === 'adopt') {
    await userEvent.click(await screen.findByLabelText('Adopt an identity made by hand'));
    await userEvent.selectOptions(await screen.findByLabelText('Identity'), 'By hand');
    await screen.findByRole('option', { name: /Later/ });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  }
  await screen.findByLabelText('Deliver data tables to this space');
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
}

describe("Administration's CT Studio", () => {
  it('API-075 sinkEntry gives the BRIDGE_SINKS line with the key as a placeholder', () => {
    expect(sinkEntry('alloy-acme', 'https://192.168.1.129:8443')).toBe(
      'BRIDGE_SINKS=[{"id":"alloy-acme","url":"https://192.168.1.129:8443/bridge","key":"<the value of SINK_BRIDGE_KEYS>"}]',
    );
  });

  it('API-075 defaultAddress prefers an https page origin, port and all', () => {
    expect(defaultAddress('https://192.168.1.129:8443', ['dev.acme.localhost'])).toBe(
      'https://192.168.1.129:8443',
    );
    expect(defaultAddress('http://127.0.0.1:8088', ['dev.acme.localhost'])).toBe(
      'https://dev.acme.localhost',
    );
    expect(defaultSinkId(['dev.acme.localhost'])).toBe('alloy-dev');
  });

  it('API-074 bridge off is said above everything', async () => {
    const { client } = service({ ...fresh, bridgeOn: false });
    render(<CtStudio client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('SINK_BRIDGE_KEYS');
  });

  it('API-074 the first connection ends on the token, the entry and four steps', async () => {
    const { client, sent } = service(fresh);
    render(<CtStudio client={client} />);
    await connectSpace('General', 'make');
    const token = await screen.findByLabelText('Token');
    expect(token).toHaveValue(issued.secret);
    expect(token).toHaveAttribute('readonly');
    expect(screen.getByText(/^BRIDGE_SINKS=/)).toHaveTextContent(
      'BRIDGE_SINKS=[{"id":"alloy-dev","url":"https://dev.acme.localhost/bridge"',
    );
    expect(
      within(screen.getByRole('list', { name: 'In CT Studio' })).getAllByRole('listitem'),
    ).toHaveLength(4);
    expect(sent.find((each) => each.url === '/v1/ct-studio/connections')!.body).toMatchObject({
      space: GENERAL.id,
      identity: { make: true },
      address: 'https://dev.acme.localhost',
      sinkId: 'alloy-dev',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByLabelText('Token')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(issued.secret);
  });

  it('API-074 a later space ends on step 4 alone', async () => {
    const { client, sent } = service(connected);
    render(<CtStudio client={client} />);
    await connectSpace('Quality');
    const steps = await screen.findByRole('list', { name: 'In CT Studio' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
    expect(sent.find((each) => each.url === '/v1/ct-studio/connections')!.body).toMatchObject({
      identity: null,
    });
  });

  it('API-074 an existing identity can be adopted, defaulting to the token that expires last', async () => {
    const { client, sent } = service(fresh);
    render(<CtStudio client={client} />);
    await connectSpace('General', 'adopt');
    await screen.findByRole('list', { name: 'In CT Studio' });
    expect(sent.find((each) => each.url === '/v1/ct-studio/connections')!.body).toMatchObject({
      identity: { adopt: BY_HAND, token: LATER },
    });
  });

  it('API-074 a token within 30 days of expiry offers Issue a new token; a disabled identity offers Replace the identity', async () => {
    const soon = {
      ...connected,
      token: { ...connected.token!, expiresAt: new Date(Date.now() + 5 * DAY).toISOString() },
    };
    const first = service(soon);
    const { unmount } = render(<CtStudio client={first.client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Issue a new token' }));
    expect(await screen.findByLabelText('Token')).toHaveValue(issued.secret);
    expect(first.sent.at(-1)).toEqual({
      url: '/v1/ct-studio/tokens',
      body: { replaceIdentity: false },
    });
    unmount();
    const disabled = service({
      ...connected,
      identity: { ...connected.identity!, disabled: true },
    });
    render(<CtStudio client={disabled.client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Replace the identity' }));
    await screen.findByLabelText('Token');
    expect(disabled.sent.at(-1)).toEqual({
      url: '/v1/ct-studio/tokens',
      body: { replaceIdentity: true },
    });
  });

  it('API-074 an enabled identity is always offered Issue a new token, not only near its expiry', async () => {
    const { client } = service(connected);
    render(<CtStudio client={client} />);
    expect(await screen.findByRole('button', { name: 'Issue a new token' })).toBeInTheDocument();
  });

  it('API-074 a space without its grant offers Grant again', async () => {
    const { client, sent } = service({
      ...connected,
      spaces: [{ ...GENERAL, granted: false, data: false }],
    });
    render(<CtStudio client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Grant General again' }));
    await waitFor(() =>
      expect(sent.find((each) => each.url === '/v1/ct-studio/connections')?.body).toMatchObject({
        space: GENERAL.id,
        identity: null,
      }),
    );
  });
});
