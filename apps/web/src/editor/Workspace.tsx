import { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { Administration } from '../admin/Administration.js';
import { ConnectionPage } from '../data/ConnectionPage.js';
import { Connections } from '../data/Connections.js';
import {
  connectionAddress,
  connectionLink,
  queryDefinitionAddress,
  queryDefinitionTab,
} from '../data/links.js';
import { QueryDefinitionPage } from '../data/QueryDefinitionPage.js';
import { QueryDefinitions } from '../data/QueryDefinitions.js';
import { Home } from '../home/Home.js';
import { PublicationList } from '../publishing/PublicationList.js';
import { PublicationPage } from '../publishing/PublicationPage.js';
import { useAbout } from '../shell/about.js';
import { hashOf, placeOf, type Place } from '../shell/places.js';
import { componentAddress, searchAddress, searchLink } from '../search/links.js';
import { SearchPage } from '../search/SearchPage.js';
import { DocumentList } from '../structure/DocumentList.js';
import { DocumentPage } from '../structure/DocumentPage.js';
import { documentAddress, documentLink, templateAccessAddress } from '../structure/links.js';
import { TemplateList } from '../structure/TemplateList.js';
import { PaneSeparator, usePaneWidth } from '../layouts/PaneWidth.js';
import { OutlineRail } from '../structure/OutlineTabs.js';
import { StatusTools } from '../shell/Status.js';
import { ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider } from '../theme/presentation.js';
import { ComponentEditor } from './ComponentEditor.js';
import { COMPONENT_PANELS, ComponentDock } from './ComponentDock.js';
import { ComponentList } from './ComponentList.js';
import { SpacePane } from './SpacePane.js';
import styles from './Workspace.module.css';
import { Notice } from '../states/Notice.js';

export interface WorkspaceProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
}

/**
 * Home and each module's list, which are read afresh on returning to them rather than kept, since what
 * they list may have changed while another place was open; every other page is somebody's work.
 */
const LISTS = new Set([
  '',
  '#',
  '#/',
  '#/components',
  '#/documents',
  '#/templates',
  '#/publications',
  '#/connections',
  '#/query-definitions',
]);
const isWork = (hash: string) => !LISTS.has(hash) && !hash.startsWith('#/admin');

/** The space pane beside an open component: dragged as the document's outline is, and hidden to a rail. */
const SPACE_PANE = { storageKey: 'aw.component.space', min: 200, max: 480, initial: 260 };
/** The panels beside an open component, and the same while they offer the Table tab (ADR-0052). */
const COMPONENT_DOCK_PANE = { storageKey: 'aw.component.panels', min: 280, max: 640, initial: 320 };
const COMPONENT_TABLE_PANE = { storageKey: 'aw.component.table', min: 360, max: 720, initial: 440 };

/** Administration, given About's content from the shell. */
function AdministrationPage({ client }: { client: ReturnType<typeof createApiClient> }) {
  return <Administration client={client} about={useAbout()} />;
}

/** A publication's own address (PUB-047). */
const PUBLICATION = /^#\/publications\/([0-9a-f-]{36})$/;

/**
 * The address after `#`, followed as it changes: a hash never reaches the service or a reload's path.
 * `arrivals` counts every change, so an address that arrives again - a link to the node already named,
 * after the document page rewrote the address to another without a `hashchange` - is still news.
 * `again` counts one more for a link to the address already shown, which a browser follows without a
 * `hashchange`.
 */
function useHash(): {
  readonly hash: string;
  readonly arrivals: number;
  readonly again: () => void;
} {
  const [followed, setFollowed] = useState(() => ({ hash: window.location.hash, arrivals: 0 }));
  const again = useCallback(
    () =>
      setFollowed((previous) => ({
        hash: window.location.hash,
        arrivals: previous.arrivals + 1,
      })),
    [],
  );
  useEffect(() => {
    window.addEventListener('hashchange', again);
    return () => window.removeEventListener('hashchange', again);
  }, [again]);
  return { ...followed, again };
}

/**
 * The list of components, one component open, the list of documents, one document open or one
 * publication, chosen by the address's hash - so opening one is a link, a reload reopens it, and the
 * renderer's relative asset paths (built for the desktop shell's `file://` fallback) are never put
 * under a deep path.
 */
export function Workspace({ fetch: given }: WorkspaceProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const { hash, arrivals, again } = useHash();
  const place = placeOf(hash);
  // Every place visited, at the address it last showed while open: each stays mounted, hidden while
  // another is open, so what was typed and not yet kept survives a trip to another module.
  const kept = useRef(new Map<Place, { readonly hash: string; readonly arrivals: number }>());
  kept.current.set(place, { hash, arrivals });
  // Where the window was scrolled in each place, given back on returning to it.
  const scrolled = useRef(new Map<Place, number>());
  useEffect(() => {
    const leaving = (event: HashChangeEvent) => {
      const from = placeOf(hashOf(event.oldURL));
      if (from !== placeOf(window.location.hash)) {
        scrolled.current.set(from, document.documentElement.scrollTop);
      }
    };
    window.addEventListener('hashchange', leaving);
    return () => window.removeEventListener('hashchange', leaving);
  }, []);
  useLayoutEffect(() => {
    const at = scrolled.current.get(place);
    if (at !== undefined) document.documentElement.scrollTop = at;
  }, [place]);
  const [me, setMe] = useState<string | null>(null);
  // Asking who is signed in failed for a reason other than nobody being signed in (final review,
  // finding 5): a server error or no answer, which Try again asks about once more.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The space the open component turned out to be in, for the pane beside the editor; kept with the
  // component it belongs to, so the pane never shows one component's space beside another.
  // Where an open component's fields are set: its Attributes panel, once that is there (LG6b).
  const [fieldsHost, setFieldsHost] = useState<HTMLElement | null>(null);
  // Where an open component's table is formatted, and whether it holds one (ADR-0052).
  const [tableHost, setTableHost] = useState<HTMLElement | null>(null);
  const [heldTable, setHeldTable] = useState({ holds: false, entered: 0 });
  // The panes beside an open component, sized and hidden as the document page's are.
  const spacePane = usePaneWidth(SPACE_PANE);
  const dockPane = usePaneWidth(COMPONENT_DOCK_PANE);
  const tablePane = usePaneWidth(COMPONENT_TABLE_PANE);
  const dockSized = heldTable.holds ? tablePane : dockPane;
  const [placed, setPlaced] = useState<{
    readonly component: string;
    readonly space: { readonly id: string; readonly name: string };
  } | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setMe(data.id);
        // Signed out shows nothing here: the environment panel beside it offers the way in.
        else if (response.status !== 401) setFailed(true);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [client, attempt]);

  if (failed) {
    return (
      <Notice tone="failed">
        <p>The workspace could not be loaded.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
      </Notice>
    );
  }
  if (me === null) return null;
  return (
    <>
      {[...kept.current]
        .filter(([at, shown]) => at === place || isWork(shown.hash))
        .map(([at, shown]) => (
          <div key={at} className={styles['kept']} hidden={at !== place}>
            {pageFor(shown.hash, shown.arrivals, me)}
          </div>
        ))}
    </>
  );

  /** The page an address names, as it was chosen before pages were kept. */
  function pageFor(hash: string, arrivals: number, me: string): React.JSX.Element {
    if (hash === '' || hash === '#' || hash === '#/') return <Home client={client} />;
    if (/^#\/admin(?:\/|$)/.test(hash)) return <AdministrationPage client={client} />;
    const address = componentAddress(hash);
    const opened = address?.component;
    if (opened && address?.access) {
      return (
        <>
          <p>
            <a href={`#/components/${opened}`}>Back to the component</a>
          </p>
          <AccessPanel key={opened} at={{ kind: 'component', id: opened }} client={client} />
        </>
      );
    }
    if (opened) {
      return (
        <div
          className={styles['triptych']}
          data-space-collapsed={spacePane.collapsed}
          data-dock-collapsed={dockPane.collapsed}
          style={
            {
              '--space-width': `${spacePane.width}px`,
              // While it offers a Table tab, the panel is wider, and stays so as the cursor moves (TF-A).
              '--dock-panel': `${dockSized.width}px`,
            } as React.CSSProperties
          }
        >
          <div className={styles['space']}>
            {spacePane.collapsed ? (
              <OutlineRail
                pane={spacePane}
                chosen="space"
                tabs={[{ key: 'space', label: placed?.space.name ?? 'Space' }]}
                label="space pane"
                className={styles['rail']}
              />
            ) : placed?.component === opened ? (
              <SpacePane client={client} space={placed.space} current={opened} pane={spacePane} />
            ) : null}
          </div>
          {!spacePane.collapsed && (
            <div className={styles['edge']}>
              <PaneSeparator label="space pane" pane={spacePane} />
            </div>
          )}
          <div className={styles['editor']}>
            <nav aria-label="Breadcrumb" className={styles['trail']}>
              <a href="#/components">Components</a>
              {placed?.component === opened && <span>{` / ${placed.space.name}`}</span>}
            </nav>
            {/* A component on its own is set in the environment's theme and layout (themes.md, ET-A). */}
            <PresentationProvider client={client}>
              {/* In the status bar (ADR-0056), as a document's is. */}
              <StatusTools>
                <ZoomControl />
              </StatusTools>
              <ComponentEditor
                key={opened}
                componentId={opened}
                client={client}
                principalId={me}
                onSpace={(space) => setPlaced({ component: opened, space })}
                linked={address?.block ? { block: address.block, arrival: arrivals } : null}
                fieldsHost={fieldsHost}
                tableHost={tableHost}
                onTable={setHeldTable}
              />
            </PresentationProvider>
          </div>
          {!dockPane.collapsed && (
            <div className={styles['dockEdge']}>
              <PaneSeparator label="component panels" pane={dockSized} edge="end" />
            </div>
          )}
          {dockPane.collapsed && (
            <div className={styles['dockRail']}>
              <OutlineRail
                pane={dockPane}
                chosen=""
                tabs={COMPONENT_PANELS.filter((each) => each.key !== 'table' || heldTable.holds)}
                label="component panels"
                edge="end"
                className={styles['rail']}
              />
            </div>
          )}
          <ComponentDock
            key={opened}
            client={client}
            id={opened}
            onFieldsHost={setFieldsHost}
            table={heldTable}
            onTableHost={setTableHost}
            pane={dockPane}
          />
        </div>
      );
    }

    const searched = searchAddress(hash);
    if (searched !== null) {
      return (
        <>
          <SearchPage
            client={client}
            query={searched}
            onSearch={(query) => {
              window.location.hash = searchLink(query);
            }}
          />
        </>
      );
    }
    const templateAccess = templateAccessAddress(hash);
    if (templateAccess !== null) {
      return (
        <>
          <p>
            <a href="#/templates">Back to templates</a>
          </p>
          <AccessPanel
            key={templateAccess}
            at={{ kind: 'template', id: templateAccess }}
            client={client}
          />
        </>
      );
    }
    const connection = connectionAddress(hash);
    if (connection?.access) {
      return (
        <>
          <p>
            <a href={connectionLink(connection.connection)}>Back to the connection</a>
          </p>
          <AccessPanel
            key={connection.connection}
            at={{ kind: 'connection', id: connection.connection }}
            client={client}
          />
        </>
      );
    }
    if (connection) {
      return (
        <ConnectionPage
          key={connection.connection}
          client={client}
          id={connection.connection}
          tab={connection.tab}
        />
      );
    }
    const definition = queryDefinitionAddress(hash);
    if (definition !== null) {
      return (
        <QueryDefinitionPage
          key={definition}
          client={client}
          id={definition}
          tab={queryDefinitionTab(hash)}
        />
      );
    }
    if (hash === '#/query-definitions') {
      return (
        <>
          <QueryDefinitions client={client} />
        </>
      );
    }
    if (hash === '#/connections') {
      return (
        <>
          <Connections client={client} />
        </>
      );
    }
    if (hash === '#/templates') {
      return (
        <>
          <TemplateList client={client} />
        </>
      );
    }
    if (hash === '#/publications') {
      return (
        <>
          <PublicationList client={client} />
        </>
      );
    }
    const publication = PUBLICATION.exec(hash)?.[1];
    if (publication) {
      return (
        <>
          <PublicationPage key={publication} client={client} id={publication} />
        </>
      );
    }
    const documents = documentAddress(hash);
    if (documents?.kind === 'access') {
      return (
        <>
          <p>
            <a href={documentLink(documents.document)}>Back to the document</a>
          </p>
          <AccessPanel
            key={documents.document}
            at={{ kind: 'document', id: documents.document }}
            client={client}
          />
        </>
      );
    }
    if (documents?.kind === 'document') {
      return (
        <>
          {/* Back to the documents is the arrow in the outline pane's tab strip (interface slice 15). */}
          <DocumentPage
            key={documents.document}
            client={client}
            principalId={me}
            id={documents.document}
            linked={documents.node === null ? null : { node: documents.node, arrival: arrivals }}
            onArriveAgain={again}
          />
        </>
      );
    }
    if (documents) {
      return (
        <>
          <DocumentList
            client={client}
            onOpen={(id) => {
              window.location.hash = documentLink(id);
            }}
          />
        </>
      );
    }
    return (
      <>
        <ComponentList client={client} principalId={me} />
      </>
    );
  }
}
