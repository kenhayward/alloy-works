import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Empty } from './Empty.js';
import { Lozenge } from './Lozenge.js';
import { Notice } from './Notice.js';
import { Waiting } from './Waiting.js';

describe('the states kit', () => {
  it('a notice carries its tone and its words', () => {
    render(<Notice tone="failed">The components could not be loaded.</Notice>);

    const notice = screen.getByText('The components could not be loaded.');
    expect(notice.closest('[data-tone]')).toHaveAttribute('data-tone', 'failed');
  });

  it('an empty state holds its sentence and its action', () => {
    render(
      <Empty>
        <p>There are no components you may read.</p>
        <button type="button">New component</button>
      </Empty>,
    );

    const sentence = screen.getByText('There are no components you may read.');
    const box = sentence.closest('[data-state="empty"]');
    expect(box).not.toBeNull();
    expect(box).toContainElement(screen.getByRole('button', { name: 'New component' }));
  });

  it('waiting shows its words, with the spinner hidden from assistive technology', () => {
    const { container } = render(<Waiting>Opening...</Waiting>);

    expect(screen.getByText('Opening...')).toBeInTheDocument();
    const spinner = container.querySelector('[data-spinner]');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });

  it('a lozenge carries its kind', () => {
    render(<Lozenge kind="changedSince">Changed since</Lozenge>);

    expect(screen.getByText('Changed since')).toHaveAttribute('data-kind', 'changedSince');
  });
});
