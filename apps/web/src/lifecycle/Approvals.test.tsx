import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApprovalsList } from './Approvals.js';

const ID = '5d9c6b1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e';
const VERSION = '7c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const client = (approvals: unknown[]) =>
  createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: (async () =>
      new Response(JSON.stringify({ approvals }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
  });

describe('the approvals beside a version list (the WF2 plan, WF2-L)', () => {
  it('LIF-008 LIF-051 lists who approved or rejected, when, and a rejection\u2019s reason', async () => {
    render(
      <ApprovalsList
        client={client([
          {
            transition: 'approve',
            decision: 'approved',
            reason: null,
            by: { id: 'g', name: 'Grace' },
            at: '2026-10-14T12:00:00.000Z',
            versionId: VERSION,
          },
          {
            transition: 'approve',
            decision: 'rejected',
            reason: 'Name the dose.',
            by: { id: 'l', name: 'Lin' },
            at: '2026-10-13T09:00:00.000Z',
            versionId: VERSION,
          },
        ])}
        kind="document"
        id={ID}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Approvals' });
    expect([...list.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      'Grace approved, 14 Oct 2026',
      'Lin returned it, 13 Oct 2026: Name the dose.',
    ]);
  });

  it('says nothing where nobody has decided', async () => {
    const { container } = render(<ApprovalsList client={client([])} kind="component" id={ID} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
