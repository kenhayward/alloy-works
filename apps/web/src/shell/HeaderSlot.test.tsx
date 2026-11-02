import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeaderHostsProvider, HeaderSlot, useHeaderHost } from './HeaderSlot.js';

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

  it('draws where it stands outside the application shell', () => {
    render(
      <HeaderSlot name="lead">
        <p>The title</p>
      </HeaderSlot>,
    );
    expect(screen.getByText('The title')).toBeInTheDocument();
  });
});
