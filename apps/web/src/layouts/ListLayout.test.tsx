import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ListLayout } from './ListLayout.js';

afterEach(() => window.localStorage.clear());

describe('the list layout', () => {
  it('hides the filter to a rail, and shows it again', async () => {
    const { unmount } = render(
      <ListLayout filter={<p>the spaces</p>}>
        <p>the list</p>
      </ListLayout>,
    );
    expect(screen.getByText('the spaces')).toBeInTheDocument();
    expect(screen.getByText('the list')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide the filter' }));
    expect(screen.queryByText('the spaces')).not.toBeInTheDocument();
    expect(screen.getByText('the list')).toBeInTheDocument();

    // Remembered for the next list this person opens.
    unmount();
    render(
      <ListLayout filter={<p>the spaces</p>}>
        <p>the list</p>
      </ListLayout>,
    );
    expect(screen.queryByText('the spaces')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the filter' }));
    expect(screen.getByText('the spaces')).toBeInTheDocument();
  });
});
