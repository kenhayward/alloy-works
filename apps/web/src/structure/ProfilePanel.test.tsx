import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EXCLUDE_UNSET_SAID, ProfilePanel } from './ProfilePanel.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const AUDIENCE = '00000000-0000-4000-8000-0000000000a1';
const version = { id: '00000000-0000-4000-8000-0000000000f1', number: '0.1' };

function service() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/definitions') {
      return json(200, {
        items: [
          { id: AUDIENCE, kind: 'conditionAxis', name: 'Audience', key: 'audience', version },
        ],
        next: null,
      });
    }
    return json(200, {
      id: AUDIENCE,
      kind: 'conditionAxis',
      version,
      definition: {
        name: 'Audience',
        key: 'audience',
        values: [
          { key: 'regulator', label: 'Regulator' },
          { key: 'internal', label: 'Internal' },
        ],
      },
    });
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://profiles.test', fetch: fetching });
}

describe("the document's profile (the R6 plan, R6-H)", () => {
  it('REU-022 shows the profile the document declares and saves the values chosen on each axis, whole', async () => {
    const save = vi.fn(async () => 'saved' as const);
    render(
      <ProfilePanel
        client={service()}
        profile={{ values: { audience: ['regulator'] } }}
        readOnly={false}
        onSave={save}
        onPreview={() => undefined}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: 'Regulator' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Internal' }));
    await userEvent.click(screen.getByRole('checkbox', { name: EXCLUDE_UNSET_SAID }));
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(save).toHaveBeenCalledWith({
      values: { audience: ['regulator', 'internal'] },
      excludeUnset: true,
    });
  });

  it('REU-025 previews the text under a profile chosen here, saved or not', async () => {
    const preview = vi.fn();
    render(
      <ProfilePanel
        client={service()}
        profile={undefined}
        readOnly
        onSave={async () => 'saved'}
        onPreview={preview}
      />,
    );
    await screen.findByRole('group', { name: 'Audience' });
    // A reader may not change the profile, and may still preview the one the document declares.
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Preview this profile' }));
    expect(preview).toHaveBeenCalledWith({ values: {} });
  });
});
