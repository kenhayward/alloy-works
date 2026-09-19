import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { isAccessAnswers } from '../access/describe.js';
import { DocumentList } from '../structure/DocumentList.js';
import { DocumentPage } from '../structure/DocumentPage.js';
import { documentAddress, documentLink } from '../structure/links.js';
import { ComponentEditor } from './ComponentEditor.js';
import { ComponentList } from './ComponentList.js';

export interface WorkspaceProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
}

const OPEN = /^#\/components\/([0-9a-f-]{36})(\/access)?$/;

/** What sits above either listing: the two kinds of thing a person can open, each a plain link. */
function Places() {
  return (
    <nav aria-label="Workspace">
      <a href="#/">Components</a> <a href="#/documents">Documents</a>
    </nav>
  );
}

type Client = ReturnType<typeof createApiClient>;

/**
 * A link to the component's access, shown only to someone the service says may administer it - at
 * the component or anywhere above it - so nobody is offered a page that would only refuse them. The
 * check is a convenience for the link alone: the access page itself enforces permission again,
 * server-side.
 */
function ManageAccessLink({ client, componentId }: { client: Client; componentId: string }) {
  const [administers, setAdministers] = useState(false);
  useEffect(() => {
    let current = true;
    setAdministers(false);
    client
      .GET('/v1/access', { params: { query: { target: `artifact:${componentId}` } } })
      .then(({ data }) => {
        if (!current) return;
        // The client's response body is `any` (packages/api-client's generated types never reach
        // the renderer), so it is checked rather than trusted before a field of it is read.
        if (!isAccessAnswers(data)) {
          setAdministers(false);
          return;
        }
        const answer = data.permissions.find((each) => each.permission === 'administer');
        setAdministers(answer?.allowed === true);
      })
      .catch(() => {
        if (current) setAdministers(false);
      });
    return () => {
      current = false;
    };
  }, [client, componentId]);
  if (!administers) return null;
  return (
    <>
      {' '}
      <a href={`#/components/${componentId}/access`}>Manage access</a>
    </>
  );
}

/**
 * The address after `#`, followed as it changes: a hash never reaches the service or a reload's path.
 * `arrivals` counts every change, so an address that arrives again - a link to the node already named,
 * after the document page rewrote the address to another without a `hashchange` - is still news.
 */
function useHash(): { readonly hash: string; readonly arrivals: number } {
  const [followed, setFollowed] = useState(() => ({ hash: window.location.hash, arrivals: 0 }));
  useEffect(() => {
    const follow = () =>
      setFollowed((previous) => ({
        hash: window.location.hash,
        arrivals: previous.arrivals + 1,
      }));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return followed;
}

/**
 * The list of components, one component open, the list of documents or one document open, chosen by
 * the address's hash - so opening one is a link, a reload reopens it, and the renderer's relative
 * asset paths (built for the desktop shell's `file://` fallback) are never put under a deep path.
 */
export function Workspace({ fetch: given }: WorkspaceProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const { hash, arrivals } = useHash();
  const [me, setMe] = useState<string | null>(null);
  // Asking who is signed in failed for a reason other than nobody being signed in (final review,
  // finding 5): a server error or no answer, which Try again asks about once more.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
      <section>
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
      </section>
    );
  }
  if (me === null) return null;
  const address = OPEN.exec(hash);
  const opened = address?.[1];
  if (opened && address?.[2]) {
    return (
      <>
        <p>
          <a href={`#/components/${opened}`}>Back to the component</a>
        </p>
        <AccessPanel key={opened} componentId={opened} client={client} />
      </>
    );
  }
  if (opened) {
    return (
      <>
        <p>
          <a href="#">Back to components</a>
          <ManageAccessLink client={client} componentId={opened} />
        </p>
        <ComponentEditor key={opened} componentId={opened} client={client} principalId={me} />
      </>
    );
  }
  const documents = documentAddress(hash);
  if (documents?.kind === 'document') {
    return (
      <>
        <p>
          <a href="#/documents">Back to documents</a>
        </p>
        <DocumentPage
          key={documents.document}
          client={client}
          id={documents.document}
          linked={documents.node === null ? null : { node: documents.node, arrival: arrivals }}
        />
      </>
    );
  }
  if (documents) {
    return (
      <>
        <Places />
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
      <Places />
      <ComponentList client={client} />
    </>
  );
}
