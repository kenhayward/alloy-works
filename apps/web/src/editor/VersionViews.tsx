import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState, type ReactNode } from 'react';

import { Icon } from './Icon.js';
import { IconButton } from '../parts/IconButton.js';
import { Lozenge, StateLozenge } from '../states/Lozenge.js';
import { componentVersionLink } from '../search/links.js';
import { baselineLink, comparisonLink, documentVersionLink } from '../structure/links.js';
import { formats, words } from '../words/words.js';
import type { ChangeCounts } from './versionDays.js';
import type { TimelineVersion } from './VersionTimeline.js';
import styles from './VersionTimeline.module.css';

type Client = ReturnType<typeof createApiClient>;
type Of = 'component' | 'document';

/** The next choice of two: a third replaces the oldest, and one chosen again is let go. */
export const nextChoice = (held: readonly string[], chosen: string): readonly string[] =>
  held.includes(chosen) ? held.filter((each) => each !== chosen) : [...held, chosen].slice(-2);

/** A hash short enough never to scroll the panel sideways; its whole stands in its title. */
export const shortHash = (hash: string): string => `sha256 ${hash.slice(0, 8)}…${hash.slice(-6)}`;

const day = (at: Date) => formats().date(at, { day: 'numeric', month: 'short', year: 'numeric' });
const toSecond = (at: Date) =>
  `${day(at)}, ${formats().date(at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

const labelled = (version: TimelineVersion) =>
  `${version.number}, ${version.author ?? words('editor.unknown')}, ${day(version.at)}`;

/**
 * Comparing any two (VER-025), taking the panel: A and B, each to be chosen again; how far apart they
 * are; and the quick choices. What changed is the panel's own redline, drawn beneath.
 */
export function VersionCompare({
  client,
  id,
  of = 'component',
  line,
  versions,
  a,
  b,
  onCompare,
  onMine,
  onClose,
  children,
}: {
  client: Client;
  id: string;
  of?: Of;
  line?: string;
  /** Those the list has read; a person reaches any other by asking for it. */
  versions: readonly TimelineVersion[];
  a: TimelineVersion;
  b: TimelineVersion;
  onCompare: (older: TimelineVersion, newer: TimelineVersion) => void;
  onMine?: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [older, setOlder] = useState(a);
  const [newer, setNewer] = useState(b);
  const [found, setFound] = useState<readonly TimelineVersion[]>([]);
  const [asking, setAsking] = useState('');
  const [baselines, setBaselines] = useState<readonly { id: string; name: string }[]>([]);

  useEffect(() => {
    if (of !== 'document') return;
    let current = true;
    void client
      .GET('/v1/documents/{id}/baselines', { params: { path: { id }, query: {} } })
      .then(({ data }) => {
        if (current && data) setBaselines(data.baselines);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, id, of]);

  useEffect(() => {
    onCompare(older, newer);
    // Each choice compares once; the handler is the panel's and may be redrawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [older, newer]);

  const held = [...new Map([...versions, ...found].map((each) => [each.id, each])).values()];
  const between = (() => {
    const from = held.findIndex((each) => each.id === older.id);
    const to = held.findIndex((each) => each.id === newer.id);
    if (from < 0 || to < 0) return null;
    const span = held.slice(Math.min(from, to), Math.max(from, to) + 1);
    return {
      apart: span.length - 1,
      people: new Set(span.map((each) => each.authorId ?? each.author)).size,
      first: span[span.length - 1]!.at,
      last: span[0]!.at,
    };
  })();
  const before = held[held.findIndex((each) => each.id === newer.id) + 1];
  const approved = held.find((each) => each.revision?.standing === 'effective');

  const ask = async () => {
    const q = asking.trim();
    if (q === '') return;
    const answer = await (
      of === 'document'
        ? client.GET('/v1/documents/{id}/versions', { params: { path: { id }, query: { q } } })
        : client.GET('/v1/components/{id}/versions', {
            params: { path: { id }, query: { q, ...(line === undefined ? {} : { line }) } },
          })
    ).catch(() => undefined);
    setFound(
      (answer?.data?.items ?? []).map((each) => ({
        id: each.id,
        number: each.number,
        createdAt: each.createdAt,
        at: new Date(each.createdAt),
        author: each.author?.name ?? null,
        authorId: each.author?.id ?? null,
        note: each.note,
        restoredFrom: each.restoredFrom?.number ?? null,
        revision: each.revision ?? null,
      })),
    );
  };

  const picker = (
    label: string,
    value: TimelineVersion,
    choose: (version: TimelineVersion) => void,
  ) => (
    <label className={styles['picker']}>
      <span className={styles['note']}>{label}</span>
      <select
        aria-label={label}
        value={value.id}
        onChange={(event) => {
          const chosen = held.find((each) => each.id === event.target.value);
          if (chosen) choose(chosen);
        }}
      >
        {held.map((each) => (
          <option key={each.id} value={each.id}>
            {labelled(each)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className={styles['view']} aria-label={words('editor.compare-two-versions')}>
      <header className={styles['viewHead']}>
        <IconButton label={words('editor.back-to-the-versions')} onClick={onClose}>
          <Icon name="Back" size={16} />
        </IconButton>
        <h3 className={styles['viewTitle']}>{words('editor.compare-two-versions')}</h3>
      </header>
      <div className={styles['pickers']}>
        {picker(words('editor.version-a'), older, setOlder)}
        <button
          type="button"
          onClick={() => {
            setOlder(newer);
            setNewer(older);
          }}
        >
          {words('editor.swap')}
        </button>
        {picker(words('editor.version-b'), newer, setNewer)}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input
          type="search"
          aria-label={words('editor.find-a-version')}
          placeholder={words('editor.find-a-version')}
          value={asking}
          onChange={(event) => setAsking(event.target.value)}
        />
      </form>
      {between && (
        <p className={styles['note']}>
          {words('editor.versions-apart', {
            apart: between.apart,
            people: between.people,
            from: day(between.first),
            to: day(between.last),
          })}
        </p>
      )}
      <div className={styles['quick']}>
        {before && (
          <button type="button" onClick={() => setOlder(before)}>
            {words('editor.with-the-version-before')}
          </button>
        )}
        {approved && approved.id !== newer.id && (
          <button type="button" onClick={() => setOlder(approved)}>
            {words('editor.with-approved', { number: approved.number })}
          </button>
        )}
        {onMine && (
          <button type="button" onClick={onMine}>
            {words('editor.with-my-changes')}
          </button>
        )}
        {baselines.map((each) => (
          <a key={each.id} href={comparisonLink(id, each.id, 'now')}>
            {words('editor.with-a-baseline', { name: each.name })}
          </a>
        ))}
      </div>
      {children}
    </section>
  );
}

interface Delivery {
  readonly from: string | null;
  readonly source: string | null;
  readonly sourceSha256: string | null;
  readonly askedBy: string | null;
  readonly key: string;
}

interface Decided {
  readonly decision: 'approved' | 'rejected';
  readonly reason: string | null;
  readonly by: string | null;
  readonly at: string;
}

/**
 * One version taking the panel: its facts to the second, its own approvals, what changed from the one
 * before, the delivery that made it by the receipt's fields, and a document's baselines naming it.
 */
export function VersionView({
  client,
  id,
  of = 'component',
  versions,
  version,
  changesFrom,
  onCompare,
  onRestore,
  onGo,
  onBack,
}: {
  client: Client;
  id: string;
  of?: Of;
  versions: readonly TimelineVersion[];
  version: TimelineVersion;
  changesFrom: (older: TimelineVersion, newer: TimelineVersion) => Promise<ChangeCounts | null>;
  onCompare?: (version: TimelineVersion, latest: TimelineVersion) => void;
  onRestore?: (version: TimelineVersion, latest: TimelineVersion) => void;
  onGo: (version: TimelineVersion) => void;
  onBack: () => void;
}) {
  const [changes, setChanges] = useState<ChangeCounts | null>(null);
  const [decided, setDecided] = useState<readonly Decided[]>([]);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [baselines, setBaselines] = useState<readonly { id: string; name: string }[]>([]);
  const at = versions.findIndex((each) => each.id === version.id);
  const newer = versions[at - 1];
  const older = versions[at + 1];
  const latest = versions[0];

  useEffect(() => {
    const away = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', away);
    return () => window.removeEventListener('keydown', away);
  }, [onBack]);

  useEffect(() => {
    let current = true;
    setChanges(null);
    setDelivery(null);
    setDecided([]);
    setBaselines([]);
    if (older) {
      void changesFrom(older, version).then((counts) => current && setChanges(counts));
    }
    const params = { params: { path: { id } } };
    void (
      of === 'document'
        ? client.GET('/v1/documents/{id}/approvals', params)
        : client.GET('/v1/components/{id}/approvals', params)
    )
      .then(({ data }) => {
        if (!current || !data) return;
        setDecided(
          data.approvals
            .filter((each) => each.versionId === version.id)
            .map((each) => ({
              decision: each.decision,
              reason: each.reason,
              by: each.by.name,
              at: each.at,
            })),
        );
      })
      .catch(() => undefined);
    const read = { params: { path: { id, version: version.id } } };
    void (
      of === 'document'
        ? client.GET('/v1/documents/{id}/versions/{version}', read)
        : client.GET('/v1/components/{id}/versions/{version}', read)
    )
      .then(({ data }) => {
        if (current && data?.delivery) setDelivery(data.delivery);
      })
      .catch(() => undefined);
    if (of === 'document') {
      void client
        .GET('/v1/documents/{id}/baselines', { params: { path: { id }, query: {} } })
        .then(({ data }) => {
          if (!current || !data) return;
          setBaselines(data.baselines.filter((each) => each.version.id === version.id));
        })
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
    // Read anew for each version shown; the comparison is the panel's and may be redrawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id, of, version.id]);

  const fact = (name: string, value: ReactNode) => (
    <div className={styles['fact']} key={name}>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
  const { revision } = version;

  return (
    <section
      className={styles['view']}
      aria-label={words('editor.version-number', { number: version.number })}
    >
      <header className={styles['viewHead']}>
        <IconButton label={words('editor.back-to-the-versions')} onClick={onBack}>
          <Icon name="Back" size={16} />
        </IconButton>
        <h3 className={styles['viewTitle']}>
          {words('editor.version-number', { number: version.number })}
        </h3>
        {revision && <StateLozenge state={revision.state} />}
        <span className={styles['viewGo']}>
          <IconButton
            label={words('editor.newer-version')}
            disabled={!newer}
            onClick={() => newer && onGo(newer)}
          >
            <Icon name="Previous page" size={16} />
          </IconButton>
          <IconButton
            label={words('editor.older-version')}
            disabled={!older}
            onClick={() => older && onGo(older)}
          >
            <Icon name="Next page" size={16} />
          </IconButton>
        </span>
      </header>
      {latest && latest.id !== version.id && (
        <div className={styles['viewActions']}>
          <a
            className={styles['action']}
            href={
              of === 'document'
                ? documentVersionLink(id, version.id)
                : componentVersionLink(id, version.id)
            }
            aria-label={words('editor.open-2', { number: version.number })}
            title={words('editor.open-2', { number: version.number })}
          >
            <Icon name="View" size={16} />
          </a>
          {onCompare && (
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
          {onRestore && (
            <IconButton
              className={styles['action']}
              label={words('editor.restore', { number: version.number })}
              onClick={() => onRestore(version, latest)}
            >
              <Icon name="Restore" size={16} />
            </IconButton>
          )}
        </div>
      )}
      <dl className={styles['factList']}>
        {fact(words('editor.fact-saved'), toSecond(version.at))}
        {fact(words('editor.fact-by'), version.author ?? words('editor.unknown'))}
        {version.note !== null && fact(words('editor.fact-note'), version.note)}
        {version.restoredFrom !== null &&
          fact(words('editor.fact-restored-from'), version.restoredFrom)}
        {revision?.standing === 'effective' &&
          fact(
            words('editor.fact-effective'),
            revision.scopes.length > 0 ? (
              revision.scopes.map((each) => `${each.axis}: ${each.value}`).join(', ')
            ) : (
              <Lozenge kind="effective" size="small" />
            ),
          )}
      </dl>
      {decided.length > 0 && (
        <>
          <h4 className={styles['viewPart']}>{words('editor.approvals')}</h4>
          <ul aria-label={words('editor.approvals-of-this-version')} className={styles['viewList']}>
            {decided.map((each, index) => (
              <li key={index}>
                <Lozenge
                  kind={each.decision === 'approved' ? 'approved' : 'rejected'}
                  size="small"
                />{' '}
                {`${each.by ?? words('editor.unknown')}, ${toSecond(new Date(each.at))}`}
                {each.reason !== null && <span className={styles['note']}> {each.reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {older && (
        <>
          <h4 className={styles['viewPart']}>
            {words('editor.changes-from-number', { number: older.number })}
          </h4>
          {changes && (
            <p className={styles['note']}>
              {words('editor.change-counts', {
                changed: changes.changed,
                added: changes.added,
                removed: changes.removed,
              })}
            </p>
          )}
        </>
      )}
      {delivery && (
        <>
          <h4 className={styles['viewPart']}>{words('editor.delivery')}</h4>
          <dl className={styles['factList']}>
            {delivery.from !== null && fact(words('editor.fact-from'), delivery.from)}
            {delivery.askedBy !== null && fact(words('editor.fact-asked-by'), delivery.askedBy)}
            {delivery.source !== null && fact(words('editor.fact-source'), delivery.source)}
            {delivery.sourceSha256 !== null &&
              fact(words('editor.fact-source-hash'), <HashFact hash={delivery.sourceSha256} />)}
            {fact(words('editor.fact-delivery-key'), delivery.key)}
          </dl>
        </>
      )}
      {baselines.length > 0 && (
        <>
          <h4 className={styles['viewPart']}>{words('editor.in-baselines')}</h4>
          <ul className={styles['viewList']}>
            {baselines.map((each) => (
              <li key={each.id}>
                <a href={baselineLink(id, each.id)}>{each.name}</a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function HashFact({ hash }: { hash: string }) {
  return (
    <span className={styles['hash']}>
      <span className={styles['number']} title={hash}>
        {shortHash(hash)}
      </span>
      <IconButton
        label={words('editor.copy-in-full')}
        onClick={() => void navigator.clipboard?.writeText(hash).catch(() => undefined)}
      >
        <Icon name="Copy" size={14} />
      </IconButton>
    </span>
  );
}
