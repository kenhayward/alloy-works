import type { createApiClient } from '@alloy-works/api-client';
import { useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { Waiting } from '../states/Waiting.js';
import { FailureList } from './FailureList.js';
import { failuresIn, isProductsOwn, type Failure } from './failures.js';
import { FOLLOW_MS, refusedWords, useFollowing } from './following.js';
import styles from './Preview.module.css';

type Client = ReturnType<typeof createApiClient>;

/**
 * How long a preview is kept after it was made: it expires an hour after it finished
 * (publishing.md, "Kept an hour, then swept"; PV-F), so it was made an hour before it expires.
 */
export const PREVIEW_KEPT_MS = 60 * 60 * 1000;

/** A done preview's links and when it goes, as the request answers them while it lasts. */
interface Links {
  readonly view: string;
  readonly download: string;
  readonly expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A `PreviewView`, checked member by member: the client's bodies are `any`. Null where there is none. */
function linksIn(value: unknown): Links | null {
  if (
    !isRecord(value) ||
    typeof value.view !== 'string' ||
    typeof value.download !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(value.expiresAt))
  ) {
    return null;
  }
  return { view: value.view, download: value.download, expiresAt: value.expiresAt };
}

/** What the live region beside the button says: the asking, and where its answer went. */
type Asking =
  | { readonly state: 'idle' }
  | { readonly state: 'working' }
  | { readonly state: 'shown' }
  | { readonly state: 'failed' }
  | { readonly state: 'refused'; readonly words: string };

/** What the pane beside the text holds, once a preview has been answered for. */
type Pane =
  | {
      readonly state: 'shown';
      readonly request: string;
      readonly view: string;
      readonly expiresAt: string;
      /** The version's number and the document's title as they were when it was asked for. */
      readonly version: string;
      readonly title: string;
      readonly downloading: boolean;
      /** A download that could not be made, said in the pane. */
      readonly note: string | null;
    }
  | { readonly state: 'failed'; readonly failures: readonly Failure[] }
  | { readonly state: 'expired' };

export interface Previewing {
  readonly asking: Asking;
  readonly pane: Pane | null;
  readonly ask: () => Promise<void>;
  readonly close: () => void;
  readonly download: () => Promise<void>;
}

/**
 * A preview of the document, asked for from its page (publishing.md, "Shown beside the text"; PV-G):
 * the version the page holds, asked for by anybody who may read it (PV-B), then followed through its
 * request as a publish is (`useFollowing`), until it is made or every failure is known. What it holds
 * is the page's to place: the button beside **Publish**, what is said while it runs, and the pane
 * beside the text.
 *
 * **The links last five minutes; the pane may stay open for the hour.** So the pane shows the PDF by
 * the view link it was answered with, which the browser has read by then, and **Download** reads the
 * request again for a fresh link when it is pressed. Once the request answers with no preview, or not
 * at all, the preview has expired and been swept, and the pane says so. A second preview replaces the
 * first, and closing the pane forgets it: an answer on its way for a preview no longer shown is
 * dropped.
 */
export function usePreview({
  client,
  document,
  version,
  title,
  followMs = FOLLOW_MS,
  follow: followLink = (url) => window.location.assign(url),
}: {
  readonly client: Client;
  readonly document: string;
  /** The version the page holds, or none while it has not opened. */
  readonly version: { readonly id: string; readonly number: string } | null;
  /** The document's title, which names the preview. */
  readonly title: string;
  /** Given in tests, which need not wait a second. */
  readonly followMs?: number;
  /** Goes to a download link: given in tests, where there is nowhere to go. */
  readonly follow?: (url: string) => void;
}): Previewing {
  const [asking, setAsking] = useState<Asking>({ state: 'idle' });
  const [pane, setPane] = useState<Pane | null>(null);
  const { follow, mounted } = useFollowing(client);
  // The request whose preview the pane shows, written where it is answered or closed: a download's
  // answer for any other is dropped.
  const shown = useRef<string | null>(null);

  const ask = async () => {
    if (version === null) return;
    const asked = { version: version.number, title };
    setAsking({ state: 'working' });
    try {
      const { data, error, response } = await client.POST('/v1/documents/{id}/previews', {
        params: { path: { id: document } },
        body: { version: version.id },
      });
      if (!mounted.current) return;
      if (!isRecord(data) || typeof data.id !== 'string') {
        setAsking({ state: 'refused', words: refusedWords('preview', response.status, error) });
        return;
      }
      const request = data.id;
      follow(request, followMs, (answer) => {
        if (!isRecord(answer)) {
          setAsking({
            state: 'refused',
            words: 'The preview could not be followed. Preview it again.',
          });
          return true;
        }
        if (answer.state === 'done') {
          const links = linksIn(answer.preview);
          shown.current = links === null ? null : request;
          setPane(
            links === null
              ? { state: 'expired' }
              : { state: 'shown', request, ...links, ...asked, downloading: false, note: null },
          );
          setAsking({ state: links === null ? 'idle' : 'shown' });
          return true;
        }
        if (answer.state === 'failed') {
          shown.current = null;
          setPane({ state: 'failed', failures: failuresIn(answer.failures) });
          setAsking({ state: 'failed' });
          return true;
        }
        return false;
      });
    } catch {
      if (mounted.current) {
        setAsking({ state: 'refused', words: refusedWords('preview', null, undefined) });
      }
    }
  };

  const close = () => {
    shown.current = null;
    setPane(null);
    setAsking((now) => (now.state === 'working' ? now : { state: 'idle' }));
  };

  const download = async () => {
    if (pane?.state !== 'shown') return;
    const { request } = pane;
    // Only the preview still shown, in a page still open, is changed by what this read answers.
    const still = () => mounted.current && shown.current === request;
    const update = (change: Partial<Extract<Pane, { state: 'shown' }>>) =>
      setPane((now) =>
        now?.state === 'shown' && now.request === request ? { ...now, ...change } : now,
      );
    update({ downloading: true, note: null });
    const cannot = { downloading: false, note: 'The PDF could not be downloaded. Try again.' };
    try {
      const { data, response } = await client.GET('/v1/publication-requests/{id}', {
        params: { path: { id: request } },
      });
      if (!still()) return;
      const links = linksIn(isRecord(data) ? data.preview : undefined);
      if (links !== null) {
        update({ downloading: false });
        followLink(links.download);
      } else if (response.status === 404 || (isRecord(data) && data.preview === null)) {
        // Expired, or swept with its request: there is nothing left to download.
        shown.current = null;
        setPane({ state: 'expired' });
      } else {
        update(cannot);
      }
    } catch {
      if (still()) update(cannot);
    }
  };

  return { asking, pane, ask, close, download };
}

/** **Preview**, for anybody who may read the document: waits while one is being made. */
export function PreviewButton({ preview }: { readonly preview: Previewing }) {
  return (
    <button
      type="button"
      disabled={preview.asking.state === 'working'}
      onClick={() => void preview.ask()}
    >
      Preview
    </button>
  );
}

/**
 * What is said of a preview beside the button, in a polite live region with no `status` role, as
 * **Publish**'s is: the page around it has one already.
 */
export function PreviewSaid({ preview }: { readonly preview: Previewing }) {
  const { asking } = preview;
  return (
    <div aria-live="polite">
      {asking.state === 'working' && <Waiting>Making a preview...</Waiting>}
      {asking.state === 'shown' && <p>The preview is shown beside the text.</p>}
      {asking.state === 'failed' && (
        <p>The preview could not be made. Why is said beside the text.</p>
      )}
      {asking.state === 'refused' && <p>{asking.words}</p>}
    </div>
  );
}

/** What introduces a failed preview's list: the product's own failure asks nothing of the author. */
function failedIntro(failures: readonly Failure[]): string {
  if (failures.length === 0) return 'The preview could not be made. Preview it again.';
  return isProductsOwn(failures)
    ? 'The preview could not be made, and nothing in the document caused it. Preview it again later.'
    : 'The preview could not be made. Put these right and preview it again:';
}

const clock = (at: Date) => at.toLocaleTimeString(undefined, { timeStyle: 'short' });

/**
 * The pane beside the text: the preview in the browser's own PDF viewer, named for the document, with
 * the version and the time it was made and until when it is kept, **Download the PDF** and a close
 * button; or why it could not be made, in **Publish**'s words, each failure at its place; or that it
 * has expired, with a new one offered. Nothing while there is no preview.
 */
export function PreviewPane({
  preview,
  placeOf,
  className,
}: {
  readonly preview: Previewing;
  readonly placeOf: (node: string) => string;
  /** Where the page places it. */
  readonly className?: string | undefined;
}) {
  const headingId = useId();
  const { pane } = preview;
  if (pane === null) return null;
  return (
    <section
      aria-labelledby={headingId}
      className={className === undefined ? styles['pane'] : `${styles['pane']} ${className}`}
    >
      <div className={styles['head']}>
        <h3 id={headingId}>Preview</h3>
        <button
          type="button"
          className={styles['close']}
          aria-label="Close the preview"
          title="Close the preview"
          onClick={preview.close}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
      {pane.state === 'shown' && <Shown pane={pane} preview={preview} />}
      {pane.state === 'failed' && (
        <>
          <p>{failedIntro(pane.failures)}</p>
          {pane.failures.length > 0 && (
            <FailureList
              label="Why the preview could not be made"
              failures={pane.failures}
              placeOf={placeOf}
            />
          )}
        </>
      )}
      {pane.state === 'expired' && (
        <>
          <p>This preview has expired. A preview is kept for an hour.</p>
          <p>
            <button
              type="button"
              disabled={preview.asking.state === 'working'}
              onClick={() => void preview.ask()}
            >
              Make a new preview
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function Shown({
  pane,
  preview,
}: {
  readonly pane: Extract<Pane, { state: 'shown' }>;
  readonly preview: Previewing;
}) {
  const expires = new Date(pane.expiresAt);
  const made = new Date(expires.getTime() - PREVIEW_KEPT_MS);
  return (
    <>
      <p className={styles['made']}>
        Version {pane.version}, made at <time dateTime={made.toISOString()}>{clock(made)}</time>. It
        is kept until <time dateTime={expires.toISOString()}>{clock(expires)}</time>.
      </p>
      <p>
        <button type="button" disabled={pane.downloading} onClick={() => void preview.download()}>
          Download the PDF
        </button>
      </p>
      <p aria-live="polite">{pane.note}</p>
      <div className={styles['canvas']}>
        <iframe className={styles['viewer']} src={pane.view} title={`Preview of ${pane.title}`} />
      </div>
    </>
  );
}
