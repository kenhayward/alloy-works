import { words as say } from '../words/words.js';
import styles from './ThreadsPanel.module.css';

export interface Person {
  readonly id: string;
  readonly name: string | null;
  /** From outside the organisation (IAM-045). */
  readonly external?: true | undefined;
}

const AVATAR_COLOURS = 6;

/** A person's colour, the same wherever they appear (the handoff's six pairs). */
const colourOf = (id: string): number => {
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + (letter.codePointAt(0) ?? 0)) >>> 0;
  return (hash % AVATAR_COLOURS) + 1;
};

const initialsOf = (name: string | null): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? '')][0] ?? '?';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase();
};

/** The first word of a name, as the strip and a card say it; the whole of it stands elsewhere. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** A person's initials on their colour. Decorative: their name stands beside it, or in its button's. */
export function Avatar({ person, size }: { person: Person; size: number }) {
  return (
    <span
      className={styles['avatar']}
      data-colour={colourOf(person.id)}
      data-size={size}
      aria-hidden="true"
      data-content
    >
      {initialsOf(person.name)}
    </span>
  );
}

/** The assistant's face: a four-point star, never initials, so it is not taken for a person. */
export function AssistantAvatar({ size }: { size: number }) {
  return (
    <span
      className={`${styles['avatar']} ${styles['assistantAvatar']}`}
      data-size={size}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24">
        <path d="M12 1.5C13.4 7.6 16.4 10.6 22.5 12C16.4 13.4 13.4 16.4 12 22.5C10.6 16.4 7.6 13.4 1.5 12C7.6 10.6 10.6 7.6 12 1.5Z" />
      </svg>
    </span>
  );
}

/** That the assistant drafted a comment (GEN-063): its person answers for it, and it is said. */
export function AiTag() {
  return (
    <span className={styles['aiTag']} title={say('review.an-ai-assistant-not-a-person')}>
      {say('review.ai')}
    </span>
  );
}

/** Up to four people in a thread, overlapping. */
export function AvatarStack({ people }: { people: readonly Person[] }) {
  return (
    <span className={styles['stack']} aria-hidden="true">
      {people.slice(0, 4).map((each) => (
        <Avatar key={each.id} person={each} size={20} />
      ))}
    </span>
  );
}
