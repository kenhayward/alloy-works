import type { createApiClient } from '@alloy-works/api-client';
import { useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from './Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

/** A component's divergent line, as its view gives it (LIF-044; the R16 plan, R16-B). */
export interface LineNow {
  readonly id: string;
  readonly name: string;
  readonly divergedFrom: { readonly revision: number; readonly version: string };
  readonly at: string;
  readonly closed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A view's `lines`, read defensively: none from a view before R16. */
export function linesIn(data: unknown): readonly LineNow[] {
  return isRecord(data) && Array.isArray(data.lines) ? (data.lines as LineNow[]) : [];
}

/** Where a component on one of its lines is, or on its main line. */
export const lineAddress = (component: string, line: string | null) =>
  line === null ? `#/components/${component}` : `#/components/${component}/lines/${line}`;

/**
 * **Line** (LIF-044, LIF-046; R16-B, R16-E): which of a component's lines is read - its main line or a
 * divergent one, each said with the revision it diverged from - and a move to another; and **Begin a
 * line**, to whoever may edit it, from its approved revision. Nothing where it has no line and the
 * reader may begin none.
 */
export function LinesControl({
  client,
  componentId,
  line,
  lines,
  revision,
  mayEdit,
  onGo,
  className,
}: {
  client: Client;
  componentId: string;
  /** The line read, or undefined for the main line. */
  line: string | undefined;
  lines: readonly LineNow[];
  /** The main line's latest revision, which a line begins from; null where none is approved. */
  revision: number | null;
  mayEdit: boolean;
  onGo: (address: string) => void;
  className?: string | undefined;
}) {
  const chooserId = useId();
  const [beginning, setBeginning] = useState(false);
  const mayBegin = mayEdit && line === undefined && revision !== null;
  if (lines.length === 0 && !mayBegin) return null;
  return (
    <>
      {lines.length > 0 && (
        <span className={className}>
          <label htmlFor={chooserId}>Line</label>{' '}
          <select
            id={chooserId}
            value={line ?? ''}
            onChange={(event) =>
              onGo(lineAddress(componentId, event.target.value === '' ? null : event.target.value))
            }
          >
            <option value="">Main line</option>
            {lines.map((each) => (
              <option key={each.id} value={each.id}>
                {`${each.name}, from revision ${each.divergedFrom.revision}${each.closed ? ', brought back' : ''}`}
              </option>
            ))}
          </select>
        </span>
      )}
      {mayBegin && (
        <button type="button" className={className} onClick={() => setBeginning(true)}>
          Begin a line
        </button>
      )}
      {beginning && revision !== null && (
        <BeginDialog
          client={client}
          componentId={componentId}
          revision={revision}
          onClose={() => setBeginning(false)}
          onBegun={(begun) => {
            setBeginning(false);
            onGo(lineAddress(componentId, begun));
          }}
        />
      )}
    </>
  );
}

function BeginDialog({
  client,
  componentId,
  revision,
  onClose,
  onBegun,
}: {
  client: Client;
  componentId: string;
  revision: number;
  onClose: () => void;
  onBegun: (line: string) => void;
}) {
  const headingId = useId();
  const [name, setName] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') {
      setSaid('A line needs a name.');
      return;
    }
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/components/{id}/lines', {
        params: { path: { id: componentId } },
        body: { revision, name: name.trim() },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onBegun(data.id);
    else setSaid(refusal(error, 'The line could not be begun.'));
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void begin(event)}>
        <h2 id={headingId}>Begin a line</h2>
        <p className={styles['muted']}>
          {`A line of revisions beside the main one, from revision ${revision}: a market's wording, say, with its own drafts and approvals, effective where its scope says.`}
        </p>
        <label>
          Name
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        {said !== '' && <p role="alert">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Begin
          </button>
        </div>
      </form>
    </Modal>
  );
}
