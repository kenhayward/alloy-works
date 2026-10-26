import type { createApiClient, paths } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';
import { Modal } from '../layouts/Modal.js';
import { StateLozenge } from '../states/Lozenge.js';
import styles from './UsedIn.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
export type Uses =
  paths['/v1/components/{id}/uses']['get']['responses']['200']['content']['application/json'];
type UsingDocument = Uses['documents'][number];
type UsingReference = UsingDocument['references'][number];

/** Where a component is used (the R1 plan, R1-B), or null where it could not be read. */
export async function readUses(client: Client, id: string): Promise<Uses | null> {
  const { data } = await client
    .GET('/v1/components/{id}/uses', { params: { path: { id } } })
    .catch(() => ({ data: undefined }));
  return data ?? null;
}

/**
 * The documents a new version reaches (R1-C, R1-D): any with a reference following the latest version,
 * now, or the latest approved revision, once one is approved. A pin is reached by nothing.
 */
export function reachedBy(uses: Uses): UsingDocument[] {
  return uses.documents.filter((each) =>
    each.references.some((reference) => reference.mode !== 'pinned'),
  );
}

/** What reaches an artifact through a declared relationship (REL-024; the R19 plan, R19-C). */
export interface Related {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly depth: number;
}

/**
 * What reaches it through relationships, three hops out: the impact walk's informational reach, never
 * a reference's, which the documents a version reaches already say. None where it could not be read.
 */
export async function readRelated(
  client: Client,
  id: string,
  withinMs = RELATED_WITHIN_MS,
): Promise<Related[]> {
  // A walk slower than this asks nothing of it, rather than hold up the act (the final review).
  const late = new Promise<{ data: undefined }>((resolve) =>
    setTimeout(() => resolve({ data: undefined }), withinMs),
  );
  const { data } = await Promise.race([
    client
      .GET('/v1/artifacts/{id}/impact', { params: { path: { id }, query: { depth: '3' } } })
      .catch(() => ({ data: undefined })),
    late,
  ]);
  return (data?.reached ?? [])
    .filter((each) => !each.hard)
    .map(({ id: at, kind, title, depth }) => ({ id: at, kind, title, depth }));
}

/** How long the question waits for what is related before it asks without it. */
export const RELATED_WITHIN_MS = 3_000;

/**
 * What to ask before a change (REU-008, REL-024), or null where nothing reaches it: the documents a
 * version reaches and what is related, the document it is open in left out of both. Where it is used
 * could not be read, what is related is asked about still (the final review).
 */
export function reachToAsk(
  read: Uses | null,
  related: readonly Related[],
  host: string | undefined,
): { readonly uses: Uses; readonly related: readonly Related[] } | null {
  const uses: Uses = read
    ? { ...read, documents: read.documents.filter((each) => each.id !== host) }
    : ({ documents: [], unreadableDocuments: false } as unknown as Uses);
  const others = related.filter((each) => each.id !== host);
  return reachesAny(uses, others) ? { uses, related: others } : null;
}

/**
 * Whether a change would reach anything, as far as the reader may know (REU-008): a document
 * following it, one they may not read, or anything related to it (REL-024).
 */
export function reachesAny(uses: Uses, related: readonly Related[] = []): boolean {
  return reachedBy(uses).length > 0 || uses.unreadableDocuments || related.length > 0;
}

const KIND_SAID: Readonly<Record<string, string>> = {
  get queryDefinition() {
    return words('reuse.query-definition');
  },
};

/** How one reference follows the component, in the reader's words (REU-007). */
export function followsSaid(reference: UsingReference): string {
  switch (reference.mode) {
    case 'latest':
      return words('reuse.follows-the-latest-version');
    case 'approved':
      return words('reuse.follows-approved-revisions');
    case 'pinned':
      return `Pinned to version ${reference.version?.number ?? ''}`.trimEnd();
  }
}

function DocumentItem({ document }: { document: UsingDocument }) {
  return (
    <li>
      <a href={`#/documents/${document.id}`}>{document.title}</a>
      {document.state && <StateLozenge state={document.state} />}
      <ul className={styles['references']}>
        {document.references.map((reference) => (
          <li key={reference.node}>{followsSaid(reference)}</li>
        ))}
      </ul>
    </li>
  );
}

const MORE = (): string => words('reuse.documents-you-may-not-read');

/** The header's Used in: where a component is used, opened as a dialog (REU-006, REU-007). */
export function UsedInButton({
  client,
  id,
  title,
  className,
  label = words('reuse.used-in'),
}: {
  client: Client;
  id: string;
  title: string;
  className?: string | undefined;
  /** Its words, where `Used in` alone would not say which component (STR-075). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <UsedInDialog client={client} id={id} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function UsedInDialog({
  client,
  id,
  title,
  onClose,
}: {
  client: Client;
  id: string;
  title: string;
  onClose: () => void;
}) {
  const headingId = useId();
  const [uses, setUses] = useState<Uses | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void readUses(client, id).then((read) => {
      if (current) setUses(read);
    });
    return () => {
      current = false;
    };
  }, [client, id]);

  const pins = uses ? uses.baselines.named.length + uses.publications.named.length : 0;
  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <div className={styles['dialog']}>
        <h2 id={headingId}>{words('reuse.where-is-used', { title })}</h2>
        {uses === undefined && <p role="status">{words('reuse.reading-where-it-is-used')}</p>}
        {uses === null && <p role="status">{words('reuse.where-it-is-used-could')}</p>}
        {uses && (
          <>
            <section aria-labelledby={`${headingId}documents`}>
              <h3 id={`${headingId}documents`}>{words('reuse.documents')}</h3>
              {uses.documents.length > 0 ? (
                <ul className={styles['list']}>
                  {uses.documents.map((each) => (
                    <DocumentItem key={each.id} document={each} />
                  ))}
                </ul>
              ) : (
                !uses.unreadableDocuments && <p>{words('reuse.no-document-places-it')}</p>
              )}
              {uses.unreadableDocuments && <p className={styles['muted']}>{MORE()}</p>}
            </section>
            <section aria-labelledby={`${headingId}pinned`}>
              <h3 id={`${headingId}pinned`}>{words('reuse.pinned-so-no-change-reaches')}</h3>
              {pins > 0 && (
                <ul className={styles['list']}>
                  {uses.baselines.named.map((each) => (
                    <li key={each.id}>
                      <a href={`#/documents/${each.document}/baselines/${each.id}`}>
                        {words('reuse.baseline', { name: each.name })}
                      </a>
                    </li>
                  ))}
                  {uses.publications.named.map((each) => (
                    <li key={each.id}>
                      <a href={`#/publications/${each.id}`}>
                        {words('reuse.publication-of', { title: each.title })}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {pins === 0 && !uses.baselines.unreadable && !uses.publications.unreadable && (
                <p>{words('reuse.no-baseline-or-publication-pins')}</p>
              )}
              {(uses.baselines.unreadable || uses.publications.unreadable) && (
                <p className={styles['muted']}>
                  {words('reuse.baselines-or-publications-you-may')}
                </p>
              )}
            </section>
          </>
        )}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('reuse.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Asked before a version that reaches other documents is saved (REU-008, REU-009; R1-D): each document
 * it reaches, approved ones apart from drafts, since an approved one is where a surprise is expensive.
 */
export function ReachDialog({
  uses,
  related = [],
  title,
  act,
  onConfirm,
  onCancel,
}: {
  uses: Uses;
  /** What reaches it through relationships (REL-024), said apart from the documents. */
  related?: readonly Related[];
  title: string;
  /** The button that goes ahead: Save version, Done editing, or Approve. */
  act: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const headingId = useId();
  const reached = reachedBy(uses);
  const approved = reached.filter((each) => each.state?.approved === true);
  const drafts = reached.filter((each) => each.state?.approved !== true);
  const group = (key: string, heading: string, documents: UsingDocument[]) =>
    documents.length > 0 && (
      <section aria-labelledby={`${headingId}${key}`}>
        <h3 id={`${headingId}${key}`}>{heading}</h3>
        <ul className={styles['list']}>
          {documents.map((each) => (
            <DocumentItem key={each.id} document={each} />
          ))}
        </ul>
      </section>
    );
  const count = reached.length;
  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onCancel}>
      <div className={styles['dialog']}>
        <h2 id={headingId}>
          {act.startsWith('Approve')
            ? `${act} ${title}?`
            : words('reuse.save-a-version-of', { title })}
        </h2>
        {(count > 0 || uses.unreadableDocuments) && (
          <p>
            {count > 0
              ? words('reuse.it-reaches-that-follow-this', {
                  value1: count === 1 ? 'one document' : `${count} documents`,
                })
              : words('reuse.it-may-reach-documents-that')}
          </p>
        )}
        {group('approved', words('reuse.approved-documents'), approved)}
        {group('drafts', words('reuse.drafts'), drafts)}
        {uses.unreadableDocuments && <p className={styles['muted']}>{MORE()}</p>}
        {related.length > 0 && (
          <section aria-labelledby={`${headingId}related`}>
            <h3 id={`${headingId}related`}>{words('reuse.related-through-relationships')}</h3>
            <ul className={styles['list']}>
              {related.map((each) => (
                <li key={each.id}>{`${each.title} (${KIND_SAID[each.kind] ?? each.kind})`}</li>
              ))}
            </ul>
          </section>
        )}
        <div className={styles['buttons']}>
          <button type="button" onClick={onCancel}>
            {words('reuse.cancel')}
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {act}
          </button>
        </div>
      </div>
    </Modal>
  );
}
