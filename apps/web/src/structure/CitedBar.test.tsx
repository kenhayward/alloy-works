import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CitedBar } from './CitedBar.js';

describe('the parts the assistant cited, stepped through above the text (the DP plan, Task 7)', () => {
  it('counts them, and steps on and back, wrapping, showing each', async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<CitedBar nodes={['n1', 'n2', 'n3']} onShow={onShow} onClear={() => {}} />);
    const bar = screen.getByRole('region', { name: 'Cited by the assistant' });
    expect(bar).toHaveTextContent('1 of 3');
    await user.click(screen.getByRole('button', { name: 'Next cited part' }));
    expect(onShow).toHaveBeenLastCalledWith('n2');
    expect(bar).toHaveTextContent('2 of 3');
    await user.click(screen.getByRole('button', { name: 'Previous cited part' }));
    await user.click(screen.getByRole('button', { name: 'Previous cited part' }));
    expect(onShow).toHaveBeenLastCalledWith('n3');
    expect(bar).toHaveTextContent('3 of 3');
  });

  it('goes when cleared, and shows nothing with nothing cited', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = render(<CitedBar nodes={['n1']} onShow={() => {}} onClear={onClear} />);
    await user.click(screen.getByRole('button', { name: 'Clear the cited parts' }));
    expect(onClear).toHaveBeenCalled();
    rerender(<CitedBar nodes={[]} onShow={() => {}} onClear={onClear} />);
    expect(screen.queryByRole('region', { name: 'Cited by the assistant' })).toBeNull();
  });
});
