import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Modal } from './Modal.js';

/** A button that opens the modal, as a screen would. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New thing
      </button>
      {open && (
        <Modal labelledBy="thing-heading" onClose={() => setOpen(false)}>
          <h2 id="thing-heading">New thing</h2>
          <label>
            Title
            <input />
          </label>
          <button type="button">Create</button>
        </Modal>
      )}
    </>
  );
}

describe('a modal', () => {
  it('opens as a dialog named by its heading, focusing its first field', async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole('button', { name: 'New thing' }));

    const dialog = screen.getByRole('dialog', { name: 'New thing' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });

  it('closes on Escape and on its close button, returning focus to what opened it', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'New thing' });

    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole('button', { name: 'New thing' }));

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Create' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
