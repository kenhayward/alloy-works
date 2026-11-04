import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

import { RecoveryPanel } from '../editor/RecoveryPanel.js';
import { modalOpen, PageShown, usePageLayer } from './Status.js';

/** A page as the workspace keeps it, which the test leaves and returns to. */
function kept() {
  const shown: { set: (value: boolean) => void } = { set: () => undefined };
  function Kept({ children }: { children: ReactNode }) {
    const [value, set] = useState(true);
    shown.set = set;
    return <PageShown value={value}>{children}</PageShown>;
  }
  return { Kept, leave: () => act(() => shown.set(false)), back: () => act(() => shown.set(true)) };
}

describe('a dialog on a page the workspace keeps (#962)', () => {
  it('goes with the page, gives the window back, and returns as it was with the focus in it', async () => {
    const { Kept, leave, back } = kept();
    const load = vi.fn(() => Promise.resolve({ ok: true as const, items: [], next: null }));
    const { container } = render(
      <Kept>
        <RecoveryPanel
          load={load}
          peek={() => Promise.resolve('unread')}
          current={() => null}
          restore={() => Promise.resolve(null)}
          onCancel={() => undefined}
        />
      </Kept>,
    );
    const dialog = await screen.findByRole('dialog');
    await act(() => Promise.resolve());
    expect(container).toHaveAttribute('inert');

    leave();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container).not.toHaveAttribute('inert');

    back();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(container).toHaveAttribute('inert');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('holds no key back on the page shown while it stands on a page kept hidden', () => {
    const { Kept, leave, back } = kept();
    function Dialog() {
      return createPortal(<div role="dialog" aria-modal="true" />, usePageLayer());
    }
    render(
      <Kept>
        <Dialog />
      </Kept>,
    );
    expect(modalOpen()).toBe(true);
    leave();
    expect(modalOpen()).toBe(false);
    back();
    expect(modalOpen()).toBe(true);
  });

  it('keeps what was typed in a dialog through leaving and coming back', async () => {
    const { Kept, leave, back } = kept();
    function Dialog() {
      return createPortal(
        <div role="dialog" aria-modal="true">
          <input aria-label="Caption" />
        </div>,
        usePageLayer(),
      );
    }
    render(
      <Kept>
        <Dialog />
      </Kept>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Caption' }), 'Readings');
    leave();
    expect(screen.queryByRole('textbox', { name: 'Caption' })).toBeNull();
    back();
    const field = screen.getByRole('textbox', { name: 'Caption' });
    expect(field).toHaveValue('Readings');
    expect(field).toHaveFocus();
  });

  it('draws on the body where nothing keeps the page', () => {
    function Dialog() {
      return createPortal(<div role="dialog" />, usePageLayer());
    }
    render(<Dialog />);
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
  });
});
