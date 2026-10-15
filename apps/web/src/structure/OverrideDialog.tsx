import { useId, useState } from 'react';
import { Modal } from '../layouts/Modal.js';
import styles from './OverrideDialog.module.css';
import { paragraphsOf, type OverrideBody, type OverrideView } from './overrides.js';

/**
 * **Overrides** of one reference (REU-011, REU-015; the R4 plan, R4-G): each paragraph of its component
 * as it stands, and its words in this document alone where they differ. An override of a paragraph that
 * has changed since no longer applies, and says so; it is kept until the author changes or removes it.
 */
export function OverrideDialog({
  name,
  content,
  version,
  overrides,
  current,
  busy,
  onSave,
  onClose,
}: {
  name: string;
  /** The component's content as the reference takes it, without overrides. */
  content: unknown;
  /** The component version that is: what a new override is made against. */
  version: string;
  overrides: readonly OverrideView[];
  /** The overrides as the outline holds them, against the versions they were made at. */
  current: readonly OverrideBody[];
  busy: boolean;
  onSave: (overrides: OverrideBody[]) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const paragraphs = paragraphsOf(content);
  const said = new Map(overrides.map((each) => [each.block, each]));
  const words = (each: OverrideView | undefined) =>
    (each?.text ?? [])
      .map((run) => (typeof run['value'] === 'string' ? run['value'] : ''))
      .join('');
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      paragraphs.map((each) => [each.id, said.has(each.id) ? words(said.get(each.id)) : each.text]),
    ),
  );

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const held = new Map(current.map((each) => [each.block, each]));
    const next: OverrideBody[] = [];
    for (const paragraph of paragraphs) {
      const now = (typed[paragraph.id] ?? '').normalize('NFC');
      const was = said.get(paragraph.id);
      // Unchanged from the component: no override. Unchanged from its override: kept as it was made.
      if (now === paragraph.text) continue;
      if (was && now === words(was) && held.has(paragraph.id)) {
        next.push(held.get(paragraph.id)!);
        continue;
      }
      if (now.trim() === '') continue;
      next.push({
        block: paragraph.id,
        against: version,
        text: [{ type: 'text', value: now, marks: [] }],
      });
    }
    onSave(next);
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={save}>
        <h2 id={headingId}>{`Overrides of ${name}`}</h2>
        <p className={styles['muted']}>
          Change a paragraph&apos;s words in this document alone. The component, and every other
          document, keeps its own. An overridden paragraph is plain text: its formatting is not
          kept.
        </p>
        {paragraphs.length === 0 && <p>This component has no paragraph to override.</p>}
        {paragraphs.map((paragraph, at) => {
          const override = said.get(paragraph.id);
          return (
            <div key={paragraph.id} className={styles['paragraph']}>
              <label>
                {`Paragraph ${at + 1}`}
                <textarea
                  value={typed[paragraph.id] ?? ''}
                  onChange={(event) =>
                    setTyped((was) => ({ ...was, [paragraph.id]: event.target.value }))
                  }
                  aria-describedby={`${headingId}${paragraph.id}`}
                />
              </label>
              {override?.stale && (
                <span role="note" className={styles['stale']}>
                  This override no longer applies: the paragraph has changed since. Change the words
                  or set them back.
                </span>
              )}
              <span id={`${headingId}${paragraph.id}`} className={styles['muted']}>
                {override && !override.stale
                  ? 'Overridden here.'
                  : `The component says: ${paragraph.text}`}
              </span>
            </div>
          );
        })}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {current.length > 0 && (
            <button type="button" onClick={() => onSave([])} disabled={busy}>
              Remove every override
            </button>
          )}
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
