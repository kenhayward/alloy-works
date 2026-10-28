import type { createApiClient } from '@alloy-works/api-client';
import { DRAFT_NOTICE } from '@alloy-works/domain';
import { useEffect, useState, type ReactNode } from 'react';
import { resolveBridge, type PlatformBridge } from '../platform/bridge.js';
import { Notice } from '../states/Notice.js';
import { baselineLink } from '../structure/links.js';
import { Chip } from '../parts/Chip.js';
import { formatsWords, reportIn, reportLines, type ReportEntry } from './formats.js';
import { Shares } from './Shares.js';
import { GeneratedContent } from './GeneratedContent.js';
import styles from './PublicationPage.module.css';
import { Waiting } from '../states/Waiting.js';
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * One output of a publication: a PDF or a Word document, to save and, for the PDF, to show; or
 * `provenance.json`, where each value it printed came from (B3), to save.
 */
interface Output {
  readonly format: 'pdf' | 'docx' | 'html' | 'provenance';
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
  /** What veraPDF found of the PDF, once checked; none before, and never any for Word. */
  readonly check: Check | null;
  /**
   * Whether the PDF's checks all gave up, so none is coming: said apart from one not yet checked. An
   * older service's answer names no state, and is read as not yet checked.
   */
  readonly checkGaveUp: boolean;
}

/** One rule the PDF failed, as veraPDF numbers it, with its words where it has them. */
interface FailedRule {
  readonly clause: string;
  readonly test: number;
  readonly description: string | null;
}

/** veraPDF's verdict on the PDF against PDF/UA-1, which joins a publication after it is recorded. */
interface Check {
  readonly checkerVersion: string;
  readonly compliant: boolean;
  readonly failedRules: readonly FailedRule[];
  /** veraPDF's whole report to save, where the service offers it. */
  readonly report: { readonly download: string; readonly bytes: number | null } | null;
}

interface Shown {
  readonly title: string;
  readonly document: string;
  readonly version: string;
  readonly publisher: string | null;
  readonly publishedAt: string;
  /** The baseline it was made from, or none (the BL plan). */
  readonly baseline: string | null;
  /** Made from a baseline taken at a workflow gate (PUB-004; the WF2 plan, WF2-I). */
  readonly approved: boolean;
  /** The PDF's engine and template; none for a publication in Word alone (Word 1, ruling R11). */
  readonly engine: string | null;
  readonly template: number | null;
  /** One per format, the PDF first, as the service names them. */
  readonly outputs: readonly Output[];
  /** Whether a later publication of its document supersedes it (PUB-059), and which, if readable. */
  readonly superseded: boolean;
  readonly newer: string | null;
  /** When the translation policy it was decided under was changed (TE-D), or none. */
  readonly policyChanged: string | null;
  /** The worker's ICU, Unicode and CLDR it was made with (TE-F), or none. */
  readonly localeData: {
    readonly icu: string;
    readonly unicode: string;
    readonly cldr: string;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A PDF's check, member by member; anything else, an older service's answer among it, is none. */
function checkIn(value: unknown): Check | null {
  if (!isRecord(value) || typeof value.checkerVersion !== 'string') return null;
  if (typeof value.compliant !== 'boolean' || !Array.isArray(value.failedRules)) return null;
  const report = value.report;
  return {
    checkerVersion: value.checkerVersion,
    compliant: value.compliant,
    report:
      isRecord(report) && typeof report.download === 'string'
        ? {
            download: report.download,
            bytes: typeof report.bytes === 'number' ? report.bytes : null,
          }
        : null,
    failedRules: value.failedRules.flatMap((rule): FailedRule[] =>
      isRecord(rule) && typeof rule.clause === 'string' && typeof rule.test === 'number'
        ? [
            {
              clause: rule.clause,
              test: rule.test,
              description: typeof rule.description === 'string' ? rule.description : null,
            },
          ]
        : [],
    ),
  };
}

/** What the check found, in one sentence: passed, or how many rules failed. */
function checkWords(check: Check): string {
  const found = check.compliant
    ? 'passed'
    : words('publishing.failed', {
        length: check.failedRules.length,
        value2: check.failedRules.length,
      });
  return words('publishing.checked-for-pdf-ua-1', { checkerVersion: check.checkerVersion, found });
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
    (each.format === 'pdf' ||
      each.format === 'docx' ||
      each.format === 'html' ||
      each.format === 'provenance') &&
    typeof each.download === 'string'
      ? [
          {
            format: each.format,
            download: each.download,
            // A PDF is shown in the page, and HTML in a tab of its own through the service's route
            // (HT-N): a browser saves a Word document whatever it is given.
            view:
              (each.format === 'pdf' || each.format === 'html') && typeof each.view === 'string'
                ? each.view
                : null,
            bytes: typeof each.bytes === 'number' ? each.bytes : null,
            producerVersion: typeof each.producerVersion === 'string' ? each.producerVersion : null,
            report: each.format === 'docx' || each.format === 'html' ? reportIn(each.report) : [],
            check: each.format === 'pdf' ? checkIn(each.check) : null,
            checkGaveUp: each.format === 'pdf' && each.checkState === 'gave_up',
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
    baseline: typeof data.baseline === 'string' ? data.baseline : null,
    approved: data.approval === 'approved',
    engine,
    template,
    outputs,
    // Absent from an answer before R17: never said to be superseded.
    superseded: data.superseded === true,
    newer: typeof data.newer === 'string' ? data.newer : null,
    // Absent from an answer before TEb, and null for one in its document's own language.
    policyChanged:
      isRecord(data.translationPolicy) && typeof data.translationPolicy.at === 'string'
        ? data.translationPolicy.at
        : null,
    // Absent from an answer before TEc, and null for one made before 0171.
    localeData:
      isRecord(data.localeData) &&
      typeof data.localeData.icu === 'string' &&
      typeof data.localeData.unicode === 'string' &&
      typeof data.localeData.cldr === 'string'
        ? { icu: data.localeData.icu, unicode: data.localeData.unicode, cldr: data.localeData.cldr }
        : null,
  };
}

/** A download's size, in whole kilobytes and never none. */
const sized = (name: ReactNode, bytes: number | null): ReactNode =>
  bytes === null
    ? name
    : wordsWith('publishing.sized', { kb: Math.max(1, Math.round(bytes / 1024)) }, { name });

/** When it was published, in the person's language. */
const published = (iso: string) =>
  formats().date(new Date(iso), { dateStyle: 'long', timeStyle: 'short' });

/**
 * One publication at its own address, `#/publications/{id}` (PUB-047): what it is, that it is not
 * approved - in the domain's own words, the sentence every page of the PDF carries (issue #142) - who
 * published which version and when, what made it, and each of its outputs to save (Word 1, ruling
 * R14): the PDF, shown in the page too, and the Word document, with what it could not carry said in
 * sentences. A publication the reader may not read is answered as nothing here, as every other address
 * is.
 */
export function PublicationPage({
  client,
  id,
  bridge = resolveBridge(),
}: {
  readonly client: Client;
  readonly id: string;
  /** Whether a page the service shows opens in a new tab with the session (HT-N). */
  readonly bridge?: PlatformBridge;
}) {
  const [shown, setShown] = useState<Shown | 'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Whether the reader is from outside and shared this publication alone (the R17 plan): they are
  // offered its files, never its document or its baseline. Unknown until the service says, and
  // nothing a member alone is offered shows until then (the final review).
  const [sharesOnly, setSharesOnly] = useState<boolean | null>(null);
  const outside = sharesOnly !== false;
  // The name of the baseline it was made from, read once the publication names one.
  const [baselineName, setBaselineName] = useState<string | null>(null);
  const baseline = typeof shown === 'object' && shown !== null ? shown.baseline : null;
  useEffect(() => {
    if (baseline === null || outside) return undefined;
    let current = true;
    client
      .GET('/v1/baselines/{id}', { params: { path: { id: baseline } } })
      .then(({ data }) => {
        if (current && data) setBaselineName(data.name);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, baseline, outside]);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ data }) => {
        if (current) setSharesOnly(isRecord(data) && data.sharesOnly === true);
      })
      .catch(() => {
        if (current) setSharesOnly(false);
      });
    return () => {
      current = false;
    };
  }, [client]);

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

  if (shown === null) return <Waiting>{words('publishing.opening')}</Waiting>;
  if (shown === 'missing') {
    return (
      <Notice tone="refused">
        <p>{words('publishing.there-is-nothing-here-or')}</p>
      </Notice>
    );
  }
  if (shown === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('publishing.the-publication-could-not-be')}</p>
        <button
          type="button"
          onClick={() => {
            setShown(null);
            setAttempt((count) => count + 1);
          }}
        >
          {words('publishing.try-again')}
        </button>
      </Notice>
    );
  }
  const pdf = shown.outputs.find((each) => each.format === 'pdf');
  const word = shown.outputs.find((each) => each.format === 'docx');
  const html = shown.outputs.find((each) => each.format === 'html');
  const provenance = shown.outputs.find((each) => each.format === 'provenance');
  const formats = formatsWords(
    shown.outputs.filter((each) => each.format !== 'provenance').map((each) => each.format),
  );
  return (
    <article aria-labelledby="publication-title" className={styles['page']}>
      {/* Layout D's head (the Ledger, ADR-0046): where it is, what it is, what can be taken away. */}
      <header className={styles['head']}>
        {!outside && (
          <nav aria-label={words('publishing.breadcrumb')} className={styles['trail']}>
            <a href="#/publications">{words('publishing.publications')}</a>
          </nav>
        )}
        <div className={styles['titleRow']}>
          <h1 id="publication-title" className={styles['title']}>
            {shown.title}
          </h1>
          <div className={styles['actions']}>
            {!outside && (
              <a className={styles['button']} href={`#/documents/${shown.document}`}>
                {words('publishing.open-the-document')}
              </a>
            )}
            {html?.view != null && bridge.opensServedPages && (
              <a
                className={styles['button']}
                href={html.view}
                target="_blank"
                rel="noopener noreferrer"
              >
                {words('publishing.open-the-html-file')}
              </a>
            )}
            {html !== undefined && (
              <a className={styles['button']} href={html.download}>
                {words('publishing.download-the-html-file')}
              </a>
            )}
            {word !== undefined && (
              <a className={styles['button']} href={word.download}>
                {words('publishing.download-the-word-document')}
              </a>
            )}
            {pdf !== undefined && (
              <a className={`${styles['button']} ${styles['primary']}`} href={pdf.download}>
                {words('publishing.download-the-pdf')}
              </a>
            )}
          </div>
        </div>
        <div className={styles['facts']}>
          <Chip className={styles['mono']}>
            {words('publishing.from', { version: shown.version })}
          </Chip>
          <Chip>{formats}</Chip>
          {shown.approved ? (
            <Chip tone="ok">{words('publishing.approved')}</Chip>
          ) : (
            <Chip tone="warn">{words('publishing.not-approved')}</Chip>
          )}
          <span className={styles['published']}>
            {words('publishing.published-by-on', {
              who: shown.publisher ?? words('publishing.somebody-in-sentence'),
              when: published(shown.publishedAt),
            })}
          </span>
        </div>
        {shown.superseded && (
          <p className={styles['superseded']} role="status">
            {shown.newer !== null ? (
              <>
                {words('publishing.a-later-publication-of-this')}{' '}
                <a href={`#/publications/${shown.newer}`}>
                  {words('publishing.open-the-newer-publication')}
                </a>
              </>
            ) : (
              words('publishing.a-later-publication-of-this-2')
            )}
          </p>
        )}
      </header>
      {/* Layout D: the publication itself, on the desk its pages sit on, shown by the browser's own
          PDF viewer - whose bookmarks, from the tagged PDF, are its contents. Nothing is editable.
          A publication in Word alone has nothing a browser can show. */}
      <div className={styles['canvas']}>
        {pdf?.view != null && (
          <iframe className={styles['viewer']} src={pdf.view} title={shown.title} />
        )}
        {pdf === undefined && word !== undefined && (
          <p className={styles['unshown']}>{words('publishing.a-word-document-is-not')}</p>
        )}
        {pdf === undefined && word === undefined && html !== undefined && (
          <p className={styles['unshown']}>
            {html.view != null && bridge.opensServedPages
              ? words('publishing.an-html-file-opens-in-a-tab')
              : words('publishing.an-html-file-is-not')}
          </p>
        )}
      </div>
      <aside className={styles['record']} aria-labelledby="publication-record">
        <h2 id="publication-record" className={styles['recordTitle']}>
          {words('publishing.what-it-was-made-from')}
        </h2>
        <p className={styles['notApproved']}>{DRAFT_NOTICE.text}</p>
        {sharesOnly === true && <p>{words('publishing.shared-with-you-to-read')}</p>}
        <p>
          {words('publishing.version-published-by-on', {
            version: shown.version,
            who: shown.publisher ?? words('publishing.somebody-in-sentence'),
            when: published(shown.publishedAt),
          })}
        </p>
        {shown.baseline !== null && !outside && (
          <p>
            {wordsWith(
              'publishing.made-from-the-baseline',
              {},
              {
                baseline: (
                  <a href={baselineLink(shown.document, shown.baseline)}>
                    {baselineName ?? words('publishing.its-own-page')}
                  </a>
                ),
              },
            )}
          </p>
        )}
        {shown.policyChanged !== null && (
          <p>
            {words('publishing.decided-under-the-translation-policy', {
              when: published(shown.policyChanged),
            })}
          </p>
        )}
        {shown.localeData !== null && (
          <p>{words('publishing.locale-data', { ...shown.localeData })}</p>
        )}
        {shown.engine !== null && shown.template !== null && (
          <p>
            {words('publishing.made-with-typst', {
              engine: shown.engine,
              template: shown.template,
            })}
          </p>
        )}
        {/* The writer's version as the template's is named, a number: the store's `word/1` names the
            producer too, which the sentence already does (the final review of Word 1, M7). */}
        {word?.producerVersion != null && (
          <p>
            {words('publishing.the-word-document-was-written')}{' '}
            {word.producerVersion.replace(/^word\//, '')}.
          </p>
        )}
        {html?.producerVersion != null && (
          <p>
            {words('publishing.the-html-file-was-written')}{' '}
            {html.producerVersion.replace(/^html\//, '')}.
          </p>
        )}
        {(pdf !== undefined ||
          (word !== undefined && word.report.length > 0) ||
          (html !== undefined && html.report.length > 0)) && (
          <section className={styles['section']} aria-labelledby="publication-checks">
            <h3 id="publication-checks" className={styles['label']}>
              {words('publishing.checks')}
            </h3>
            {/* Checked by veraPDF after it was recorded (W14.1, ADR-0030): until then, it says so, and
                where its checks all gave up, that it could not be checked. */}
            {pdf !== undefined && (
              <p>
                {pdf.check !== null
                  ? checkWords(pdf.check)
                  : pdf.checkGaveUp
                    ? words('publishing.could-not-be-checked-for')
                    : words('publishing.not-yet-checked-for-accessibility')}
              </p>
            )}
            {pdf?.check != null && pdf.check.failedRules.length > 0 && (
              <ul aria-label={words('publishing.rules-the-pdf-failed')}>
                {pdf.check.failedRules.map((rule) => (
                  <li key={`${rule.clause}-${rule.test}`}>
                    {rule.description === null
                      ? words('publishing.clause-test', { clause: rule.clause, test: rule.test })
                      : words('publishing.clause-test-described', {
                          clause: rule.clause,
                          test: rule.test,
                          description: rule.description,
                        })}
                  </li>
                ))}
              </ul>
            )}
            {pdf?.check?.report != null && (
              <p>
                {sized(
                  <a href={pdf.check.report.download}>
                    {words('publishing.download-the-full-report')}
                  </a>,
                  pdf.check.report.bytes,
                )}
              </p>
            )}
            {word !== undefined && word.report.length > 0 && (
              <ul aria-label={words('publishing.about-the-word-document')}>
                {reportLines(word.report).map((line) => (
                  <li key={line.key}>{line.words}</li>
                ))}
              </ul>
            )}
            {html !== undefined && html.report.length > 0 && (
              <ul aria-label={words('publishing.about-the-html-file')}>
                {reportLines(html.report, 'html').map((line) => (
                  <li key={line.key}>{line.words}</li>
                ))}
              </ul>
            )}
          </section>
        )}
        {(pdf !== undefined ||
          word !== undefined ||
          html !== undefined ||
          provenance !== undefined) && (
          <section className={styles['section']} aria-labelledby="publication-files">
            <h3 id="publication-files" className={styles['label']}>
              {words('publishing.files')}
            </h3>
            {pdf !== undefined && <p>{sized(words('publishing.pdf'), pdf.bytes)}</p>}
            {word !== undefined && <p>{sized(words('publishing.word-document'), word.bytes)}</p>}
            {html !== undefined && <p>{sized(words('publishing.html-file'), html.bytes)}</p>}
            {provenance !== undefined && (
              <p>
                {wordsWith(
                  'publishing.provenance-file',
                  {},
                  {
                    file: sized(
                      <a href={provenance.download}>
                        {words('publishing.download-where-its-values-came')}
                      </a>,
                      provenance.bytes,
                    ),
                  },
                )}
              </p>
            )}
          </section>
        )}
        {!outside && <GeneratedContent client={client} of={{ publication: id }} />}
        {!outside && <Shares client={client} publication={id} />}
      </aside>
    </article>
  );
}
