import { compareContent, unitTexts, type ContentDocument } from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Redline, redlineHtml } from './Redline.js';

const docOf = (...paragraphs: [string, string][]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: paragraphs.map(([id, value]) => ({
    type: 'paragraph' as const,
    id,
    style: 'body',
    content: [{ type: 'text' as const, value, marks: [] }],
  })),
});

const drawn = (older: ContentDocument, newer: ContentDocument) => {
  const { changes } = compareContent(older, newer);
  return render(
    <Redline
      changes={changes}
      texts={{ older: unitTexts(older), newer: unitTexts(newer) }}
      label="Changes"
    />,
  );
};

describe('a comparison drawn as a redline', () => {
  it('VER-030 underlines what was added and strikes through what was removed, word by word, and names a move', () => {
    drawn(
      docOf(['a', 'Alpha'], ['b', 'Bravo'], ['c', 'Charlie'], ['d', 'Set the tray.']),
      docOf(['a', 'Alpha'], ['c', 'Charlie'], ['b', 'Bravo, revised'], ['e', 'Then wait.']),
    );
    const list = screen.getByRole('list', { name: 'Changes' });
    const bravo = within(list)
      .getAllByRole('listitem')
      .find((item) => /Bravo/.test(item.textContent ?? ''))!;
    expect(within(bravo).getByText('Moved')).toBeInTheDocument();
    expect(bravo.querySelector('ins')).toHaveTextContent('Added: , revised');
    const added = within(list)
      .getAllByRole('listitem')
      .find((item) => item.dataset['change'] === 'inserted')!;
    expect(added).toHaveTextContent('Then wait.');
    const removed = within(list)
      .getAllByRole('listitem')
      .find((item) => item.dataset['change'] === 'deleted')!;
    expect(removed.querySelector('del')).toHaveTextContent('Removed: Set the tray.');
  });

  it('VER-029 marks a match by similar wording apart from one by identity', () => {
    drawn(docOf(['o1', 'Bravo']), docOf(['n1', 'Bravo, revised']));
    expect(screen.getByText('Matched by similar wording')).toBeInTheDocument();
  });

  it('says so where nothing changed', () => {
    drawn(docOf(['a', 'Alpha']), docOf(['a', 'Alpha']));
    expect(screen.getByText('Nothing changed.')).toBeInTheDocument();
  });

  it('VER-030 exports the redline as one HTML file holding what the page shows', () => {
    const { container } = drawn(docOf(['a', 'Alpha']), docOf(['a', 'Alpha'], ['b', 'Beta']));
    const html = redlineHtml('Install the printer: 0.2 compared with 0.3', container);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Install the printer: 0.2 compared with 0.3</title>');
    expect(html).toContain('Beta');
    expect(html).toContain('<ins');
  });
});
