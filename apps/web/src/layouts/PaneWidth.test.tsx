import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PaneSeparator, PaneToggle, usePaneWidth } from './PaneWidth.js';

const BOUNDS = { storageKey: 'aw.test.width', min: 220, max: 520, initial: 300 };

/** A page with one pane: its width shown, the separator beside it and the toggle that hides it. */
function Page() {
  const pane = usePaneWidth(BOUNDS);
  return (
    <>
      <p>{pane.collapsed ? 'hidden' : `${pane.width}px`}</p>
      <PaneToggle label="outline" pane={pane} />
      {!pane.collapsed && <PaneSeparator label="outline" pane={pane} />}
    </>
  );
}

afterEach(() => window.localStorage.clear());

describe('a pane whose width the reader sets', () => {
  it('resizes with the arrow keys within its bounds, and remembers the width', async () => {
    const { unmount } = render(<Page />);
    const separator = screen.getByRole('separator', { name: 'Resize the outline' });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    expect(separator).toHaveAttribute('aria-valuemin', '220');
    expect(separator).toHaveAttribute('aria-valuemax', '520');

    separator.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('320px')).toBeInTheDocument();
    await userEvent.keyboard('{End}');
    expect(screen.getByText('520px')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('520px')).toBeInTheDocument();
    await userEvent.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByText('220px')).toBeInTheDocument();

    unmount();
    render(<Page />);
    expect(screen.getByText('220px')).toBeInTheDocument();
  });

  it('hides to a rail and shows again, remembering which', async () => {
    const { unmount } = render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the outline' }));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();

    unmount();
    render(<Page />);
    expect(screen.getByText('hidden')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the outline' }));
    expect(screen.getByText('300px')).toBeInTheDocument();
  });
});
