import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { IconButton } from './IconButton.js';
import { NameTip } from './NameTip.js';

const tip = () => document.querySelector('[data-name-tip]');

describe('a tip at once (ADR-0075; the part-panel-2 handoff)', () => {
  it('shows a second line under the name, and goes on Escape', async () => {
    render(
      <NameTip name="Overrides" hint="In this document only." below align="end">
        <button type="button">Overrides</button>
      </NameTip>,
    );
    await userEvent.hover(screen.getByRole('button'));
    expect(tip()).toHaveTextContent('Overrides');
    expect(tip()?.querySelector('[data-name-tip-hint]')).toHaveTextContent(
      'In this document only.',
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(tip()).toBeNull();
  });

  it('stands at the end of its control, so the last icons keep their tips in the window', async () => {
    render(
      <NameTip name="Remove section" below align="end">
        <button type="button">Remove</button>
      </NameTip>,
    );
    screen.getByRole('button').parentElement!.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: 100, right: 130 }) as DOMRect;
    await userEvent.hover(screen.getByRole('button'));
    expect(tip()).toHaveAttribute('data-align', 'end');
    expect((tip() as HTMLElement).style.right).toBe(`${window.innerWidth - 130}px`);
    expect((tip() as HTMLElement).style.top).toBe('34px');
  });

  it('an icon button with a tip keeps its name and drops the browser tip, on focus as on hover', async () => {
    render(
      <IconButton label="Remove section Methods" tip={{ name: 'Remove section', hint: 'Gone.' }}>
        x
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Remove section Methods' });
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAccessibleDescription('Gone.');
    expect(tip()).toBeNull();
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(tip()).toHaveTextContent('Remove section');
  });

  it('an icon button without one keeps the browser tip', () => {
    render(<IconButton label="Close">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('title', 'Close');
  });
});
