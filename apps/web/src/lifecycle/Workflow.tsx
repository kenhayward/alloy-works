import type { createApiClient } from '@alloy-works/api-client';
import { useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import styles from './Hold.module.css';

type Client = ReturnType<typeof createApiClient>;

export type Movable = 'component' | 'document' | 'queryDefinition';

/** A transition the reader may take, as a view offers it. */
export interface Offered {
  readonly key: string;
  readonly name: string;
  readonly to: { readonly key: string; readonly name: string };
  readonly reasonRequired: boolean;
}

/** A gate from its state, as a view offers it (the WF2 plan, WF2-L). */
export interface Gate {
  readonly key: string;
  readonly name: string;
  readonly to: { readonly key: string; readonly name: string };
  readonly reject: {
    readonly name: string;
    readonly to: { readonly key: string; readonly name: string };
  };
  /** Whether passing it may, or must, request an approved publication (LIF-050). */
  readonly publication?: 'none' | 'permitted' | 'required';
  /** Where it permits one, whether the caller may ask for it as they approve. */
  readonly mayPublish?: boolean;
  readonly count: number;
  readonly required: number;
  readonly approvedByCaller: boolean;
  readonly mayDecide: boolean;
}

/** An artifact's latest revision; null for revision 0 (VER-015). */
export type Revision = {
  readonly number: number;
  readonly versionId: string;
  readonly at: string;
} | null;

/** Where a component or a document stands, as its view says (workflow.md, "Shown"). */
export interface Standing {
  readonly state: { readonly key: string; readonly name: string; readonly approved: boolean };
  readonly transitions: readonly Offered[];
  readonly gates?: readonly Gate[];
  readonly revision?: Revision;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const named = (value: unknown): value is Record<string, unknown> & { key: string; name: string } =>
  isRecord(value) && typeof value.key === 'string' && typeof value.name === 'string';

/** A view's gates, checked rather than trusted. */
function gatesIn(value: unknown): Gate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each: unknown) => {
    if (!isRecord(each) || !named(each) || !named(each.to) || !isRecord(each.reject)) return [];
    const reject = each.reject;
    if (typeof reject.name !== 'string' || !named(reject.to)) return [];
    if (typeof each.count !== 'number' || typeof each.required !== 'number') return [];
    return [
      {
        key: each.key,
        name: each.name,
        to: { key: each.to.key, name: each.to.name },
        reject: { name: reject.name, to: { key: reject.to.key, name: reject.to.name } },
        publication:
          each.publication === 'permitted' || each.publication === 'required'
            ? each.publication
            : 'none',
        mayPublish: each.mayPublish === true,
        count: each.count,
        required: each.required,
        approvedByCaller: each.approvedByCaller === true,
        mayDecide: each.mayDecide === true,
      },
    ];
  });
}

/** A view's revision, checked rather than trusted. */
function revisionIn(value: unknown): Revision {
  if (!isRecord(value) || typeof value.number !== 'number') return null;
  if (typeof value.versionId !== 'string' || typeof value.at !== 'string') return null;
  return { number: value.number, versionId: value.versionId, at: value.at };
}

/** A view's state and transitions, checked rather than trusted; undefined where it carries none. */
export function standingIn(data: unknown): Standing | undefined {
  if (!isRecord(data) || !named(data.state)) return undefined;
  const transitions = Array.isArray(data.transitions) ? data.transitions : [];
  return {
    gates: gatesIn(data.gates),
    revision: revisionIn(data.revision),
    state: {
      key: data.state.key,
      name: data.state.name,
      approved: data.state.approved === true,
    },
    transitions: transitions.flatMap((each: unknown) => {
      if (!isRecord(each) || !named(each) || !named(each.to)) return [];
      return [
        {
          key: each.key,
          name: each.name,
          to: { key: each.to.key, name: each.to.name },
          reasonRequired: each.reasonRequired === true,
        },
      ];
    }),
  };
}

/** Its standing read again from its view, for a page told it moved; undefined where it could not be. */
export async function readStanding(
  client: Client,
  kind: Movable,
  id: string,
): Promise<Standing | undefined> {
  const params = { params: { path: { id } } };
  try {
    const { data } =
      kind === 'component'
        ? await client.GET('/v1/components/{id}', params)
        : kind === 'document'
          ? await client.GET('/v1/documents/{id}', params)
          : await client.GET('/v1/query-definitions/{id}', params);
    return standingIn(data);
  } catch {
    return undefined;
  }
}

type Moved = { readonly moved: Standing } | { readonly refused: string; readonly stale: boolean };

async function move(
  client: Client,
  kind: Movable,
  id: string,
  body: { transition: string; from: string; reason?: string; line?: string },
): Promise<Moved> {
  const options = { params: { path: { id } }, body };
  try {
    const { data, error } =
      kind === 'component'
        ? await client.POST('/v1/components/{id}/transitions', options)
        : kind === 'document'
          ? await client.POST('/v1/documents/{id}/transitions', options)
          : await client.POST('/v1/query-definitions/{id}/transitions', options);
    const moved = standingIn(data);
    if (moved) return { moved };
    const code = (error as { code?: unknown } | undefined)?.code;
    return {
      refused: refusal(error, 'Try again.'),
      stale:
        code === 'state_moved' ||
        code === 'transition_unknown' ||
        code === 'artifact_archived' ||
        // A permission tightened since the view was read (WF-E).
        code === 'forbidden',
    };
  } catch {
    return { refused: 'Try again.', stale: false };
  }
}

async function decideGate(
  client: Client,
  kind: Movable,
  id: string,
  body: {
    transition: string;
    version: string;
    decision: 'approved' | 'rejected';
    reason?: string;
    publish?: boolean;
    line?: string;
  },
): Promise<Moved> {
  const options = { params: { path: { id } }, body };
  try {
    const { data, error } =
      kind === 'component'
        ? await client.POST('/v1/components/{id}/approvals', options)
        : kind === 'document'
          ? await client.POST('/v1/documents/{id}/approvals', options)
          : await client.POST('/v1/query-definitions/{id}/approvals', options);
    const moved = standingIn(data);
    if (moved) return { moved };
    const code = (error as { code?: unknown } | undefined)?.code;
    return {
      refused: refusal(error, 'Try again.'),
      stale:
        code === 'state_moved' ||
        code === 'version_moved' ||
        code === 'approval_given' ||
        code === 'transition_unknown' ||
        code === 'artifact_archived' ||
        code === 'forbidden',
    };
  } catch {
    return { refused: 'Try again.', stale: false };
  }
}

/** Its revision, where one was designated (VER-015): nothing for revision 0. */
export function RevisionChip({ revision }: { revision: Revision | undefined }) {
  if (!revision) return null;
  return <Chip>Revision {revision.number}</Chip>;
}

/** How far a gate has got, in words. */
const progressOf = (gate: Gate) =>
  `${gate.count} of ${gate.required} approval${gate.required === 1 ? '' : 's'}${gate.approvedByCaller ? ', yours among them' : ''}`;

/**
 * A button for each transition the view says the reader may take (WF-F), none otherwise: the move
 * sends the state it was seen in, asks for a reason first where the transition requires one, and says
 * a refusal by the service's own words, reading the state again where it moved meanwhile.
 */
export function TransitionButtons({
  client,
  kind,
  id,
  title,
  standing,
  versionId,
  onMoved,
  onNotice,
  onStale,
  className,
  line,
  askFirst,
}: {
  client: Client;
  kind: Movable;
  id: string;
  title: string;
  standing: Standing;
  /** The version the reader sees: what an approval approves. */
  versionId: string;
  /** The divergent line moved (R16-C), or undefined for the main line. */
  line?: string | undefined;
  onMoved: (standing: Standing, said: string) => void;
  onNotice: (said: string) => void;
  onStale: () => void;
  className?: string | undefined;
  /**
   * Asks first what approving reaches (REL-024; the R19 plan, R19-C), going ahead once answered, as
   * saving a version asks; approving goes ahead at once where none is given.
   */
  askFirst?: ((act: string, go: () => void) => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const approving = (go: () => void) => (askFirst ? askFirst('Approve', go) : go());
  const [asking, setAsking] = useState<Offered | null>(null);
  const [rejecting, setRejecting] = useState<Gate | null>(null);

  /**
   * Approves or rejects at `gate`, and asks for its publication where `publish` says (LIF-050),
   * answering what to say where it was refused (WF2-L).
   */
  const decideAt = async (
    gate: Gate,
    reason?: string,
    publish = false,
  ): Promise<string | undefined> => {
    setBusy(true);
    const answer = await decideGate(client, kind, id, {
      transition: gate.key,
      version: versionId,
      decision: reason === undefined ? 'approved' : 'rejected',
      ...(reason === undefined ? {} : { reason }),
      ...(publish ? { publish } : {}),
      ...(line === undefined ? {} : { line }),
    });
    setBusy(false);
    if ('moved' in answer) {
      const now = answer.moved.state;
      const said =
        reason !== undefined
          ? `Moved ${title} to ${now.name}.`
          : now.key !== standing.state.key
            ? `Approved ${title}. It is now ${now.name}.`
            : `Approved ${title}. It needs more approvals.`;
      onMoved(answer.moved, said);
      return undefined;
    }
    if (answer.stale) onStale();
    return `${title} was not ${reason === undefined ? 'approved' : 'returned'}. ${answer.refused}`;
  };

  /** Moves along `transition`, answering what to say where it was refused. */
  const take = async (transition: Offered, reason?: string): Promise<string | undefined> => {
    setBusy(true);
    const answer = await move(client, kind, id, {
      transition: transition.key,
      from: standing.state.key,
      ...(reason === undefined ? {} : { reason }),
      ...(line === undefined ? {} : { line }),
    });
    setBusy(false);
    if ('moved' in answer) {
      onMoved(answer.moved, `Moved ${title} to ${answer.moved.state.name}.`);
      return undefined;
    }
    if (answer.stale) onStale();
    return `${title} was not moved. ${answer.refused}`;
  };

  return (
    <>
      {standing.transitions.map((transition) => (
        <button
          key={transition.key}
          type="button"
          className={className}
          disabled={busy}
          title={`Move to ${transition.to.name}`}
          onClick={() => {
            if (transition.reasonRequired) setAsking(transition);
            else {
              void take(transition).then((refused) => {
                if (refused !== undefined) onNotice(refused);
              });
            }
          }}
        >
          {transition.name}
        </button>
      ))}
      {(standing.gates ?? []).map((gate) => (
        <span key={gate.key} className={styles['gate']}>
          <span className={styles['muted']}>{progressOf(gate)}</span>
          {gate.mayDecide && (
            <>
              {!gate.approvedByCaller && (
                <button
                  type="button"
                  className={className}
                  disabled={busy}
                  title={`Approve, towards ${gate.to.name}`}
                  onClick={() =>
                    approving(() => {
                      void decideAt(gate).then((refused) => {
                        if (refused !== undefined) onNotice(refused);
                      });
                    })
                  }
                >
                  {gate.name}
                </button>
              )}
              {/* Any approver may return it, one who approved it among them (WF2-E). */}
              {!gate.approvedByCaller && gate.publication === 'permitted' && gate.mayPublish && (
                <button
                  type="button"
                  className={className}
                  disabled={busy}
                  title={`Approve, and publish once ${gate.to.name}`}
                  onClick={() =>
                    approving(() => {
                      void decideAt(gate, undefined, true).then((refused) => {
                        if (refused !== undefined) onNotice(refused);
                      });
                    })
                  }
                >
                  {`${gate.name} and publish`}
                </button>
              )}
              <button
                type="button"
                className={className}
                disabled={busy}
                title={`Return to ${gate.reject.to.name}`}
                onClick={() => setRejecting(gate)}
              >
                {gate.reject.name}
              </button>
            </>
          )}
        </span>
      ))}
      {rejecting && (
        <ReasonDialog
          heading={`${rejecting.reject.name} ${title}`}
          explained={`It returns to ${rejecting.reject.to.name}.`}
          submit={`${rejecting.reject.name} to ${rejecting.reject.to.name}`}
          act={async (reason) => {
            const refused = await decideAt(rejecting, reason);
            if (refused === undefined) setRejecting(null);
            return refused;
          }}
          onClose={() => setRejecting(null)}
        />
      )}
      {asking && (
        <ReasonDialog
          heading={`${asking.name} ${title}`}
          explained={`It moves to ${asking.to.name}.`}
          submit={`${asking.name} to ${asking.to.name}`}
          act={async (reason) => {
            const refused = await take(asking, reason);
            if (refused === undefined) setAsking(null);
            return refused;
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

/** The longest reason the service takes. */
const MAX_REASON = 2000;

/** Asks why before a transition that requires a reason (LIF-061); a refusal is said inside it. */
function ReasonDialog({
  heading,
  explained,
  submit,
  act,
  onClose,
}: {
  heading: string;
  explained: string;
  submit: string;
  act: (reason: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const headingId = useId();
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === '') {
      setSaid('Give a reason.');
      return;
    }
    if (trimmed.length > MAX_REASON) {
      setSaid(`A reason is at most ${MAX_REASON} characters.`);
      return;
    }
    setBusy(true);
    const refused = await act(trimmed);
    if (refused !== undefined) {
      setSaid(refused);
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={headingId} onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={headingId}>{heading}</h2>
        <p>{explained}</p>
        <label>
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className={styles['muted']}>Kept with the move, for whoever reads its history.</p>
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
