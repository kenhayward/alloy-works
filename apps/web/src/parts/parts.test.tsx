import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Chip } from './Chip.js';
import { IconButton } from './IconButton.js';
import { PanelTabs } from './PanelTabs.js';
import { Toolbar } from './Toolbar.js';

describe('a grouped toolbar', () => {
  function Tools() {
    return (
      <>
        <button type="button">Before</button>
        <Toolbar label="Tools">
          <button type="button">Bold</button>
          <button type="button">Italic</button>
          <Toolbar.Divider />
          <button type="button" aria-disabled="true">
            Undo
          </button>
        </Toolbar>
        <button type="button">After</button>
      </>
    );
  }

  it('is one tab stop, the arrows, Home and End moving along it and wrapping', async () => {
    render(<Tools />);
    const tools = screen.getByRole('toolbar', { name: 'Tools' });

    await userEvent.tab();
    await userEvent.tab();
    expect(within(tools).getByRole('button', { name: 'Bold' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();

    await userEvent.tab({ shift: true });
    await userEvent.keyboard('{ArrowRight}');
    expect(within(tools).getByRole('button', { name: 'Italic' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(tools).getByRole('button', { name: 'Undo' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(tools).getByRole('button', { name: 'Bold' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(tools).getByRole('button', { name: 'Undo' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(within(tools).getByRole('button', { name: 'Bold' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(tools).getByRole('button', { name: 'Undo' })).toHaveFocus();
  });

  it('comes back to the button last used, whether reached by the arrows or a click', async () => {
    render(<Tools />);
    const tools = screen.getByRole('toolbar', { name: 'Tools' });

    await userEvent.click(within(tools).getByRole('button', { name: 'Italic' }));
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    await userEvent.tab({ shift: true });

    expect(within(tools).getByRole('button', { name: 'Italic' })).toHaveFocus();
    expect(
      within(tools)
        .getAllByRole('button')
        .filter((each) => each.tabIndex === 0),
    ).toHaveLength(1);
  });
});

describe('an icon button', () => {
  it('is named in words, says its shortcut on hover, and shows whether it is pressed', async () => {
    const pressed = vi.fn();
    render(
      <IconButton label="Bold" shortcut="Ctrl or Cmd and B" pressed onClick={pressed}>
        <svg />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Bold' });
    expect(button).toHaveAttribute('title', 'Bold (Ctrl or Cmd and B)');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(pressed).toHaveBeenCalledOnce();
  });

  it('is titled with its name alone where it has no shortcut, and claims no pressed state', () => {
    render(
      <IconButton label="Close">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('title', 'Close');
    expect(button).not.toHaveAttribute('aria-pressed');
  });
});

describe('panel tabs', () => {
  const TABS = [
    { key: 'part', label: 'Part' },
    { key: 'used', label: 'Used in' },
    { key: 'history', label: 'History' },
  ];

  function Tabs() {
    const [chosen, setChosen] = useState('part');
    return (
      <PanelTabs
        label="The part's panel"
        tabs={TABS}
        chosen={chosen}
        onChoose={setChosen}
        ids={(key) => ({ tab: `tab-${key}`, panel: `panel-${key}` })}
      />
    );
  }

  it('names each panel in words, one stop, the arrows choosing as they go', async () => {
    render(<Tabs />);
    const list = screen.getByRole('tablist', { name: "The part's panel" });
    expect(
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Part', 'Used in', 'History']);

    await userEvent.tab();
    expect(within(list).getByRole('tab', { name: 'Part' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const used = within(list).getByRole('tab', { name: 'Used in' });
    expect(used).toHaveFocus();
    expect(used).toHaveAttribute('aria-selected', 'true');
    expect(used).toHaveAttribute('aria-controls', 'panel-used');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(within(list).getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Home}');
    expect(within(list).getByRole('tab', { name: 'Part' })).toHaveFocus();
    expect(
      within(list)
        .getAllByRole('tab')
        .filter((tab) => tab.tabIndex === 0),
    ).toHaveLength(1);
  });
});

describe('a chip', () => {
  it('says its words, in the tone that means its status', () => {
    render(
      <>
        <Chip tone="warn">Not approved</Chip>
        <Chip>en-GB</Chip>
      </>,
    );
    expect(screen.getByText('Not approved')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByText('en-GB')).toHaveAttribute('data-tone', 'neutral');
  });
});
