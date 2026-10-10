import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComponentDock } from './ComponentDock.js';

/** A client that never answers: these tests choose no panel that asks the service anything. */
const client = { GET: () => new Promise(() => {}) } as never;

const tabNames = () =>
  within(screen.getByRole('tablist', { name: 'Component panels' }))
    .getAllByRole('tab')
    .map((tab) => tab.textContent);

describe("an open component's panels", () => {
  it('offers the Table tab first while the component holds a table, and chooses it each time the cursor enters one (ADR-0052)', async () => {
    const dock = (holds: boolean, entered: number) => (
      <ComponentDock
        client={client}
        id="c"
        onFieldsHost={() => {}}
        table={{ holds, entered }}
        onTableHost={() => {}}
      />
    );
    const { rerender } = render(dock(false, 0));
    expect(tabNames()).toEqual(['Attributes', 'Versions', 'Access']);

    rerender(dock(true, 0));
    expect(tabNames()).toEqual(['Table', 'Attributes', 'Versions', 'Access']);
    // Holding a table chooses nothing: the cursor entering one does.
    expect(screen.getByRole('tab', { name: 'Attributes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    rerender(dock(true, 1));
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');

    // The reader's own choice stands until the cursor enters a table again.
    await userEvent.click(screen.getByRole('tab', { name: 'Access' }));
    rerender(dock(true, 1));
    expect(screen.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true');
    rerender(dock(true, 2));
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Table' })).toBeInTheDocument();
  });
});
