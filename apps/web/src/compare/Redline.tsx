import type { UnitChange, UnitText } from '@alloy-works/domain';

import styles from './Redline.module.css';
import { words } from '../words/words.js';

/** What a unit is called where it holds no text of its own. */
const TYPE_WORDS: Record<string, string> = {
  get paragraph() {
    return words('compare.paragraph');
  },
  get list() {
    return words('compare.list');
  },
  get item() {
    return words('compare.list-item');
  },
  get table() {
    return words('compare.table');
  },
  get cell() {
    return words('compare.table-cell');
  },
  get footnote() {
    return words('compare.footnote');
  },
  get figure() {
    return words('compare.figure');
  },
  get boundTable() {
    return words('compare.table-of-results');
  },
  get preformatted() {
    return words('compare.preformatted-text');
  },
  get blockquote() {
    return words('compare.quotation');
  },
  get equation() {
    return words('compare.equation');
  },
  get section() {
    return words('compare.section');
  },
  get reference() {
    return words('compare.component');
  },
};

const ATTRIBUTE_WORDS: Record<string, string> = {
  style: 'style',
  marks: 'formatting',
  get shape() {
    return words('compare.rows-or-columns');
  },
  get kind() {
    return words('compare.kind-of-list');
  },
};

/** Each change's text: what an unchanged or an edited unit says now, or what one inserted or deleted said. */
export interface RedlineTexts {
  readonly older: ReadonlyMap<string, UnitText>;
  readonly newer: ReadonlyMap<string, UnitText>;
  /** A name for a unit holding no text, by its key - a reference by its component's title. */
  readonly names?: ReadonlyMap<string, string>;
}

const Added = ({ text }: { text: string }) => (
  <ins className={styles['added']}>
    <span className={styles['hidden']}>{words('compare.added')}</span>
    {text}
  </ins>
);
const Removed = ({ text }: { text: string }) => (
  <del className={styles['removed']}>
    <span className={styles['hidden']}>{words('compare.removed')}</span>
    {text}
  </del>
);

/** How deep a unit stands, by its parents, for its indent. */
function depthOf(key: string, texts: ReadonlyMap<string, UnitText>): number {
  let depth = 0;
  for (let parent = texts.get(key)?.parent; parent && parent !== 'root';) {
    depth += 1;
    parent = texts.get(parent)?.parent;
  }
  return depth;
}

/**
 * A comparison drawn as a redline (VER-030; comparison.md): every unit in the newer side's order,
 * deletions where they stood, text added underlined and text removed struck through, each said in
 * words to a screen reader as well; a move, a split, a join and changed attributes named; and a match
 * by similar wording marked apart from one by identity (VER-029), since it is the less certain.
 */
export function Redline({
  changes,
  texts,
  label,
}: {
  changes: readonly UnitChange[];
  texts: RedlineTexts;
  label: string;
}) {
  const nameOf = (key: string, text: UnitText | undefined) =>
    text?.text || texts.names?.get(key) || TYPE_WORDS[text?.type ?? ''] || words('compare.part');
  const changed = changes.some(
    (each) =>
      each.change !== 'matched' ||
      each.moved !== null ||
      each.edited !== null ||
      each.changed.length > 0 ||
      each.matched === 'similarity',
  );
  if (!changed) return <p className={styles['note']}>{words('compare.nothing-changed')}</p>;
  return (
    <ol className={styles['redline']} aria-label={label}>
      {changes.map((change) => {
        if (change.change === 'inserted') {
          const text = texts.newer.get(change.newer);
          return (
            <li
              key={`i${change.newer}`}
              data-change="inserted"
              className={styles['unit']}
              style={{ marginInlineStart: `${depthOf(change.newer, texts.newer) * 16}px` }}
            >
              <span className={styles['badge']}>{words('compare.added-2')}</span>
              <Added text={nameOf(change.newer, text)} />
            </li>
          );
        }
        if (change.change === 'deleted') {
          const text = texts.older.get(change.older);
          return (
            <li
              key={`d${change.older}`}
              data-change="deleted"
              className={styles['unit']}
              style={{ marginInlineStart: `${depthOf(change.older, texts.older) * 16}px` }}
            >
              <span className={styles['badge']}>{words('compare.removed-2')}</span>
              <Removed text={nameOf(change.older, text)} />
            </li>
          );
        }
        const now = texts.newer.get(change.newer);
        const was = texts.older.get(change.older);
        // A container that holds no text and kept its place says nothing.
        if (
          !now?.text &&
          change.edited === null &&
          change.moved === null &&
          change.changed.length === 0 &&
          !texts.names?.has(change.newer)
        ) {
          return null;
        }
        const notes = [
          ...(change.moved ? [words('compare.moved')] : []),
          ...(change.split ? [words('compare.split')] : []),
          ...(change.joined ? [words('compare.joined')] : []),
          ...(change.changed.length > 0
            ? [
                words('compare.changed', {
                  value1: change.changed.map((name) => ATTRIBUTE_WORDS[name] ?? name).join(', '),
                }),
              ]
            : []),
        ];
        return (
          <li
            key={`m${change.newer}`}
            data-change={
              change.edited || change.moved || change.changed.length > 0 ? 'changed' : 'unchanged'
            }
            data-matched={change.matched}
            className={styles['unit']}
            style={{ marginInlineStart: `${depthOf(change.newer, texts.newer) * 16}px` }}
          >
            {notes.map((note) => (
              <span key={note} className={styles['badge']}>
                {note}
              </span>
            ))}
            {change.matched === 'similarity' && (
              <span className={styles['similar']}>
                {words('compare.matched-by-similar-wording')}
              </span>
            )}
            {change.edited === null ? (
              <span>{nameOf(change.newer, now)}</span>
            ) : 'whole' in change.edited ? (
              <>
                <Removed text={was?.text ?? ''} /> <Added text={now?.text ?? ''} />
              </>
            ) : (
              <span>
                {change.edited.ops.map((op, index) =>
                  op.op === 'keep' ? (
                    <span key={index}>{op.text}</span>
                  ) : op.op === 'insert' ? (
                    <Added key={index} text={op.text} />
                  ) : (
                    <Removed key={index} text={op.text} />
                  ),
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The redline under `root` as one HTML file to save (VER-030; CP-H): what the page shows and nothing
 * else, so nothing the reader may not read; its styles inline, so it opens anywhere.
 */
export function redlineHtml(title: string, root: HTMLElement): string {
  const escape = (value: string) =>
    value.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
  // The theme's own colours, as the page is drawn in them now: the file writes none of its own, and
  // without them the redline still reads by its underlining and striking through.
  const token = (name: string) =>
    getComputedStyle(root.ownerDocument.documentElement).getPropertyValue(name).trim() || 'inherit';
  return words('compare.doctype-html-html-lang-en', {
    value1: escape(title),
    value2: token('--text'),
    value3: token('--surface'),
    value4: token('--ok'),
    value5: token('--ok-bg'),
    value6: token('--danger'),
    value7: token('--danger-bg'),
    value8: escape(title),
    innerHTML: root.innerHTML,
  });
}

/** Saves `html` as a file without navigating the page (a download never does). */
export function saveHtml(name: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
