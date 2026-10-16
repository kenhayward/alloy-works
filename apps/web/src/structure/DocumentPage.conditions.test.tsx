import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import {
  item,
  open,
  outline,
  RESULTS,
  INTRODUCTION,
  section,
  service,
} from './test/documentPage.js';

shimRangeMeasurement();

const regulator = [{ axis: 'audience', values: ['regulator'] }];

describe("a node's conditions in the outline (the R12 plan)", () => {
  it('REU-021 REU-026 sets a section conditions from the outline, says them on its row, and takes them off', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]),
      { axes: true },
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Results' });
    await userEvent.click(item('Results'));
    expect(screen.getByText('Kept for every reader')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Set condition on Results' }));
    const dialog = await screen.findByRole('dialog', { name: 'Condition' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Regulator' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set condition' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Results is now kept for some readers.'),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: { operation: 'set', node: RESULTS, conditions: regulator },
      },
    ]);
    // Its row says what it is kept for, and that this document's profile, which sets no audience,
    // leaves it out: it takes no number.
    await waitFor(() =>
      expect(item('Results')).toHaveAccessibleDescription(
        'Kept for Audience: Regulator; left out by this document’s profile',
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Set condition on Results' }));
    const again = await screen.findByRole('dialog', { name: 'Condition' });
    // A section is not copied beside itself: no alternative is offered for one.
    await within(again).findByRole('button', { name: 'Remove condition' });
    expect(within(again).queryByRole('button', { name: 'Add alternative' })).toBeNull();
    await userEvent.click(await within(again).findByRole('button', { name: 'Remove condition' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Results is now kept for every reader.'),
    );
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: RESULTS, conditions: [] },
    });
  });

  it('REU-027 publishes under the profile chosen in the Profile panel, from the Publishing tab, saying which', async () => {
    const fake = service(outline([section(RESULTS, 'Results')]), { axes: true, mayPublish: true });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Results' });
    await userEvent.click(screen.getByRole('tab', { name: 'Document' }));
    const document = screen.getByRole('tabpanel', { name: 'Document' });
    await userEvent.click(await within(document).findByRole('checkbox', { name: 'Regulator' }));
    await userEvent.click(
      within(document).getByRole('button', { name: 'Publish under this profile' }),
    );

    const publishing = await screen.findByRole('tabpanel', { name: 'Publishing' });
    expect(
      within(publishing).getByText(
        'Publishing under a profile chosen in place of the document’s: Audience: Regulator.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(publishing).getByRole('button', { name: 'Publish as PDF' }));
    await waitFor(() =>
      expect(
        fake.sent.find((each) => each.url.endsWith('/publications') && each.body !== undefined)
          ?.body,
      ).toMatchObject({ profile: { values: { audience: ['regulator'] } } }),
    );
  });
});
