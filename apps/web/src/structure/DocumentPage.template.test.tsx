import type { OutlineNode } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import {
  ADA,
  client,
  DOCUMENT,
  METHOD,
  outline,
  RESULTS,
  section,
  service,
} from './test/documentPage.js';

// A section's title is a ProseMirror view, which scrolls its selection into view.
shimRangeMeasurement();

const TEMPLATE = {
  id: 'ee000000-0000-4000-8000-000000000001',
  name: 'Report',
  version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3' },
  required: ['method'],
  departures: {
    added: [{ node: RESULTS, title: 'Results' }],
    missing: [
      { key: 'scope', title: 'Scope', required: true, reason: 'Covered in the method.' },
      { key: 'annex', title: 'Annex', required: false, reason: null },
    ],
  },
};

/** Method, made from the template's required `method`, then Results, which the author added. */
const open = () => {
  const fake = service(
    outline([
      { ...section(METHOD, 'Method'), origin: 'method' } as OutlineNode,
      section(RESULTS, 'Results'),
    ]),
    { template: TEMPLATE },
  );
  render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} principalId={ADA} />);
  return fake;
};

describe("a document's template (templates.md; the WF6 plan, WF6-A, WF6-B)", () => {
  it('TPL-028 says which template it was made from and lists how it departs from it', async () => {
    open();
    expect(await screen.findByText('Made from Report, version 0.3')).toBeInTheDocument();
    const departures = screen.getByRole('list', { name: 'Departures from Report' });
    expect(
      within(departures)
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual([
      'Results is not in the template.',
      'Scope, which the template requires, was removed: Covered in the method.',
      'Annex is not here.',
    ]);
  });

  it('TPL-029 asks for a reason before removing a section the template requires, and sends it', async () => {
    const fake = open();
    await userEvent.click(await screen.findByRole('treeitem', { name: /^Method/ }));
    await userEvent.keyboard('{Delete}');
    const question = screen.getByRole('group', { name: 'Confirm removal' });
    const remove = within(question).getByRole('button', { name: 'Remove' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(
      within(question).getByRole('textbox', { name: 'Why it is removed' }),
      'Covered by the appendix.',
    );
    expect(remove).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(remove);
    await waitFor(() =>
      expect(fake.edits().at(-1)?.body).toMatchObject({
        operation: { operation: 'remove', node: METHOD, reason: 'Covered by the appendix.' },
      }),
    );
  });

  it('removes a section the template does not require without asking why', async () => {
    const fake = open();
    await userEvent.click(await screen.findByRole('treeitem', { name: /^Results/ }));
    await userEvent.keyboard('{Delete}');
    const question = screen.getByRole('group', { name: 'Confirm removal' });
    expect(within(question).queryByRole('textbox')).toBeNull();
    await userEvent.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(fake.edits().at(-1)?.body).toEqual(
        expect.objectContaining({ operation: { operation: 'remove', node: RESULTS } }),
      ),
    );
  });
});
