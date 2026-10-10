import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { StatusBar, StatusProvider, StatusTools, useStatus } from './Status.js';

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

  it('says where the person is within the page beside the notice, never announcing it (ADR-0051)', () => {
    function Placing({ where }: { where: string | null }) {
      const status = useStatus();
      useEffect(() => {
        status?.place(where);
      }, [status, where]);
      return null;
    }
    const { rerender } = render(
      <StatusProvider>
        <Placing where="Bound table, column 3 of 11" />
      </StatusProvider>,
    );
    expect(screen.getByText('Bound table, column 3 of 11')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Bound table');
    rerender(
      <StatusProvider>
        <Placing where={null} />
      </StatusProvider>,
    );
    expect(screen.queryByText(/Bound table/)).toBeNull();
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

  it("holds a page's tools at its right, before the context, such as the zoom (ADR-0056)", () => {
    render(
      <StatusProvider>
        <Saying notice={null} context={['1 section']} />
        <StatusTools>
          <button type="button">Zoom in</button>
        </StatusTools>
      </StatusProvider>,
    );
    const bar = document.querySelector('footer')!;
    const tool = screen.getByRole('button', { name: 'Zoom in' });
    expect(bar).toContainElement(tool);
    expect(
      tool.compareDocumentPosition(screen.getByText('1 section')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('holds the tools where they are, with no shell to hold them', () => {
    render(
      <StatusTools>
        <button type="button">Zoom in</button>
      </StatusTools>,
    );
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
  });

  it('is drawn by the page itself where there is no shell to hold it', () => {
    render(<Saying notice="Link copied." context={['Version 0.1 in General']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });

  it('tells the page how tall it is, as it wraps, so what scrolls stops above it (issue #336)', () => {
    const original = {
      rect: HTMLElement.prototype.getBoundingClientRect,
      observer: window.ResizeObserver,
    };
    let height = 31;
    let resized: (() => void) | null = null;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const tall = this.tagName === 'FOOTER' ? height : 0;
      return { top: 0, bottom: tall, left: 0, right: 0, width: 0, height: tall } as DOMRect;
    };
    // An observer by hand: it tells the bar it changed size when the test says so.
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const root = document.documentElement;
    try {
      const { unmount } = render(
        <StatusProvider>
          <Saying notice="Link copied." />
        </StatusProvider>,
      );
      expect(root.style.getPropertyValue('--status-height')).toBe('31px');
      height = 53;
      act(() => resized?.());
      expect(root.style.getPropertyValue('--status-height')).toBe('53px');
      unmount();
      expect(root.style.getPropertyValue('--status-height')).toBe('');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original.rect;
      window.ResizeObserver = original.observer;
    }
  });
});
