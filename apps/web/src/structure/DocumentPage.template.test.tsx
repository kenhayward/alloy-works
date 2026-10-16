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
  reference,
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

  it('TPL-044 asks for a reason before removing a component the template requires, and sends it', async () => {
    const NOTICE = 'nnnnnnnnnnnnnnnnnnnnnnnnnn';
    const fake = service(
      outline([
        section(METHOD, 'Method'),
        { ...reference(NOTICE, 'latest'), origin: 'notice' } as OutlineNode,
      ]),
      { template: { ...TEMPLATE, required: ['notice'] } },
    );
    render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} principalId={ADA} />);
    await userEvent.click(await screen.findByRole('treeitem', { name: /Install the printer/ }));
    await userEvent.keyboard('{Delete}');
    const question = screen.getByRole('group', { name: 'Confirm removal' });
    await userEvent.type(
      within(question).getByRole('textbox', { name: 'Why it is removed' }),
      'Issued separately.',
    );
    await userEvent.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(fake.edits().at(-1)?.body).toMatchObject({
        operation: { operation: 'remove', node: NOTICE, reason: 'Issued separately.' },
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

  it('TPL-033 TPL-034 offers the template’s newest version, says what the move changes first, and moves only when asked', async () => {
    const NEWER = 'ee000000-0000-4000-8000-0000000000a2';
    const fake = service(
      outline([{ ...section(METHOD, 'Method'), origin: 'method' } as OutlineNode]),
      { template: { ...TEMPLATE, newest: { id: NEWER, number: '0.4' } } },
    );
    const asked: { method: string; body: unknown }[] = [];
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === `/v1/documents/${DOCUMENT}/template-move`) {
        asked.push({
          method: request.method,
          body: request.method === 'POST' ? await request.json() : url.searchParams.get('to'),
        });
        const report = {
          theme: { from: 'a', to: 'b' },
          layout: null,
          fields: [{ level: 'document', field: 'f1', name: 'Reviewer', change: 'removed' }],
          notCarried: [{ node: null, field: 'f1', name: 'Reviewer', value: 'Grace' }],
          adding: [{ kind: 'section', key: 'scope', title: 'Scope' }],
        };
        return request.method === 'GET'
          ? new Response(
              JSON.stringify({
                template: TEMPLATE.id,
                from: TEMPLATE.version.id,
                to: NEWER,
                latest: 'dddddddd-0000-4000-8000-000000000001',
                report,
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ version: { id: 'v', number: '0.2' }, report }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
      }
      return fake.fetch(request);
    }) as typeof fetch;
    render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move to version 0.4' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to Report, version 0.4' });
    expect(
      within(await within(dialog).findByRole('list', { name: 'What the move changes' }))
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual([
      'Its theme changes.',
      'Reviewer is no longer one of its fields.',
      'Its value for Reviewer, Grace, is not carried forward.',
    ]);
    // What the newer version requires and the document lacks is added, unless left out (#660).
    expect(
      within(dialog).getByRole('group', {
        name: 'The template now requires these, which the move adds',
      }),
    ).toBeVisible();
    // Left there, nothing is moved.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep version 0.3' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(asked.filter((each) => each.method === 'POST')).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Move to version 0.4' }));
    const again = await screen.findByRole('dialog', { name: 'Move to Report, version 0.4' });
    await within(again).findByRole('list', { name: 'What the move changes' });
    // Left out, Scope needs a reason before the move is taken (TPL-029).
    await userEvent.click(within(again).getByRole('checkbox', { name: 'Leave out Scope' }));
    const move = within(again).getByRole('button', { name: 'Move' });
    expect(move).toBeDisabled();
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Why Scope is left out' }),
      'Covered by the method.',
    );
    await userEvent.click(move);
    await waitFor(() =>
      expect(asked.filter((each) => each.method === 'POST')).toEqual([
        {
          method: 'POST',
          body: {
            latest: 'dddddddd-0000-4000-8000-000000000001',
            to: NEWER,
            declined: [{ key: 'scope', reason: 'Covered by the method.' }],
          },
        },
      ]),
    );
  });
});
