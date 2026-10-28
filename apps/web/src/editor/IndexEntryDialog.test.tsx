import type { IndexEntryChoice } from '@alloy-works/editor';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IndexEntryDialog } from './IndexEntryDialog.js';

const open = (current: IndexEntryChoice | null = null, answer: string | null = null) => {
  const given: IndexEntryChoice[] = [];
  const cancelled = vi.fn();
  render(
    <IndexEntryDialog
      current={current}
      terms={['Alloy', 'Bronze']}
      onDone={(choice) => {
        given.push(choice);
        return answer;
      }}
      onCancel={cancelled}
    />,
  );
  return { given, cancelled };
};

describe('the Index entry dialog (the IX plan, IX-M)', () => {
  it('STR-043 marks a term and sub-entry, held as the content model holds them, from the keyboard alone', async () => {
    const { given } = open();
    const dialog = screen.getByRole('dialog', { name: 'Index entry' });
    expect(dialog).toHaveAccessibleDescription(/prints nothing where it stands/);
    expect(screen.getByRole('combobox', { name: 'Term' })).toHaveFocus();
    // Typed decomposed and with spaces round it: held in NFC, trimmed.
    await userEvent.keyboard(` Cafe${String.fromCharCode(0x301)} `);
    await userEvent.tab();
    await userEvent.keyboard('opening hours{Enter}');
    expect(given).toEqual([{ term: 'Café', sub: 'opening hours', see: null, seeAlso: null }]);
  });

  it('offers the terms the component already carries as the author types', () => {
    open();
    const term = screen.getByRole('combobox', { name: 'Term' });
    const offered = document.getElementById(term.getAttribute('list')!);
    expect([...offered!.querySelectorAll('option')].map((each) => each.value)).toEqual([
      'Alloy',
      'Bronze',
    ]);
  });

  it('gives a "see" or "see also"s in place of this place, one term a line', async () => {
    const { given } = open();
    await userEvent.type(screen.getByRole('combobox', { name: 'Term' }), 'Brass');
    await userEvent.click(screen.getByRole('radio', { name: 'See another term instead' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'See' }), 'Alloy');
    await userEvent.click(
      screen.getByRole('radio', { name: 'This place, and see also other terms' }),
    );
    expect(screen.queryByRole('combobox', { name: 'See' })).toBeNull();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'See also, one term a line' }),
      'Alloy{Enter}{Enter}Bronze',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(given).toEqual([{ term: 'Brass', sub: null, see: null, seeAlso: ['Alloy', 'Bronze'] }]);
  });

  it('refuses what the content model refuses, naming the field and putting the focus on it', async () => {
    const { given } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(given).toEqual([]);
    const term = screen.getByRole('combobox', { name: 'Term' });
    expect(term).toHaveAttribute('aria-invalid', 'true');
    expect(term).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(/Give a term/);
    await userEvent.type(term, 'Tin');
    await userEvent.click(
      screen.getByRole('radio', { name: 'This place, and see also other terms' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'See also, one term a line' }),
      Array.from({ length: 11 }, (_, n) => `T${n}`).join('{Enter}'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(given).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'See also, one term a line' })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(/1 to 10 terms/);
  });

  it('opens on the marker selected to change it, says why it could not, and cancels on Escape', async () => {
    const { given, cancelled } = open(
      { term: 'Brass', sub: null, see: 'Alloy', seeAlso: null },
      'That index entry is not there any more.',
    );
    expect(screen.getByRole('combobox', { name: 'Term' })).toHaveValue('Brass');
    expect(screen.getByRole('radio', { name: 'See another term instead' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'See' })).toHaveValue('Alloy');
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(given).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('That index entry is not there any more.');
    await userEvent.keyboard('{Escape}');
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
