import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerMarkdown } from './AnswerMarkdown.js';

const ID = '4c3f3ba9-0000-4000-8000-000000000001';

describe('the answer as Markdown (issue #857)', () => {
  it('shows headings, emphasis, lists, tables and code as formatted text', () => {
    const text = [
      '## Summary',
      '',
      'The weir **floods** in *spring*, see `levels`.',
      '',
      '- North',
      '- South',
      '',
      '1. First',
      '',
      '| Site | Level |',
      '| --- | --- |',
      '| North | 3.2 |',
      '',
      '```',
      'a = 1',
      '```',
    ].join('\n');
    render(<AnswerMarkdown text={text} cite={() => null} />);
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeVisible();
    expect(screen.getByText('floods').tagName).toBe('STRONG');
    expect(screen.getByText('spring').tagName).toBe('EM');
    expect(screen.getByText('levels').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem').map((each) => each.textContent)).toEqual([
      'North',
      'South',
      'First',
    ]);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Level' })).toBeVisible();
    expect(within(table).getByRole('cell', { name: '3.2' })).toBeVisible();
    expect(screen.getByText('a = 1').closest('pre')).not.toBeNull();
  });

  it('keeps each citation where it stands, by what cite gives for it', () => {
    render(
      <AnswerMarkdown
        text={`It **floods** [[${ID}#p_1]] each spring.`}
        cite={(component, block, key) => (
          <button key={key} type="button">
            {component === ID ? block : '?'}
          </button>
        )}
      />,
    );
    expect(screen.getByRole('button', { name: 'p_1' })).toBeVisible();
    expect(screen.getByRole('button').closest('p')).toHaveTextContent('It floods p_1 each spring.');
  });

  it('never makes HTML, links or images of what the model wrote', () => {
    const { container } = render(
      <AnswerMarkdown
        text={'<b>bold</b> [a link](https://example.test) ![a gauge](https://example.test/g.png)'}
        cite={() => null}
      />,
    );
    expect(container.querySelector('b, a, img, script')).toBeNull();
    expect(container).toHaveTextContent('<b>bold</b> a link a gauge');
  });
});
