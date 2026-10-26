import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from '../lifecycle/Hold.module.css';
import { followInFrame } from '../publishing/Preview.js';

type Client = ReturnType<typeof createApiClient>;

/** A job as `GET .../translation-jobs` lists it (the XL plan, XL-D). */
export interface JobNow {
  readonly id: string;
  readonly language: string;
  readonly vendor: string | null;
  readonly at: string;
  readonly closed: { readonly at: string } | null;
  readonly items: readonly {
    readonly component: { readonly id: string; readonly title: string };
    readonly source: { readonly number: string } | null;
    readonly notSent: 'needs_revision' | 'not_editable' | null;
    readonly outcome: 'returned' | 'held' | 'refused' | null;
  }[];
  readonly returns?: readonly {
    readonly id: string;
    readonly state: 'reading' | 'read' | 'failed';
    readonly failure: string | null;
    readonly returned: number | null;
    readonly held: number | null;
    readonly refused: number | null;
  }[];
}

/** A held translation as `GET .../held` shows it (XL-G). */
interface HeldNow {
  readonly sent: { readonly number: string };
  readonly current: { readonly number: string };
  readonly changes: readonly {
    readonly block: string;
    readonly change: string;
    readonly words: string;
  }[];
  readonly returned: readonly { readonly block: string; readonly words: string }[];
  readonly offered: 'review' | 'accept' | 'reject';
}

/** What came back of a component sent, in words. */
export function outcomeWords(outcome: JobNow['items'][number]['outcome']): string {
  switch (outcome) {
    case 'returned':
      return 'translated';
    case 'held':
      return 'held for review';
    case 'refused':
      return 'refused';
    default:
      return 'out';
  }
}

/** Why a returned file was refused whole, in words. */
const FAILED: Readonly<Record<string, string>> = {
  file_unreadable: 'it could not be read as XLIFF',
  file_unsafe: 'it holds a document type, which is never read',
  file_too_large: 'it took too long or too much memory to read',
  file_not_xliff: 'it is not an XLIFF 2 file',
  language_mismatch: "it is not in the job's language",
  unknown_file: 'it names a component the job did not send',
  translation_job_closed: 'the job was closed',
  reading_failed: 'reading it failed; return it again',
};

/** The newest file returned to a job, in words. */
export function returnWords(job: JobNow): string | undefined {
  const newest = job.returns?.[0];
  if (newest === undefined) return undefined;
  if (newest.state === 'reading') return 'A returned file is being read.';
  if (newest.state === 'failed') {
    return `The returned file was refused: ${FAILED[newest.failure ?? ''] ?? newest.failure}.`;
  }
  return `The returned file made ${newest.returned ?? 0} translated, ${newest.held ?? 0} held for review and ${newest.refused ?? 0} refused.`;
}

/** Why a component was listed and not sent, in words. */
export function notSentWords(reason: 'needs_revision' | 'not_editable'): string {
  return reason === 'needs_revision'
    ? 'not sent: approve it first'
    : 'not sent: you may not edit it';
}

/** A job in a line: its language, vendor, how many were sent and whether it is closed. */
export function jobWords(job: JobNow): string {
  const sent = job.items.filter((item) => item.notSent === null).length;
  const to = job.vendor === null ? '' : ` to ${job.vendor}`;
  const state = job.closed === null ? 'open' : 'closed';
  return `${job.language}${to}, ${sent} sent, ${state}`;
}

/**
 * **Translation jobs** (LOC-033; the XL plan, XL-D, XL-F, XL-G): a document's jobs, each with what it
 * sent, why any was not and what came back; to whoever may edit, a job sent in a language, its XLIFF
 * file downloaded and returned, a held translation reviewed beside the source changes and decided,
 * and the job closed. Nothing is sent to a vendor by the product: the file is theirs to send.
 */
export function TranslationJobsButton({
  client,
  documentId,
  mayEdit,
}: {
  client: Client;
  documentId: string;
  mayEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Translation jobs
      </button>
      {open && (
        <JobsDialog
          client={client}
          documentId={documentId}
          mayEdit={mayEdit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function JobsDialog({
  client,
  documentId,
  mayEdit,
  onClose,
}: {
  client: Client;
  documentId: string;
  mayEdit: boolean;
  onClose: () => void;
}) {
  const headingId = useId();
  const [jobs, setJobs] = useState<readonly JobNow[] | 'unread' | null>(null);
  const [language, setLanguage] = useState('');
  const [vendor, setVendor] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const { data } = await client
      .GET('/v1/documents/{id}/translation-jobs', { params: { path: { id: documentId } } })
      .catch(() => ({ data: undefined }));
    setJobs(data ? data.jobs : 'unread');
  }, [client, documentId]);

  useEffect(() => {
    void read();
  }, [read]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (language.trim() === '') {
      setSaid('A job needs a language, such as fr-FR.');
      return;
    }
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/documents/{id}/translation-jobs', {
        params: { path: { id: documentId } },
        body: {
          language: language.trim(),
          ...(vendor.trim() === '' ? {} : { vendor: vendor.trim() }),
        },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      setSaid(`Sent: ${jobWords(data)}. Download its file to send it.`);
      setLanguage('');
      await read();
    } else setSaid(refusal(error, 'The job could not be made.'));
  };

  const giveBack = async (job: string, file: File) => {
    setBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { data, error } = await client
      .PUT('/v1/documents/{id}/translation-jobs/{job}/return', {
        params: { path: { id: documentId, job } },
        // The bytes as they are, never serialised as JSON (as an import's are).
        body: bytes as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      setSaid('The file is being read. Check again in a moment to see what came back.');
      await read();
    } else setSaid(refusal(error, 'The file could not be returned.'));
  };

  const close = async (job: string) => {
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/documents/{id}/translation-jobs/{job}/close', {
        params: { path: { id: documentId, job } },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      setSaid('The job is closed.');
      await read();
    } else setSaid(refusal(error, 'The job could not be closed.'));
  };

  return (
    <Modal labelledBy={headingId} size="wide" onClose={onClose}>
      <div className={styles['form']}>
        <h2 id={headingId}>Translation jobs</h2>
        {jobs === null && <p className={styles['muted']}>Reading its jobs…</p>}
        {jobs === 'unread' && <p role="alert">Its jobs could not be read.</p>}
        {jobs !== null && jobs !== 'unread' && jobs.length === 0 && (
          <p>No job has been sent for this document.</p>
        )}
        {jobs !== null && jobs !== 'unread' && jobs.length > 0 && (
          <ul aria-label="Jobs">
            {jobs.map((job) => (
              <li key={job.id}>
                {jobWords(job)}
                {returnWords(job) !== undefined && (
                  <p className={styles['muted']}>{returnWords(job)}</p>
                )}
                <ul>
                  {job.items.map((item) => (
                    <li key={item.component.id}>
                      {item.component.title}
                      {item.notSent === null
                        ? `: ${item.source === null ? '' : `version ${item.source.number}, `}${outcomeWords(item.outcome)}`
                        : `: ${notSentWords(item.notSent)}`}
                      {mayEdit && item.outcome === 'held' && job.closed === null && (
                        <HeldReview
                          client={client}
                          documentId={documentId}
                          job={job.id}
                          component={item.component}
                          onDecided={(words) => {
                            setSaid(words);
                            void read();
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {mayEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        followInFrame(`/v1/documents/${documentId}/translation-jobs/${job.id}/file`)
                      }
                    >
                      {`Download the ${job.language} file`}
                    </button>{' '}
                    {job.closed === null && (
                      <>
                        <label>
                          {`Return the ${job.language} file`}
                          <input
                            type="file"
                            accept=".xlf,.xliff,application/xliff+xml"
                            disabled={busy}
                            onChange={(event) => {
                              const chosen = event.target.files?.[0];
                              event.target.value = '';
                              if (chosen) void giveBack(job.id, chosen);
                            }}
                          />
                        </label>{' '}
                        <button type="button" disabled={busy} onClick={() => void read()}>
                          Check again
                        </button>{' '}
                        <button type="button" disabled={busy} onClick={() => void close(job.id)}>
                          {`Close the ${job.language} job`}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {mayEdit && (
          <form onSubmit={(event) => void send(event)}>
            <p className={styles['muted']}>
              Each component that needs translating into the language is sent from its approved
              revision.
            </p>
            <label>
              Language
              <input
                value={language}
                maxLength={35}
                placeholder="fr-FR"
                onChange={(event) => setLanguage(event.target.value)}
              />
            </label>{' '}
            <label>
              Vendor
              <input
                value={vendor}
                maxLength={200}
                onChange={(event) => setVendor(event.target.value)}
              />
            </label>{' '}
            <button type="submit" disabled={busy}>
              Send for translation
            </button>
          </form>
        )}
        {said !== '' && <p role="status">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * **A held translation reviewed** (XL-G; LOC-035): the source changed since it was sent, block by
 * block, beside the words returned, and the decision the policy offers first chosen until a person
 * chooses otherwise: accept it as a translation of the version sent, then out of date, or reject it.
 */
function HeldReview({
  client,
  documentId,
  job,
  component,
  onDecided,
}: {
  client: Client;
  documentId: string;
  job: string;
  component: { readonly id: string; readonly title: string };
  onDecided: (words: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<HeldNow | 'unread' | null>(null);
  const [choice, setChoice] = useState<'accept' | 'reject' | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const path = { id: documentId, job, component: component.id };

  const review = async () => {
    setOpen(true);
    const { data } = await client
      .GET('/v1/documents/{id}/translation-jobs/{job}/items/{component}/held', {
        params: { path },
      })
      .catch(() => ({ data: undefined }));
    setHeld(data ? (data as HeldNow) : 'unread');
    if (data && data.offered !== 'review') setChoice(data.offered);
  };

  const decide = async () => {
    if (choice === null) return;
    setBusy(true);
    const { data, error } = await client
      .POST('/v1/documents/{id}/translation-jobs/{job}/items/{component}/decision', {
        params: { path },
        body: { decision: choice },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (data) {
      onDecided(
        choice === 'accept'
          ? `${component.title}: accepted as a translation of the version sent.`
          : `${component.title}: rejected.`,
      );
    } else setSaid(refusal(error, 'That could not be decided.'));
  };

  if (!open) {
    return (
      <>
        {' '}
        <button type="button" onClick={() => void review()}>
          {`Review ${component.title}`}
        </button>
      </>
    );
  }
  return (
    <section aria-label={`Review ${component.title}`}>
      {held === null && <p className={styles['muted']}>Reading what came back…</p>}
      {held === 'unread' && <p role="alert">What came back could not be read.</p>}
      {held !== null && held !== 'unread' && (
        <>
          <p>
            {`Translated from version ${held.sent.number}; the source is at ${held.current.number} now.`}
          </p>
          {held.changes.length > 0 && (
            <ul aria-label="Source changes since it was sent">
              {held.changes.map((each) => (
                <li key={each.block}>{`${each.change}: ${each.words}`}</li>
              ))}
            </ul>
          )}
          <ul aria-label="Words returned">
            {held.returned.map((each) => (
              <li key={each.block}>{each.words}</li>
            ))}
          </ul>
          <fieldset>
            <legend>Decide</legend>
            <label>
              <input
                type="radio"
                name={`decide-${component.id}`}
                checked={choice === 'accept'}
                onChange={() => setChoice('accept')}
              />
              Accept as a translation of the version sent
            </label>
            <label>
              <input
                type="radio"
                name={`decide-${component.id}`}
                checked={choice === 'reject'}
                onChange={() => setChoice('reject')}
              />
              Reject
            </label>
          </fieldset>
          <button type="button" disabled={busy || choice === null} onClick={() => void decide()}>
            Decide
          </button>
        </>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}
