import type { createApiClient, paths } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';
import { Modal } from '../layouts/Modal.js';
import { StateLozenge } from '../states/Lozenge.js';
import styles from './UsedIn.module.css';

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

/** Whether a new version would reach anything, as far as the reader may know (REU-008). */
export function reachesAny(uses: Uses): boolean {
  return reachedBy(uses).length > 0 || uses.unreadableDocuments;
}

/** How one reference follows the component, in the reader's words (REU-007). */
export function followsSaid(reference: UsingReference): string {
  switch (reference.mode) {
    case 'latest':
      return 'Follows the latest version';
    case 'approved':
      return 'Follows approved revisions';
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

const MORE = 'Documents you may not read place it too.';

/** The header's Used in: where a component is used, opened as a dialog (REU-006, REU-007). */
export function UsedInButton({
  client,
  id,
  title,
  className,
}: {
  client: Client;
  id: string;
  title: string;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Used in
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
        <h2 id={headingId}>{`Where ${title} is used`}</h2>
        {uses === undefined && <p role="status">Reading where it is used.</p>}
        {uses === null && <p role="status">Where it is used could not be read.</p>}
        {uses && (
          <>
            <section aria-labelledby={`${headingId}documents`}>
              <h3 id={`${headingId}documents`}>Documents</h3>
              {uses.documents.length > 0 ? (
                <ul className={styles['list']}>
                  {uses.documents.map((each) => (
                    <DocumentItem key={each.id} document={each} />
                  ))}
                </ul>
              ) : (
                !uses.unreadableDocuments && <p>No document places it.</p>
              )}
              {uses.unreadableDocuments && <p className={styles['muted']}>{MORE}</p>}
            </section>
            <section aria-labelledby={`${headingId}pinned`}>
              <h3 id={`${headingId}pinned`}>Pinned, so no change reaches them</h3>
              {pins > 0 && (
                <ul className={styles['list']}>
                  {uses.baselines.named.map((each) => (
                    <li key={each.id}>
                      <a href={`#/documents/${each.document}/baselines/${each.id}`}>
                        {`Baseline ${each.name}`}
                      </a>
                    </li>
                  ))}
                  {uses.publications.named.map((each) => (
                    <li key={each.id}>
                      <a href={`#/publications/${each.id}`}>{`Publication of ${each.title}`}</a>
                    </li>
                  ))}
                </ul>
              )}
              {pins === 0 && !uses.baselines.unreadable && !uses.publications.unreadable && (
                <p>No baseline or publication pins it.</p>
              )}
              {(uses.baselines.unreadable || uses.publications.unreadable) && (
                <p className={styles['muted']}>
                  Baselines or publications you may not read pin it too.
                </p>
              )}
            </section>
          </>
        )}
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
 * Asked before a version that reaches other documents is saved (REU-008, REU-009; R1-D): each document
 * it reaches, approved ones apart from drafts, since an approved one is where a surprise is expensive.
 */
export function ReachDialog({
  uses,
  title,
  act,
  onConfirm,
  onCancel,
}: {
  uses: Uses;
  title: string;
  /** The button that goes ahead: Save version, or Done editing. */
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
        <h2 id={headingId}>{`Save a version of ${title}?`}</h2>
        <p>
          {count > 0
            ? `It reaches ${count === 1 ? 'one document' : `${count} documents`} that follow this component: now where it follows the latest version, and once approved where it follows approved revisions.`
            : 'It may reach documents that follow this component.'}
        </p>
        {group('approved', 'Approved documents', approved)}
        {group('drafts', 'Drafts', drafts)}
        {uses.unreadableDocuments && <p className={styles['muted']}>{MORE}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {act}
          </button>
        </div>
      </div>
    </Modal>
  );
}
