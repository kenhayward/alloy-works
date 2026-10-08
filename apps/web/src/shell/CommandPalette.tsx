import { useEffect, useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import styles from './CommandPalette.module.css';
import { MODULES } from './modules.js';

/** One thing the palette offers: what it says, and the address it goes to. */
interface Command {
  readonly label: string;
  readonly href: string;
}

const GO: readonly Command[] = [
  { label: 'Go to Home', href: '#/' },
  ...MODULES.map((each) => ({ label: `Go to ${each.name}`, href: each.href })),
];

/** What is offered for `typed`: a search for it first, then each place whose name holds it. */
export function commandsFor(typed: string): readonly Command[] {
  const text = typed.trim();
  if (text === '') return GO;
  const wanted = text.toLowerCase();
  return [
    { label: `Search for "${text}"`, href: `#/search?q=${encodeURIComponent(text)}` },
    ...GO.filter((each) => each.label.slice('Go to '.length).toLowerCase().includes(wanted)),
  ];
}

/**
 * Whether search and commands is open, and Ctrl K (Cmd K on a Mac) opening it from anywhere a field
 * has not taken the key for itself: a component's text keeps Ctrl K for Link, and has handled it
 * before it gets here (ADR-0046, decision 3; the LG plan, LG-G).
 */
export function useCommandKey(): readonly [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

/**
 * Search and commands: a box and what it offers, as a combobox and its listbox. The arrows choose,
 * Enter goes, Escape closes. Navigation first: every module, and a search for what is typed; the
 * commands that open a dialog come later (the LG plan, LG-G).
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState(0);
  const offered = commandsFor(typed);
  const at = Math.min(chosen, offered.length - 1);
  const option = (index: number) => `${ids}-option-${index}`;

  const go = (command: Command | undefined) => {
    if (command === undefined) return;
    onClose();
    window.location.hash = command.href;
  };

  return (
    <Modal labelledBy={`${ids}-heading`} onClose={onClose}>
      <div className={styles['palette']}>
        <h2 id={`${ids}-heading`} className={styles['heading']}>
          Search and commands
        </h2>
        <input
          className={styles['box']}
          type="text"
          role="combobox"
          aria-label="Search or go to"
          aria-expanded="true"
          aria-controls={`${ids}-list`}
          aria-activedescendant={offered.length > 0 ? option(at) : undefined}
          autoComplete="off"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setChosen(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setChosen((at + 1) % offered.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setChosen((at - 1 + offered.length) % offered.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(offered[at]);
            }
          }}
        />
        <ul id={`${ids}-list`} className={styles['list']} role="listbox" aria-label="Commands">
          {offered.map((each, index) => (
            <li
              key={each.label}
              id={option(index)}
              className={styles['option']}
              role="option"
              aria-selected={index === at}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(each)}
            >
              {each.label}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
