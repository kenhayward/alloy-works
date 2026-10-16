import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from '../editor/MarkPrompt.module.css';
import shell from '../layouts/Modal.module.css';
import own from './GenerateDialog.module.css';
import { rowsFrom, type ReadRows } from './rows.js';

type Client = ReturnType<typeof createApiClient>;

export interface GenerateDialogProps {
  readonly client: Client;
  readonly template: { readonly id: string; readonly name: string; readonly space: string };
  /** The cohort asked for, to follow on its own page. */
  readonly onGenerated: (cohort: string) => void;
  readonly onCancel: () => void;
}

/** What the dialog says of the rows read. */
const rowsSaid = (read: ReadRows): string =>
  read.ok
    ? `${read.rows.length} ${read.rows.length === 1 ? 'row' : 'rows'}, giving ${read.names.join(', ')}.`
    : read.problem;

/**
 * **Generate documents** (REU-031, REU-032; the R7 plan, R7-B, R7-C): a document for each row of a CSV
 * file or a list pasted from a spreadsheet, its first line naming the template's parameters, each
 * titled from a pattern, `{name}` standing for the row's value. Asked for as one cohort, followed on
 * its own page.
 */
export function GenerateDialog({ client, template, onGenerated, onCancel }: GenerateDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const [language, setLanguage] = useState('en-GB');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const read = text.trim() === '' ? null : rowsFrom(text);
  // Named by the first parameter until the author says otherwise.
  const pattern = title ?? (read?.ok ? `${template.name}: {${read.names[0]}}` : template.name);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, []);

  const generate = async () => {
    if (!read?.ok) return;
    setAsking(true);
    setRefusal(null);
    try {
      const { data, error } = await client.POST('/v1/spaces/{space}/cohorts', {
        params: { path: { space: template.space } },
        body: {
          template: template.id,
          title: pattern,
          language,
          direction: 'ltr',
          rows: read.rows.map((row) => ({ ...row })),
        },
      });
      if (data) {
        onGenerated(data.cohort.id);
        return;
      }
      const message = (error as { message?: unknown } | undefined)?.message;
      setRefusal(typeof message === 'string' ? message : 'The documents could not be asked for.');
    } catch {
      setRefusal('The documents could not be asked for. Try again.');
    } finally {
      setAsking(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)') ??
        []),
    ];
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < stops.length) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <div className={styles['form']}>
          <h2 id={`${id}-heading`} className={styles['heading']}>
            Generate documents from {template.name}
          </h2>
          <div className={styles['field']}>
            <label htmlFor={`${id}-file`}>A CSV file of rows</label>
            <input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.text().then(setText);
              }}
            />
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-rows`}>Or paste the rows</label>
            <textarea
              id={`${id}-rows`}
              className={own['rows']}
              rows={6}
              value={text}
              aria-describedby={`${id}-said`}
              onChange={(event) => setText(event.target.value)}
            />
            <p id={`${id}-said`} className={own['said']} role="status">
              {read === null
                ? 'The first line names the parameters; each line after it is a document.'
                : rowsSaid(read)}
            </p>
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-title`}>Each title</label>
            <input
              id={`${id}-title`}
              value={pattern}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className={styles['field']}>
            <label htmlFor={`${id}-language`}>Language</label>
            <input
              id={`${id}-language`}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>
          {refusal !== null && <p role="alert">{refusal}</p>}
          <div className={own['actions']}>
            <button
              type="button"
              disabled={!read?.ok || asking || pattern.trim() === ''}
              onClick={() => void generate()}
            >
              {read?.ok ? `Generate ${read.rows.length} documents` : 'Generate documents'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
