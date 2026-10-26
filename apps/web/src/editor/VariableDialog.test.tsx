import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NO_VARIABLES, VariableDialog } from './VariableDialog.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const version = { id: '00000000-0000-4000-8000-0000000000f1', number: '0.1' };

/** Two pages of definitions: a field and a variable, then another variable. */
function service() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname !== '/v1/definitions') return json(404, {});
    return url.searchParams.get('cursor') === null
      ? json(200, {
          items: [
            { id: 'a1', kind: 'field', name: 'Next review', version },
            { id: 'a2', kind: 'variable', name: 'Plant', key: 'plant', version },
          ],
          next: 'page2',
        })
      : json(200, {
          items: [{ id: 'a3', kind: 'variable', name: 'Review date', key: 'review_date', version }],
          next: null,
        });
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://variables.test', fetch: fetching });
}

describe('the Variable dialog (the R5 plan, R5b)', () => {
  it('REU-018 offers the declared variables alone, every page of them, and answers the key chosen', async () => {
    const chosen: string[] = [];
    render(
      <VariableDialog
        client={service()}
        onChoose={(key) => chosen.push(key)}
        onCancel={() => undefined}
      />,
    );
    const review = await screen.findByRole('button', { name: /Review date/ });
    expect(screen.getByRole('button', { name: /Plant/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next review/ })).toBeNull();
    await userEvent.click(review);
    expect(chosen).toEqual(['review_date']);
  });

  it('says where none is declared, and closes on Escape', async () => {
    const fetching = vi.fn(async () =>
      json(200, { items: [], next: null }),
    ) as unknown as typeof fetch;
    const cancelled = vi.fn();
    render(
      <VariableDialog
        client={createApiClient({ baseUrl: 'http://variables.test', fetch: fetching })}
        onChoose={() => undefined}
        onCancel={cancelled}
      />,
    );
    expect(await screen.findByText(NO_VARIABLES())).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(cancelled).toHaveBeenCalled();
  });
});
