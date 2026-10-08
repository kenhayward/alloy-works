import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { CommandPalette, useCommandKey } from './CommandPalette.js';

/** A page with the palette on Ctrl K, a field that takes Ctrl K for itself, and a plain button. */
function Page() {
  const [open, setOpen] = useCommandKey();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Search components, documents, or run a command
      </button>
      <div
        role="textbox"
        aria-label="Text"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === 'k') event.preventDefault();
        }}
      />
      {open && <CommandPalette onClose={() => setOpen(false)} />}
    </>
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('search and commands', () => {
  it('opens on Ctrl K and goes to the module typed, by keyboard alone', async () => {
    render(<Page />);

    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = screen.getByRole('dialog', { name: 'Search and commands' });
    const box = within(dialog).getByRole('combobox', { name: 'Search or go to' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'query');
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Search for "query"', 'Go to Query definitions']);
    await userEvent.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('option', { name: 'Go to Query definitions' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Enter}');

    expect(window.location.hash).toBe('#/query-definitions');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers every module before anything is typed, and searches for what is typed', async () => {
    render(<Page />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Search components, documents, or run a command' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Search and commands' });
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual([
      'Go to Home',
      'Go to Components',
      'Go to Documents',
      'Go to Templates',
      'Go to Publications',
      'Go to Connections',
      'Go to Query definitions',
    ]);
    await userEvent.type(within(dialog).getByRole('combobox'), 'pump housing{Enter}');

    expect(window.location.hash).toBe('#/search?q=pump%20housing');
  });

  it('closes on Escape, returning the focus to where it was', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', {
      name: 'Search components, documents, or run a command',
    });

    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("leaves Ctrl K to a field that takes it, as a component's text does for Link", async () => {
    render(<Page />);

    screen.getByRole('textbox', { name: 'Text' }).focus();
    await userEvent.keyboard('{Control>}k{/Control}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
