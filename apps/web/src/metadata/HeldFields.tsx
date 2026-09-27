import type { FieldView } from '@alloy-works/api-client';
import { canonicaliseValues } from '@alloy-works/domain';
import { useEffect, useRef, useState } from 'react';

import { FieldsForm } from './FieldsForm.js';

/** What a save came to: kept, or not sent because another act was in flight, or refused. */
export type SaveAnswer = 'saved' | 'unsent' | 'refused';

export interface HeldFieldsProps {
  /** The region's name, which `F6` and a screen reader announce. */
  readonly label: string;
  readonly fields: readonly FieldView[];
  readonly schemas: readonly { readonly id: string; readonly name: string }[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** The values as they are stored now. */
  readonly stored: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  /** Saves the values, whole, as the artifact's next version. */
  readonly onSave: (values: Record<string, unknown>) => Promise<SaveAnswer>;
  /** How long after the last change the values are saved: each save is a version. */
  readonly delayMs?: number;
}

/**
 * A document's or a section's fields (definitions.md, "A document's and a section's"): the one form,
 * saving a pause after the last change rather than on every key, since each save is a version, and
 * trying again while another act is in flight. What is stored is taken back whenever nothing typed is
 * waiting and it differs from what the form holds - somebody else's version, or a refusal's current -
 * and the form is drawn afresh then, so no input goes on showing what it held.
 */
export function HeldFields(props: HeldFieldsProps) {
  const [held, setHeld] = useState<Record<string, unknown>>({ ...props.stored });
  const heldNow = useRef(held);
  heldNow.current = held;
  const [drawn, setDrawn] = useState(0);
  const waiting = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = props.delayMs ?? 800;
  const save = useRef(props.onSave);
  save.current = props.onSave;

  // Taken back only where it says something the form does not hold: the answer to this form's own
  // save says what it already shows, and drawing it afresh then would take the focus from the author.
  // Compared canonically: Postgres hands an object's members back in an order of its own.
  const stored = canonicaliseValues(props.stored);
  useEffect(() => {
    if (waiting.current !== null || stored === canonicaliseValues(heldNow.current)) return;
    setHeld(JSON.parse(stored) as Record<string, unknown>);
    setDrawn((count) => count + 1);
  }, [stored]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const values = waiting.current;
      if (values === null) return;
      void save.current(values).then((answer) => {
        // Typed again while this was on the wire: that is the next save, already waiting.
        if (waiting.current !== values) return;
        if (answer === 'unsent') {
          schedule();
          return;
        }
        waiting.current = null;
      });
    }, delay);
  };

  return (
    <section aria-label={props.label}>
      <FieldsForm
        key={drawn}
        fields={props.fields}
        schemas={props.schemas}
        values={held}
        people={props.people}
        readOnly={props.readOnly}
        onChange={(next) => {
          setHeld(next);
          waiting.current = next;
          schedule();
        }}
      />
    </section>
  );
}
