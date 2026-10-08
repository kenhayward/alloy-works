import { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { ConnectionPage } from '../data/ConnectionPage.js';
import { Connections } from '../data/Connections.js';
import { connectionAddress, connectionLink, queryDefinitionAddress } from '../data/links.js';
import { QueryDefinitionPage } from '../data/QueryDefinitionPage.js';
import { QueryDefinitions } from '../data/QueryDefinitions.js';
import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { Home } from '../home/Home.js';
import { PublicationList } from '../publishing/PublicationList.js';
import { PublicationPage } from '../publishing/PublicationPage.js';
import { componentAddress, searchAddress, searchLink } from '../search/links.js';
import { SearchPage } from '../search/SearchPage.js';
import { DocumentList } from '../structure/DocumentList.js';
import { DocumentPage } from '../structure/DocumentPage.js';
import { documentAddress, documentLink, templateAccessAddress } from '../structure/links.js';
import { TemplateList } from '../structure/TemplateList.js';
import { ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider } from '../theme/presentation.js';
import { ComponentEditor } from './ComponentEditor.js';
import { ComponentList } from './ComponentList.js';
import { SpacePane } from './SpacePane.js';
import styles from './Workspace.module.css';
import { Notice } from '../states/Notice.js';

export interface WorkspaceProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
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
  const [me, setMe] = useState<string | null>(null);
  // Asking who is signed in failed for a reason other than nobody being signed in (final review,
  // finding 5): a server error or no answer, which Try again asks about once more.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The space the open component turned out to be in, for the pane beside the editor; kept with the
  // component it belongs to, so the pane never shows one component's space beside another.
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
  if (hash === '' || hash === '#' || hash === '#/') return <Home client={client} />;
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
      <div className={styles['triptych']}>
        {placed?.component === opened ? (
          <SpacePane client={client} space={placed.space} current={opened} />
        ) : (
          <div />
        )}
        <div className={styles['editor']}>
          <p>
            <a href="#/components">Back to components</a>{' '}
            <ManageAccessLink
              client={client}
              target={`artifact:${opened}`}
              href={`#/components/${opened}/access`}
            />
          </p>
          {/* A component on its own is set in the environment's theme and layout (themes.md, ET-A). */}
          <PresentationProvider client={client}>
            <ZoomControl />
            <ComponentEditor
              key={opened}
              componentId={opened}
              client={client}
              principalId={me}
              onSpace={(space) => setPlaced({ component: opened, space })}
              linked={address?.block ? { block: address.block, arrival: arrivals } : null}
            />
          </PresentationProvider>
        </div>
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
      <ConnectionPage key={connection.connection} client={client} id={connection.connection} />
    );
  }
  const definition = queryDefinitionAddress(hash);
  if (definition !== null) {
    return <QueryDefinitionPage key={definition} client={client} id={definition} />;
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
