import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import placing from '../structure/PlaceSection.module.css';
import styles from './groups.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** Where a sentence is split for the link it holds: a character no word or title contains. */
const MARK = String.fromCharCode(0);

interface Numbered {
  readonly id: string;
  readonly number: string;
}

/** A group a document places, as its view gives it (REU-061): `newer` is an approved version not taken. */
export interface PlacedGroupView {
  readonly placement: string;
  /** Its title null where the reader may not read the group. */
  readonly group: { readonly id: string; readonly title: string | null };
  readonly version: Numbered;
  readonly newer: Numbered | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const numbered = (value: unknown): Numbered | undefined =>
  isRecord(value) && typeof value.id === 'string' && typeof value.number === 'string'
    ? { id: value.id, number: value.number }
    : undefined;

/** A document view's `groups`, checked member by member; one that is not whole is left out. */
export function groupsIn(value: unknown): readonly PlacedGroupView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each: unknown) => {
    if (!isRecord(each) || typeof each.placement !== 'string') return [];
    const { group } = each;
    if (
      !isRecord(group) ||
      typeof group.id !== 'string' ||
      (typeof group.title !== 'string' && group.title !== null)
    )
      return [];
    const version = numbered(each.version);
    if (version === undefined) return [];
    return [
      {
        placement: each.placement,
        group: { id: group.id, title: group.title },
        version,
        newer: numbered(each.newer) ?? null,
      },
    ];
  });
}

const failedWith = (error: unknown, fallback: string) =>
  isRecord(error) && typeof error.message === 'string' ? error.message : fallback;

/**
 * **Place a component group** (REU-061; the CG plan, CG-F): an approved group's members placed as
 * references at the end of the section chosen, each pinned to the version the group pins.
 */
export function PlaceGroupButton({
  client,
  documentId,
  openedFrom,
  sections,
  className,
  onPlaced,
}: {
  client: Client;
  documentId: string;
  openedFrom: string;
  /** The document's sections in order, each with how many children it has now. */
  sections: readonly { id: string; title: string; children: number }[];
  className?: string | undefined;
  onPlaced: (answer: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={words('groups.place-a-component-group')}
        title={words('groups.place-a-component-group')}
        onClick={() => setOpen(true)}
      >
        {words('groups.place-a-component-group')}
      </button>
      {open && (
        <PlaceGroupDialog
          client={client}
          documentId={documentId}
          openedFrom={openedFrom}
          sections={sections}
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

function PlaceGroupDialog({
  client,
  documentId,
  openedFrom,
  sections,
  onClose,
  onPlaced,
}: {
  client: Client;
  documentId: string;
  openedFrom: string;
  sections: readonly { id: string; title: string; children: number }[];
  onClose: () => void;
  onPlaced: (answer: unknown) => void;
}) {
  const headingId = useId();
  const [groups, setGroups] = useState<readonly { id: string; title: string }[] | null>(null);
  const [group, setGroup] = useState('');
  const [section, setSection] = useState(sections[0]?.id ?? '');
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    everyPage((cursor) =>
      client.GET('/v1/component-groups', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((all) => {
        if (!current) return;
        // Only an approved group is placed (CG-F): its members' versions are what it approved.
        const items = 'items' in all ? (all.items as readonly Record<string, unknown>[]) : [];
        setGroups(
          items.flatMap((each) =>
            typeof each.id === 'string' &&
            typeof each.title === 'string' &&
            isRecord(each.state) &&
            each.state.approved === true
              ? [{ id: each.id, title: each.title }]
              : [],
          ),
        );
      })
      .catch(() => current && setGroups([]));
    return () => {
      current = false;
    };
  }, [client]);

  const chosen = groups?.some((each) => each.id === group) ? group : (groups?.[0]?.id ?? '');
  const into = sections.find((each) => each.id === section);

  const place = async () => {
    if (busy || chosen === '' || into === undefined) return;
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/documents/{id}/groups', {
        params: { path: { id: documentId } },
        body: { openedFrom, group: chosen, parent: into.id, position: into.children },
      });
      if (data !== undefined) onPlaced(data);
      else setSaid(failedWith(error, words('groups.the-group-could-not-be-placed')));
    } catch {
      setSaid(words('groups.the-group-could-not-be-placed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form
        className={placing['form']}
        onSubmit={(event) => {
          event.preventDefault();
          void place();
        }}
      >
        <h2 id={headingId}>{words('groups.place-a-component-group')}</h2>
        <p className={placing['muted']}>{words('groups.its-components-are-placed-at')}</p>
        {groups !== null && groups.length === 0 ? (
          <p>{words('groups.there-are-no-approved-groups')}</p>
        ) : (
          <label>
            {words('groups.component-group')}
            <select value={chosen} onChange={(event) => setGroup(event.target.value)}>
              {(groups ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {each.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {sections.length === 0 ? (
          <p>{words('groups.add-a-section-first')}</p>
        ) : (
          <label>
            {words('groups.in-section')}
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              {sections.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <p role="status">{said}</p>
        <div className={placing['buttons']}>
          <button type="button" onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || chosen === '' || into === undefined}
          >
            {words('document.place')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface Preview {
  readonly added: readonly { readonly title: string }[];
  readonly removed: readonly { readonly title: string }[];
  readonly kept: number;
  readonly overridesDropped: number;
}

const titled = (value: unknown): readonly { title: string }[] =>
  Array.isArray(value)
    ? value.flatMap((each: unknown) =>
        isRecord(each) && typeof each.title === 'string' ? [{ title: each.title }] : [],
      )
    : [];

/**
 * A placed group, beside each of its members in the Part panel (REU-061, REU-062; the CG plan, CG-F,
 * CG-I): the group and version placed, a newer approved version offered and taken only when asked,
 * after saying what it changes, and the run removed as one.
 */
export function PlacedGroup({
  client,
  documentId,
  openedFrom,
  placed,
  editable,
  onAnswer,
}: {
  client: Client;
  documentId: string;
  openedFrom: string;
  placed: PlacedGroupView;
  editable: boolean;
  /** Handed the service's answer: the document at its latest version. */
  onAnswer: (answer: unknown, act: 'taken' | 'removed') => void;
}) {
  const [taking, setTaking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = { id: documentId, placement: placed.placement };
  // The sentence about the group, split where its title goes so the title can be its link.
  const unread = placed.group.title === null;
  const [before, after] = words('groups.part-of-the-group', {
    title: MARK,
    number: placed.version.number,
  }).split(MARK);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/documents/{id}/groups/{placement}/remove', {
        params: { path },
        body: { openedFrom },
      });
      if (data !== undefined) {
        setRemoving(false);
        onAnswer(data, 'removed');
      } else setSaid(failedWith(error, words('groups.the-group-could-not-be-removed')));
    } catch {
      setSaid(words('groups.the-group-could-not-be-removed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles['placed']}>
      <p>
        {unread ? (
          words('groups.part-of-a-group-you', { number: placed.version.number })
        ) : (
          <>
            {before}
            <a href={`#/component-groups/${placed.group.id}`} data-content>
              {placed.group.title}
            </a>
            {after}
          </>
        )}
      </p>
      {editable && (
        <div className={styles['acts']}>
          {placed.newer !== null && !unread && (
            <button type="button" onClick={() => setTaking(true)}>
              {words('groups.take-version', { number: placed.newer.number })}
            </button>
          )}
          {!removing && (
            <button type="button" onClick={() => setRemoving(true)}>
              {words('groups.remove-group')}
            </button>
          )}
        </div>
      )}
      {removing && (
        <div className={styles['acts']}>
          <p>{words('groups.remove-the-components-of')}</p>
          <button type="button" onClick={() => setRemoving(false)}>
            {words('document.cancel')}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void remove()}>
            {words('groups.remove-its-components')}
          </button>
        </div>
      )}
      {said !== null && <p role="status">{said}</p>}
      {taking && placed.newer !== null && placed.group.title !== null && (
        <TakeDialog
          client={client}
          path={path}
          openedFrom={openedFrom}
          title={placed.group.title}
          newer={placed.newer}
          onClose={() => setTaking(false)}
          onTaken={(answer) => {
            setTaking(false);
            onAnswer(answer, 'taken');
          }}
        />
      )}
    </div>
  );
}

function TakeDialog({
  client,
  path,
  openedFrom,
  title,
  newer,
  onClose,
  onTaken,
}: {
  client: Client;
  path: { id: string; placement: string };
  openedFrom: string;
  title: string;
  newer: Numbered;
  onClose: () => void;
  onTaken: (answer: unknown) => void;
}) {
  const headingId = useId();
  const [preview, setPreview] = useState<Preview | 'failed' | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .POST('/v1/documents/{id}/groups/{placement}/take/preview', {
        params: { path },
        body: { version: newer.id },
      })
      .then(({ data }) => {
        if (!current) return;
        setPreview(
          isRecord(data) && typeof data.kept === 'number'
            ? {
                added: titled(data.added),
                removed: titled(data.removed),
                kept: data.kept,
                overridesDropped:
                  typeof data.overridesDropped === 'number' ? data.overridesDropped : 0,
              }
            : 'failed',
        );
      })
      .catch(() => current && setPreview('failed'));
    return () => {
      current = false;
    };
    // The path's parts, not the object made afresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, path.id, path.placement, newer.id]);

  const take = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/documents/{id}/groups/{placement}/take', {
        params: { path },
        body: { openedFrom, version: newer.id },
      });
      if (data !== undefined) onTaken(data);
      else setSaid(failedWith(error, words('groups.the-version-could-not-be-taken')));
    } catch {
      setSaid(words('groups.the-version-could-not-be-taken'));
    } finally {
      setBusy(false);
    }
  };

  const names = (list: readonly { title: string }[]) => list.map((each) => each.title).join(', ');
  return (
    <Modal labelledBy={headingId} size="narrow" onClose={onClose}>
      <form
        className={placing['form']}
        onSubmit={(event) => {
          event.preventDefault();
          void take();
        }}
      >
        <h2 id={headingId}>{words('groups.take-version-of', { number: newer.number, title })}</h2>
        <p className={placing['muted']}>{words('groups.taken-in-this-documents-next')}</p>
        {preview === null && <p>{words('groups.reading-what-it-changes')}</p>}
        {preview === 'failed' && <p>{words('groups.what-it-changes-could-not')}</p>}
        {preview !== null && preview !== 'failed' && (
          <ul className={styles['preview']}>
            {preview.added.length > 0 && (
              <li>{words('groups.adds', { names: names(preview.added) })}</li>
            )}
            {preview.removed.length > 0 && (
              <li>{words('groups.removes', { names: names(preview.removed) })}</li>
            )}
            <li>{words('groups.keeps', { count: preview.kept })}</li>
            {preview.overridesDropped > 0 && (
              <li>{words('groups.drops-rewordings', { count: preview.overridesDropped })}</li>
            )}
          </ul>
        )}
        <p role="status">{said}</p>
        <div className={placing['buttons']}>
          <button type="button" onClick={onClose}>
            {words('document.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || preview === null || preview === 'failed'}
          >
            {words('groups.take-version', { number: newer.number })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
