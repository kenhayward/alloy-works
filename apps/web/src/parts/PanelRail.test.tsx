import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { Pane } from '../layouts/PaneWidth.js';
import { PanelRail, type RailTab } from './PanelRail.js';

const TABS: readonly RailTab[] = [
  { key: 'part', label: 'Part', icon: 'Part' },
  { key: 'lists', label: 'Lists', icon: 'Lists', disabled: true },
  { key: 'threads', label: 'Threads', icon: 'Threads', count: 3 },
  { key: 'sources', label: 'Sources', icon: 'Source', name: 'Sources, 1 retracted', tone: 'warn' },
];

/** A pane of its own, collapsed or not, as `usePaneWidth` keeps one. */
function Rail({ collapsed = false }: { collapsed?: boolean }) {
  const [chosen, setChosen] = useState('part');
  const [hidden, setHidden] = useState(collapsed);
  const pane: Pane = {
    width: 320,
    collapsed: hidden,
    bounds: { storageKey: 'test.rail', min: 260, max: 520, initial: 320 },
    setWidth: () => {},
    setCollapsed: setHidden,
  };
  return (
    <>
      <PanelRail
        label="document panels"
        listLabel="Document panels"
        tabs={TABS}
        chosen={chosen}
        onChoose={setChosen}
        ids={(key) => ({ tab: `tab-${key}`, panel: `panel-${key}` })}
        pane={pane}
      />
      <output>{hidden ? 'hidden' : `shown at ${chosen}`}</output>
    </>
  );
}

describe('the document panels’ rail (ADR-0074)', () => {
  it('puts the hide and show toggle first, outside the tabs', async () => {
    render(<Rail />);
    const toggle = screen.getAllByRole('button')[0]!;
    expect(toggle).toHaveAccessibleName('Hide the document panels');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('tablist')).queryByRole('button')).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByRole('status')).toHaveTextContent('hidden');
    expect(toggle).toHaveAccessibleName('Show the document panels');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('names each tab in words, with its count, though it shows an icon', () => {
    render(<Rail />);
    const list = screen.getByRole('tablist', { name: 'Document panels' });
    expect(list).toHaveAttribute('aria-orientation', 'vertical');
    expect(
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label')),
    ).toEqual(['Part', 'Lists', 'Threads, 3', 'Sources, 1 retracted']);
    expect(within(list).getByRole('tab', { name: 'Sources, 1 retracted' })).toHaveAttribute(
      'data-tone',
      'warn',
    );
  });

  it('moves down and up the tabs, wrapping, passing over one not available', async () => {
    render(<Rail />);
    await userEvent.click(screen.getByRole('tab', { name: 'Part' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Threads, 3' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Part' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Sources, 1 retracted' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Part' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Sources, 1 retracted' })).toHaveFocus();
  });

  it('shows the panels at the tab chosen while they are hidden', async () => {
    render(<Rail collapsed />);
    await userEvent.click(screen.getByRole('tab', { name: 'Threads, 3' }));
    expect(screen.getByRole('status')).toHaveTextContent('shown at threads');
  });

  it('shows a tab’s name beside it on focus, and takes it away on Escape', async () => {
    render(<Rail />);
    const part = screen.getByRole('tab', { name: 'Part' });
    const name = part.querySelector('[data-rail-name]')!;
    expect(name).toHaveAttribute('aria-hidden', 'true');
    expect(name).not.toBeVisible();
    act(() => part.focus());
    expect(name).toBeVisible();
    expect(name).toHaveTextContent('Part');
    await userEvent.keyboard('{Escape}');
    expect(name).not.toBeVisible();
  });
});
