import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { InPlaceBand } from './InPlaceBand.js';
import { ADA, json, lock, open, opened, quick, saves } from './test/componentEditor.js';

/** A page keeping a band above the desk, as a document does and a component's own page will. */
function Banded({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setHost} data-testid="band" />
      <InPlaceBand.Provider value={host}>{children}</InPlaceBand.Provider>
    </>
  );
}

const banded = (page: React.JSX.Element) => <Banded>{page}</Banded>;

describe('the one toolbar on a part of a document (the EP plan, EP3)', () => {
  it('stands outside the sheet, holding the acts and the Component menu', async () => {
    open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      { onDone: () => undefined },
      undefined,
      banded,
    );
    const bar = await screen.findByRole('toolbar', { name: 'Part toolbar' });
    // On the page's layer, in the reader's theme, not in the paper's.
    expect(bar.closest('.aw-canvas')).toBeNull();
    expect(bar.closest('article')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Done editing' })).toBeInTheDocument();
    const menu = within(bar).getByRole('button', { name: 'Component' });
    expect(within(bar).queryByRole('button', { name: /settings/ })).toBeNull();
    // One tab stop, and arrows between them.
    expect(
      within(bar)
        .getAllByRole('button')
        .filter((each) => each.tabIndex === 0),
    ).toHaveLength(1);
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('is no toolbar on a component with nothing to close, until the cursor is in a table', async () => {
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      {},
      undefined,
      banded,
    );
    await surface();
    expect(screen.queryByRole('toolbar', { name: 'Part toolbar' })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Table toolbar' })).toBeNull();
  });
});

/** A page asking the open editor to close, as a document does when its reader moves on. */
function Asking({
  page,
  onlyIfUnchanged = false,
}: {
  page: ReactElement;
  onlyIfUnchanged?: boolean;
}) {
  const [leaving, setLeaving] = useState<{ arrival: number; onlyIfUnchanged: boolean } | null>(
    null,
  );
  return (
    <>
      <button type="button" onClick={() => setLeaving({ arrival: 1, onlyIfUnchanged })}>
        Move on
      </button>
      {cloneElement(page, { leaving } as never)}
    </>
  );
}

describe('moving on from a part open in place (the EP plan, EP5)', () => {
  const moving = (answers: Parameters<typeof open>[0], onlyIfUnchanged = false) => {
    const closed: unknown[] = [];
    const stayed: boolean[] = [];
    const opening = open(
      answers,
      quick,
      false,
      {
        onDone: (...args: unknown[]) => closed.push(args),
        onStay: (blocked: boolean) => stayed.push(blocked),
      },
      undefined,
      (page) => <Asking page={page} onlyIfUnchanged={onlyIfUnchanged} />,
    );
    return { ...opening, closed, stayed };
  };
  const moveOn = () => userEvent.click(screen.getByRole('button', { name: 'Move on' }));

  it('closes a part with nothing changed, asking nothing', async () => {
    const { surface, closed, stayed } = moving({
      'GET /v1/components/{id}': () => json(200, opened()),
    });
    await surface();
    await moveOn();
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(stayed).toEqual([]);
  });

  it('keeps a part with changes open on a click on empty sheet, and says nothing of it', async () => {
    const { surface, closed, stayed } = moving(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, lock),
        ...saves,
      },
      true,
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText('A', 1));
    await moveOn();
    await waitFor(() => expect(stayed).toEqual([false]));
    expect(closed).toEqual([]);
  });

  it('CNT-191 saves a title changed in the heading alone, cutting a version on moving on', async () => {
    const host = document.createElement('span');
    document.body.append(host);
    const closed: unknown[][] = [];
    let answer: (response: Response) => void = () => undefined;
    const { surface, asked } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
        'POST /v1/components/{id}/versions': () =>
          json(201, { version: { id: 'v2', number: '0.2' }, outcome: 'cut' }),
        'DELETE /v1/components/{id}/lock': () =>
          json(200, { outcome: 'cut', version: { id: 'v2', number: '0.2' } }),
        ...saves,
      },
      quick,
      false,
      {
        titleHost: host,
        titleFirst: true,
        onDone: (...args: unknown[]) => closed.push(args),
      },
      undefined,
      (page) => (
        <Banded>
          <Asking page={page} />
        </Banded>
      ),
    );
    await surface();
    const field = within(host).getByRole('textbox', { name: 'Title' });
    field.textContent = 'Set up the printer';
    fireEvent.input(field);
    // Moved on from while the claim the first key started is still on the wire: it waits for the answer.
    await moveOn();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(closed).toEqual([]);
    answer(json(200, lock));
    await waitFor(() => expect(closed).toHaveLength(1));
    const routes = asked.map((each) => each.route);
    expect(routes.some((each) => each.startsWith('PUT '))).toBe(true);
    expect(routes).toContain('DELETE /v1/components/{id}/lock');
  });

  it('keeps open what cannot be saved, as closing would destroy the words: someone else holds it', async () => {
    const { surface, closed, stayed } = moving({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText('A', 1));
    await screen.findByRole('button', { name: 'Try again' });
    await moveOn();
    await waitFor(() => expect(stayed).toEqual([true]));
    expect(closed).toEqual([]);
  });
});

describe('a component opening in place (the EP plan, EP2)', () => {
  it('stands what it is given while it opens, and the keys typed meanwhile arrive', async () => {
    let answer: (response: Response) => void = () => undefined;
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
        'POST /v1/components/{id}/lock': () => json(200, lock),
      },
      quick,
      false,
      { whileOpening: <p>The words as read.</p>, openAt: 0, onDone: () => undefined },
    );
    expect(screen.getByText('The words as read.')).toBeInTheDocument();
    expect(screen.queryByText('Opening...')).toBeNull();

    await userEvent.keyboard('Ab');
    answer(json(200, opened()));

    const view = await surface();
    expect(screen.queryByText('The words as read.')).toBeNull();
    await waitFor(() => expect(view.state.doc.textContent).toBe('AbUnbox the printer.'));
  });

  it('leaves alone the keys typed where something else holds the focus', async () => {
    let answer: (response: Response) => void = () => undefined;
    const { surface } = open(
      {
        'GET /v1/components/{id}': () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      },
      quick,
      false,
      {
        whileOpening: <input aria-label="Elsewhere" />,
        openAt: 0,
        onDone: () => undefined,
      },
    );
    await userEvent.type(screen.getByLabelText('Elsewhere'), 'Ab');
    answer(json(200, opened()));
    const view = await surface();
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
  });
});

describe('a component on its own page, reading (the CE plan, CE3)', () => {
  const page = (reading: boolean) => ({
    ownPage: {
      reading,
      tools: null,
      identityHost: null,
      pageState: () => undefined,
      onShowAttributes: () => undefined,
    },
  });

  it('takes no change, claims no lock and draws no toolbar', async () => {
    const { asked, surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      page(true),
    );
    const view = await surface();
    expect(view.editable).toBe(false);
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    expect(asked.map((each) => each.route)).not.toContain('POST /v1/components/{id}/lock');
  });

  it('draws its header and Component menu in the page, and no strip', async () => {
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      page(false),
      undefined,
      banded,
    );
    await surface();
    expect(screen.getByRole('menuitem', { name: 'Component' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Title')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Component header' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Install the printer' })).toHaveAttribute(
      'id',
      'component-title',
    );
  });
});

describe('a component in a band with nothing to close (the CE plan, CE1)', () => {
  it('stands its toolbar in the band with its acts, and has no frame', async () => {
    const { surface } = open(
      { 'GET /v1/components/{id}': () => json(200, opened()) },
      quick,
      false,
      {},
      undefined,
      banded,
    );
    await surface();
    const band = within(screen.getByTestId('band'));
    const tools = band.getByRole('toolbar', { name: 'Formatting' });
    expect(within(tools).getByRole('button', { name: 'Done editing' })).toBeInTheDocument();
    expect(within(tools).getByRole('button', { name: 'Save version' })).toBeInTheDocument();
    expect(within(tools).getByRole('button', { name: 'Strong' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Component' })).toBeNull();
    // The sheet is its own, as a component's own page sets it.
    expect(screen.getByRole('article')).toHaveAttribute('data-in-place', 'false');
  });

  it('keeps Done editing as cutting and releasing, and closes nothing', async () => {
    const { asked, surface } = open(
      {
        'GET /v1/components/{id}': () => json(200, opened()),
        'POST /v1/components/{id}/lock': () => json(200, { lock }),
        'DELETE /v1/components/{id}/lock': () =>
          json(200, {
            outcome: 'cut',
            version: { id: 'v2', number: '0.2', author: ADA, createdAt: 't', note: null },
          }),
        ...saves,
      },
      quick,
      false,
      {},
      undefined,
      banded,
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    const done = within(screen.getByTestId('band')).getByRole('button', { name: 'Done editing' });
    await waitFor(() => expect(done).toHaveAttribute('aria-disabled', 'false'));
    await userEvent.click(done);
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain('DELETE /v1/components/{id}/lock'),
    );
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toBeVisible();
    expect(within(screen.getByTestId('band')).getByRole('toolbar')).toBeInTheDocument();
  });
});
