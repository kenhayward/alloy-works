import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
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
