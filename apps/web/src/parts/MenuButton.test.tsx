import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MenuButton } from './MenuButton.js';

describe('a button opening a menu of choices', () => {
  it('opens on a click, its first item focused, the arrows moving and Escape closing to the button', async () => {
    const user = userEvent.setup();
    render(
      <MenuButton
        label="Earlier conversations"
        face="History"
        items={[
          { key: 'a', label: 'About the weir', onSelect: () => {} },
          { key: 'b', label: 'Levels', onSelect: () => {} },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Earlier conversations' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Earlier conversations' });
    expect(screen.getByRole('menuitem', { name: 'About the weir' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Levels' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'About the weir' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(menu).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('marks the item chosen as a radio, chooses on a click and closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MenuButton
        label="Model: Drafting"
        face="Drafting"
        items={[
          {
            key: 'd',
            label: 'Drafting',
            detail: 'Outside your data boundary',
            checked: true,
            onSelect: () => {},
          },
          { key: 'o', label: 'Ours', checked: false, onSelect },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Model: Drafting' }));
    // Named by its label alone, its detail describing it.
    const drafting = screen.getByRole('menuitemradio', { name: 'Drafting' });
    expect(drafting).toHaveAttribute('aria-checked', 'true');
    expect(drafting).toHaveAccessibleDescription('Outside your data boundary');
    await user.click(screen.getByRole('menuitemradio', { name: 'Ours' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('says so when it has nothing to offer', async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Earlier conversations" face="History" items={[]} empty="None kept yet." />,
    );
    await user.click(screen.getByRole('button', { name: 'Earlier conversations' }));
    expect(screen.getByRole('menu', { name: 'Earlier conversations' })).toHaveTextContent(
      'None kept yet.',
    );
  });
});
