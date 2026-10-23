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
    readonly outcome: string | null;
  }[];
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
 * **Translation jobs** (LOC-033; the XL plan, XL-D): a document's jobs, each with what it sent and
 * why any was not; to whoever may edit, a job sent in a language, its XLIFF file downloaded and the
 * job closed. Nothing is sent to a vendor by the product: the file is theirs to send.
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
                <ul>
                  {job.items.map((item) => (
                    <li key={item.component.id}>
                      {item.component.title}
                      {item.notSent === null
                        ? `: ${item.source === null ? '' : `version ${item.source.number}, `}${item.outcome ?? 'out'}`
                        : `: ${notSentWords(item.notSent)}`}
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
                      <button type="button" disabled={busy} onClick={() => void close(job.id)}>
                        {`Close the ${job.language} job`}
                      </button>
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
