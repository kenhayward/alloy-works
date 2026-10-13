import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { json, open, opened } from './test/componentEditor.js';

afterEach(() => {
  window.sessionStorage.clear();
});

const remains = { versions: 3, iterations: 0, threads: 1, suggestions: 0, rounds: 0, events: 7 };

describe('deletion on a component’s own page (lifecycle.md)', () => {
  it('LIF-024 says what deleting it leaves, deletes it, and then says it is deleted', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayRetire: true })),
      'GET /v1/components/{id}/deletion': () =>
        json(200, { kind: 'component', deleted: false, remains, refusals: [] }),
      'POST /v1/components/{id}/delete': () => json(200, { deleted: true }),
    });
    await surface();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const deleting = await screen.findByRole('dialog', { name: 'Delete Install the printer' });
    expect(
      await within(deleting).findByText(
        'Nothing is removed: its 3 versions, 1 thread and 7 audit events are kept, out of reach, and come back if it is undeleted.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(deleting).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('This component has been deleted.')).toBeInTheDocument();
    expect(asked.map((each) => each.route)).toContain('POST /v1/components/{id}/delete');
  });

  it('LIF-023 says every reason it may not be deleted, naming what may be read and counting the rest, and offers no Delete', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayRetire: true })),
      'GET /v1/components/{id}/deletion': () =>
        json(200, {
          kind: 'component',
          deleted: false,
          remains,
          refusals: [
            { code: 'baselined', named: [{ id: 'b1', title: 'Issue 1' }], unnamed: 0 },
            { code: 'referenced', named: [{ id: 'd1', title: 'Dosing report' }], unnamed: 2 },
            { code: 'held' },
            { code: 'locked', holder: { id: 'g', name: 'Grace' } },
          ],
        }),
    });
    await surface();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const deleting = await screen.findByRole('dialog', { name: 'Delete Install the printer' });
    for (const said of [
      'A baseline pins it: Issue 1.',
      'Documents reference it: Dosing report, and 2 you may not read.',
      'A legal hold is on it or its space.',
      'Grace is editing it.',
    ]) {
      expect(await within(deleting).findByText(said)).toBeInTheDocument();
    }
    expect(within(deleting).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(asked.map((each) => each.route)).not.toContain('POST /v1/components/{id}/delete');
  });

  it('says a deleted component is deleted when it is opened', async () => {
    open({
      'GET /v1/components/{id}': () =>
        json(410, { code: 'artifact_deleted', message: 'This has been deleted.', traceId: 't' }),
    });
    expect(await screen.findByText('This component has been deleted.')).toBeInTheDocument();
  });

  it('offers no Delete to a reader who may not retire it', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayRetire: false })),
    });
    await surface();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument(),
    );
  });
});
