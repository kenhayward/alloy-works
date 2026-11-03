import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGoToKeys, useGoToKeysOn } from './useGoToKeys.js';

function Page({ onGone }: { onGone: () => void }) {
  useGoToKeys();
  const [on, set] = useGoToKeysOn();
  return (
    <>
      <a
        href="#/documents"
        data-go-to="d"
        onClick={(event) => {
          event.preventDefault();
          onGone();
        }}
      >
        Documents
      </a>
      <button type="button" onClick={() => set(!on)}>
        Keys
      </button>
      <p data-testid="body-target" tabIndex={-1}>
        Somewhere keys mean nothing
      </p>
      <input aria-label="Text" />
      <textarea aria-label="Long text" />
      <div
        contentEditable
        suppressContentEditableWarning
        aria-label="Editor"
        data-testid="editor"
      />
      <ul role="tree" aria-label="Tree">
        <li role="treeitem" aria-selected tabIndex={0}>
          A node
        </li>
      </ul>
      <ul role="listbox" aria-label="List">
        <li role="option" aria-selected tabIndex={0}>
          An option
        </li>
      </ul>
      <div role="menu" aria-label="Menu">
        <button type="button" role="menuitem">
          An item
        </button>
      </div>
    </>
  );
}

const press = (target: Element, key: string, options = {}) =>
  fireEvent.keyDown(target, { key, bubbles: true, ...options });

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem('alloy-works.go-to-keys');
});

describe('a key something else took', () => {
  it('ends the wait for a letter, so it goes nowhere', () => {
    const onGone = vi.fn();
    render(<Page onGone={onGone} />);
    const target = screen.getByTestId('body-target');
    target.addEventListener('keydown', (event) => {
      if (event.key === 'j') event.preventDefault();
    });
    fireEvent.keyDown(target, { key: 'g' });
    fireEvent.keyDown(target, { key: 'j' });
    fireEvent.keyDown(target, { key: 'd' });
    expect(onGone).not.toHaveBeenCalled();
  });
});

describe('the go-to keys', () => {
  it('go to the rail link a letter names, G then the letter', () => {
    const gone = vi.fn();
    render(<Page onGone={gone} />);
    const plain = screen.getByTestId('body-target');
    press(plain, 'd');
    expect(gone).not.toHaveBeenCalled();
    press(plain, 'g');
    press(plain, 'd');
    expect(gone).toHaveBeenCalledOnce();
    // A letter nothing names goes nowhere, and takes the wait with it.
    press(plain, 'g');
    press(plain, 'z');
    press(plain, 'd');
    expect(gone).toHaveBeenCalledOnce();
  });

  it('stop waiting for the letter after a moment', () => {
    vi.useFakeTimers();
    const gone = vi.fn();
    render(<Page onGone={gone} />);
    const plain = screen.getByTestId('body-target');
    press(plain, 'g');
    act(() => vi.advanceTimersByTime(2000));
    press(plain, 'd');
    expect(gone).not.toHaveBeenCalled();
  });

  it('leave a chord alone', () => {
    const gone = vi.fn();
    render(<Page onGone={gone} />);
    const plain = screen.getByTestId('body-target');
    press(plain, 'g', { ctrlKey: true });
    press(plain, 'd');
    expect(gone).not.toHaveBeenCalled();
  });

  it('CNT-189 never act while the focus is in text, a tree, a list that is typed into or a menu', () => {
    const gone = vi.fn();
    render(<Page onGone={gone} />);
    const plain = screen.getByTestId('body-target');
    for (const place of [
      screen.getByRole('textbox', { name: 'Text' }),
      screen.getByRole('textbox', { name: 'Long text' }),
      screen.getByTestId('editor'),
      screen.getByRole('treeitem'),
      screen.getByRole('option'),
      screen.getByRole('menuitem'),
    ]) {
      press(place, 'g');
      press(place, 'd');
      // A G begun outside and a letter inside goes nowhere either.
      press(plain, 'g');
      press(place, 'd');
      press(plain, 'd');
    }
    expect(gone).not.toHaveBeenCalled();
  });

  it('CNT-189 can be turned off, and stay so on this device', () => {
    const gone = vi.fn();
    const { unmount } = render(<Page onGone={gone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    expect(window.localStorage.getItem('alloy-works.go-to-keys')).toBe('off');
    const plain = screen.getByTestId('body-target');
    press(plain, 'g');
    press(plain, 'd');
    expect(gone).not.toHaveBeenCalled();
    unmount();

    render(<Page onGone={gone} />);
    press(screen.getByTestId('body-target'), 'g');
    press(screen.getByTestId('body-target'), 'd');
    expect(gone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    press(screen.getByTestId('body-target'), 'g');
    press(screen.getByTestId('body-target'), 'd');
    expect(gone).toHaveBeenCalledOnce();
  });
});
