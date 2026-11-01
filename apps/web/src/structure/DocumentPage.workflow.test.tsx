import type { FollowOptions } from '@alloy-works/api-client';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import {
  client,
  COMPONENTS,
  DOCUMENT,
  INTRODUCTION,
  item,
  METHOD,
  open,
  outline,
  PRINTER,
  reference,
  SCOPE,
  section,
  service,
  type Standing,
} from './test/documentPage.js';

shimRangeMeasurement();

const IN_REVIEW: Standing = {
  state: { key: 'in_review', name: 'In review', approved: false },
  transitions: [
    { key: 'return', name: 'Return', to: { key: 'draft', name: 'Draft' }, reasonRequired: true },
    {
      key: 'approve',
      name: 'Approve',
      to: { key: 'approved', name: 'Approved' },
      reasonRequired: false,
    },
  ],
};
const APPROVED: Standing = {
  state: { key: 'approved', name: 'Approved', approved: true },
  transitions: [],
};

const sentTo = (fake: ReturnType<typeof service>, path: string) =>
  fake.sent.filter((each) => each.url === path).map((each) => each.body);

describe('workflow on a document’s own page (the WF1 plan, WF-G)', () => {
  it('shows the document’s state beside Archived, and moves it by a transition from the header', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), { moves: { submit: IN_REVIEW } });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: /Method/ });
    expect(screen.getByText('Draft')).toHaveAttribute('data-kind', 'draft');

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('In review')).toHaveAttribute('data-kind', 'inReview');
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(sentTo(fake, `/v1/documents/${DOCUMENT}/transitions`)).toEqual([
      { transition: 'submit', from: 'draft' },
    ]);
  });

  it('LIF-061 asks for a reason before a transition that requires one', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), {
      standing: IN_REVIEW,
      moves: {
        return: {
          state: { key: 'draft', name: 'Draft', approved: false },
          transitions: [],
        },
      },
    });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: /Method/ });
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    const dialog = screen.getByRole('dialog', { name: 'Return The dosing report' });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Name the dose.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Return to Draft' }));
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(sentTo(fake, `/v1/documents/${DOCUMENT}/transitions`)).toEqual([
      { transition: 'return', from: 'in_review', reason: 'Name the dose.' },
    ]);
  });

  it('says, before an approved document is saved, that saving starts a new draft, and only to whoever may edit it', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), { standing: APPROVED });
    const { unmount } = open(fake.fetch);
    await screen.findByRole('treeitem', { name: /Method/ });
    expect(
      await screen.findByText(
        'This is approved. Saving starts a new draft, and the approved version stays as it is.',
      ),
    ).toBeInTheDocument();
    unmount();

    const reader = service(outline([section(METHOD, 'Method')]), {
      standing: APPROVED,
      mayEdit: false,
    });
    open(reader.fetch);
    await screen.findByRole('treeitem', { name: /Method/ });
    expect(screen.queryByText(/Saving starts a new draft/)).toBeNull();
  });

  it('follows the state the document’s stream says it moved to', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    const streams: FollowOptions[] = [];
    render(
      <StrictMode>
        <DocumentPage
          client={client(fake.fetch)}
          id={DOCUMENT}
          follow={(options) => {
            streams.push(options);
            return () => undefined;
          }}
        />
      </StrictMode>,
    );
    await screen.findByRole('treeitem', { name: /Method/ });
    fake.moved(IN_REVIEW);
    act(() => {
      for (const each of streams) {
        each.onEvent!('workflow', {
          artifact: DOCUMENT,
          state: { key: 'in_review', name: 'In review' },
        });
      }
    });
    await waitFor(() => expect(screen.getByText('In review')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('keeps another person’s outline change when the state it moved to answers first', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    const streams: FollowOptions[] = [];
    // Each read of the document from here on waits until the next one has answered.
    let holding = false;
    let release: () => void = () => undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://x');
      if (holding && url.pathname === `/v1/documents/${DOCUMENT}`) {
        holding = false;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await gate;
      } else if (url.pathname === `/v1/documents/${DOCUMENT}`) {
        const answered = await fake.fetch(input, init);
        release();
        return answered;
      }
      return fake.fetch(input, init);
    };
    render(
      <StrictMode>
        <DocumentPage
          client={client(fetch)}
          id={DOCUMENT}
          follow={(options) => {
            streams.push(options);
            return () => undefined;
          }}
        />
      </StrictMode>,
    );
    await screen.findByRole('treeitem', { name: /Method/ });
    fake.theirs({
      operation: 'insert',
      parent: null,
      position: 1,
      node: { type: 'section', title: [{ type: 'text', value: 'Scope', marks: [] }] },
    });
    fake.moved(IN_REVIEW);
    holding = true;
    act(() => {
      for (const each of streams) each.onEvent!('outline', { document: DOCUMENT });
    });
    act(() => {
      for (const each of streams) {
        each.onEvent!('workflow', {
          artifact: DOCUMENT,
          state: { key: 'in_review', name: 'In review' },
        });
      }
    });
    await waitFor(() => expect(screen.getByText('In review')).toBeInTheDocument());
    expect(await screen.findByRole('treeitem', { name: /Scope/ })).toBeInTheDocument();
  });

  it('shows a placed component’s state in the Part panel, and none for one the reader may not read', async () => {
    const placed = outline([section(INTRODUCTION, 'Introduction', [reference(SCOPE, 'latest')])]);
    const readable = service(placed, {
      components: {
        ...COMPONENTS,
        items: COMPONENTS.items.map((each) => ({
          ...each,
          state: { key: 'approved', name: 'Approved' },
        })),
      },
    });
    const { unmount } = open(readable.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    const part = () => document.querySelector<HTMLElement>('[data-part="details"]')!;
    await userEvent.click(item('Install the printer, latest'));
    expect(within(part()).getByText('Approved')).toHaveAttribute('data-kind', 'approved');
    unmount();

    const withheld = service(placed, { mayRead: (component) => component !== PRINTER });
    open(withheld.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item(/^A component/));
    expect(within(part()).queryByText('State')).toBeNull();
  });

  it('shows the state of the component Add component would place', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), {
      components: {
        ...COMPONENTS,
        items: COMPONENTS.items.map((each) => ({
          ...each,
          state: { key: 'in_review', name: 'In review' },
        })),
      },
    });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    const chooser = (await screen.findByRole('combobox', { name: 'Component' })).closest('form')!;
    expect(within(chooser).getByText('In review')).toHaveAttribute('data-kind', 'inReview');
  });
});
