import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveIndicator } from './SaveIndicator.js';

const at = (value: number) => `at ${value}`;

describe('the save indicator', () => {
  it('CNT-068 states plainly whether the draft is saved, saving, or failing to save', () => {
    const { rerender } = render(<SaveIndicator save="saved" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saved at at 1000')).toBeInTheDocument();
    rerender(<SaveIndicator save="saving" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saving')).toBeInTheDocument();
    rerender(<SaveIndicator save="failing" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Not saved, retrying')).toBeInTheDocument();
  });

  it('shows a dot beside the words, hidden from assistive technology', () => {
    const { container, rerender } = render(
      <SaveIndicator save="saved" savedAt={null} formatTime={at} />,
    );
    const dot = () => container.querySelector('[data-dot]');
    expect(dot()).toHaveAttribute('aria-hidden', 'true');
    expect(dot()).toHaveAttribute('data-dot', 'idle');
    rerender(<SaveIndicator save="saved" savedAt={1_000} formatTime={at} />);
    expect(dot()).toHaveAttribute('data-dot', 'saved');
    rerender(<SaveIndicator save="stopped" savedAt={1_000} formatTime={at} />);
    expect(dot()).toHaveAttribute('data-dot', 'stopped');
    expect(screen.getByText('Not saved')).toBeInTheDocument();
  });

  it('claims no save before there has been one', () => {
    render(<SaveIndicator save="saved" savedAt={null} formatTime={at} />);
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('says plainly that nothing is saved and nothing is retrying, distinct from failing (fix round 1 finding 3)', () => {
    render(<SaveIndicator save="stopped" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.queryByText('Not saved, retrying')).toBeNull();
  });
});
