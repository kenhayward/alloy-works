import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Rail } from './Rail.js';

/** The service, as far as Administration's first section asks it. */
const service = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const asked = input instanceof Request ? input : new Request(String(input), init);
  const path = new URL(asked.url, 'http://rail.test').pathname;
  const body = path === '/v1/tenant' ? { name: 'Development' } : {};
  return new Response(JSON.stringify(body), {
    status: path === '/v1/tenant' ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

afterEach(() => vi.clearAllMocks());

describe('the module rail', () => {
  it('reaches Home and every module by Tab, in groups, the one it is in marked', async () => {
    render(<Rail module="Documents" fetch={service} />);

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
    render(<Rail module={null} fetch={service} />);
    const rail = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail).getByRole('link', { name: 'Components' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens Administration from its foot, and closes it', async () => {
    render(<Rail module="Components" fetch={service} about={<p>the scaffolding</p>} />);

    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByRole('dialog', { name: 'Administration' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toHaveFocus();
  });
});
