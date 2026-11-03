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
  it('offers the Table tab first while the component holds a table, and never chooses it for the reader (ADR-0079)', async () => {
    const dock = (holds: boolean, inHand: boolean) => (
      <ComponentDock
        client={client}
        id="c"
        onFieldsHost={() => {}}
        table={{ holds, inHand }}
        onTableHost={() => {}}
      />
    );
    const { rerender } = render(dock(false, false));
    expect(tabNames()).toEqual(['Attributes', 'Versions', 'Access']);

    rerender(dock(true, false));
    expect(tabNames()).toEqual(['Table', 'Attributes', 'Versions', 'Access']);
    const attributes = screen.getByRole('tab', { name: 'Attributes' });
    expect(attributes).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Table' }).querySelector('[data-dot]')).toBeNull();

    // The cursor entering a table changes no tab: the tab says so, in its dot and its name.
    rerender(dock(true, true));
    expect(attributes).toHaveAttribute('aria-selected', 'true');
    const table = screen.getByRole('tab', { name: 'Table, the cursor is in a table' });
    expect(table.querySelector('[data-dot]')).not.toBeNull();

    // The reader's own choice stands, and the tab showing needs no dot.
    await userEvent.click(table);
    const chosen = screen.getByRole('tab', { name: 'Table' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(chosen.querySelector('[data-dot]')).toBeNull();
    rerender(dock(true, false));
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Table' })).toBeInTheDocument();
  });
});
