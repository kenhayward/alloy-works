import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import styles from '../lifecycle/Hold.module.css';
import { followInFrame } from '../publishing/Preview.js';
import { words as say } from '../words/words.js';

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
    readonly notSent: 'needs_revision' | 'not_editable' | 'other_source' | null;
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
      return say('translation.held-for-review');
    case 'refused':
      return 'refused';
    default:
      return 'out';
  }
}

/** Why a returned file was refused whole, in words. */
const FAILED: Readonly<Record<string, string>> = {
  get file_unreadable() {
    return say('translation.it-could-not-be-read');
  },
  get file_unsafe() {
    return say('translation.it-holds-a-document-type');
  },
  get file_too_large() {
    return say('translation.it-took-too-long-or');
  },
  get file_not_xliff() {
    return say('translation.it-is-not-an-xliff');
  },
  get language_mismatch() {
    return say('translation.it-is-not-in-the');
  },
  get unknown_file() {
    return say('translation.it-names-a-component-the');
  },
  get translation_job_closed() {
    return say('translation.the-job-was-closed');
  },
  get reading_failed() {
    return say('translation.reading-it-failed-return-it');
  },
};

/** The newest file returned to a job, in words. */
export function returnWords(job: JobNow): string | undefined {
  const newest = job.returns?.[0];
  if (newest === undefined) return undefined;
  if (newest.state === 'reading') return say('translation.a-returned-file-is-being');
  if (newest.state === 'failed') {
    return say('translation.the-returned-file-was-refused', {
      value1: FAILED[newest.failure ?? ''] ?? newest.failure,
    });
  }
  return say('translation.the-returned-file-made-translated', {
    value1: newest.returned ?? 0,
    value2: newest.held ?? 0,
    value3: newest.refused ?? 0,
  });
}

/** Why a component was listed and not sent, in words. */
export function notSentWords(reason: 'needs_revision' | 'not_editable' | 'other_source'): string {
  switch (reason) {
    case 'needs_revision':
      return say('translation.not-sent-approve-it-first');
    case 'not_editable':
      return say('translation.not-sent-you-may-not');
    case 'other_source':
      return say('translation.not-sent-its-source-is');
  }
}

/** A job in a line: its language, vendor, how many were sent and whether it is closed. */
export function jobWords(job: JobNow): string {
  const sent = job.items.filter((item) => item.notSent === null).length;
  const to = job.vendor === null ? '' : say('translation.to', { vendor: job.vendor });
  const state = job.closed === null ? 'open' : 'closed';
  return say('translation.sent', { language: job.language, to, sent, state });
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
        {say('translation.translation-jobs')}
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
      setSaid(say('translation.a-job-needs-a-language'));
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
      setSaid(say('translation.sent-download-its-file-to', { value1: jobWords(data) }));
      setLanguage('');
      await read();
    } else setSaid(refusal(error, say('translation.the-job-could-not-be')));
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
      setSaid(say('translation.the-file-is-being-read'));
      await read();
    } else setSaid(refusal(error, say('translation.the-file-could-not-be')));
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
      setSaid(say('translation.the-job-is-closed'));
      await read();
    } else setSaid(refusal(error, say('translation.the-job-could-not-be-2')));
  };

  return (
    <Modal labelledBy={headingId} size="wide" onClose={onClose}>
      <div className={styles['form']}>
        <h2 id={headingId}>{say('translation.translation-jobs')}</h2>
        {jobs === null && <p className={styles['muted']}>{say('translation.reading-its-jobs')}</p>}
        {jobs === 'unread' && <p role="alert">{say('translation.its-jobs-could-not-be')}</p>}
        {jobs !== null && jobs !== 'unread' && jobs.length === 0 && (
          <p>{say('translation.no-job-has-been-sent')}</p>
        )}
        {jobs !== null && jobs !== 'unread' && jobs.length > 0 && (
          <ul aria-label={say('translation.jobs')}>
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
                        ? `: ${item.source === null ? '' : say('translation.version', { number: item.source.number })}${outcomeWords(item.outcome)}`
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
                      {say('translation.download-the-file', { language: job.language })}
                    </button>{' '}
                    {job.closed === null && (
                      <>
                        <label>
                          {say('translation.return-the-file', { language: job.language })}
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
                          {say('translation.check-again')}
                        </button>{' '}
                        <button type="button" disabled={busy} onClick={() => void close(job.id)}>
                          {say('translation.close-the-job', { language: job.language })}
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
              {say('translation.each-component-that-needs-translating')}
            </p>
            <label>
              {say('translation.language')}
              <input
                value={language}
                maxLength={35}
                placeholder={say('translation.language-example')}
                onChange={(event) => setLanguage(event.target.value)}
              />
            </label>{' '}
            <label>
              {say('translation.vendor')}
              <input
                value={vendor}
                maxLength={200}
                onChange={(event) => setVendor(event.target.value)}
              />
            </label>{' '}
            <button type="submit" disabled={busy}>
              {say('translation.send-for-translation')}
            </button>
          </form>
        )}
        {said !== '' && <p role="status">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {say('translation.close')}
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
          ? say('translation.accepted-as-a-translation-of', { title: component.title })
          : say('translation.rejected', { title: component.title }),
      );
    } else setSaid(refusal(error, say('translation.that-could-not-be-decided')));
  };

  if (!open) {
    return (
      <>
        {' '}
        <button type="button" onClick={() => void review()}>
          {say('translation.review', { title: component.title })}
        </button>
      </>
    );
  }
  return (
    <section aria-label={say('translation.review', { title: component.title })}>
      {held === null && (
        <p className={styles['muted']}>{say('translation.reading-what-came-back')}</p>
      )}
      {held === 'unread' && <p role="alert">{say('translation.what-came-back-could-not')}</p>}
      {held !== null && held !== 'unread' && (
        <>
          <p>
            {say('translation.translated-from-version-the-source', {
              number: held.sent.number,
              number2: held.current.number,
            })}
          </p>
          {held.changes.length > 0 && (
            <ul aria-label={say('translation.source-changes-since-it-was')}>
              {held.changes.map((each) => (
                <li key={each.block}>{`${each.change}: ${each.words}`}</li>
              ))}
            </ul>
          )}
          <ul aria-label={say('translation.words-returned')}>
            {held.returned.map((each) => (
              <li key={each.block}>{each.words}</li>
            ))}
          </ul>
          <fieldset>
            <legend>{say('translation.decide')}</legend>
            <label>
              <input
                type="radio"
                name={`decide-${component.id}`}
                checked={choice === 'accept'}
                onChange={() => setChoice('accept')}
              />
              {say('translation.accept-as-a-translation-of')}
            </label>
            <label>
              <input
                type="radio"
                name={`decide-${component.id}`}
                checked={choice === 'reject'}
                onChange={() => setChoice('reject')}
              />
              {say('translation.reject')}
            </label>
          </fieldset>
          <button type="button" disabled={busy || choice === null} onClick={() => void decide()}>
            {say('translation.decide')}
          </button>
        </>
      )}
      {said !== '' && <p role="status">{said}</p>}
    </section>
  );
}
