import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Rail } from './Rail.js';

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
    const link = (name: string) =>
      within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', { name });
    expect(link('Query definitions')).toHaveAttribute('href', '#/query-definitions');

    leave('#/query-definitions/new', '#/components');
    rerender(<Rail module="Components" />);
    expect(link('Query definitions')).toHaveAttribute('href', '#/query-definitions/new');
    expect(link('Components')).toHaveAttribute('href', '#/components');

    // Back in it, its own link starts it over.
    leave('#/components', '#/query-definitions/new');
    rerender(<Rail module="Query definitions" />);
    expect(link('Query definitions')).toHaveAttribute('href', '#/query-definitions');
    expect(link('Components')).toHaveAttribute('href', '#/components');
  });

  it('reaches Home and every module by Tab, in groups, the one it is in marked', async () => {
    render(<Rail module="Documents" />);

    const rail = screen.getByRole('navigation', { name: 'Modules' });
    const reached: string[] = [];
    for (let presses = 0; presses < 8; presses += 1) {
      await userEvent.tab();
      reached.push(document.activeElement?.textContent ?? '');
    }
    expect(reached).toEqual([
      'Home',
      'Components',
      'Documents',
      'Templates',
      'Publications',
      'Connections',
      'Query definitions',
      'Admin',
    ]);
    expect(within(rail).getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail).getByRole('link', { name: 'Query definitions' })).toHaveAttribute(
      'href',
      '#/query-definitions',
    );
    expect(
      within(within(rail).getByRole('list', { name: 'Author' })).getAllByRole('link'),
    ).toHaveLength(3);
    expect(
      within(within(rail).getByRole('list', { name: 'Publish' })).getAllByRole('link'),
    ).toHaveLength(1);
    expect(
      within(within(rail).getByRole('list', { name: 'Data' })).getAllByRole('link'),
    ).toHaveLength(2);
  });

  it('marks Home on Home, and no module', () => {
    render(<Rail module={null} />);
    const rail = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail).getByRole('link', { name: 'Components' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('links Admin to Administration, a page, marked when it is open', () => {
    const { rerender } = render(<Rail module="Components" />);
    const admin = () =>
      within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', {
        name: 'Admin',
      });
    expect(admin()).toHaveAttribute('href', '#/admin/overview');
    expect(admin()).not.toHaveAttribute('aria-current');
    rerender(<Rail module="Administration" />);
    expect(admin()).toHaveAttribute('aria-current', 'page');
  });
});
