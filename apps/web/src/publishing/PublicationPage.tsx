import type { createApiClient } from '@alloy-works/api-client';
import { DRAFT_NOTICE } from '@alloy-works/domain';
import { useEffect, useState } from 'react';
import { Notice } from '../states/Notice.js';
import styles from './PublicationPage.module.css';
import { Waiting } from '../states/Waiting.js';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly title: string;
  readonly document: string;
  readonly version: string;
  readonly publisher: string | null;
  readonly publishedAt: string;
  readonly engine: string;
  readonly template: number;
  readonly download: string | null;
  /** The same bytes, signed to be shown rather than saved; absent from an older service's answer. */
  readonly view: string | null;
  readonly bytes: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A `PublicationView`, checked member by member: the client's bodies are `any`. */
function shownIn(data: unknown): Shown | undefined {
  if (!isRecord(data) || typeof data.title !== 'string' || typeof data.document !== 'string') {
    return undefined;
  }
  if (!isRecord(data.version) || typeof data.version.number !== 'string') return undefined;
  if (!isRecord(data.publisher) || typeof data.publishedAt !== 'string') return undefined;
  if (!isRecord(data.engine) || typeof data.engine.version !== 'string') return undefined;
  if (!isRecord(data.template) || typeof data.template.version !== 'number') return undefined;
  const [pdf] = Array.isArray(data.outputs)
    ? data.outputs.filter((each) => isRecord(each) && each.format === 'pdf')
    : [];
  return {
    title: data.title,
    document: data.document,
    version: data.version.number,
    publisher: typeof data.publisher.displayName === 'string' ? data.publisher.displayName : null,
    publishedAt: data.publishedAt,
    engine: data.engine.version,
    template: data.template.version,
    download: isRecord(pdf) && typeof pdf.download === 'string' ? pdf.download : null,
    view: isRecord(pdf) && typeof pdf.view === 'string' ? pdf.view : null,
    bytes: isRecord(pdf) && typeof pdf.bytes === 'number' ? pdf.bytes : null,
  };
}

/**
 * One publication at its own address, `#/publications/{id}` (PUB-047): what it is, that it is not
 * approved - in the domain's own words, the sentence every page of the PDF carries (issue #142) - who
 * published which version and when, what made it, and its PDF. A publication the reader may not read
 * is answered as nothing here, as every other address is.
 */
export function PublicationPage({ client, id }: { readonly client: Client; readonly id: string }) {
  const [shown, setShown] = useState<Shown | 'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/publications/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (response.status === 404) setShown('missing');
        else setShown(shownIn(data) ?? 'failed');
      })
      .catch(() => {
        if (current) setShown('failed');
      });
    return () => {
      current = false;
    };
  }, [client, id, attempt]);

  if (shown === null) return <Waiting>Opening...</Waiting>;
  if (shown === 'missing') {
    return (
      <Notice tone="refused">
        <p>There is nothing here, or nothing you may read.</p>
      </Notice>
    );
  }
  if (shown === 'failed') {
    return (
      <Notice tone="failed">
        <p>The publication could not be opened.</p>
        <button
          type="button"
          onClick={() => {
            setShown(null);
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
      </Notice>
    );
  }
  return (
    <article aria-labelledby="publication-title" className={styles['page']}>
      {/* Layout D: the publication itself, on the desk its pages sit on, shown by the browser's own
          PDF viewer - whose bookmarks, from the tagged PDF, are its contents. Nothing is editable. */}
      <div className={styles['canvas']}>
        {shown.view !== null && (
          <iframe className={styles['viewer']} src={shown.view} title={shown.title} />
        )}
      </div>
      <aside className={styles['record']} aria-label="What it was made from">
        <h2 id="publication-title">{shown.title}</h2>
        <p className={styles['notApproved']}>{DRAFT_NOTICE.text}</p>
        <p>
          Version {shown.version}, published by {shown.publisher ?? 'somebody'} on{' '}
          {new Date(shown.publishedAt).toLocaleString(undefined, {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          .
        </p>
        <p>
          Made with Typst {shown.engine} and publication template {shown.template}.
        </p>
        {shown.download !== null && (
          <p>
            <a href={shown.download}>Download the PDF</a>
            {shown.bytes !== null && ` (${Math.max(1, Math.round(shown.bytes / 1024))} KB)`}
          </p>
        )}
        <p>
          <a href={`#/documents/${shown.document}`}>Open the document</a>
        </p>
      </aside>
    </article>
  );
}
