import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Rail } from './Rail.js';

const rail = () => screen.getByRole('navigation', { name: 'Modules' });
const link = (name: string) => within(rail()).getByRole('link', { name });

afterEach(() => {
  window.localStorage.removeItem('alloy-works.go-to-keys');
});

describe('the module rail', () => {
  it('links each module to where it was left, and the one it is in to its start', () => {
    const leave = (from: string, to: string) => {
      window.location.hash = from;
      const oldURL = window.location.href;
      window.location.hash = to;
      window.dispatchEvent(
        new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
      );
    };
    const { rerender } = render(<Rail module="Components" />);
    expect(link('Prompts')).toHaveAttribute('href', '#/prompts');

    leave('#/prompts/new', '#/components');
    rerender(<Rail module="Components" />);
    expect(link('Prompts')).toHaveAttribute('href', '#/prompts/new');
    expect(link('Components')).toHaveAttribute('href', '#/components');

    // Back in it, its own link starts it over.
    leave('#/components', '#/prompts/new');
    rerender(<Rail module="Prompts" />);
    expect(link('Prompts')).toHaveAttribute('href', '#/prompts');
    expect(link('Components')).toHaveAttribute('href', '#/components');
  });

  it('reaches the mark, the environment, Home and every module by Tab, in groups, the one it is in marked', async () => {
    render(<Rail module="Documents" environment="Development" />);

    const reached: (string | null | undefined)[] = [];
    for (let presses = 0; presses < 13; presses += 1) {
      await userEvent.tab();
      reached.push(document.activeElement?.getAttribute('aria-label'));
    }
    expect(reached).toEqual([
      'Alloy Works',
      'Development',
      'Home',
      'Components',
      'Documents',
      'Templates',
      'Prompts',
      'Bibliography',
      'Terms',
      'Images',
      'Conversations',
      'Publications',
      'Administration',
    ]);
    expect(link('Documents')).toHaveAttribute('aria-current', 'page');
    expect(
      within(within(rail()).getByRole('list', { name: 'Author' })).getAllByRole('link'),
    ).toHaveLength(4);
    expect(
      within(within(rail()).getByRole('list', { name: 'Library' })).getAllByRole('link'),
    ).toHaveLength(3);
    expect(
      within(within(rail()).getByRole('list', { name: 'Publish' })).getAllByRole('link'),
    ).toHaveLength(2);
    expect(within(rail()).queryByRole('list', { name: 'Data' })).not.toBeInTheDocument();
  });

  it('marks Home on Home, and no module', () => {
    render(<Rail module={null} />);
    expect(link('Home')).toHaveAttribute('aria-current', 'page');
    expect(link('Components')).not.toHaveAttribute('aria-current');
  });

  it('links to Administration, a page, marked when it is open', () => {
    const { rerender } = render(<Rail module="Components" />);
    expect(link('Administration')).toHaveAttribute('href', '#/admin/overview');
    expect(link('Administration')).not.toHaveAttribute('aria-current');
    rerender(<Rail module="Administration" />);
    expect(link('Administration')).toHaveAttribute('aria-current', 'page');
  });

  it('holds no Connections or Query definitions, and marks Administration current on either', () => {
    const { rerender } = render(<Rail module="Connections" />);
    expect(within(rail()).queryByRole('link', { name: 'Connections' })).not.toBeInTheDocument();
    expect(
      within(rail()).queryByRole('link', { name: 'Query definitions' }),
    ).not.toBeInTheDocument();
    expect(link('Administration')).toHaveAttribute('aria-current', 'page');
    rerender(<Rail module="Query definitions" />);
    expect(link('Administration')).toHaveAttribute('aria-current', 'page');
    expect(link('Components')).not.toHaveAttribute('aria-current');
  });

  it('returns to Home from the mark, and says the environment on a chip of its letters', () => {
    render(<Rail module="Components" environment="Development" />);
    expect(link('Alloy Works')).toHaveAttribute('href', '#/');
    expect(within(rail()).getByRole('img', { name: 'Development' })).toHaveTextContent('DEV');
  });

  it('names each icon link in words, and shows that name at once on hover and on focus', async () => {
    render(<Rail module="Components" />);

    // The name is the link's own: what the tip shows repeats it, hidden from assistive technology.
    expect(link('Documents').textContent).toBe('');
    expect(document.querySelector('[data-name-tip]')).toBeNull();
    fireEvent.mouseEnter(link('Documents').parentElement!);
    const tip = document.querySelector('[data-name-tip]')!;
    expect(tip).toHaveTextContent('Documents');
    expect(tip).toHaveAttribute('aria-hidden', 'true');
    fireEvent.mouseLeave(link('Documents').parentElement!);
    expect(document.querySelector('[data-name-tip]')).toBeNull();

    link('Terms').focus();
    fireEvent.focusIn(link('Terms'));
    expect(document.querySelector('[data-name-tip]')).toHaveTextContent('Terms');
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[data-name-tip]')).toBeNull();
  });

  it("says a module's go-to keys in its name tip, and none once they are turned off", () => {
    const { unmount } = render(<Rail module="Components" />);
    expect(link('Documents')).toHaveAttribute('data-go-to', 'd');
    fireEvent.mouseEnter(link('Documents').parentElement!);
    expect(document.querySelector('[data-name-tip] kbd')).toHaveTextContent('G D');
    unmount();

    window.localStorage.setItem('alloy-works.go-to-keys', 'off');
    render(<Rail module="Components" />);
    fireEvent.mouseEnter(link('Documents').parentElement!);
    expect(document.querySelector('[data-name-tip]')).toHaveTextContent('Documents');
    expect(document.querySelector('[data-name-tip] kbd')).toBeNull();
  });
});
