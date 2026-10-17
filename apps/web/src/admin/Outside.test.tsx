import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Outside } from './Outside.js';

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000004';
const CLINICAL = 'ssssssss-0000-4000-8000-000000000001';
const GRANT = 'gggggggg-0000-4000-8000-000000000001';
const EXTENDED = 'gggggggg-0000-4000-8000-000000000002';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const sent: { path: string; body: unknown }[] = [];
  let until = '2026-11-15T00:00:00.000Z';
  let id = GRANT;
  const listed = () => ({
    items: [
      {
        principal: { id: ALICE, name: 'Alice', email: 'alice@example.org' },
        grants: [
          {
            id,
            role: { id: 'r1', name: 'Reviewer' },
            level: `space:${CLINICAL}`,
            effect: 'allow',
            expiresAt: until,
            extends: id === EXTENDED ? GRANT : null,
            group: null,
          },
        ],
        reads: { spaces: [{ id: CLINICAL, name: 'Clinical' }], included: [], excluded: [] },
      },
    ],
  });
  const fetching = vi.fn(async (input: Request) => {
    const path = new URL(input.url).pathname;
    if (input.method === 'POST') {
      const body = await input.json();
      sent.push({ path, body });
      until = (body as { expiresAt: string }).expiresAt;
      id = EXTENDED;
      return json(200, { grant: listed().items[0]!.grants[0] });
    }
    return json(200, listed());
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), sent };
}

describe('Administration: from outside the organisation (the R13 plan, R13-E, R13-F)', () => {
  it('IAM-051 lists everybody from outside, what each may read and every grant reaching them, with its expiry', async () => {
    render(<Outside client={service().client} />);
    const alice = await screen.findByRole('region', { name: 'Alice' });
    expect(within(alice).getByText('alice@example.org')).toBeInTheDocument();
    expect(within(alice).getByText('May read: Clinical.')).toBeInTheDocument();
    const grants = within(alice).getByRole('table', { name: 'What reaches Alice' });
    expect(grants).toHaveTextContent('Reviewer');
    expect(grants).toHaveTextContent('Clinical');
    expect(grants).toHaveTextContent('Directly');
    expect(grants).toHaveTextContent('15 Nov 2026');
  });

  it('IAM-050 extends a grant to a chosen day, as an act the page asks for, and shows it extended', async () => {
    const { client, sent } = service();
    render(<Outside client={client} />);
    const alice = await screen.findByRole('region', { name: 'Alice' });
    const day = within(alice).getByLabelText('Extend Reviewer in Clinical to');
    await userEvent.clear(day);
    await userEvent.type(day, '2026-12-20');
    await userEvent.click(within(alice).getByRole('button', { name: 'Extend' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Extended Reviewer in Clinical for Alice to 20 Dec 2026.',
    );
    expect(sent).toEqual([
      { path: `/v1/grants/${GRANT}/extension`, body: { expiresAt: '2026-12-20T23:59:59.000Z' } },
    ]);
    expect(await screen.findByText('20 Dec 2026')).toBeInTheDocument();
  });
});
