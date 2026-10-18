import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './Preview.module.css';

type Client = ReturnType<typeof createApiClient>;

/** How often a range waiting to be drawn is asked after: the budget is a second (CNT-151). */
export const RANGE_FOLLOW_MS = 150;

/** A range preview as the service answers it, checked before it is read. */
interface RangeView {
  readonly id: string;
  readonly state: 'waiting' | 'ready' | 'failed';
  readonly sequence: number | null;
  readonly images: readonly { readonly page: number; readonly alternative: string }[];
  readonly untagged: string;
}

function isRangeView(value: unknown): value is RangeView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  return (
    typeof view.id === 'string' &&
    (view.state === 'waiting' || view.state === 'ready' || view.state === 'failed') &&
    (view.sequence === null || typeof view.sequence === 'number') &&
    typeof view.untagged === 'string' &&
    Array.isArray(view.images) &&
    view.images.every(
      (each: unknown) =>
        typeof each === 'object' &&
        each !== null &&
        typeof (each as { page?: unknown }).page === 'number' &&
        typeof (each as { alternative?: unknown }).alternative === 'string',
    )
  );
}

/** A page drawn, as the pane shows it: its number, its words for assistive technology, its picture. */
export interface RangePage {
  readonly page: number;
  readonly alternative: string;
  readonly url: string;
}

export interface RangePreviewing {
  /** Whether the author has asked to see the pages as they edit. */
  readonly on: boolean;
  readonly toggle: () => void;
  /** What the pane says on screen of the pages: untagged, and the tagged PDF the accessible path. */
  readonly untagged: string | null;
  readonly pages: readonly RangePage[];
  /** Waiting for a save, drawing, drawn, or why not. */
  readonly said: string;
}

/**
 * **The pages as you edit** (CNT-151, PUB-080; publishing.md, "The warm range preview"; the R22 plan,
 * R22b): while an occurrence is open in place, the author may ask for its pages and one either side,
 * drawn from each save. The range is asked for at the first save, when the editing session is known,
 * refreshed after each one, followed until it is drawn and its pages read as pictures.
 */
export function useRangePreview(options: {
  readonly client: Client;
  readonly document: string;
  readonly version: string | null;
  /** The occurrence open in place, or null. */
  readonly node: string | null;
  /** The editor's latest save, or null before its first. */
  readonly saved: { readonly session: string; readonly sequence: number } | null;
  readonly followMs?: number;
}): RangePreviewing {
  const { client, document, version, node, saved } = options;
  const followMs = options.followMs ?? RANGE_FOLLOW_MS;
  const [on, setOn] = useState(false);
  const [range, setRange] = useState<{ id: string; node: string; session: string } | null>(null);
  const [view, setView] = useState<RangeView | null>(null);
  const [pages, setPages] = useState<readonly RangePage[]>([]);
  const [failed, setFailed] = useState('');
  /** The range and the save its pages were last read for: read again only for another. */
  const shown = useRef<string | undefined>(undefined);
  /** The save last asked for, so a save is asked for once, and a range made once at a time. */
  const asked = useRef<number | null>(null);
  const asking = useRef(false);
  // Counted when an ask ends, so a save made while one was in flight is asked for after it.
  const [ended, setEnded] = useState(0);
  const urls = useRef<string[]>([]);

  const forget = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  };
  useEffect(() => forget, []);

  // Off, or nothing open in place: nothing is shown, and the next range is asked for afresh.
  useEffect(() => {
    if (on && node !== null) return;
    setRange(null);
    setView(null);
    setPages([]);
    shown.current = undefined;
    asked.current = null;
    forget();
  }, [on, node]);

  // Each save: a range made at the first, or after one that failed, and refreshed at each after.
  const sequence = saved?.sequence ?? null;
  const session = saved?.session ?? null;
  const failedNow = view?.state === 'failed';
  useEffect(() => {
    if (!on || node === null || session === null || version === null || sequence === null) return;
    if (asking.current || asked.current === sequence) return;
    const fresh = range === null || range.node !== node || range.session !== session || failedNow;
    asking.current = true;
    asked.current = sequence;
    void (async () => {
      try {
        if (fresh) {
          const { data } = await client.POST('/v1/documents/{id}/range-previews', {
            params: { path: { id: document } },
            body: { version, node, session },
          });
          if (isRangeView(data)) {
            setFailed('');
            setRange({ id: data.id, node, session });
            setView(data);
          } else setFailed('The pages could not be asked for. Save again to try.');
          return;
        }
        const { data } = await client.POST('/v1/documents/{id}/range-previews/{range}/refresh', {
          params: { path: { id: document, range: range.id } },
        });
        if (isRangeView(data)) {
          setFailed('');
          setView(data);
        }
      } catch {
        setFailed('The pages could not be asked for. Save again to try.');
      } finally {
        asking.current = false;
        setEnded((count) => count + 1);
      }
    })();
  }, [on, node, session, sequence, version, client, document, range, failedNow, ended]);

  // Followed while it waits; read again once drawn.
  useEffect(() => {
    if (range === null || view === null || view.state !== 'waiting') return;
    const timer = setTimeout(() => {
      void client
        .GET('/v1/documents/{id}/range-previews/{range}', {
          params: { path: { id: document, range: range.id } },
        })
        .then(({ data }) => {
          if (isRangeView(data)) setView(data);
        })
        .catch(() => setFailed('The pages could not be read.'));
    }, followMs);
    return () => clearTimeout(timer);
  }, [client, document, range, view, followMs]);

  // Drawn: each page read as a picture, once for each range and save it shows.
  useEffect(() => {
    if (range === null || view === null || view.state !== 'ready') return;
    const key = `${range.id} ${view.sequence ?? 'version'}`;
    if (shown.current === key) return;
    let current = true;
    void (async () => {
      const read: RangePage[] = [];
      for (const image of view.images) {
        const { data } = await client.GET(
          '/v1/documents/{id}/range-previews/{range}/pages/{page}',
          {
            params: { path: { id: document, range: range.id, page: String(image.page) } },
            parseAs: 'blob',
          },
        );
        if (!(data instanceof Blob)) continue;
        read.push({ ...image, url: URL.createObjectURL(data) });
      }
      if (!current) {
        for (const page of read) URL.revokeObjectURL(page.url);
        return;
      }
      forget();
      urls.current = read.map((page) => page.url);
      shown.current = key;
      setFailed('');
      setPages(read);
    })().catch(() => setFailed('The pages could not be read.'));
    return () => {
      current = false;
    };
  }, [client, document, range, view]);

  const said =
    failed !== ''
      ? failed
      : !on
        ? ''
        : session === null
          ? 'The pages appear after your next save.'
          : view === null || view.state === 'waiting'
            ? pages.length > 0
              ? 'Drawing your latest save.'
              : 'Drawing the pages.'
            : view.state === 'failed'
              ? 'The pages could not be drawn. Save again to try.'
              : 'Showing your latest save.';
  return {
    on,
    toggle: () => {
      setFailed('');
      setOn((was) => !was);
    },
    untagged: view?.untagged ?? null,
    pages,
    said,
  };
}

/** **Pages as you edit**, a switch in the document bar while an occurrence is open in place. */
export function RangePreviewButton({
  range,
  className,
}: {
  readonly range: RangePreviewing;
  readonly className?: string | undefined;
}) {
  return (
    <button type="button" className={className} aria-pressed={range.on} onClick={range.toggle}>
      Pages as you edit
    </button>
  );
}

/**
 * The pane of the pages as you edit, beside the text: what they are, said on screen (PUB-080), with
 * **Preview** beside it, which makes the tagged PDF; then each page as a picture, its own words saying
 * the same to assistive technology. Nothing while it is off.
 */
export function RangePreviewPane({
  range,
  onPreview,
  className,
}: {
  readonly range: RangePreviewing;
  /** Makes the tagged PDF, as the document bar's Preview does. */
  readonly onPreview: () => void;
  readonly className?: string | undefined;
}) {
  const headingId = useId();
  if (!range.on) return null;
  return (
    <section
      aria-labelledby={headingId}
      className={className === undefined ? styles['pane'] : `${styles['pane']} ${className}`}
    >
      <div className={styles['head']}>
        <h3 id={headingId}>Pages as you edit</h3>
        <button
          type="button"
          className={styles['close']}
          aria-label="Close the pages as you edit"
          title="Close the pages as you edit"
          onClick={range.toggle}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
      <p>
        {range.untagged ??
          'These pages are pictures drawn as you edit, untagged, so assistive technology cannot read them. For an accessible copy, choose Preview, which makes the tagged PDF.'}
      </p>
      <p>
        <button type="button" onClick={onPreview}>
          Preview
        </button>
      </p>
      <p aria-live="polite">{range.said}</p>
      {range.pages.length > 0 && (
        <div className={styles['canvas']}>
          {range.pages.map((page) => (
            <img key={page.page} className={styles['page']} src={page.url} alt={page.alternative} />
          ))}
        </div>
      )}
    </section>
  );
}
