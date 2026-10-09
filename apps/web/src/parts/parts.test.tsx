import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Icon } from '../editor/Icon.js';
import { Chip } from './Chip.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { IconButton } from './IconButton.js';
import { PanelTabs } from './PanelTabs.js';
import { RowActions } from './RowActions.js';
import { SidePanel } from './SidePanel.js';
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

describe('a side panel', () => {
  function Listing() {
    const [open, setOpen] = useState<string | null>(null);
    return (
      <>
        {['General', 'Regulatory'].map((name) => (
          <button key={name} type="button" onClick={() => setOpen(name)}>
            {`Access to ${name}`}
          </button>
        ))}
        <button type="button">Elsewhere</button>
        {open !== null && (
          <SidePanel
            key={open}
            heading={`Access to ${open}`}
            description="Space. Grants here add to the environment's."
            icon="Access"
            onClose={() => setOpen(null)}
          >
            <button type="button">Grant access</button>
          </SidePanel>
        )}
      </>
    );
  }

  it('is named by its heading, takes the focus, closes on Escape and gives it back to its opener', async () => {
    render(<Listing />);
    const opener = screen.getByRole('button', { name: 'Access to General' });
    await userEvent.click(opener);
    const panel = screen.getByRole('complementary', { name: 'Access to General' });
    expect(within(panel).getByRole('heading', { name: 'Access to General' })).toHaveFocus();
    expect(panel).toHaveTextContent("Space. Grants here add to the environment's.");
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes by its button, and never takes the focus back from a row chosen while it was open', async () => {
    render(<Listing />);
    await userEvent.click(screen.getByRole('button', { name: 'Access to General' }));
    // Another row's panel replaces it: focus goes to the new one, not back to the first opener.
    await userEvent.click(screen.getByRole('button', { name: 'Access to Regulatory' }));
    const panel = screen.getByRole('complementary', { name: 'Access to Regulatory' });
    expect(within(panel).getByRole('heading', { name: 'Access to Regulatory' })).toHaveFocus();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Access to Regulatory' })).toHaveFocus();
  });
});

describe('a confirmation', () => {
  it('asks first: named by its question, focus on keeping, Keep it acting on nothing and the danger button acting once', async () => {
    const remove = vi.fn(() => Promise.resolve());
    const keep = vi.fn();
    render(
      <ConfirmDialog
        question="Delete Reviewers?"
        sentence="Everything granted to this group is deleted with it, so its members lose whatever they held only through it."
        detail="5 members: Alice Byrne, Ada Nolan, Marta Silva and 2 more"
        keep="Keep it"
        act="Delete group"
        onKeep={keep}
        onAct={remove}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Reviewers?' });
    expect(dialog).toHaveTextContent('5 members: Alice Byrne, Ada Nolan, Marta Silva and 2 more');
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toHaveFocus();
    const act = within(dialog).getByRole('button', { name: 'Delete group' });
    expect(act).toHaveAttribute('data-tone', 'danger');
    await userEvent.dblClick(act);
    expect(remove).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('keeps on Escape', async () => {
    const keep = vi.fn();
    render(
      <ConfirmDialog
        question="Revoke CI publishing?"
        sentence="Revoking a token ends it at once, without waiting for it to expire."
        keep="Keep it"
        act="Revoke"
        onKeep={keep}
        onAct={() => Promise.resolve()}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(keep).toHaveBeenCalledTimes(1);
  });
});

describe("a row's actions", () => {
  const actions = (picked: string[]) => ({
    shown: [
      {
        label: 'Access',
        name: 'Access to General',
        icon: 'Access',
        onSelect: () => picked.push('access'),
      },
      {
        label: 'Rename',
        name: 'Rename General',
        icon: 'Rename',
        onSelect: () => picked.push('rename'),
      },
    ],
    more: [
      { label: 'Archive', onSelect: () => picked.push('archive') },
      { label: 'Delete', onSelect: () => picked.push('delete'), danger: true },
    ],
  });

  it('shows at most two as icon buttons, each named for its row and titled with its action', async () => {
    const picked: string[] = [];
    render(<RowActions subject="General" {...actions(picked)} />);
    const access = screen.getByRole('button', { name: 'Access to General' });
    expect(access).toHaveAttribute('title', 'Access');
    expect(access.querySelector('svg[data-icon="Access"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Rename General' }));
    expect(picked).toEqual(['rename']);
    expect(() =>
      render(
        <RowActions
          subject="Too many"
          shown={[
            ...actions([]).shown,
            { label: 'x', name: 'x', icon: 'Delete', onSelect: () => {} },
          ]}
          more={[]}
        />,
      ),
    ).toThrow(/at most two/);
  });

  it('says why an action cannot be taken, and does not take it', async () => {
    const picked: string[] = [];
    render(
      <RowActions
        subject="sam.okafor@acme.example"
        shown={[
          {
            label: 'API tokens',
            name: 'API tokens of sam.okafor@acme.example',
            icon: 'API tokens',
            onSelect: () => picked.push('tokens'),
            unavailable: 'Not signed in yet, so no tokens',
          },
        ]}
        more={[]}
      />,
    );
    const tokens = screen.getByRole('button', { name: 'API tokens of sam.okafor@acme.example' });
    expect(tokens).toHaveAttribute('aria-disabled', 'true');
    expect(tokens).toHaveAttribute('title', 'Not signed in yet, so no tokens');
    await userEvent.click(tokens);
    expect(picked).toEqual([]);
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('keeps a button as an action arrives beside it, and as one in its slot gives way to another', () => {
    const access = {
      label: 'Access',
      name: 'Access to Training',
      icon: 'Access',
      onSelect: () => {},
    };
    const rename = {
      label: 'Rename',
      name: 'Rename Training',
      icon: 'Rename',
      slot: 'change',
      onSelect: () => {},
    };
    const restore = {
      label: 'Restore',
      name: 'Restore Training',
      icon: 'Restore',
      slot: 'change',
      onSelect: () => {},
    };
    const { rerender } = render(<RowActions subject="Training" shown={[restore]} more={[]} />);
    const button = screen.getByRole('button', { name: 'Restore Training' });
    button.focus();
    // Access, read later, arrives first in the row: Restore is still the button it was.
    rerender(<RowActions subject="Training" shown={[access, restore]} more={[]} />);
    expect(screen.getByRole('button', { name: 'Restore Training' })).toBe(button);
    // Restored, its Restore becomes Rename in the same place, the focus still on it.
    rerender(<RowActions subject="Training" shown={[access, rename]} more={[]} />);
    expect(screen.getByRole('button', { name: 'Rename Training' })).toBe(button);
    expect(button).toHaveFocus();
  });

  it('puts the rest under More actions, worked by the arrows, Escape giving the focus back', async () => {
    const picked: string[] = [];
    render(<RowActions subject="General" {...actions(picked)} />);
    const more = screen.getByRole('button', { name: 'More actions for General' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    more.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'More actions for General' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();

    await userEvent.click(more);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(picked).toEqual(['delete']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
  });
});

describe("Administration's glyphs", () => {
  it('draws each action Administration names, on its own grid', () => {
    const names = [
      'Rename',
      'Access',
      'Archive',
      'Restore',
      'API tokens',
      'Members',
      'Delete',
      'Revoke',
      'Withdraw',
      'Invite people',
      'More actions',
    ];
    const { container } = render(
      <>
        {names.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </>,
    );
    expect([...container.querySelectorAll('svg')].map((svg) => svg.dataset['icon'])).toEqual(names);
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    }
  });
});
