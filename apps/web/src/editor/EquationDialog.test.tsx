import { equationAlternative } from '@alloy-works/domain';
import type { EquationChoice } from '@alloy-works/editor';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EquationDialog } from './EquationDialog.js';

/**
 * The engine, answered by hand: every request waits until the test settles it, so what the dialog
 * does while words are being written, and when they cannot be, is seen rather than raced. The dialog
 * with the real engine is tested in `ComponentEditor.test.tsx`.
 */
const asked: { resolve: (words: string | null) => void; reject: (error: Error) => void }[] = [];
vi.mock('./speech.js', () => ({
  speechLanguage: (tag: string) => (tag.startsWith('en') ? 'en' : null),
  describeEquation: () =>
    new Promise<string | null>((resolve, reject) => asked.push({ resolve, reject })),
}));

const opened = () => {
  const done = vi.fn<(choice: EquationChoice) => string | null>(() => null);
  render(
    <EquationDialog
      current={null}
      blockPlaceable={false}
      language="en"
      onDone={done}
      onCancel={() => {}}
    />,
  );
  return done;
};
const answer = (words: string | null) => act(async () => asked.shift()!.resolve(words));
const fail = () => act(async () => asked.shift()!.reject(new Error('The engine did not load.')));

describe('the Equation dialog, waiting for its description (equations 1, ruling R7)', () => {
  it('places an equation whose words could not be written with none, not with the words of the equation it was', async () => {
    const done = opened();
    const latex = screen.getByLabelText('LaTeX');
    fireEvent.change(latex, { target: { value: 'x' } });
    await answer('x');
    expect(screen.getByLabelText('Description')).toHaveValue('x');

    fireEvent.change(latex, { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.getByRole('button', { name: 'Writing the description' })).toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
    await fail();

    expect(done).toHaveBeenCalledTimes(1);
    const [choice] = done.mock.calls[0]!;
    expect(choice).toMatchObject({ display: 'inline', latex: 'y' });
    expect(equationAlternative(choice.mathml)).toBeNull();
  });

  it('places nothing while the author writes the description themselves, until they ask again', async () => {
    const done = opened();
    fireEvent.change(screen.getByLabelText('LaTeX'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'e' } });
    await answer('x');
    // Their first letter is not the whole of their words.
    expect(done).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'ex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(equationAlternative(done.mock.calls[0]![0].mathml)).toBe('ex');
  });
});
