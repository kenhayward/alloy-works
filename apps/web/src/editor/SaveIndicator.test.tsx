import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveIndicator } from './SaveIndicator.js';

const at = (value: number) => `at ${value}`;

describe('the save indicator', () => {
  it('CNT-068 states plainly whether the draft is saved, saving, or failing to save', () => {
    const { rerender } = render(<SaveIndicator save="saved" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saved')).toHaveAttribute('title', 'Saved at at 1000');
    rerender(<SaveIndicator save="saving" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saving')).toBeInTheDocument();
    rerender(<SaveIndicator save="failing" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Not saved')).toBeInTheDocument();
  });

  it('is a chip with a dot beside the words, hidden from assistive technology', () => {
    const { container, rerender } = render(
      <SaveIndicator save="saved" savedAt={1_000} formatTime={at} />,
    );
    const dot = () => container.querySelector('[data-dot]');
    expect(dot()).toHaveAttribute('aria-hidden', 'true');
    expect(dot()).toHaveAttribute('data-dot', 'saved');
    rerender(<SaveIndicator save="stopped" savedAt={1_000} formatTime={at} />);
    expect(dot()).toHaveAttribute('data-dot', 'notSaved');
    rerender(<SaveIndicator save="failing" savedAt={1_000} formatTime={at} />);
    expect(dot()).toHaveAttribute('data-dot', 'notSaved');
    expect(container.firstChild).toHaveAttribute('data-save', 'failing');
  });

  it('says Saved before there has been a save, with no time to give', () => {
    render(<SaveIndicator save="saved" savedAt={null} formatTime={at} />);
    expect(screen.getByText('Saved')).not.toHaveAttribute('title');
  });

  it('folds retrying into Not saved: the retry is nothing the author acts on', () => {
    render(<SaveIndicator save="failing" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.queryByText('Not saved, retrying')).toBeNull();
  });
});
