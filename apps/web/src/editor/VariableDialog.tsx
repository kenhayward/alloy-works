import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './VariableDialog.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A declared variable, as the dialog offers it. */
interface Offered {
  readonly name: string;
  readonly key: string;
}

/** What the dialog says where the environment declares no variable. */
export const NO_VARIABLES = 'No variables are declared yet.';
/** What it says where the definitions could not be read. */
export const VARIABLES_UNREAD = 'The variables could not be read.';

/** Every declared variable, by name, from every page of the definitions. */
async function declared(client: Client): Promise<readonly Offered[]> {
  const offered: Offered[] = [];
  let cursor: string | null = null;
  do {
    const query: { cursor?: string } = cursor === null ? {} : { cursor };
    const { data } = await client.GET('/v1/definitions', { params: { query } });
    if (!data) throw new Error('unread');
    for (const each of data.items) {
      if (each.kind === 'variable' && each.key !== undefined) {
        offered.push({ name: each.name, key: each.key });
      }
    }
    cursor = data.next;
  } while (cursor !== null);
  return offered;
}

export interface VariableDialogProps {
  readonly client: Client;
  /** The key of the variable chosen, for the caller to place where the cursor was. */
  readonly onChoose: (key: string) => void;
  /** Closed with nothing chosen: Escape or Close. */
  readonly onCancel: () => void;
}

/**
 * **The Variable dialog** (REU-018; the R5 plan, R5b): the variables the environment declares, by
 * name with the key text names each by, so an author chooses one rather than typing a name. Choosing
 * answers its key; Escape and Close answer nothing. The keyboard is held inside, as every dialog here
 * holds it.
 */
export function VariableDialog({ client, onChoose, onCancel }: VariableDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const [offered, setOffered] = useState<readonly Offered[] | 'unread' | null>(null);

  useEffect(() => {
    let live = true;
    declared(client).then(
      (found) => live && setOffered(found),
      () => live && setOffered('unread'),
    );
    return () => {
      live = false;
    };
  }, [client]);

  // The first variable takes the focus once they are read; Close until then.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
  }, [offered]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('button') ?? [])];
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
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Variable" size={22} />
            </span>
            {words('editor.variable')}
          </h2>
          {offered === null && <p role="status">{words('editor.reading-the-variables')}</p>}
          {offered === 'unread' && <p role="alert">{VARIABLES_UNREAD}</p>}
          {Array.isArray(offered) && offered.length === 0 && <p>{NO_VARIABLES}</p>}
          {Array.isArray(offered) && offered.length > 0 && (
            <ul className={own['list']} aria-label={words('editor.declared-variables')}>
              {offered.map((each) => (
                <li key={each.key}>
                  <button
                    type="button"
                    className={own['choice']}
                    onClick={() => onChoose(each.key)}
                  >
                    <span>{each.name}</span>
                    <code className={own['key']}>{each.key}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className={shell['close']}
          aria-label={words('editor.close')}
          title={words('editor.close')}
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
