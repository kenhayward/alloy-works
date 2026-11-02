import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeaderHostsProvider, HeaderSlot, useHeaderHost } from './HeaderSlot.js';
import { PageShown } from './Status.js';

function Host() {
  const ref = useHeaderHost('lead');
  return <div ref={ref} data-testid="host" />;
}

describe('a page drawing in the header', () => {
  it('draws in the place the header holds, settling at once', () => {
    render(
      <HeaderHostsProvider>
        <Host />
        <HeaderSlot name="lead">
          <p>The title</p>
        </HeaderSlot>
      </HeaderHostsProvider>,
    );
    expect(within(screen.getByTestId('host')).getByText('The title')).toBeInTheDocument();
  });

  it('draws nothing in the header from a page kept hidden, and draws again once it is shown', () => {
    const page = (shown: boolean) => (
      <HeaderHostsProvider>
        <Host />
        <PageShown value={shown}>
          <HeaderSlot name="lead">
            <p>The title</p>
          </HeaderSlot>
        </PageShown>
      </HeaderHostsProvider>
    );
    const { rerender } = render(page(false));
    expect(screen.getByTestId('host')).toBeEmptyDOMElement();
    expect(screen.queryByText('The title')).not.toBeInTheDocument();
    rerender(page(true));
    expect(within(screen.getByTestId('host')).getByText('The title')).toBeInTheDocument();
    rerender(page(false));
    expect(screen.getByTestId('host')).toBeEmptyDOMElement();
  });

  it('draws where it stands outside the application shell', () => {
    render(
      <HeaderSlot name="lead">
        <p>The title</p>
      </HeaderSlot>,
    );
    expect(screen.getByText('The title')).toBeInTheDocument();
  });
});
