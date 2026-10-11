import type { FollowOptions } from '@alloy-works/api-client';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useHeardLock } from './lockLive.js';
import type { TakeResult } from './session.js';
import { TakeOver } from './TakeOver.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

describe('Take over, in the editor (collaboration.md, Taking)', () => {
  it('COL-046 offers to take over only once the holder has been idle the take period, and says when before then', () => {
    const { unmount } = render(
      <TakeOver
        holder="Ada"
        takeableAt="2026-10-11T12:03:00.000Z"
        onTake={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
    expect(screen.getByText(/You may ask Ada for it from/)).toBeInTheDocument();
    unmount();
    render(
      <TakeOver
        holder="Ada"
        takeableAt="2026-10-11T11:55:00.000Z"
        onTake={vi.fn()}
        now={() => NOW}
      />,
    );
    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument();
  });

  it('COL-047 COL-009 asks, says the holder has until the grace ends, then asks again and takes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const answers: TakeResult[] = [
        { ok: true, taken: false, until: new Date(NOW + 60_000).toISOString() },
        { ok: true, taken: true },
      ];
      const onTake = vi.fn(async () => answers.shift()!);
      render(
        <TakeOver
          holder="Ada"
          takeableAt="2026-10-11T11:55:00.000Z"
          onTake={onTake}
          now={() => NOW}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Take over' }));
      expect(
        await screen.findByText(/Ada has been asked for it\. It is yours at/),
      ).toBeInTheDocument();
      expect(onTake).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(onTake).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the holder went back to work in the grace', async () => {
    const onTake = vi.fn(async (): Promise<TakeResult> => ({ ok: false, code: 'lock_active' }));
    render(
      <TakeOver
        holder="Ada"
        takeableAt="2026-10-11T11:55:00.000Z"
        onTake={onTake}
        now={() => NOW}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(await screen.findByText('Ada is working on it again.')).toBeInTheDocument();
  });

  it("COL-045 hears at once on the component's own stream that somebody asked for it, and took it", () => {
    const opened: FollowOptions[] = [];
    const follow = (options: FollowOptions) => {
      opened.push(options);
      return () => undefined;
    };
    const { result } = renderHook(() => useHeardLock('c1', follow));
    expect(opened[0]!.url).toMatch(/\/v1\/stream\?component=c1$/);
    act(() => opened[0]!.onEvent!('snapshot', { locks: [], presence: [] }));
    expect(result.current).toEqual({ holder: null, expectedRelease: null, taking: null });
    const asked = {
      component: 'c1',
      holder: { id: 'ada', name: 'Ada' },
      expectedRelease: '2026-10-11T12:15:00.000Z',
      taking: { by: { id: 'grace', name: 'Grace' }, until: '2026-10-11T12:01:00.000Z' },
    };
    act(() => opened[0]!.onEvent!('lock', asked));
    expect(result.current?.taking?.by.name).toBe('Grace');
    act(() =>
      opened[0]!.onEvent!('lock', {
        ...asked,
        holder: { id: 'grace', name: 'Grace' },
        taking: null,
      }),
    );
    expect(result.current?.holder?.id).toBe('grace');
  });
});
