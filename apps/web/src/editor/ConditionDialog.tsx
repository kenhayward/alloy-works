import type { createApiClient } from '@alloy-works/api-client';
import type { ConditionChoice, ConditionHeld } from '@alloy-works/editor';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ConditionDialog.module.css';

type Client = ReturnType<typeof createApiClient>;

/** A declared axis, with its values, as the dialog offers it. */
export interface OfferedAxis {
  readonly key: string;
  readonly name: string;
  readonly values: readonly { readonly key: string; readonly label: string }[];
}

/** What the dialog says where the environment declares no axis. */
export const NO_AXES = 'No condition axes are declared yet.';
/** What it says where the axes could not be read. */
export const AXES_UNREAD = 'The condition axes could not be read.';
/** Why an alternative is offered: the documented way to word text differently per profile. */
export const ALTERNATIVE_SAID =
  'To word this differently for other readers, add an alternative: a copy kept for the other values, to rewrite.';

/** The keys of every declared axis, from the listing alone: what a paste keeps conditions on. */
export async function declaredAxisKeys(client: Client): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | null = null;
  do {
    const query: { cursor?: string } = cursor === null ? {} : { cursor };
    const { data } = await client.GET('/v1/definitions', { params: { query } });
    if (!data) return keys;
    for (const each of data.items) {
      if (each.kind === 'conditionAxis' && each.key !== undefined) keys.push(each.key);
    }
    cursor = data.next;
  } while (cursor !== null);
  return keys;
}

/** Every declared axis with its values, by name. */
export async function declaredAxes(client: Client): Promise<OfferedAxis[]> {
  const keyed: { id: string; key: string; name: string }[] = [];
  let cursor: string | null = null;
  do {
    const query: { cursor?: string } = cursor === null ? {} : { cursor };
    const { data } = await client.GET('/v1/definitions', { params: { query } });
    if (!data) throw new Error('unread');
    for (const each of data.items) {
      if (each.kind === 'conditionAxis' && each.key !== undefined) {
        keyed.push({ id: each.id, key: each.key, name: each.name });
      }
    }
    cursor = data.next;
  } while (cursor !== null);
  return Promise.all(
    keyed.map(async (each) => {
      const { data } = await client.GET('/v1/definitions/{id}', {
        params: { path: { id: each.id } },
      });
      if (!data) throw new Error('unread');
      const values = (data.definition['values'] ?? []) as OfferedAxis['values'];
      return { key: each.key, name: each.name, values };
    }),
  );
}

export interface ConditionDialogProps {
  readonly client: Client;
  /** The conditions the selection already carries. */
  readonly held: readonly ConditionHeld[];
  readonly onSet: (choice: ConditionChoice) => void;
  readonly onAlternative: (choice: ConditionChoice) => void;
  readonly onRemove: (axis: string) => void;
  readonly onCancel: () => void;
}

/**
 * **The Condition dialog** (REU-021, REU-047; the R6 plan, R6-H): an axis chosen from those declared,
 * and the values the selected text is kept for. Where the text already carries that axis, it offers
 * an alternative for the other values, and to take the condition off.
 */
export function ConditionDialog({
  client,
  held,
  onSet,
  onAlternative,
  onRemove,
  onCancel,
}: ConditionDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const [axes, setAxes] = useState<readonly OfferedAxis[] | 'unread' | null>(null);
  const [axis, setAxis] = useState<string | null>(held[0]?.axis ?? null);
  const [values, setValues] = useState<readonly string[]>(held[0]?.values ?? []);

  useEffect(() => {
    let live = true;
    declaredAxes(client).then(
      (found) => {
        if (!live) return;
        setAxes(found);
        setAxis((now) => now ?? found[0]?.key ?? null);
      },
      () => live && setAxes('unread'),
    );
    return () => {
      live = false;
    };
  }, [client]);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('select, input, button')?.focus();
  }, [axes]);

  const read = axes !== null && axes !== 'unread' ? axes : null;
  const chosen = read !== null ? read.find((each) => each.key === axis) : undefined;
  const already = held.find((each) => each.axis === axis);
  const others = chosen?.values.filter((each) => !already?.values.includes(each.key)) ?? [];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>('select, input, button:not(:disabled)') ??
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
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Condition" size={22} />
            </span>
            Condition
          </h2>
          {axes === null && <p role="status">Reading the condition axes.</p>}
          {axes === 'unread' && <p role="alert">{AXES_UNREAD}</p>}
          {read !== null && read.length === 0 && <p>{NO_AXES}</p>}
          {read !== null && read.length > 0 && (
            <>
              <div className={styles['field']}>
                <label htmlFor={`${id}-axis`}>Axis</label>
                <select
                  id={`${id}-axis`}
                  value={axis ?? ''}
                  onChange={(event) => {
                    setAxis(event.target.value);
                    setValues(held.find((each) => each.axis === event.target.value)?.values ?? []);
                  }}
                >
                  {read.map((each) => (
                    <option key={each.key} value={each.key}>
                      {each.name}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className={own['values']}>
                <legend>Kept for</legend>
                {chosen?.values.map((each) => (
                  <label key={each.key} className={own['value']}>
                    <input
                      type="checkbox"
                      checked={values.includes(each.key)}
                      onChange={(event) =>
                        setValues((now) =>
                          event.target.checked
                            ? [...now, each.key]
                            : now.filter((value) => value !== each.key),
                        )
                      }
                    />
                    {each.label}
                  </label>
                ))}
              </fieldset>
              {already !== undefined && others.length > 0 && (
                <p className={own['said']}>{ALTERNATIVE_SAID}</p>
              )}
              <div className={own['actions']}>
                <button
                  type="button"
                  disabled={axis === null || values.length === 0}
                  onClick={() => axis !== null && onSet({ axis, values })}
                >
                  Set condition
                </button>
                {already !== undefined && others.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      axis !== null &&
                      onAlternative({ axis, values: others.map((each) => each.key) })
                    }
                  >
                    Add alternative
                  </button>
                )}
                {already !== undefined && (
                  <button type="button" onClick={() => axis !== null && onRemove(axis)}>
                    Remove condition
                  </button>
                )}
              </div>
            </>
          )}
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
