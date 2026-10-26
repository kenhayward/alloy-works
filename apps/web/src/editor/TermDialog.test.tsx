import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NO_TERMS, TermDialog, TERMS_TRUNCATED } from './TermDialog.js';
import type { TermChoice } from './terming.js';

const WHO = '22222222-2222-4222-8222-222222222221';
const DUNNART = '22222222-2222-4222-8222-222222222222';
const TIDE = '22222222-2222-4222-8222-222222222223';
const LEVEL = '22222222-2222-4222-8222-222222222224';

const TERMS: TermChoice[] = [
  {
    id: WHO,
    label: 'World Health Organization',
    abbreviation: 'WHO',
    forms: ['World Health Organization', 'WHO'],
    standing: 'approved',
    replacedBy: null,
  },
  {
    id: DUNNART,
    label: 'Fat-tailed dunnart',
    abbreviation: null,
    forms: ['Fat-tailed dunnart', 'Dunnart'],
    standing: 'approved',
    replacedBy: null,
  },
  {
    id: TIDE,
    label: 'Mean tide',
    abbreviation: 'MT',
    forms: ['Mean tide', 'MT'],
    standing: 'deprecated',
    replacedBy: WHO,
  },
  {
    id: LEVEL,
    label: 'Sea level',
    abbreviation: 'SL',
    forms: ['Sea level', 'SL'],
    standing: 'draft',
    replacedBy: null,
  },
];

function open(props: Partial<Parameters<typeof TermDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onRemove = vi.fn();
  const onCancel = vi.fn();
  render(
    <TermDialog
      terms={TERMS}
      current={null}
      removable={false}
      selected="WHO"
      onApply={onApply}
      onRemove={onRemove}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onApply, onRemove, onCancel };
}

describe('the Term dialog (the TM plan, TMc)', () => {
  it("CNT-165 offers the space's approved terms, found by label, alternative or abbreviation, and applies the one chosen", async () => {
    const { onApply } = open();
    const dialog = screen.getByRole('dialog', { name: 'Term' });
    const offered = () =>
      within(dialog)
        .getAllByRole('radio')
        .map((each) => each.closest('label')!.textContent);
    // A draft is not offered; a deprecated one is, said so.
    expect(offered()).toEqual([
      'World Health Organization (WHO)',
      'Fat-tailed dunnart',
      'Mean tide (MT), deprecated',
    ]);
    const find = within(dialog).getByRole('searchbox', { name: 'Find a term' });
    expect(find).toHaveFocus();
    await userEvent.type(find, 'dunnart');
    expect(offered()).toEqual(['Fat-tailed dunnart']);
    await userEvent.clear(find);
    await userEvent.type(find, 'who{Enter}');
    expect(onApply).toHaveBeenCalledWith({ term: WHO });
  });

  it('LIB-057 flags a deprecated term as it is chosen, naming its replacement and offering it', async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole('radio', { name: 'Mean tide (MT), deprecated' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mean tide is deprecated. Use World Health Organization instead.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use World Health Organization' }));
    expect(screen.getByRole('radio', { name: 'World Health Organization (WHO)' })).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ term: WHO });
  });

  it('opens on the term the words carry, and takes it off', async () => {
    const { onRemove, onCancel } = open({ current: DUNNART, removable: true });
    expect(screen.getByRole('radio', { name: 'Fat-tailed dunnart' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Remove term' }));
    expect(onRemove).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('says where the space holds no term to offer', () => {
    open({ terms: [] });
    expect(screen.getByText(NO_TERMS())).toBeInTheDocument();
  });

  it('says quietly when the space held more terms than are offered', () => {
    open({ truncated: true });
    expect(screen.getByText(TERMS_TRUNCATED)).toBeInTheDocument();
    expect(screen.getByText(TERMS_TRUNCATED)).not.toHaveAttribute('role');
  });
});
