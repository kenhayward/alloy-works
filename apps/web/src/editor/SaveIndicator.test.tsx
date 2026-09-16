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

  it('claims no save before there has been one', () => {
    render(<SaveIndicator save="saved" savedAt={null} formatTime={at} />);
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });
});
