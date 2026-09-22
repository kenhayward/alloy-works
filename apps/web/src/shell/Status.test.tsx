import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { StatusBar, StatusProvider, useStatus } from './Status.js';

/** A page that says something through the bar, as the document page does. */
function Saying({ notice, context }: { notice: string | null; context?: readonly string[] }) {
  const status = useStatus();
  useEffect(() => {
    status?.say(notice);
  }, [status, notice]);
  useEffect(() => {
    if (context) status?.describe(context);
    return () => status?.describe(null);
  }, [status, context]);
  return status === null ? <StatusBar notice={notice} context={context ?? null} /> : null;
}

describe('the status bar', () => {
  it('says the one notice at the left, live, and the context at the right', () => {
    render(
      <StatusProvider>
        <Saying
          notice="Moved Install the printer under Section 2."
          context={['4 sections', 'Version 0.9 in General']}
        />
      </StatusProvider>,
    );
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('Moved Install the printer under Section 2.');
    // A move is marked with the move glyph; nothing else is.
    expect(live.querySelector('[data-icon="Move"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Version 0.9 in General')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('marks nothing but a move, and keeps a notice until the next replaces it', () => {
    const { rerender } = render(
      <StatusProvider>
        <Saying notice="Front matter and appendices stay at the top level." />
      </StatusProvider>,
    );
    expect(screen.getByRole('status').querySelector('[data-icon]')).toBeNull();
    rerender(
      <StatusProvider>
        <Saying notice="Link copied." />
      </StatusProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
  });

  it('clears what a page described when the page goes away', () => {
    const { rerender } = render(
      <StatusProvider>
        <Saying notice={null} context={['Version 0.9 in General']} />
      </StatusProvider>,
    );
    expect(screen.getByText('Version 0.9 in General')).toBeInTheDocument();
    rerender(<StatusProvider>{null}</StatusProvider>);
    expect(screen.queryByText('Version 0.9 in General')).toBeNull();
  });

  it('is drawn by the page itself where there is no shell to hold it', () => {
    render(<Saying notice="Link copied." context={['Version 0.1 in General']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });
});
