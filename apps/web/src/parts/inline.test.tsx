import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { WordsProvider } from '../words/words.js';
import { inlineKey } from './inline.js';
import { PanelTabs } from './PanelTabs.js';
import { Segmented } from './Segmented.js';
import { Toolbar } from './Toolbar.js';

/** The right-to-left pseudo-locale, its words beside the point here: only its direction. */
const RightToLeft = ({ children }: { children: ReactNode }) => (
  <WordsProvider language="ar-XB">{children}</WordsProvider>
);

describe('the arrows right to left (the UI plan, UI-G)', () => {
  it('LOC-004 reads ArrowLeft as on and ArrowRight as back right to left, and every key as itself left to right', () => {
    expect(inlineKey('ArrowLeft')).toBe('ArrowLeft');
    render(
      <RightToLeft>
        <span />
      </RightToLeft>,
    );
    expect(inlineKey('ArrowLeft')).toBe('ArrowRight');
    expect(inlineKey('ArrowRight')).toBe('ArrowLeft');
    expect(inlineKey('ArrowUp')).toBe('ArrowUp');
  });

  it('LOC-004 moves along a toolbar to the left right to left', async () => {
    render(
      <RightToLeft>
        <Toolbar label="Tools">
          <button type="button">Bold</button>
          <button type="button">Italic</button>
        </Toolbar>
      </RightToLeft>,
    );
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(tools).getByRole('button', { name: 'Italic' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(tools).getByRole('button', { name: 'Bold' })).toHaveFocus();
  });

  it('LOC-004 chooses the next tab to the left right to left', async () => {
    function Tabs() {
      const [chosen, setChosen] = useState('part');
      return (
        <PanelTabs
          label="Panel"
          tabs={[
            { key: 'part', label: 'Part' },
            { key: 'used', label: 'Used in' },
          ]}
          chosen={chosen}
          onChoose={setChosen}
          ids={(key) => ({ tab: `tab-${key}`, panel: `panel-${key}` })}
        />
      );
    }
    render(
      <RightToLeft>
        <Tabs />
      </RightToLeft>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Used in' })).toHaveAttribute('aria-selected', 'true');
  });

  it('LOC-004 chooses the next of a segmented control to the left right to left', async () => {
    function Choice() {
      const [chosen, setChosen] = useState('start');
      return (
        <Segmented
          label="Alignment"
          value={chosen}
          onChange={setChosen}
          options={[
            { value: 'start', name: 'Start', icon: 'Align start' },
            { value: 'end', name: 'End', icon: 'Align end' },
          ]}
        />
      );
    }
    render(
      <RightToLeft>
        <Choice />
      </RightToLeft>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'End' })).toHaveAttribute('aria-checked', 'true');
  });
});
