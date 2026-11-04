import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LockGlyph } from './DocumentText.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const grace = (expectedRelease: string) => ({
  holder: { name: 'Grace' },
  expectedRelease,
  yours: false,
});
const mine = (expectedRelease: string) => ({
  holder: { name: 'Ada' },
  expectedRelease,
  yours: true,
});

describe('the lock symbol in the gutter (the EP plan, EP7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('CNT-074 names who holds a part and when it is back, and a click opens the panel', () => {
    const onOpen = vi.fn();
    render(<LockGlyph lock={grace(inMinutes(45))} openHere={false} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: /^Grace is editing this component/ });
    expect(button.getAttribute('data-lock')).toBe('theirs');
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('Lock held');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('differs in shape, not colour alone, when the lock is yours', () => {
    render(<LockGlyph lock={mine(inMinutes(45))} openHere onOpen={() => undefined} />);
    const button = screen.getByRole('button', { name: 'You are editing this component.' });
    expect(button.getAttribute('data-lock')).toBe('yours');
    expect(button.querySelector('svg')?.getAttribute('data-icon')).toBe('Lock yours');
  });

  it('says so when your lock is from another window or left behind', () => {
    render(<LockGlyph lock={mine(inMinutes(45))} openHere={false} onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: /another window/ })).toBeInTheDocument();
  });

  it('goes as the lock lapses, with no event to say so', () => {
    render(<LockGlyph lock={grace(inMinutes(1))} openHere={false} onOpen={() => undefined} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws nothing for a lock already lapsed', () => {
    render(<LockGlyph lock={grace(inMinutes(-1))} openHere={false} onOpen={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays while you edit here, however long since the stream last spoke', () => {
    render(<LockGlyph lock={mine(inMinutes(-1))} openHere onOpen={() => undefined} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
