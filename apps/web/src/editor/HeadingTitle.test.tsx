import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HeadingTitle } from './HeadingTitle.js';

const setUp = (title = 'Install the printer', focusFirst = true) => {
  const onChange = vi.fn();
  const onLeave = vi.fn();
  const view = render(
    <HeadingTitle
      title={title}
      label="Title"
      focusFirst={focusFirst}
      onChange={onChange}
      onLeave={onLeave}
    />,
  );
  return { onChange, onLeave, view, field: screen.getByRole('textbox', { name: 'Title' }) };
};

describe("a component's title, typed in its heading (the EP plan, EP6)", () => {
  it('CNT-191 holds the title, and takes the cursor only where the heading was what was clicked', () => {
    const { field, view } = setUp();
    expect(field).toHaveTextContent('Install the printer');
    expect(field).toHaveFocus();
    view.unmount();
    expect(setUp('Install the printer', false).field).not.toHaveFocus();
  });

  it('says what is typed, a pasted line break as a space', () => {
    const { field, onChange } = setUp();
    field.textContent = 'Set up\nthe printer';
    fireEvent.input(field);
    expect(onChange).toHaveBeenLastCalledWith('Set up the printer');
  });

  it('moves into the text on Enter', () => {
    const { field, onLeave } = setUp();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('puts back what it held on arriving on Esc', () => {
    const { field, onChange, onLeave } = setUp();
    fireEvent.focus(field);
    field.textContent = 'Changed';
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveTextContent('Install the printer');
    expect(onChange).toHaveBeenLastCalledWith('Install the printer');
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('follows a title changed from elsewhere, such as an undo', () => {
    const { field, view, onChange, onLeave } = setUp();
    view.rerender(
      <HeadingTitle
        title="Undone"
        label="Title"
        focusFirst
        onChange={onChange}
        onLeave={onLeave}
      />,
    );
    expect(field).toHaveTextContent('Undone');
  });
});
