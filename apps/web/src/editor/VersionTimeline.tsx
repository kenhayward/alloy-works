import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from './Icon.js';
import { componentVersionLink } from '../search/links.js';
import { documentVersionLink, baselineLink, comparisonLink } from '../structure/links.js';
import { IconButton } from '../parts/IconButton.js';
import { kept, keep } from '../layouts/PaneWidth.js';
import { followInFrame } from '../publishing/Preview.js';
import { readStanding } from '../lifecycle/Workflow.js';
import { Lozenge, StateLozenge, seededKind, type LozengeKind } from '../states/Lozenge.js';
import { Avatar } from '../review/ThreadFaces.js';
import { words } from '../words/words.js';
import type { ListedVersion } from './VersionList.js';
import {
  dayKey,
  dayLabel,
  daysOf,
  timelineRows,
  type ChangeCounts,
  type Timed,
} from './versionDays.js';
import styles from './VersionTimeline.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Revision {
  readonly number: number;
  readonly state: { readonly key: string; readonly name: string };
  readonly standing: 'pending' | 'effective' | 'superseded' | 'neverInForce' | null;
  readonly scopes: readonly { readonly axis: string; readonly value: string }[];
  readonly supersededBy: number | null;
}

/** A version as the timeline shows it (VER-060). */
export interface TimelineVersion extends ListedVersion, Timed {
  readonly authorId: string | null;
  readonly revision: Revision | null;
}

interface TimelineBaseline extends Timed {
  readonly name: string;
  readonly who: string | null;
  readonly whoId: string;
  readonly version: string;
  readonly gate: boolean;
  readonly superseded: boolean;
}

interface TimelinePublication extends Timed {
  readonly who: string | null;
  readonly whoId: string;
  readonly version: string;
  readonly baseline: string | null;
  readonly formats: readonly string[];
  readonly approved: boolean;
  readonly superseded: boolean;
}

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The collapsed days, remembered by this browser per artifact, as the panes' are (the plan, D9). */
const everyDayKey = (id: string) => `aw.versions.${id}.collapsed`;

const FORMAT_WORDS: Readonly<Record<string, () => string>> = {
  pdf: () => words('editor.format-pdf'),
  docx: () => words('editor.format-word'),
  html: () => words('editor.format-html'),
};

/** A revision's state and where it stands: never a state of the version itself (LIF-048). */
function RevisionFacts({ revision }: { revision: Revision }) {
  const standing = (): ReactNode => {
    switch (revision.standing) {
      case 'effective':
        return <Lozenge kind="effective" size="small" />;
      case 'pending':
        return <Lozenge kind="pending" size="small" />;
      case 'superseded':
        return (
          <Lozenge kind="superseded" size="small">
            {words('document.superseded-by', {
              value1: words('lifecycle.revision-2', { number: revision.supersededBy ?? 0 }),
            })}
          </Lozenge>
        );
      default:
        return null;
    }
  };
  return (
    <span className={styles['facts']}>
      <span className={styles['revision']}>
        {words('lifecycle.revision-2', { number: revision.number })}
      </span>
      <StateLozenge state={revision.state} size="small" />
      {standing()}
      {revision.standing === 'neverInForce' && (
        <span className={styles['note']}>{words('editor.never-in-force')}</span>
      )}
      {revision.scopes.length > 0 && (
        <span className={styles['note']}>
          {revision.scopes.map((each) => `${each.axis}: ${each.value}`).join(', ')}
        </span>
      )}
    </span>
  );
}

/** Each kind a collapsed day holds, at most three, so a folded day still says what happened in it. */
function dayKinds(
  rows: readonly ReturnType<
    typeof timelineRows<TimelineVersion, TimelineBaseline, TimelinePublication>
  >[number][],
): readonly { readonly kind: LozengeKind; readonly name?: string }[] {
  const found = new Map<string, { kind: LozengeKind; name?: string }>();
  for (const row of rows) {
    if (row.kind === 'version' && row.revision) {
      const kind = seededKind(row.revision.state.key) ?? 'state';
      found.set(row.revision.state.key, { kind, name: row.revision.state.name });
    } else if (row.kind === 'baseline') {
      found.set(row.superseded ? 'superseded' : 'current', {
        kind: row.superseded ? 'superseded' : 'current',
      });
    } else if (row.kind === 'publication') {
      found.set('published', { kind: 'published' });
    }
  }
  return [...found.values()].slice(0, 3);
}

/**
 * The Versions panel's list, a timeline newest first and by day, in the reader's zone (VER-060): each
 * version a line that opens in place, with what changed from the one before and its actions; a revision
 * says its state and where it stands; and a document's baselines and publications fall where they
 * happened, in rows of their own, neither of them a version.
 */
export function VersionTimeline({
  client,
  id,
  of = 'component',
  line,
  read = 0,
  onCompare,
  onRestore,
  changesFrom,
}: {
  client: Client;
  id: string;
  of?: 'component' | 'document';
  line?: string;
  /** Read again each time this changes, as after a restore. */
  read?: number;
  onCompare?: (version: ListedVersion, latest: ListedVersion) => void;
  onRestore?: (version: ListedVersion, latest: ListedVersion) => void;
  /** What changed between two versions, for one opened in place: one comparison, on opening. */
  changesFrom: (older: ListedVersion, newer: ListedVersion) => Promise<ChangeCounts | null>;
}) {
  const [versions, setVersions] = useState<readonly TimelineVersion[] | null | undefined>(
    undefined,
  );
  const [next, setNext] = useState<string | null>(null);
  const [baselines, setBaselines] = useState<readonly TimelineBaseline[] | null>([]);
  const [publications, setPublications] = useState<readonly TimelinePublication[] | null>([]);
  const [nextPublications, setNextPublications] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeCounts | 'reading' | 'failed' | 'first' | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [everyDayCollapsed, setEveryDayCollapsed] = useState(() => kept(everyDayKey(id)) === 'yes');
  // Days differing from that, one by one: today stays open when earlier days were left folded.
  const [turned, setTurned] = useState<ReadonlySet<string>>(
    () => new Set(kept(everyDayKey(id)) === 'yes' ? [dayKey(new Date())] : []),
  );
  const asked = useRef(0);
  // The artifact's state, one lozenge at the head (LIF-048; the plan, D1); a line's has its own header.
  const [state, setState] = useState<{ readonly key: string; readonly name: string } | null>(null);
  useEffect(() => {
    if (line !== undefined) return;
    let current = true;
    void readStanding(client, of, id).then((standing) => {
      if (current && standing) setState(standing.state);
    });
    return () => {
      current = false;
    };
  }, [client, id, line, read, of]);

  const versionsFrom = (cursor: string | null) => {
    const query = cursor === null ? {} : { cursor };
    return of === 'document'
      ? client.GET('/v1/documents/{id}/versions', { params: { path: { id }, query } })
      : client.GET('/v1/components/{id}/versions', {
          params: { path: { id }, query: { ...query, ...(line === undefined ? {} : { line }) } },
        });
  };
  const publicationsFrom = (cursor: string | null) =>
    client.GET('/v1/documents/{id}/publications', {
      params: { path: { id }, query: cursor === null ? {} : { cursor } },
    });

  const shownVersions = (data: NonNullable<Awaited<ReturnType<typeof versionsFrom>>['data']>) =>
    data.items.map((each): TimelineVersion => ({
      id: each.id,
      number: each.number,
      createdAt: each.createdAt,
      at: new Date(each.createdAt),
      author: each.author?.name ?? null,
      authorId: each.author?.id ?? null,
      note: each.note,
      restoredFrom: each.restoredFrom?.number ?? null,
      revision: each.revision ?? null,
    }));
  const shownPublications = (
    data: NonNullable<Awaited<ReturnType<typeof publicationsFrom>>['data']>,
  ) =>
    data.items.map((each): TimelinePublication => ({
      id: each.id,
      at: new Date(each.publishedAt),
      who: each.publisher.displayName,
      whoId: each.publisher.id,
      version: each.version.number,
      baseline: each.baseline,
      formats: each.formats,
      approved: each.approval === 'approved',
      superseded: each.superseded === true,
    }));

  useEffect(() => {
    let current = true;
    setVersions(undefined);
    setOpened(null);
    versionsFrom(null)
      .then(({ data }) => {
        if (!current) return;
        setVersions(data ? shownVersions(data) : null);
        setNext(data?.next ?? null);
      })
      .catch(() => current && setVersions(null));
    if (of === 'document') {
      client
        .GET('/v1/documents/{id}/baselines', { params: { path: { id }, query: {} } })
        .then(({ data }) => {
          if (!current) return;
          setBaselines(
            data
              ? data.baselines.map((each) => ({
                  id: each.id,
                  at: new Date(each.madeAt),
                  name: each.name,
                  who: each.madeBy.name,
                  whoId: each.madeBy.id,
                  version: each.version.number,
                  gate: each.gate !== null,
                  superseded: each.superseded !== null,
                }))
              : null,
          );
        })
        .catch(() => current && setBaselines(null));
      publicationsFrom(null)
        .then(({ data }) => {
          if (!current) return;
          setPublications(data ? shownPublications(data) : null);
          setNextPublications(data?.next ?? null);
        })
        .catch(() => current && setPublications(null));
    }
    return () => {
      current = false;
    };
    // Each read is of what these name; the helpers close over nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id, line, read, of]);

  const older = async () => {
    const [moreVersions, morePublications] = await Promise.all([
      next === null ? undefined : versionsFrom(next).catch(() => undefined),
      nextPublications === null
        ? undefined
        : publicationsFrom(nextPublications).catch(() => undefined),
    ]);
    if (moreVersions?.data) {
      const { data } = moreVersions;
      setVersions((held) => [...(held ?? []), ...shownVersions(data)]);
      setNext(data.next ?? null);
    }
    if (morePublications?.data) {
      const { data } = morePublications;
      setPublications((held) => [...(held ?? []), ...shownPublications(data)]);
      setNextPublications(data.next ?? null);
    }
  };

  if (versions === undefined) return null;
  if (versions === null)
    return <p className={styles['muted']}>{words('editor.the-versions-could-not-be')}</p>;
  if (versions.length === 0)
    return <p className={styles['muted']}>{words('editor.no-version-has-been-saved')}</p>;

  const latest = versions[0]!;
  const open = (version: TimelineVersion, at: number) => {
    const ask = (asked.current += 1);
    if (opened === version.id) {
      setOpened(null);
      return;
    }
    setOpened(version.id);
    const before = versions[at + 1];
    if (!before) {
      setChanges(next === null ? 'first' : null);
      return;
    }
    setChanges('reading');
    void changesFrom(before, version).then((counts) => {
      if (ask === asked.current) setChanges(counts ?? 'failed');
    });
  };

  const rows = timelineRows({
    versions,
    baselines: baselines ?? [],
    publications: publications ?? [],
    olderVersions: next !== null,
    olderPublications: nextPublications !== null,
  });
  const days = daysOf(rows);
  const isCollapsed = (key: string) => turned.has(key) !== everyDayCollapsed;
  const anyOpen = days.some((day) => !isCollapsed(day.key));
  const every = () => {
    setEveryDayCollapsed(anyOpen);
    keep(everyDayKey(id), anyOpen ? 'yes' : 'no');
    setTurned(new Set());
  };
  const copyLink = async (version: TimelineVersion) => {
    const link =
      of === 'document'
        ? documentVersionLink(id, version.id)
        : componentVersionLink(id, version.id);
    await navigator.clipboard
      ?.writeText(new URL(link, window.location.href).href)
      .then(() => setCopied(version.id))
      .catch(() => undefined);
  };
  const download = async (publication: TimelinePublication) => {
    const { data } = await client
      .GET('/v1/publications/{id}', { params: { path: { id: publication.id } } })
      .catch(() => ({ data: undefined }));
    const output = data?.outputs.find((each) => each.format === 'pdf') ?? data?.outputs[0];
    if (output) followInFrame(output.download);
  };

  const versionRow = (version: TimelineVersion) => {
    const at = versions.findIndex((each) => each.id === version.id);
    const isOpen = opened === version.id;
    const who = version.author ?? words('editor.unknown');
    const isLatest = version.id === latest.id;
    const showsActions = isOpen || isLatest;
    const link =
      of === 'document'
        ? documentVersionLink(id, version.id)
        : componentVersionLink(id, version.id);
    return (
      <li key={version.id} className={styles['row']} data-version={version.number}>
        <span
          className={styles['node']}
          data-revision={version.revision ? '' : undefined}
          aria-hidden="true"
        >
          {version.revision && (
            <Icon name={`state:${seededKind(version.revision.state.key) ?? 'state'}`} size={12} />
          )}
        </span>
        <div className={styles['body']}>
          <button
            type="button"
            className={styles['line']}
            aria-expanded={isOpen}
            aria-label={words('editor.version-row', {
              number: version.number,
              time: time.format(version.at),
              who,
            })}
            onClick={() => open(version, at)}
          >
            <span className={styles['head']}>
              <span className={styles['number']}>{version.number}</span>
              <span className={styles['number']}>{time.format(version.at)}</span>
              {isLatest && <Lozenge kind="current" size="small" />}
            </span>
            <span className={styles['who']}>
              {version.authorId !== null && (
                <Avatar person={{ id: version.authorId, name: version.author }} size={20} />
              )}
              {who}
            </span>
            {version.note !== null && <span className={styles['note']}>{version.note}</span>}
            {version.restoredFrom !== null && (
              <span className={styles['note']}>
                {words('editor.restored-from-version', { restoredFrom: version.restoredFrom })}
              </span>
            )}
          </button>
          {version.revision && <RevisionFacts revision={version.revision} />}
          {isOpen && (
            <p className={styles['changes']} role="status">
              {changes === 'reading' && words('editor.reading-the-changes')}
              {changes === 'failed' && words('editor.the-changes-could-not-be-read')}
              {changes === 'first' && words('editor.nothing-came-before-it')}
              {typeof changes === 'object' &&
                changes !== null &&
                words('editor.changes-from-the-version-before', {
                  changed: changes.changed,
                  added: changes.added,
                  removed: changes.removed,
                })}
            </p>
          )}
          {showsActions && (
            <span className={styles['actions']}>
              {!isLatest && (
                <a
                  className={styles['action']}
                  href={link}
                  aria-label={words('editor.open-2', { number: version.number })}
                  title={words('editor.open-2', { number: version.number })}
                >
                  <Icon name="View" size={16} />
                </a>
              )}
              {onCompare && !isLatest && (
                <IconButton
                  className={styles['action']}
                  data-accent=""
                  label={words('editor.compare-with', {
                    number: version.number,
                    number2: latest.number,
                  })}
                  onClick={() => onCompare(version, latest)}
                >
                  <Icon name="Compare" size={16} />
                </IconButton>
              )}
              {onRestore && !isLatest && (
                <IconButton
                  className={styles['action']}
                  label={words('editor.restore', { number: version.number })}
                  onClick={() => onRestore(version, latest)}
                >
                  <Icon name="Restore" size={16} />
                </IconButton>
              )}
              <IconButton
                className={styles['action']}
                label={words('editor.copy-link-to', { number: version.number })}
                onClick={() => void copyLink(version)}
              >
                <Icon name="Copy link" size={16} />
              </IconButton>
              {copied === version.id && (
                <span className={styles['note']} role="status">
                  {words('editor.link-copied')}
                </span>
              )}
            </span>
          )}
        </div>
      </li>
    );
  };

  const baselineRow = (baseline: TimelineBaseline) => (
    <li key={baseline.id} className={styles['row']} data-baseline={baseline.id}>
      <span className={styles['mark']} aria-hidden="true">
        <Icon name="Baseline" size={14} />
      </span>
      <div className={styles['body']}>
        <span className={styles['head']}>
          <a href={baselineLink(id, baseline.id)}>{baseline.name}</a>
          <span className={styles['number']}>{time.format(baseline.at)}</span>
          {baseline.superseded && <Lozenge kind="superseded" size="small" />}
        </span>
        <span className={styles['note']}>
          {baseline.gate
            ? words('editor.baseline-at-a-gate', {
                number: baseline.version,
                who: baseline.who ?? words('editor.unknown'),
              })
            : words('editor.baseline-of-version', {
                number: baseline.version,
                who: baseline.who ?? words('editor.unknown'),
              })}
        </span>
        <span className={styles['actions']}>
          <a
            className={styles['action']}
            href={comparisonLink(id, baseline.id, 'now')}
            aria-label={words('editor.compare-with-now', { name: baseline.name })}
            title={words('editor.compare-with-now', { name: baseline.name })}
          >
            <Icon name="Compare" size={16} />
          </a>
        </span>
      </div>
    </li>
  );

  const publicationRow = (publication: TimelinePublication) => (
    <li key={publication.id} className={styles['row']} data-publication={publication.id}>
      <span className={styles['mark']} aria-hidden="true">
        <Icon name="Publication" size={14} />
      </span>
      <div className={styles['body']}>
        <span className={styles['head']}>
          <span className={styles['number']}>{time.format(publication.at)}</span>
          <Lozenge kind="published" size="small" />
          <Lozenge kind={publication.approved ? 'approved' : 'notApproved'} size="small" />
          {publication.superseded && <Lozenge kind="superseded" size="small" />}
        </span>
        <span className={styles['note']}>
          {words('editor.publication-of-version', {
            number: publication.version,
            who: publication.who ?? words('editor.unknown'),
            formats: publication.formats.map((each) => FORMAT_WORDS[each]?.() ?? each).join(', '),
          })}
        </span>
        <span className={styles['actions']}>
          <a
            className={styles['action']}
            href={`#/publications/${publication.id}`}
            aria-label={words('editor.open-the-publication-of', { number: publication.version })}
            title={words('editor.open-the-publication-of', { number: publication.version })}
          >
            <Icon name="View" size={16} />
          </a>
          {publication.formats.length > 0 && (
            <IconButton
              className={styles['action']}
              label={words('editor.download-the-publication-of', { number: publication.version })}
              onClick={() => void download(publication)}
            >
              <Icon name="Download" size={16} />
            </IconButton>
          )}
        </span>
      </div>
    </li>
  );

  return (
    <div className={styles['timeline']}>
      <div className={styles['toolbar']}>
        <span className={styles['title']}>
          {words('editor.versions')}
          {state && <StateLozenge state={state} size="small" />}
          <span className={styles['count']}>
            {next === null
              ? words('editor.version-count', { count: versions.length })
              : words('editor.version-count-so-far', { count: versions.length })}
          </span>
        </span>
        <IconButton
          label={words(anyOpen ? 'editor.collapse-every-day' : 'editor.expand-every-day')}
          onClick={every}
        >
          <Icon name={anyOpen ? 'Collapse every day' : 'Expand every day'} size={16} />
        </IconButton>
      </div>
      {baselines === null && (
        <p className={styles['muted']}>{words('editor.the-baselines-could-not-be-read')}</p>
      )}
      {publications === null && (
        <p className={styles['muted']}>{words('editor.the-publications-could-not-be-read')}</p>
      )}
      <ul className={styles['days']} aria-label={words('editor.versions')}>
        {days.map((day) => {
          const collapsed = isCollapsed(day.key);
          const counted = day.rows.filter((row) => row.kind === 'version');
          const people = new Map(
            counted.flatMap((row) =>
              row.kind === 'version' && row.authorId !== null
                ? [[row.authorId, { id: row.authorId, name: row.author }] as const]
                : [],
            ),
          );
          return (
            <li key={day.key} className={styles['day']}>
              <h4 className={styles['dayHead']}>
                <button
                  type="button"
                  className={styles['dayToggle']}
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setTurned((held) => {
                      const now = new Set(held);
                      if (now.has(day.key)) now.delete(day.key);
                      else now.add(day.key);
                      return now;
                    })
                  }
                >
                  <Icon name={collapsed ? 'Next page' : 'Day open'} size={14} />
                  <span className={styles['dayName']}>{dayLabel(day.at)}</span>
                  {collapsed &&
                    dayKinds(day.rows).map((each) =>
                      each.kind === 'state' || each.name !== undefined ? (
                        <Lozenge key={each.name} kind={each.kind} size="dot" content>
                          {each.name}
                        </Lozenge>
                      ) : (
                        <Lozenge key={each.kind} kind={each.kind} size="dot" />
                      ),
                    )}
                  {collapsed &&
                    [...people.values()]
                      .slice(0, 3)
                      .map((person) => <Avatar key={person.id} person={person} size={20} />)}
                  {counted.length > 0 && (
                    <span className={styles['count']}>
                      {words('editor.version-count', { count: counted.length })}
                    </span>
                  )}
                </button>
              </h4>
              {!collapsed && (
                <ul className={styles['rows']}>
                  {day.rows.map((row) =>
                    row.kind === 'version'
                      ? versionRow(row)
                      : row.kind === 'baseline'
                        ? baselineRow(row)
                        : publicationRow(row),
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {(next !== null || nextPublications !== null) && (
        <button type="button" onClick={() => void older()}>
          {words('editor.show-older-versions')}
        </button>
      )}
    </div>
  );
}
