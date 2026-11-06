import type { createApiClient } from '@alloy-works/api-client';
import { readOutlineView, numberingSchemeSchema, type OutlineView } from '@alloy-works/domain';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';

import { administersAt } from '../access/ManageAccessLink.js';
import { Icon } from '../editor/Icon.js';
import { Modal } from '../layouts/Modal.js';
import { ArchiveButton } from '../lifecycle/Archive.js';
import { DeleteButton } from '../lifecycle/Delete.js';
import { PlaceHoldButton } from '../lifecycle/Hold.js';
import { MoveDialog } from '../lifecycle/MoveDialog.js';
import {
  standingIn,
  useLifecycleActs,
  type LifecycleAct,
  type Standing,
} from '../lifecycle/Workflow.js';
import { Flyout, type MenuEntry } from '../parts/MenuBar.js';
import styles from '../parts/parts.module.css';
import { Publishing } from '../publishing/Publishing.js';
import { readRelated, readUses, reachToAsk, ReachDialog, UsedInButton } from '../reuse/UsedIn.js';
import type { Related, Uses } from '../reuse/UsedIn.js';
import { RelationshipsButton } from '../reuse/Relationships.js';
import { documentAccessLink, documentLink, templateAccessLink } from '../structure/links.js';
import { placeInOutline } from '../structure/placeInOutline.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export type RowKind = 'document' | 'component' | 'template';

/** What the item's own view says, read when its menu opens (the RM plan, RM-B). */
interface Read {
  readonly space: string;
  readonly version: string;
  readonly archived: boolean;
  readonly mayRetire: boolean;
  readonly mayMove: boolean;
  readonly mayHold: boolean;
  readonly mayPublish: boolean;
  readonly mayDesign: boolean;
  readonly standing: Standing | undefined;
  readonly publish: {
    readonly outline: OutlineView;
    readonly scheme: ReturnType<typeof numberingSchemeSchema.parse> | null;
    readonly formats: readonly string[];
    readonly languages: readonly string[];
  } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const strings = (value: unknown, otherwise: readonly string[]): readonly string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : otherwise;

function readIn(data: unknown): Read | null {
  if (!isRecord(data) || !isRecord(data.space) || typeof data.space.id !== 'string') return null;
  const version = isRecord(data.version) && typeof data.version.id === 'string' ? data.version.id : '';
  const outline =
    typeof data.id === 'string' && data.outline !== undefined
      ? readOutlineView(data.outline, { artifact: data.id, version })
      : undefined;
  const layout = isRecord(data.layout) ? data.layout : {};
  const scheme = numberingSchemeSchema.safeParse(layout.scheme);
  return {
    space: data.space.id,
    version,
    archived: data.archived === true,
    mayRetire: data.mayRetire === true,
    mayMove: data.mayMove === true,
    mayHold: data.mayHold === true,
    mayPublish: data.mayPublish === true,
    mayDesign: data.mayDesign === true,
    standing: standingIn(data),
    publish:
      outline?.ok === true
        ? {
            outline: outline.outline,
            scheme: scheme.success ? scheme.data : null,
            formats: strings(layout.formats, ['pdf']),
            languages: strings(layout.languages, []),
          }
        : null,
  };
}

const PATH = { document: 'documents', component: 'components', template: 'templates' } as const;

const linkOf = (kind: RowKind, id: string): string =>
  kind === 'document' ? documentLink(id) : `#/${PATH[kind]}/${id}`;

const accessLinkOf = (kind: RowKind, id: string): string =>
  kind === 'document'
    ? documentAccessLink(id)
    : kind === 'template'
      ? templateAccessLink(id)
      : `#/components/${id}/access`;

const UNREAD: Standing = { state: { key: '', name: '', approved: false }, transitions: [] };

/** The lifecycle's acts, none until the item is read. */
function WithActs({
  client,
  kind,
  id,
  title,
  read,
  onMoved,
  onNotice,
  onStale,
  children,
}: {
  client: Client;
  kind: 'document' | 'component';
  id: string;
  title: string;
  read: Read | null;
  onMoved: (standing: Standing, said: string) => void;
  onNotice: (said: string) => void;
  onStale: () => void;
  children: (acts: readonly LifecycleAct[]) => ReactNode;
}) {
  // One tree whether or not it is read yet, so the menu stays open as its rows arrive.
  return (
    <Acts
      transition={{
        client,
        kind,
        id,
        title,
        standing: read?.standing ?? UNREAD,
        versionId: read?.version ?? '',
        onMoved,
        onNotice,
        onStale,
      }}
    >
      {children}
    </Acts>
  );
}

function Acts({
  transition,
  children,
}: {
  transition: Parameters<typeof useLifecycleActs>[0];
  children: (acts: readonly LifecycleAct[]) => ReactNode;
}) {
  // A component's approval asks first what approving reaches, as its own page does (REL-024).
  const [reach, setReach] = useState<{
    uses: Uses;
    related: readonly Related[];
    act: string;
    go: () => void;
  } | null>(null);
  const { client, id, kind, title } = transition;
  const askFirst =
    kind === 'component'
      ? (act: string, go: () => void) => {
          void Promise.all([readUses(client, id), readRelated(client, id)]).then(
            ([uses, related]) => {
              const asked = reachToAsk(uses, related, undefined);
              if (asked) setReach({ ...asked, act, go });
              else go();
            },
          );
        }
      : undefined;
  const { acts, dialogs } = useLifecycleActs({ ...transition, askFirst });
  return (
    <>
      {children(acts)}
      {dialogs}
      {reach !== null && (
        <ReachDialog
          uses={reach.uses}
          related={reach.related}
          title={title}
          act={reach.act}
          onConfirm={() => {
            const { go } = reach;
            setReach(null);
            go();
          }}
          onCancel={() => setReach(null)}
        />
      )}
    </>
  );
}

/**
 * A row's More actions (SCH-075; the RM plan): the menu bar's flyout under its button, offering what
 * the item's own page offers that applies from a list. The item is read when the menu opens, not for
 * every row; what the caller may not do stays in it, unavailable, and the routes decide again.
 */
export function ContentRowMenu({
  client,
  kind,
  id,
  title,
  onChanged,
  onDuplicate,
  onGenerate,
}: {
  client: Client;
  kind: RowKind;
  id: string;
  title: string;
  /** Told what happened, and whether the list should be read again. */
  onChanged: (said: string, changed: boolean) => void;
  onDuplicate: () => void;
  /** A template's: generate documents from it. */
  onGenerate?: () => void;
}) {
  const [read, setRead] = useState<Read | null>(null);
  const [administers, setAdministers] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publishHeading = useId();
  const archiveAct = useRef<() => void>(null);
  const deleteAct = useRef<() => void>(null);
  const holdAct = useRef<() => void>(null);
  const moveAct = useRef<() => void>(null);
  const relationshipsAct = useRef<() => void>(null);
  const usedInAct = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    void client
      .GET(`/v1/${PATH[kind]}/{id}` as '/v1/documents/{id}', { params: { path: { id } } })
      .then(({ data }) => setRead(readIn(data)))
      .catch(() => setRead(null));
    void administersAt(client, `artifact:${id}`).then(setAdministers);
  }, [client, kind, id]);

  const copyLink = () => {
    const address = new URL(linkOf(kind, id), window.location.href).href;
    const failed = () => onChanged(words('editor.the-link-could-not-be'), false);
    const copying = navigator.clipboard?.writeText(address);
    if (!copying) return failed();
    copying.then(() => onChanged(words('editor.copied-the-link-to', { title }), false), failed);
  };

  const item = (key: string, label: string, enabled: boolean, run: () => void, danger = false) =>
    ({ kind: 'item', key, label, enabled, run, ...(danger ? { danger } : {}) }) as const;
  const divider = (key: string) => ({ kind: 'divider', key }) as const;
  const call = (act: { current: (() => void) | null }) => () => act.current?.();

  const entries = (acts: readonly LifecycleAct[]): MenuEntry[] => {
    const known = read !== null;
    const own: MenuEntry[] =
      kind === 'template'
        ? [item('generate', words('rows.generate-documents'), onGenerate !== undefined, () => onGenerate?.())]
        : [
            item('open', words('editor.open'), true, () => {
              window.location.hash = linkOf(kind, id);
            }),
            ...(kind === 'document'
              ? [item('publish', words('rows.publish'), read?.mayPublish === true, () => setPublishing(true))]
              : []),
            item('copy-link', words('editor.copy-link'), true, copyLink),
            {
              kind: 'submenu',
              key: 'lifecycle',
              label: words('rows.lifecycle'),
              enabled: acts.length > 0,
              entries: acts.map((act) => ({
                kind: 'item',
                key: act.key,
                label: act.label,
                enabled: act.enabled,
                content: true,
                run: act.run,
              })),
            },
            ...(kind === 'component'
              ? [item('used-in', words('reuse.used-in'), true, call(usedInAct))]
              : []),
          ];
    const may = kind === 'template' ? read?.mayDesign === true : known;
    return [
      ...own,
      item('relationships', words('reuse.relationships'), true, call(relationshipsAct)),
      item('duplicate', words('rows.duplicate'), may, onDuplicate),
      divider('manage'),
      item('access', words('access.manage-access'), administers, () => {
        window.location.hash = accessLinkOf(kind, id);
      }),
      ...(kind === 'template'
        ? []
        : [
            item('move', words('moving.move-to-another-space-menu'), read?.mayMove === true, call(moveAct)),
            item('hold', words('menu.place-a-hold'), read?.mayHold === true, call(holdAct)),
            item(
              'archive',
              read?.archived === true ? words('lifecycle.unarchive') : words('lifecycle.archive'),
              read?.mayRetire === true,
              call(archiveAct),
            ),
            divider('remove'),
            item('delete', words('menu.delete'), read?.mayRetire === true, call(deleteAct), true),
          ]),
    ];
  };

  const lifecycleKind = kind === 'template' ? undefined : kind;
  const flyout = (acts: readonly LifecycleAct[]) => (
    <Flyout
      label={words('parts.more-actions-for', { subject: title })}
      entries={entries(acts)}
      className={`${styles['iconButton']} ${styles['rowIcon']}`}
      onOpen={load}
      under
    >
      <Icon name="More actions" />
    </Flyout>
  );

  return (
    <>
      {lifecycleKind === undefined ? (
        flyout([])
      ) : (
        <WithActs
          client={client}
          kind={lifecycleKind}
          id={id}
          title={title}
          read={read}
          onMoved={(standing, said) => {
            setRead((now) => (now === null ? now : { ...now, standing }));
            onChanged(said, true);
          }}
          onNotice={(said) => onChanged(said, false)}
          onStale={load}
        >
          {flyout}
        </WithActs>
      )}
      <RelationshipsButton act={relationshipsAct} client={client} id={id} kind={kind} title={title} />
      {kind === 'component' && (
        <UsedInButton act={usedInAct} client={client} id={id} title={title} />
      )}
      {read !== null && lifecycleKind !== undefined && (
        <>
          <MoveDialog
            act={moveAct}
            client={client}
            id={id}
            from={read.space}
            carries={kind === 'document'}
            onChanged={(said) => onChanged(said, true)}
          />
          <PlaceHoldButton
            act={holdAct}
            client={client}
            target={{ artifact: id }}
            title={title}
            mayHold={read.mayHold}
            onPlaced={(said) => onChanged(said, true)}
          />
          <ArchiveButton
            act={archiveAct}
            client={client}
            kind={lifecycleKind}
            id={id}
            title={title}
            archived={read.archived}
            mayRetire={read.mayRetire}
            onChanged={(archived, said) => {
              setRead((now) => (now === null ? now : { ...now, archived }));
              onChanged(said, true);
            }}
          />
          <DeleteButton
            act={deleteAct}
            client={client}
            kind={lifecycleKind}
            id={id}
            title={title}
            mayRetire={read.mayRetire}
            onDeleted={() => onChanged(words('rows.deleted', { title }), true)}
          />
        </>
      )}
      {publishing && read?.publish != null && (
        <Modal labelledBy={publishHeading} size="wide" onClose={() => setPublishing(false)}>
          <h2 id={publishHeading}>{words('rows.publish-title', { title })}</h2>
          <Publishing
            client={client}
            document={id}
            version={read.version}
            mayPublish={read.mayPublish}
            placeOf={(node) => placeInOutline(read.publish!.outline, node, null, read.publish!.scheme)}
            formats={read.publish.formats}
            language={read.publish.outline.language}
            languages={read.publish.languages}
          />
        </Modal>
      )}
    </>
  );
}
