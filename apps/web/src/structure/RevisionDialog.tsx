import type { createApiClient } from '@alloy-works/api-client';
import {
  canonicalKeyValue,
  formatValue,
  takes,
  valueTypeSchema,
  type CanonicalValue,
  type ColumnType,
  type ValueFormats,
} from '@alloy-works/domain';
import { useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import type { BindingState, RevisionShown } from './bindingContexts.js';
import { standingRevision } from './bindingContexts.js';

type Client = ReturnType<typeof createApiClient>;

/** What the dialog acts on: a value or a table, to revise or withdraw. */
export interface Revising {
  readonly node: string;
  readonly state: BindingState;
  readonly act: 'revise' | 'withdraw';
  /** The columns a bound table's cell may be revised in, by name and type; empty for a value. */
  readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
}

/** Why a revision was refused, in words, by the service's code. */
const REFUSED: Readonly<Record<string, string>> = {
  value_invalid: 'That is not a value of its column.',
  value_empty: 'A value revised by hand is never blank.',
  key_required: 'Name a value for every key column.',
  revision_row_missing: 'The result has no row with that key.',
  revision_not_possible: 'That cannot be revised by hand.',
  revision_precondition: 'The value changed meanwhile. Look at it again.',
  revision_not_standing: 'Nothing revised by hand stands there now.',
  binding_stale: 'The binding changed since its value was taken: resolve it first.',
};

/** A canonical value typed in a column's type, or null where it is not one. */
const typed = (type: ColumnType, words: string): CanonicalValue => canonicalKeyValue(type, words);

/**
 * **Revise a value by hand, or withdraw a revision** (bindings.md, "A value revised by hand"; the RV
 * plan, RV-I, RV-J): for a value, its new value typed in its column's type with the value shown as the
 * document will show it, and a reason; for a bound table, a cell by its row's key and its column. A
 * withdrawal asks only why, and for a table which cell's. Sent to the revisions route; `onDone` reads
 * the view again.
 */
export function RevisionDialog({
  client,
  document,
  revising,
  formats,
  onClose,
  onDone,
}: {
  client: Client;
  document: string;
  revising: Revising;
  formats: ValueFormats;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const ids = useId();
  const { state, act, columns } = revising;
  const held = state.held!;
  const inline = takes(state.binding);
  const keyColumns = held.key ?? [];
  const typeOf = (name: string): ColumnType | undefined => {
    const declared = held.provenance.columns.find((each) => each.name === name)?.type;
    return declared === undefined ? undefined : (declared as ColumnType);
  };
  const standingCells = (state.revisions ?? []).filter((each) => each.stands && each.cell !== null);
  const inlineStanding = inline ? standingRevision(state) : undefined;
  const inlineType =
    inline && held.taken !== null && 'value' in held.taken
      ? valueTypeSchema.safeParse(held.taken.column.type)
      : undefined;
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const [key, setKey] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState(standingCells[0]?.id ?? '');
  const [value, setValue] = useState(
    inlineStanding === undefined ? '' : String(inlineStanding.value),
  );
  const [reason, setReason] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const type: ColumnType | undefined = inline
    ? inlineType?.success === true
      ? inlineType.data
      : undefined
    : typeOf(column);
  const canonical = type === undefined || value.trim() === '' ? null : typed(type, value);
  const preview =
    canonical === null || type === undefined || type.base === 'image'
      ? null
      : formatValue(canonical as string | boolean, type as never, formats);

  const send = async () => {
    if (sending) return;
    let cell: RevisionShown['cell'] = null;
    let replaces: string | null;
    if (!inline && act === 'revise') {
      const named: Record<string, CanonicalValue> = {};
      for (const name of keyColumns) {
        const one = typed(typeOf(name) ?? { base: 'text' }, key[name] ?? '');
        if (one === null) {
          setRefused(`Give the row's ${name}.`);
          return;
        }
        named[name] = one;
      }
      cell = { key: named, column };
      replaces = standingRevision(state, cell)?.id ?? null;
    } else if (!inline) {
      const picked = standingCells.find((each) => each.id === chosen);
      cell = picked?.cell ?? null;
      replaces = picked?.id ?? null;
    } else {
      replaces = inlineStanding?.id ?? null;
    }
    if (act === 'revise' && canonical === null) {
      setRefused(REFUSED['value_invalid']!);
      return;
    }
    if (reason.trim() === '') {
      setRefused('Say why.');
      return;
    }
    setSending(true);
    const { response, error } = await client.POST('/v1/documents/{id}/bindings/revisions', {
      params: { path: { id: document } },
      body: {
        node: revising.node,
        binding: state.binding.id,
        ...(cell === null
          ? {}
          : { cell: { key: { ...cell.key } as Record<string, string>, column: cell.column } }),
        act,
        value: act === 'revise' ? (canonical as string | boolean) : null,
        reason: reason.trim(),
        resolution: held.resolution ?? '',
        replaces,
      },
    });
    setSending(false);
    if (response.ok) {
      onDone(act === 'revise' ? 'Revised by hand.' : 'The revision was withdrawn.');
      return;
    }
    const code = (error as { code?: unknown } | undefined)?.code;
    setRefused(
      (typeof code === 'string' ? REFUSED[code] : undefined) ??
        'That could not be done. Try again.',
    );
  };

  const heading = act === 'revise' ? 'Revise by hand' : 'Withdraw a revision';
  return (
    <Modal labelledBy={`${ids}-heading`} size="narrow" onClose={onClose}>
      <section aria-labelledby={`${ids}-heading`}>
        <h2 id={`${ids}-heading`}>{heading}</h2>
        <p>
          {act === 'revise'
            ? 'The value you give stands in front of what the query returned, which is kept, and is marked as revised by hand. A subtotal stays the query’s.'
            : 'The value the query returned is shown again.'}
        </p>
        {!inline && act === 'revise' && (
          <>
            {keyColumns.map((name) => (
              <label key={name} htmlFor={`${ids}-key-${name}`}>
                {`Row: ${name}`}
                <input
                  id={`${ids}-key-${name}`}
                  value={key[name] ?? ''}
                  onChange={(event) => setKey({ ...key, [name]: event.target.value })}
                />
              </label>
            ))}
            <label htmlFor={`${ids}-column`}>
              Column
              <select
                id={`${ids}-column`}
                value={column}
                onChange={(event) => setColumn(event.target.value)}
              >
                {columns.map((each) => (
                  <option key={each.name} value={each.name}>
                    {each.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {!inline && act === 'withdraw' && (
          <label htmlFor={`${ids}-cell`}>
            Revision
            <select
              id={`${ids}-cell`}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              {standingCells.map((each) => (
                <option key={each.id} value={each.id}>
                  {`${String(each.value)} in ${each.cell!.column}, the row ${Object.values(each.cell!.key).map(String).join(', ')}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {act === 'revise' && (
          <label htmlFor={`${ids}-value`}>
            Value
            <input
              id={`${ids}-value`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-describedby={`${ids}-preview`}
            />
          </label>
        )}
        {act === 'revise' && (
          <p id={`${ids}-preview`}>
            {preview === null ? 'Not yet a value of its column.' : `Shown as ${preview}`}
          </p>
        )}
        <label htmlFor={`${ids}-reason`}>
          Why
          <textarea
            id={`${ids}-reason`}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {refused !== null && <p role="alert">{refused}</p>}
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>{' '}
          <button type="button" className="primary" onClick={() => void send()}>
            {act === 'revise' ? 'Revise' : 'Withdraw'}
          </button>
        </div>
      </section>
    </Modal>
  );
}
