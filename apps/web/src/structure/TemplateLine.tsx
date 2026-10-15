import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';

type Client = ReturnType<typeof createApiClient>;

/** The template a document was made from, as its view gives it (templates.md; the WF6 plan, WF6-A). */
export interface TemplateInfo {
  readonly id: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  /** Its newest version, where the document may move to it (TPL-033). */
  readonly newest: { readonly id: string; readonly number: string } | null;
  /** The keys of the starting sections it requires (TPL-029). */
  readonly required: readonly string[];
  readonly departures: {
    readonly added: readonly { readonly node: string; readonly title: string }[];
    readonly missing: readonly {
      readonly key: string;
      readonly title: string;
      readonly required: boolean;
      readonly reason: string | null;
    }[];
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A view's `template`, read defensively: null for none, or one from a service before WF6. */
export function templateIn(value: unknown): TemplateInfo | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string')
    return null;
  const version = isRecord(value.version) ? value.version : {};
  const departures = isRecord(value.departures) ? value.departures : {};
  const list = (items: unknown) => (Array.isArray(items) ? items.filter(isRecord) : []);
  return {
    id: value.id,
    name: value.name,
    version: {
      id: typeof version.id === 'string' ? version.id : '',
      number: typeof version.number === 'string' ? version.number : '',
    },
    newest:
      isRecord(value.newest) &&
      typeof value.newest.id === 'string' &&
      typeof value.newest.number === 'string'
        ? { id: value.newest.id, number: value.newest.number }
        : null,
    required: Array.isArray(value.required)
      ? value.required.filter((each): each is string => typeof each === 'string')
      : [],
    departures: {
      added: list(departures.added).map((each) => ({
        node: String(each.node),
        title: String(each.title),
      })),
      missing: list(departures.missing).map((each) => ({
        key: String(each.key),
        title: String(each.title),
        required: each.required === true,
        reason: typeof each.reason === 'string' ? each.reason : null,
      })),
    },
  };
}

/**
 * Which template the document was made from, and how it departs from it (TPL-028): each section it
 * has that its template does not, and each it lacks, with the reason a required one was removed for.
 */
export function TemplateLine({
  template,
  className,
  move,
}: {
  template: TemplateInfo;
  className?: string | undefined;
  /** Offered to whoever may edit it, where a newer version is (TPL-033). */
  move?:
    | { readonly client: Client; readonly document: string; readonly onMoved: () => void }
    | undefined;
}) {
  const { added, missing } = template.departures;
  const [moving, setMoving] = useState(false);
  return (
    <div className={className}>
      <p>
        {`Made from ${template.name}, version ${template.version.number}`}
        {move && template.newest && (
          <>
            {' '}
            <button type="button" onClick={() => setMoving(true)}>
              {`Move to version ${template.newest.number}`}
            </button>
          </>
        )}
      </p>
      {moving && move && template.newest && (
        <MoveDialog
          client={move.client}
          document={move.document}
          template={template}
          to={template.newest}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            move.onMoved();
          }}
        />
      )}
      {added.length + missing.length > 0 && (
        <ul aria-label={`Departures from ${template.name}`}>
          {added.map((each) => (
            <li key={each.node}>{`${each.title || 'A section'} is not in the template.`}</li>
          ))}
          {missing.map((each) => (
            <li key={each.key}>
              {each.required
                ? each.reason === null
                  ? `${each.title}, which the template requires, is missing.`
                  : `${each.title}, which the template requires, was removed: ${each.reason}`
                : `${each.title} is not here.`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Report {
  readonly theme: unknown;
  readonly layout: unknown;
  readonly fields: readonly {
    readonly level: string;
    readonly name: string;
    readonly change: string;
  }[];
  readonly notCarried: readonly {
    readonly node: string | null;
    readonly name: string;
    readonly value: unknown;
  }[];
  readonly missing: readonly { readonly key: string; readonly title: string }[];
}

const CHANGES: Readonly<Record<string, string>> = {
  added: 'is now one of its fields',
  removed: 'is no longer one of its fields',
  required: 'is now required',
  optional: 'is no longer required',
};

/** What a move changes, each in a sentence an author can act on (TPL-034, TPL-058). */
function reportLines(report: Report): string[] {
  const lines: string[] = [];
  if (report.theme !== null) lines.push('Its theme changes.');
  if (report.layout !== null) lines.push('Its layout changes.');
  for (const each of report.fields) {
    lines.push(
      `${each.name} ${CHANGES[each.change] ?? 'changes'}${each.level === 'section' ? ' for each section' : ''}.`,
    );
  }
  for (const each of report.notCarried) {
    const value = typeof each.value === 'string' ? each.value : JSON.stringify(each.value);
    lines.push(
      each.node === null
        ? `Its value for ${each.name}, ${value}, is not carried forward.`
        : `A section's value for ${each.name}, ${value}, is not carried forward.`,
    );
  }
  for (const each of report.missing) {
    lines.push(`${each.title} is required and missing: add it, or remove it with a reason.`);
  }
  return lines;
}

/**
 * Moving to the newest version (TPL-033, TPL-034): what it changes, read first and recording nothing,
 * then **Move**, against the document version the preview was of; or kept as it is.
 */
function MoveDialog({
  client,
  document,
  template,
  to,
  onClose,
  onMoved,
}: {
  client: Client;
  document: string;
  template: TemplateInfo;
  to: { readonly id: string; readonly number: string };
  onClose: () => void;
  onMoved: () => void;
}) {
  const headingId = useId();
  const [preview, setPreview] = useState<{ latest: string; report: Report } | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/documents/{id}/template-move', {
        params: { path: { id: document }, query: { to: to.id } },
      })
      .then(({ data, error }) => {
        if (!current) return;
        if (data) setPreview({ latest: data.latest, report: data.report });
        else setSaid(refusal(error, 'What the move changes could not be read.'));
      })
      .catch(() => current && setSaid('What the move changes could not be read.'));
    return () => {
      current = false;
    };
  }, [client, document, to.id]);

  const take = async () => {
    if (!preview) return;
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/documents/{id}/template-move', {
        params: { path: { id: document } },
        body: { latest: preview.latest, to: to.id },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) onMoved();
    else setSaid(refusal(error, 'The document could not be moved.'));
  };

  const lines = preview ? reportLines(preview.report) : [];
  return (
    <Modal labelledBy={headingId} onClose={onClose}>
      <h2 id={headingId}>{`Move to ${template.name}, version ${to.number}`}</h2>
      {preview === null ? (
        <p role="status">{said || 'Reading what the move changes...'}</p>
      ) : (
        <>
          {lines.length === 0 ? (
            <p>Nothing the document holds changes.</p>
          ) : (
            <ul aria-label="What the move changes">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p role="status">{said}</p>
        </>
      )}
      <div>
        <button type="button" onClick={onClose}>
          {`Keep version ${template.version.number}`}
        </button>
        <button
          type="button"
          className="primary"
          disabled={preview === null || busy}
          onClick={() => void take()}
        >
          Move
        </button>
      </div>
    </Modal>
  );
}
