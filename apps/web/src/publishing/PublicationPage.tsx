import type { createApiClient } from '@alloy-works/api-client';
import { DRAFT_NOTICE } from '@alloy-works/domain';
import { useEffect, useState } from 'react';
import { Notice } from '../states/Notice.js';
import { reportIn, reportWords, type ReportEntry } from './formats.js';
import styles from './PublicationPage.module.css';
import { Waiting } from '../states/Waiting.js';

type Client = ReturnType<typeof createApiClient>;

/** One output of a publication: a PDF or a Word document, to save and, for the PDF, to show. */
interface Output {
  readonly format: 'pdf' | 'docx';
  readonly download: string;
  /**
   * The same bytes, signed to be shown rather than saved: the PDF's alone, and absent from an older
   * service's answer.
   */
  readonly view: string | null;
  readonly bytes: number | null;
  /** What made it: the template version for the PDF, the writer's (`word/1`) for Word. */
  readonly producerVersion: string | null;
  /** What Word could not carry; always empty for the PDF. */
  readonly report: readonly ReportEntry[];
}

interface Shown {
  readonly title: string;
  readonly document: string;
  readonly version: string;
  readonly publisher: string | null;
  readonly publishedAt: string;
  /** The PDF's engine and template; none for a publication in Word alone (Word 1, ruling R11). */
  readonly engine: string | null;
  readonly template: number | null;
  /** One per format, the PDF first, as the service names them. */
  readonly outputs: readonly Output[];
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
  // Null where the publication has no PDF, which nothing ran Typst for; otherwise read as ever.
  const engine =
    data.engine === null ? null : isRecord(data.engine) ? data.engine.version : undefined;
  const template =
    data.template === null ? null : isRecord(data.template) ? data.template.version : undefined;
  if (engine !== null && typeof engine !== 'string') return undefined;
  if (template !== null && typeof template !== 'number') return undefined;
  const outputs = (Array.isArray(data.outputs) ? data.outputs : []).flatMap((each): Output[] =>
    isRecord(each) &&
    (each.format === 'pdf' || each.format === 'docx') &&
    typeof each.download === 'string'
      ? [
          {
            format: each.format,
            download: each.download,
            // Only a PDF is shown in the page: a browser saves a Word document whatever it is given.
            view: each.format === 'pdf' && typeof each.view === 'string' ? each.view : null,
            bytes: typeof each.bytes === 'number' ? each.bytes : null,
            producerVersion: typeof each.producerVersion === 'string' ? each.producerVersion : null,
            report: each.format === 'docx' ? reportIn(each.report) : [],
          },
        ]
      : [],
  );
  return {
    title: data.title,
    document: data.document,
    version: data.version.number,
    publisher: typeof data.publisher.displayName === 'string' ? data.publisher.displayName : null,
    publishedAt: data.publishedAt,
    engine,
    template,
    outputs,
  };
}

/** A download's size, in whole kilobytes and never none. */
const size = (bytes: number | null) =>
  bytes === null ? '' : ` (${Math.max(1, Math.round(bytes / 1024))} KB)`;

/**
 * One publication at its own address, `#/publications/{id}` (PUB-047): what it is, that it is not
 * approved - in the domain's own words, the sentence every page of the PDF carries (issue #142) - who
 * published which version and when, what made it, and each of its outputs to save (Word 1, ruling
 * R14): the PDF, shown in the page too, and the Word document, with what it could not carry said in
 * sentences. A publication the reader may not read is answered as nothing here, as every other address
 * is.
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
  const pdf = shown.outputs.find((each) => each.format === 'pdf');
  const word = shown.outputs.find((each) => each.format === 'docx');
  return (
    <article aria-labelledby="publication-title" className={styles['page']}>
      {/* Layout D: the publication itself, on the desk its pages sit on, shown by the browser's own
          PDF viewer - whose bookmarks, from the tagged PDF, are its contents. Nothing is editable.
          A publication in Word alone has nothing a browser can show. */}
      <div className={styles['canvas']}>
        {pdf?.view != null && (
          <iframe className={styles['viewer']} src={pdf.view} title={shown.title} />
        )}
        {pdf === undefined && word !== undefined && (
          <p className={styles['unshown']}>
            A Word document is not shown in the page. Download it to open it in Word.
          </p>
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
        {shown.engine !== null && shown.template !== null && (
          <p>
            Made with Typst {shown.engine} and publication template {shown.template}.
          </p>
        )}
        {word?.producerVersion != null && (
          <p>The Word document was written by the Word writer {word.producerVersion}.</p>
        )}
        {pdf !== undefined && (
          <p>
            <a href={pdf.download}>Download the PDF</a>
            {size(pdf.bytes)}
          </p>
        )}
        {word !== undefined && (
          <p>
            <a href={word.download}>Download the Word document</a>
            {size(word.bytes)}
          </p>
        )}
        {word !== undefined && word.report.length > 0 && (
          <ul aria-label="About the Word document">
            {word.report.map((entry) => (
              <li
                key={
                  entry.kind === 'face_substituted' ? `${entry.kind} ${entry.family}` : entry.kind
                }
              >
                {reportWords(entry)}
              </li>
            ))}
          </ul>
        )}
        <p>
          <a href={`#/documents/${shown.document}`}>Open the document</a>
        </p>
      </aside>
    </article>
  );
}
