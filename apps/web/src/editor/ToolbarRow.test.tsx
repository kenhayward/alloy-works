import { render, screen, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, it } from 'vitest';

import { HeaderHostsProvider, useHeaderHost } from '../shell/HeaderSlot.js';
import { PageShown } from '../shell/Status.js';
import { ToolbarRow, useToolbarHost } from './ToolbarRow.js';

function HeaderRow() {
  const ref = useHeaderHost('toolbar');
  return <div ref={ref} data-testid="row" />;
}

/** A page drawing a toolbar into the row, as a document and a component's own page do. */
function Page() {
  const host = useToolbarHost();
  return (
    <>
      <ToolbarRow host={host} />
      {createPortal(<button type="button">Strong</button>, host)}
    </>
  );
}

describe('the toolbar row under the menus', () => {
  it('stands in the place the header holds for it', () => {
    render(
      <HeaderHostsProvider>
        <HeaderRow />
        <Page />
      </HeaderHostsProvider>,
    );
    expect(
      within(screen.getByTestId('row')).getByRole('button', { name: 'Strong' }),
    ).toBeInTheDocument();
  });

  it('leaves the header while its page is kept hidden, and comes back the same toolbar', () => {
    const tree = (shown: boolean) => (
      <HeaderHostsProvider>
        <HeaderRow />
        <PageShown value={shown}>
          <Page />
        </PageShown>
      </HeaderHostsProvider>
    );
    const { rerender } = render(tree(true));
    const button = screen.getByRole('button', { name: 'Strong' });
    button.focus();
    rerender(tree(false));
    expect(screen.getByTestId('row')).toBeEmptyDOMElement();
    rerender(tree(true));
    // The same element: the editor that drew it was never told its place had gone.
    expect(within(screen.getByTestId('row')).getByRole('button', { name: 'Strong' })).toBe(button);
  });

  it('keeps the focus on its toolbar as the page renders again', () => {
    const tree = (
      <HeaderHostsProvider>
        <HeaderRow />
        <Page />
      </HeaderHostsProvider>
    );
    const { rerender } = render(tree);
    const button = screen.getByRole('button', { name: 'Strong' });
    button.focus();
    rerender(tree);
    expect(document.activeElement).toBe(button);
  });

  it('stands in place outside the application shell, as a page under test does', () => {
    render(<Page />);
    expect(screen.getByRole('button', { name: 'Strong' })).toBeInTheDocument();
  });
});
