import type { createApiClient, paths } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';
import { PLACE_MAX } from '@alloy-works/domain';
import { Modal } from '../layouts/Modal.js';
import styles from './PlaceSection.module.css';
import { sectionTitle, titleText } from './tree.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Report =
  paths['/v1/documents/{id}/placement']['get']['responses']['200']['content']['application/json'];
type Mode = 'latest' | 'approved' | 'pinned';

interface Section {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each section of an outline as it reads, nested ones after their parent. */
function sectionsIn(nodes: unknown, depth = 0): Section[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node): Section[] => {
    if (!isRecord(node)) return [];
    const children = sectionsIn(node['children'], depth + 1);
    if (node['type'] !== 'section' || typeof node['id'] !== 'string') return children;
    const title = Array.isArray(node['title'])
      ? titleText(node['title'] as Parameters<typeof titleText>[0])
      : '';
    return [{ id: node['id'], title, depth }, ...children];
  });
}

const MODES: readonly { readonly mode: Mode; readonly label: string }[] = [
  {
    mode: 'latest',
    get label() {
      return words('document.follow-the-latest-version');
    },
  },
  {
    mode: 'approved',
    get label() {
      return words('document.follow-approved-revisions');
    },
  },
  {
    mode: 'pinned',
    get label() {
      return words('document.pin-each-to-its-version');
    },
  },
];

/**
 * **Place from a document** (REU-054; the R2 plan, R2-F): another document's section placed here as
 * references under a new section of the author's, after a report of how much it pulls in (REU-046).
 */
export function PlaceSectionButton({
  client,
  documentId,
  openedFrom,
  className,
  onPlaced,
}: {
  client: Client;
  documentId: string;
  /** The version the outline was read at. */
  openedFrom: string;
  className?: string | undefined;
  /** Handed the service's answer: the document at its latest version. */
  onPlaced: (answer: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={words('document.place-from-a-document')}
        title={words('document.place-from-a-document')}
        onClick={() => setOpen(true)}
      >
        {words('document.place-from-a-document')}
      </button>
      {open && (
        <PlaceDialog
          client={client}
          documentId={documentId}
          openedFrom={openedFrom}
          onClose={() => setOpen(false)}
          onPlaced={(answer) => {
            setOpen(false);
            onPlaced(answer);
          }}
        />
      )}
    </>
  );
}

/**
 * **Place in a document** (SCH-053; the R14 plan, R14-C): a section found by search placed in a document
 * the author chooses, by the act **Place from a document** is there.
 */
export function PlaceIntoButton({
  client,
  from,
  section,
  className,
  onPlaced,
}: {
  client: Client;
  /** The document the section is in. */
  from: string;
  section: string;
  className?: string | undefined;
  /** Handed the document it was placed in. */
  onPlaced: (into: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {words('document.place-in-a-document')}
      </button>
      {open && (
        <PlaceDialog
          client={client}
          found={{ from, section }}
          onClose={() => setOpen(false)}
          onPlaced={(_, into) => {
            setOpen(false);
            onPlaced(into);
          }}
        />
      )}
    </>
  );
}

function PlaceDialog({
  client,
  documentId,
  openedFrom,
  found,
  onClose,
  onPlaced,
}: {
  client: Client;
  /** The document placed in, and the version its outline was read at; chosen in the dialog if absent. */
  documentId?: string;
  openedFrom?: string;
  /** The section placed, where it was found rather than chosen here. */
  found?: { readonly from: string; readonly section: string };
  onClose: () => void;
  onPlaced: (answer: unknown, into: string) => void;
}) {
  // Its parts, so an effect runs again only when one changes, not each render.
  const foundFrom = found?.from;
  const foundSection = found?.section;
  const headingId = useId();
  const [documents, setDocuments] = useState<readonly { id: string; title: string }[]>([]);
  const [into, setInto] = useState(documentId ?? '');
  const [opened, setOpened] = useState(openedFrom ?? '');
  const [from, setFrom] = useState(found?.from ?? '');
  const [sections, setSections] = useState<readonly Section[]>([]);
  const [section, setSection] = useState(found?.section ?? '');
  const [report, setReport] = useState<Report | null>(null);
  const [mode, setMode] = useState<Mode>('latest');
  const [title, setTitle] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/documents', { params: { query: { limit: '100' } } })
      .then(({ data }) => {
        if (current && data) {
          setDocuments(
            data.items
              .filter((each) => each.id !== (foundFrom ?? documentId))
              .map((each) => ({ id: each.id, title: each.title })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, documentId, foundFrom]);

  // The version of the document chosen to place in, which the placement is made against.
  useEffect(() => {
    if (documentId !== undefined) return;
    setOpened('');
    if (into === '') return;
    let current = true;
    void client
      .GET('/v1/documents/{id}', { params: { path: { id: into } } })
      .then(({ data }) => {
        if (current && data) setOpened(data.version.id);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, documentId, into]);

  useEffect(() => {
    setSections([]);
    setSection(foundFrom !== undefined && from === foundFrom ? (foundSection ?? '') : '');
    if (from === '') return;
    let current = true;
    void client
      .GET('/v1/documents/{id}', { params: { path: { id: from } } })
      .then(({ data }) => {
        if (current && isRecord(data) && isRecord(data['outline'])) {
          setSections(sectionsIn(data['outline']['nodes']));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, from, foundFrom, foundSection]);

  // The section's own title, offered as the new one's, each time a section is chosen: never over
  // what the author typed when the same section is reported again.
  useEffect(() => {
    setTitle(sections.find((each) => each.id === section)?.title ?? '');
  }, [section, sections]);

  useEffect(() => {
    setReport(null);
    if (section === '' || into === '') return;
    let current = true;
    void client
      .GET('/v1/documents/{id}/placement', {
        params: { path: { id: into }, query: { from, section } },
      })
      .then(({ data }) => {
        if (!current) return;
        setReport(data ?? null);
        if (!data) setSaid(words('document.what-the-section-places-could'));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, into, from, section, asked]);

  // A word said of one section is not said of the next; after a refusal, of the same one again.
  useEffect(() => setSaid(''), [from, section]);

  const place = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!report || busy || opened === '') return;
    if (title.trim() === '') {
      setSaid(words('document.the-new-section-needs-a'));
      return;
    }
    setBusy(true);
    const { data, response } = await client
      .POST('/v1/documents/{id}/placement', {
        params: { path: { id: into } },
        body: {
          openedFrom: opened,
          from,
          fromVersion: report.from.version,
          section,
          parent: null,
          position: 0,
          title: sectionTitle(title.trim()) as never,
          mode,
        },
      })
      .catch(() => ({ data: undefined, response: undefined }));
    setBusy(false);
    if (data) {
      onPlaced(data, into);
      return;
    }
    if (response?.status === 409) {
      setSaid(words('document.something-changed-since-the-report'));
      setAsked((count) => count + 1);
      return;
    }
    setSaid(words('document.the-section-could-not-be'));
  };

  const tooMany = report !== null && report.occurrences > PLACE_MAX;
  const refused = report !== null && (report.unreadable > 0 || tooMany);
  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void place(event)}>
        <h2 id={headingId}>
          {found ? words('document.place-in-a-document') : words('document.place-from-a-document')}
        </h2>
        {found ? (
          <p className={styles['muted']}>{words('document.the-components-this-section-places')}</p>
        ) : (
          <p className={styles['muted']}>{words('document.the-components-a-section-of')}</p>
        )}
        {found && (
          <label>
            {words('document.into')}
            <select value={into} onChange={(event) => setInto(event.target.value)}>
              <option value="">{words('document.choose-a-document')}</option>
              {documents.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {!found && (
          <>
            <label>
              {words('document.document')}
              <select value={from} onChange={(event) => setFrom(event.target.value)}>
                <option value="">{words('document.choose-a-document')}</option>
                {documents.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {words('document.section')}
              <select
                value={section}
                disabled={sections.length === 0}
                onChange={(event) => setSection(event.target.value)}
              >
                <option value="">{words('document.choose-a-section')}</option>
                {sections.map((each) => (
                  <option key={each.id} value={each.id}>
                    {`${'  '.repeat(each.depth)}${each.title}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {report && (
          <section aria-labelledby={`${headingId}report`} className={styles['report']}>
            <h3 id={`${headingId}report`}>{words('document.what-it-places')}</h3>
            <p>
              {words('document.to-of-text', {
                references: report.occurrences,
                components: report.components.length + report.unreadable,
                blocks: report.blocks,
                characters: report.characters,
              })}
            </p>
            <ul>
              {report.components.map((each) => (
                <li key={each.id}>
                  {each.occurrences > 1
                    ? words('document.times', { title: each.title, occurrences: each.occurrences })
                    : each.title}
                </li>
              ))}
            </ul>
            {report.unreadable > 0 && (
              <p role="alert">
                {words('document.it-places-you-may-not', {
                  count: report.unreadable,
                })}
              </p>
            )}
            {tooMany && (
              <p role="alert">{words('document.it-places-more-than-references', { PLACE_MAX })}</p>
            )}
          </section>
        )}
        {report && !refused && (
          <>
            <fieldset>
              <legend>{words('document.each-reference')}</legend>
              {MODES.map((each) => (
                <label key={each.mode} className={styles['choice']}>
                  <input
                    type="radio"
                    name={`${headingId}mode`}
                    checked={mode === each.mode}
                    onChange={() => setMode(each.mode)}
                  />
                  {each.label}
                </label>
              ))}
            </fieldset>
            <label>
              {words('document.new-section-title')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </>
        )}
        <p role="status">{said}</p>
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!report || refused || busy || opened === ''}
          >
            {words('document.place')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
