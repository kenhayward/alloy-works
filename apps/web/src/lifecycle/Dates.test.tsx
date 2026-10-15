import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DatesChips, DatesButton, type Dates } from './Dates.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const GRACE = '22222222-2222-4222-8222-222222222222';
const NONE: Dates = {
  effectiveAt: null,
  reviewBy: null,
  owner: null,
  pastReview: false,
  effectiveFrom: null,
};

describe('dates in a header (workflow.md, Dates; the WF5 plan, WF5-H)', () => {
  it('LIF-015 LIF-016 LIF-018 says the effective date, the review-by day and its owner, and past review', () => {
    render(
      <DatesChips
        dates={{
          effectiveAt: '2026-12-01T09:00:00.000+01:00',
          reviewBy: '2026-10-01',
          owner: { id: GRACE, name: 'Grace' },
          pastReview: true,
          effectiveFrom: '2026-12-01T08:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByText('Effective 1 December 2026')).toBeInTheDocument();
    expect(screen.getByText('Review by 1 October 2026, Grace')).toBeInTheDocument();
    expect(screen.getByText('Past review')).toBeInTheDocument();
    expect(
      screen.getByText('Its latest revision takes effect 1 December 2026'),
    ).toBeInTheDocument();
  });

  it('says nothing where no dates are set', () => {
    const { container } = render(<DatesChips dates={NONE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('LIF-015 LIF-016 sets the dates and the owner from the header, and says a refusal', async () => {
    const sent: unknown[] = [];
    let refuse = false;
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === '/v1/people') {
        return json(200, { items: [{ id: GRACE, name: 'Grace' }], next: null });
      }
      if (path === `/v1/components/${PRINTER}/dates` && request.method === 'PUT') {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        if (refuse) {
          return json(400, {
            code: 'owner_invalid',
            message: 'The owner is somebody who may read it.',
            traceId: 't',
          });
        }
        return json(200, { ...NONE, ...body, owner: { id: GRACE, name: 'Grace' } });
      }
      return json(404, { code: 'not_found', message: 'x', traceId: 't' });
    }) as typeof fetch;
    const saved: Dates[] = [];
    render(
      <DatesButton
        client={createApiClient({ baseUrl: 'http://dates.test', fetch: fetching })}
        kind="component"
        id={PRINTER}
        title="Install the printer"
        dates={NONE}
        onSaved={(dates) => saved.push(dates)}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dates' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dates of Install the printer' });
    await userEvent.type(within(dialog).getByLabelText('Review by'), '2027-06-30');
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Review owner' }),
      'Grace',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(sent[0]).toEqual({ effectiveAt: null, reviewBy: '2027-06-30', owner: GRACE });
    expect(screen.queryByRole('dialog')).toBeNull();

    refuse = true;
    await userEvent.click(screen.getByRole('button', { name: 'Dates' }));
    const again = await screen.findByRole('dialog', { name: 'Dates of Install the printer' });
    await userEvent.click(within(again).getByRole('button', { name: 'Save' }));
    expect(
      await within(again).findByText('The owner is somebody who may read it.'),
    ).toBeInTheDocument();
  });
});
