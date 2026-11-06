import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Flyout, MenuBar, type MenuSpec } from './MenuBar.js';

const menus = (run: (key: string) => void): readonly MenuSpec[] => [
  {
    key: 'document',
    label: 'Document',
    letter: 'D',
    entries: [
      { kind: 'item', key: 'preview', label: 'Preview', enabled: true, run: () => run('preview') },
      { kind: 'divider', key: 'one' },
      { kind: 'item', key: 'archive', label: 'Archive', enabled: false, run: () => run('archive') },
    ],
  },
  {
    key: 'view',
    label: 'View',
    letter: 'V',
    entries: [
      {
        kind: 'item',
        key: 'boundaries',
        label: 'Show boundaries',
        role: 'menuitemcheckbox',
        checked: true,
        enabled: true,
        keys: 'Ctrl Alt B',
        ariaKeys: 'Control+Alt+B',
        run: () => run('boundaries'),
      },
      {
        kind: 'submenu',
        key: 'style',
        label: 'Paragraph style',
        enabled: true,
        entries: [
          {
            kind: 'item',
            key: 'body',
            label: 'Body',
            role: 'menuitemradio',
            checked: true,
            enabled: true,
            run: () => run('body'),
          },
        ],
      },
    ],
  },
];

describe('the menu bar', () => {
  it('CNT-188 says a command item its words and keys, and aria-keyshortcuts the same', async () => {
    render(<MenuBar label="Document menus" menus={menus(() => undefined)} />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    const item = screen.getByRole('menuitemcheckbox', { name: 'Show boundaries' });
    expect(item).toHaveAttribute('aria-checked', 'true');
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+B');
    expect(item).toHaveTextContent('Ctrl Alt B');
  });

  it('CNT-077 F10 reaches the bar, the arrows move, Enter opens, and Escape returns to the text', async () => {
    render(
      <>
        <textarea aria-label="the text" />
        <MenuBar label="Document menus" menus={menus(() => undefined)} />
      </>,
    );
    const text = screen.getByRole('textbox', { name: 'the text' });
    text.focus();
    await userEvent.keyboard('{F10}');
    expect(screen.getByRole('menuitem', { name: 'Document' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show boundaries' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(text).toHaveFocus();
  });

  it('opens by its access letter with Alt', async () => {
    render(<MenuBar label="Document menus" menus={menus(() => undefined)} />);
    await userEvent.keyboard('{Alt>}v{/Alt}');
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
  });

  it('once one is open, pointing at another opens it', async () => {
    render(<MenuBar label="Document menus" menus={menus(() => undefined)} />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Document' }));
    await userEvent.hover(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByRole('menu', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Document' })).not.toBeInTheDocument();
  });

  it('runs a chosen item, closes, and gives the focus back before it runs', async () => {
    const ran = vi.fn();
    render(
      <>
        <textarea aria-label="the text" />
        <MenuBar label="Document menus" menus={menus(ran)} />
      </>,
    );
    const text = screen.getByRole('textbox', { name: 'the text' });
    text.focus();
    await userEvent.keyboard('{F10}{Enter}{Enter}');
    expect(ran).toHaveBeenCalledWith('preview');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(text).toHaveFocus());
  });

  it('keeps an item that cannot apply, aria-disabled, and does nothing on choosing it', async () => {
    const ran = vi.fn();
    render(<MenuBar label="Document menus" menus={menus(ran)} />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Document' }));
    const archive = screen.getByRole('menuitem', { name: 'Archive' });
    expect(archive).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(archive);
    expect(ran).not.toHaveBeenCalled();
  });

  it('opens a submenu by the right arrow and closes it by the left, on one level', async () => {
    render(<MenuBar label="Document menus" menus={menus(() => undefined)} />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    screen.getByRole('menuitem', { name: 'Paragraph style' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitemradio', { name: 'Body' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menuitem', { name: 'Paragraph style' })).toHaveFocus();
    expect(screen.queryByRole('menuitemradio', { name: 'Body' })).not.toBeInTheDocument();
  });

  it('closes when the focus is taken elsewhere by the pointer', async () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <MenuBar label="Document menus" menus={menus(() => undefined)} />
      </>,
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a flyout gives the focus back to what had it once a row is chosen, so typing goes on', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <>
        <textarea aria-label="Text" />
        <Flyout
          label="Style"
          entries={[{ kind: 'item', key: 'lead', label: 'Lead', enabled: true, run }]}
        >
          S
        </Flyout>
      </>,
    );
    screen.getByRole('textbox', { name: 'Text' }).focus();
    await user.click(screen.getByRole('button', { name: 'Style' }));
    await user.click(screen.getByRole('menuitem', { name: 'Lead' }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveFocus();
  });

  it('a flyout says when it opens, and its rows can change while it is open', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const row = (enabled: boolean) => [
      { kind: 'item' as const, key: 'archive', label: 'Archive', enabled, run: vi.fn() },
    ];
    const { rerender } = render(
      <Flyout label="More actions" entries={row(false)} onOpen={onOpen} under>
        M
      </Flyout>,
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    rerender(
      <Flyout label="More actions" entries={row(true)} onOpen={onOpen} under>
        M
      </Flyout>,
    );
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await user.keyboard('{Escape}');
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('takes no key while a dialog stands over the page', async () => {
    const user = userEvent.setup();
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Over" />
        <MenuBar
          label="Menus"
          menus={[{ key: 'd', label: 'Document', letter: 'D', entries: [] }]}
        />
      </>,
    );
    await user.keyboard('{F10}');
    expect(screen.getByRole('menuitem', { name: 'Document' })).not.toHaveFocus();
  });

  it('closes on Tab, the focus given back', async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea aria-label="Text" />
        <MenuBar
          label="Menus"
          menus={[
            {
              key: 'd',
              label: 'Document',
              letter: 'D',
              entries: [
                { kind: 'item', key: 'x', label: 'Save', enabled: true, run: () => undefined },
              ],
            },
          ]}
        />
      </>,
    );
    screen.getByRole('textbox', { name: 'Text' }).focus();
    await user.click(screen.getByRole('menuitem', { name: 'Document' }));
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveFocus();
  });
});
