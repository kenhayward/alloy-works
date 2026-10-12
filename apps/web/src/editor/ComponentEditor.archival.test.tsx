import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { json, open, opened } from './test/componentEditor.js';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('archival on a component’s own page (lifecycle.md)', () => {
  it('LIF-020 shows Archived on an archived component, and Unarchive to whoever may retire it', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ archived: true, mayRetire: true })),
      'POST /v1/components/{id}/unarchive': () => json(200, { archived: false }),
    });
    await surface();
    expect(screen.getByText('Archived')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Unarchive' }));
    expect(await screen.findByText('Unarchived Install the printer.')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(asked.map((each) => each.route)).toContain('POST /v1/components/{id}/unarchive');
  });

  it('offers no Archive to a reader who may not retire it, and no chip on a live component', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ archived: false, mayRetire: false })),
    });
    await surface();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});
