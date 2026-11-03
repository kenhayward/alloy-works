import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { Icon } from '../editor/Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { words as say } from '../words/words.js';
import {
  applyEdit,
  chooseMention,
  EMPTY_DRAFT,
  fromParts,
  hasContent,
  MOST_MENTIONS,
  toParts,
  typedMention,
  type Draft,
  type Part,
} from './mentionDraft.js';
import { Avatar, type Person } from './ThreadFaces.js';
import { fold } from './threadFilters.js';
import styles from './ThreadsPanel.module.css';

const SUGGESTED = 6;
const ROOM_WANTED = 240;

/** A person's name, the letters a query matched underlined, wherever folding kept each letter's place. */
function Matched({ name, query }: { name: string; query: string }) {
  const folded = fold(name);
  const wanted = fold(query);
  if (wanted === '' || folded.length !== name.length) return <>{name}</>;
  const at = folded.startsWith(wanted) ? 0 : folded.indexOf(` ${wanted}`) + 1;
  if (at === 0 && !folded.startsWith(wanted)) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <u>{name.slice(at, at + wanted.length)}</u>
      {name.slice(at + wanted.length)}
    </>
  );
}

/** Whether a query matches a name from the start of any of its words, across the words after. */
export const nameMatches = (name: string | null, query: string): boolean => {
  const folded = fold(name ?? '');
  const wanted = fold(query);
  return folded.startsWith(wanted) || folded.includes(` ${wanted}`);
};

/**
 * Where a list of choices stands by what it belongs to: fixed to the window, as the panel clips what
 * overflows it, above if it fits and on whichever side has more room if it does not.
 */
export function useChoicesPlace(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  prefersAbove: boolean,
): CSSProperties {
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const gap = 4;
      const above = box.top - gap * 2;
      const below = window.innerHeight - box.bottom - gap * 2;
      const up = prefersAbove
        ? above >= ROOM_WANTED || above > below
        : above > below && below < ROOM_WANTED;
      setPlace({
        position: 'fixed',
        insetInline: 'auto',
        left: box.left,
        width: box.width,
        ...(up
          ? { top: 'auto', bottom: window.innerHeight - box.top + gap, maxHeight: above }
          : { top: box.bottom + gap, bottom: 'auto', maxHeight: below }),
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [anchor, open, prefersAbove]);
  return place;
}

/** The chosen one of a list kept in sight as the arrows move. */
export function useActiveInSight(id: string, open: boolean, active: number): void {
  useEffect(() => {
    if (open) document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, open, active]);
}

/**
 * A comment being written (TH-B; the TP plan, T5): a plain box, the people it names typed where they
 * belong, offered as `@` and a letter or two are typed. The service tells who may not read it only once
 * it is sent, so nothing here promises who will hear.
 */
export function ThreadComposer({
  label,
  placeholder,
  action,
  people,
  inThread = [],
  initial,
  roomy = false,
  focusWhen,
  kept,
  onKept,
  onSend,
  onCancel,
}: {
  label: string;
  placeholder: string;
  action: string;
  people: readonly Person[];
  /** Who is in the thread already, offered first. */
  inThread?: readonly string[];
  initial?: readonly Part[];
  /** The whole panel's box: taller, saying what Enter does. */
  roomy?: boolean;
  /** Counted up for what asks for the keys here. */
  focusWhen?: number;
  /** A draft kept by whoever holds this box, and told as it changes, to outlive its leaving. */
  kept?: Draft | undefined;
  onKept?: (draft: Draft) => void;
  onSend: (parts: Part[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const ids = useId();
  const nameOf = (id: string) =>
    people.find((each) => each.id === id)?.name ?? say('review.somebody');
  const [draft, setDraft] = useState<Draft>(() =>
    initial === undefined ? (kept ?? EMPTY_DRAFT) : fromParts(initial, nameOf),
  );
  const keep = (next: Draft) => {
    setDraft(next);
    onKept?.(next);
  };
  const [caret, setCaret] = useState(draft.text.length);
  const [closed, setClosed] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const boxAround = useRef<HTMLDivElement>(null);
  const caretTo = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    box.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  });
  useLayoutEffect(() => {
    if (focusWhen !== undefined && focusWhen > 0) box.current?.focus();
  }, [focusWhen]);

  const typed = closed ? null : typedMention(draft, caret);
  const offered =
    typed === null || draft.mentions.length >= MOST_MENTIONS
      ? []
      : people
          .filter((each) => each.name !== null && nameMatches(each.name, typed.query))
          .sort(
            (a, b) =>
              Number(inThread.includes(b.id)) - Number(inThread.includes(a.id)) ||
              (a.name ?? '').localeCompare(b.name ?? ''),
          )
          .slice(0, SUGGESTED);
  const shownActive = Math.min(active, Math.max(offered.length - 1, 0));

  const change = (value: string, at: number) => {
    keep(applyEdit(draft, value, at));
    setCaret(at);
    setClosed(false);
    setActive(0);
  };

  const choose = (person: Person) => {
    if (typed === null) return;
    const chosen = chooseMention(draft, typed.at, caret, {
      id: person.id,
      name: person.name ?? say('review.somebody'),
    });
    keep(chosen.draft);
    setCaret(chosen.caret);
    caretTo.current = chosen.caret;
    box.current?.focus();
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!hasContent(draft) || busy) return;
    setBusy(true);
    const sent = await onSend(toParts(draft));
    setBusy(false);
    if (sent && initial === undefined) {
      keep(EMPTY_DRAFT);
      setCaret(0);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Words being composed (an input method's): its keys are its own.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (offered.length > 0) {
      const keys: Record<string, () => void> = {
        ArrowDown: () => setActive((shownActive + 1) % offered.length),
        ArrowUp: () => setActive((shownActive - 1 + offered.length) % offered.length),
        Enter: () => choose(offered[shownActive]!),
        Tab: () => choose(offered[shownActive]!),
        Escape: () => setClosed(true),
      };
      const act = keys[event.key];
      if (act !== undefined && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        act();
        return;
      }
    }
    // A typed draft is never lost to the key that leaves the thread.
    if (event.key === 'Escape' && draft.text !== '') event.stopPropagation();
    // A comment being edited is saved or cancelled by its buttons, and Enter breaks its line.
    if (event.key === 'Enter' && !event.shiftKey && onCancel === undefined) {
      event.preventDefault();
      void send();
    }
  };

  const typeAt = () => {
    const at = box.current?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, at);
    const needsSpace = before !== '' && !/\s$/.test(before);
    const put = `${needsSpace ? ' ' : ''}@`;
    change(`${before}${put}${draft.text.slice(at)}`, at + put.length);
    caretTo.current = at + put.length;
    box.current?.focus();
  };

  const ready = hasContent(draft) && !busy;
  const place = useChoicesPlace(boxAround, offered.length > 0, true);
  useActiveInSight(`${ids}-option-${shownActive}`, offered.length > 0, shownActive);
  return (
    <form
      className={styles['composer']}
      data-roomy={roomy || undefined}
      onSubmit={(event) => void send(event)}
    >
      {offered.length > 0 && (
        <div className={styles['suggestions']} style={place}>
          <p id={`${ids}-heading`} className={styles['suggestHeading']}>
            {say('review.mention-someone')}
          </p>
          <ul id={`${ids}-list`} role="listbox" aria-labelledby={`${ids}-heading`}>
            {offered.map((person, index) => (
              <li
                key={person.id}
                id={`${ids}-option-${index}`}
                role="option"
                aria-selected={index === shownActive}
                className={styles['suggestion']}
                // The box keeps the keys, and its caret, while a pointer chooses.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
              >
                <Avatar person={person} size={28} />
                <span className={styles['suggestName']} data-content>
                  <Matched name={person.name ?? ''} query={typed?.query ?? ''} />
                </span>
                {inThread.includes(person.id) && (
                  <span className={styles['suggestAside']}>{say('review.in-this-thread')}</span>
                )}
              </li>
            ))}
          </ul>
          <p className={styles['suggestFoot']}>{say('review.enter-or-tab-to-choose')}</p>
        </div>
      )}
      <div ref={boxAround} className={styles['box']}>
        <label htmlFor={`${ids}-words`} className={styles['hiddenLabel']}>
          {label}
        </label>
        <textarea
          ref={box}
          id={`${ids}-words`}
          value={draft.text}
          placeholder={placeholder}
          rows={roomy || initial !== undefined ? 2 : 1}
          role="combobox"
          aria-expanded={offered.length > 0}
          aria-autocomplete="list"
          aria-controls={offered.length > 0 ? `${ids}-list` : undefined}
          aria-activedescendant={offered.length > 0 ? `${ids}-option-${shownActive}` : undefined}
          onChange={(event) =>
            change(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className={styles['boxActions']}>
          {people.length > 0 && (
            <IconButton className={styles['icon']} label={say('review.mention')} onClick={typeAt}>
              <Icon name="Mention" size={16} />
            </IconButton>
          )}
          {roomy && <span className={styles['boxHint']}>{say('review.enter-to-send')}</span>}
          {onCancel && (
            <button type="button" className={styles['textButton']} onClick={onCancel}>
              {say('review.cancel')}
            </button>
          )}
          <button
            type="submit"
            className={styles['send']}
            aria-label={action}
            title={action}
            data-ready={ready || undefined}
            disabled={!ready}
          >
            <Icon name="Reply" size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
