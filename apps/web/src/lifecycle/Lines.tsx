import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

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
  /** A language line's tag (the TR plan, TR-A): a translation, offered under Translations instead. */
  readonly language?: string | null;
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
  // A translation is a language line, but not a divergence: Translations opens it (TR-G).
  const divergent = lines.filter((each) => !each.language);
  if (lines.some((each) => each.id === line && each.language)) return null;
  if (divergent.length === 0 && !mayBegin) return null;
  return (
    <>
      {divergent.length > 0 && (
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
            {divergent.map((each) => (
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

/** A block's words, read defensively: every text run's value, in order. */
function wordsIn(block: unknown): string {
  if (Array.isArray(block)) return block.map(wordsIn).join('');
  if (!isRecord(block)) return '';
  if (block.type === 'text' && typeof block.value === 'string') return block.value;
  return Object.entries(block)
    .filter(([key]) => key !== 'id' && key !== 'type')
    .map(([, value]) => wordsIn(value))
    .join(' ')
    .trim();
}

interface Compared {
  readonly main: { readonly id: string; readonly number: string };
  readonly line: { readonly id: string; readonly number: string };
  readonly differences: readonly {
    readonly block: string;
    readonly change: 'changed' | 'line' | 'main';
    readonly mainBlock: unknown;
    readonly lineBlock: unknown;
  }[];
}

/**
 * **Bring back** (LIF-045; the R16 plan, R16-F), to whoever may edit, on an open line: the line and the
 * main line compared first, block by block, each block that differs offered as the line's to take or
 * the main line's to keep; then the line brought back, closed, and the main line opened.
 */
export function BringBackButton({
  client,
  componentId,
  line,
  onGo,
  className,
}: {
  client: Client;
  componentId: string;
  line: LineNow;
  onGo: (address: string) => void;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Bring back
      </button>
      {open && (
        <BringBackDialog
          client={client}
          componentId={componentId}
          line={line}
          onClose={() => setOpen(false)}
          onBack={() => {
            setOpen(false);
            onGo(lineAddress(componentId, null));
          }}
        />
      )}
    </>
  );
}

function BringBackDialog({
  client,
  componentId,
  line,
  onClose,
  onBack,
}: {
  client: Client;
  componentId: string;
  line: LineNow;
  onClose: () => void;
  onBack: () => void;
}) {
  const headingId = useId();
  const [compared, setCompared] = useState<Compared | 'unread' | null>(null);
  const [carry, setCarry] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/components/{id}/lines/{line}/comparison', {
        params: { path: { id: componentId, line: line.id } },
      })
      .then(({ data }) => {
        if (current) setCompared(data ? (data as Compared) : 'unread');
      })
      .catch(() => {
        if (current) setCompared('unread');
      });
    return () => {
      current = false;
    };
  }, [client, componentId, line.id]);

  const toggle = (block: string) =>
    setCarry((now) => {
      const next = new Set(now);
      if (next.has(block)) next.delete(block);
      else next.add(block);
      return next;
    });

  const bring = async (event: React.FormEvent) => {
    event.preventDefault();
    if (compared === null || compared === 'unread') return;
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/components/{id}/lines/{line}/return', {
        params: { path: { id: componentId, line: line.id } },
        body: { openedFrom: compared.main.id, lineHead: compared.line.id, carry: [...carry] },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onBack();
    else setSaid(refusal(error, 'It could not be brought back.'));
  };

  const legend = {
    changed: 'Changed on either line',
    line: `On ${line.name} alone`,
    main: 'On the main line alone',
  } as const;

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void bring(event)}>
        <h2 id={headingId}>{`Bring ${line.name} back`}</h2>
        <p className={styles['muted']}>
          {`Each block that differs keeps the main line's unless ${line.name}'s is taken. The main line gets a new version, ${line.name} is closed, and what was carried and what was left behind are recorded.`}
        </p>
        {compared === null && <p role="status">Comparing the lines.</p>}
        {compared === 'unread' && <p role="alert">The lines could not be compared.</p>}
        {compared !== null && compared !== 'unread' && compared.differences.length === 0 && (
          <p>The lines hold the same blocks: bringing it back closes it.</p>
        )}
        {compared !== null &&
          compared !== 'unread' &&
          compared.differences.map((each) => (
            <fieldset key={each.block}>
              <legend>{legend[each.change]}</legend>
              {each.mainBlock !== null && <p>{`Main line: ${wordsIn(each.mainBlock)}`}</p>}
              {each.lineBlock !== null && <p>{`${line.name}: ${wordsIn(each.lineBlock)}`}</p>}
              <label className={styles['choice']}>
                <input
                  type="checkbox"
                  checked={carry.has(each.block)}
                  onChange={() => toggle(each.block)}
                />
                {`Take ${line.name}'s`}
              </label>
            </fieldset>
          ))}
        {said !== '' && <p role="alert">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || compared === null || compared === 'unread'}
          >
            Bring back
          </button>
        </div>
      </form>
    </Modal>
  );
}
