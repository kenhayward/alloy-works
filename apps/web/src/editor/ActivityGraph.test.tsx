import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ActivityGraph, weeksShown } from './ActivityGraph.js';

const NOW = new Date(Date.UTC(2026, 10, 4));

describe('the activity graph', () => {
  it('fills the last year’s weeks, those with nothing at nought', () => {
    const weeks = weeksShown(
      [
        { start: '2026-10-26', versions: 3, approvals: 1 },
        { start: '2026-11-02', versions: 1, approvals: 0 },
        { start: '2020-01-06', versions: 9, approvals: 0 },
      ],
      NOW,
    );
    expect(weeks).toHaveLength(52);
    expect(weeks[51]).toEqual({ start: '2026-11-02', versions: 1, approvals: 0 });
    expect(weeks[50]).toEqual({ start: '2026-10-26', versions: 3, approvals: 1 });
    expect(weeks[49]).toEqual({ start: '2026-10-19', versions: 0, approvals: 0 });
    expect(weeks.some((each) => each.start === '2020-01-06')).toBe(false);
  });

  it('is one tab stop, moved by the arrow keys, saying each week in words, and goes there on Enter', async () => {
    const go = vi.fn();
    render(
      <ActivityGraph
        weeks={[
          { start: '2026-10-26', versions: 3, approvals: 1 },
          { start: '2026-11-02', versions: 1, approvals: 0 },
        ]}
        now={NOW}
        shown={null}
        onGo={go}
        onHide={() => undefined}
      />,
    );
    const graph = screen.getByRole('slider', { name: 'Versions a week' });
    expect(screen.queryAllByRole('button', { name: /Week of/ })).toEqual([]);
    expect(graph).toHaveAttribute('aria-valuetext', expect.stringContaining('1 version'));
    graph.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(graph).toHaveAttribute('aria-valuetext', expect.stringContaining('3 versions'));
    expect(graph).toHaveAttribute('aria-valuetext', expect.stringContaining('1 approval'));
    await userEvent.keyboard('{Enter}');
    // The end of that week, so the list opens at its newest.
    expect(go).toHaveBeenCalledWith(new Date(Date.UTC(2026, 10, 2) - 1));
  });

  it('hides itself when asked', async () => {
    const hide = vi.fn();
    render(
      <ActivityGraph weeks={[]} now={NOW} shown={null} onGo={() => undefined} onHide={hide} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Hide the activity graph' }));
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
