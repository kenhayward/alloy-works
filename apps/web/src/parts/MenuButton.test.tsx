import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MenuButton } from './MenuButton.js';
import { Toolbar } from './Toolbar.js';

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

  it('keeps its keys to itself inside a toolbar, which never moves the focus out of it open', async () => {
    const user = userEvent.setup();
    render(
      <Toolbar label="Conversation">
        <MenuButton
          label="Earlier conversations"
          face="History"
          items={[
            { key: 'a', label: 'About the weir', onSelect: () => {} },
            { key: 'b', label: 'Levels', onSelect: () => {} },
          ]}
        />
        <button type="button">New</button>
      </Toolbar>,
    );
    await user.click(screen.getByRole('button', { name: 'Earlier conversations' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'About the weir' })).toHaveFocus();
    await user.keyboard('{Escape}');
    // The toolbar's stop is the button, never an item gone with the menu.
    expect(
      screen
        .getAllByRole('button')
        .filter((each) => each.tabIndex === 0)
        .map((each) => each.getAttribute('aria-label') ?? each.textContent),
    ).toEqual(['Earlier conversations']);
  });

  it('says so when it has nothing to offer', async () => {
    const user = userEvent.setup();
    render(
      <MenuButton label="Earlier conversations" face="History" items={[]} empty="None kept yet." />,
    );
    const button = screen.getByRole('button', { name: 'Earlier conversations' });
    await user.click(button);
    // Said beside the button, never as a menu holding no item.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('None kept yet.')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('None kept yet.')).toBeNull();
    expect(button).toHaveFocus();
  });
});
