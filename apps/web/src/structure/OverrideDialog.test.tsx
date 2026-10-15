import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OverrideDialog } from './OverrideDialog.js';
import { withOverrides } from './overrides.js';

const V1 = 'cccccccc-0000-4000-8000-0000000000a1';
const V2 = 'cccccccc-0000-4000-8000-0000000000a2';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const content = {
  schemaVersion: 1,
  title: 'Flush the line',
  content: [
    { type: 'paragraph', id: 'p1', style: 'body', content: [text('Open the drain.')] },
    { type: 'paragraph', id: 'p2', style: 'body', content: [text('Close the valve.')] },
  ],
};

describe('overrides of a reference, on the page', () => {
  it('REU-011 overrides a paragraph words in this document, against the version the reference takes', async () => {
    const saved = vi.fn();
    render(
      <OverrideDialog
        name="Flush the line"
        content={content}
        version={V2}
        overrides={[]}
        current={[]}
        busy={false}
        onSave={saved}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Overrides of Flush the line' });
    const first = within(dialog).getByRole('textbox', { name: 'Paragraph 1' });
    expect(first).toHaveValue('Open the drain.');
    await userEvent.clear(first);
    await userEvent.type(first, 'Open the north drain.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved).toHaveBeenCalledWith([
      { block: 'p1', against: V2, text: [text('Open the north drain.')] },
    ]);
  });

  it('REU-015 says an override no longer applies where its paragraph has changed, and keeps others as made', async () => {
    const saved = vi.fn();
    const held = { block: 'p2', against: V1, text: [text('Shut it.')] };
    render(
      <OverrideDialog
        name="Flush the line"
        content={content}
        version={V2}
        overrides={[
          { block: 'p1', text: [text('Open the north drain.')], stale: true },
          { block: 'p2', text: [text('Shut it.')], stale: false },
        ]}
        current={[{ block: 'p1', against: V1, text: [text('Open the north drain.')] }, held]}
        busy={false}
        onSave={saved}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('note')).toHaveTextContent('This override no longer applies');
    // Set back to the component's words, the stale one goes; the other stands as it was made.
    const first = within(dialog).getByRole('textbox', { name: /Paragraph 1/ });
    await userEvent.clear(first);
    await userEvent.type(first, 'Open the drain.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved).toHaveBeenCalledWith([held]);
  });

  it('draws the paragraphs an override stands for, and not a stale one', () => {
    const drawn = withOverrides(content, [
      { block: 'p1', text: [text('Open the north drain.')], stale: false },
      { block: 'p2', text: [text('Shut it.')], stale: true },
    ]) as typeof content;
    expect(drawn.content.map((block) => block.content)).toEqual([
      [text('Open the north drain.')],
      [text('Close the valve.')],
    ]);
  });

  it('offers no paragraph holding more than text, which an override would take away', () => {
    const noted = {
      ...content,
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [text('See the note.'), { type: 'footnote', id: 'f1', content: [] }],
        },
      ],
    };
    render(
      <OverrideDialog
        name="Flush the line"
        content={noted}
        version={V2}
        overrides={[]}
        current={[]}
        busy={false}
        onSave={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByText('This component has no paragraph of plain text to override.'),
    ).toBeVisible();
  });
});
