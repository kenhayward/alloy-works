import styles from './DocumentPage.module.css';
import { outsideSaid } from '../parts/Outside.js';
import type { Freshness, LivePresence } from './live.js';
import { words } from '../words/words.js';

type Person = LivePresence & { readonly freshness: Freshness };

/** What somebody is doing, in words (COL-002). */
const DOING: Readonly<Record<NonNullable<LivePresence['mode']>, string>> = {
  read: 'reading',
  review: 'reviewing',
  author: 'editing',
};

const initialsOf = (name: string) =>
  name
    .split(/[\s.@]+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/** A person's presence in words: their name, what they are doing where it may be told, and staleness. */
export function presenceWords(person: Person): string {
  const name = `${person.person.name ?? words('document.somebody')}${person.person.external === true ? `, ${outsideSaid()}` : ''}`;
  const doing = person.mode === null ? 'here' : DOING[person.mode];
  return person.freshness === 'stale'
    ? words('document.not-heard-from-lately', { name, doing })
    : `${name}, ${doing}`;
}

/**
 * **Who else is in the document** (COL-001, COL-002; the PL plan, PL2), on the document bar: each
 * person's initials, named and said for a screen reader, a stale one faded (COL-055). While the stream
 * is down it says live information is unavailable rather than show an old picture (COL-004).
 */
export function PeopleHere({
  people,
  connected,
}: {
  people: readonly Person[];
  connected: boolean;
}) {
  if (!connected) {
    return <p className={styles['peopleOff']}>{words('document.who-is-here-is-not')}</p>;
  }
  if (people.length === 0) return null;
  // One mark a person, however many windows they have open: the freshest says what they are doing.
  const byPerson = new Map<string, Person>();
  for (const each of people) {
    const was = byPerson.get(each.person.id);
    if (!was || was.beatAt < each.beatAt) byPerson.set(each.person.id, each);
  }
  const shown = [...byPerson.values()];
  return (
    <ul className={styles['people']} aria-label={words('document.also-here')}>
      {shown.map((person) => (
        <li
          key={person.person.id}
          className={styles['peopleMark']}
          data-freshness={person.freshness}
          title={presenceWords(person)}
        >
          <span aria-hidden="true">{initialsOf(person.person.name ?? '?')}</span>
          <span className={styles['peopleHidden']}>{presenceWords(person)}</span>
        </li>
      ))}
    </ul>
  );
}
