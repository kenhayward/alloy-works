import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { json, open, opened } from './test/componentEditor.js';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('legal holds on a component’s own page (lifecycle.md)', () => {
  it('shows On hold where the view says so, and places a hold, asking why, for an environment administrator', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ onHold: true, mayHold: true })),
      'POST /v1/holds': () => json(200, { id: 'h1' }),
    });
    await surface();
    expect(screen.getByText('On hold')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Place a hold' }));
    const placing = screen.getByRole('dialog', { name: 'Place a hold on Install the printer' });
    await userEvent.type(within(placing).getByRole('textbox', { name: 'Reason' }), 'Matter 7');
    await userEvent.click(within(placing).getByRole('button', { name: 'Place hold' }));
    expect(await screen.findByText('Placed a hold on Install the printer.')).toBeInTheDocument();
    expect(asked.map((each) => each.route)).toContain('POST /v1/holds');
  });

  it('offers no hold to a reader who is not an environment administrator, and no chip where the view says none', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ onHold: false, mayHold: false })),
    });
    await surface();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Place a hold' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('On hold')).not.toBeInTheDocument();
  });
});
