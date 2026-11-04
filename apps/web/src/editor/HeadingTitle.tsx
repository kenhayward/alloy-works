import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

import styles from './ComponentEditor.module.css';

/**
 * **A component's title, typed where its heading stands** (the EP plan, EP6): set in the heading's own
 * face and wrapping as it does, so opening it moves nothing, where an `<input>` would collapse a wrapped
 * heading. It changes the session's document as the Part panel's Title does, saved with the session and
 * under its question. `Enter` moves into the text, and `Esc` puts back what it held on arriving.
 */
export function HeadingTitle({
  title,
  label,
  focusFirst,
  onChange,
  onLeave,
}: {
  title: string;
  label: string;
  /** Opened by a click on the heading, so the cursor starts here rather than in the text. */
  focusFirst: boolean;
  onChange: (title: string) => void;
  onLeave: () => void;
}) {
  const own = useRef<HTMLSpanElement | null>(null);
  const entered = useRef(title);
  // Set by hand as the title changes from elsewhere, such as an undo: React redrawing what is being
  // typed in would move the caret.
  useLayoutEffect(() => {
    if (own.current !== null && own.current.textContent !== title) own.current.textContent = title;
  }, [title]);
  useEffect(() => {
    const element = own.current;
    if (!focusFirst || element === null) return;
    element.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(element);
    selection?.collapseToEnd();
    // On arriving only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onLeave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.textContent = entered.current;
      onChange(entered.current);
      onLeave();
    }
  };
  return (
    <span
      ref={own}
      className={styles['headingTitle']}
      role="textbox"
      aria-label={label}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      tabIndex={0}
      data-content
      onFocus={() => {
        entered.current = own.current?.textContent ?? title;
      }}
      // One line: a line break pasted in is a space, as the title's other fields make it.
      onInput={(event) =>
        onChange((event.currentTarget.textContent ?? '').replace(/\s*\n\s*/g, ' '))
      }
      onKeyDown={onKeyDown}
    />
  );
}
