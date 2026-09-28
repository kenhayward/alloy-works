import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { isAccessAnswers } from './describe.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * A link to the access page of an artifact, shown only to someone the service says may administer it
 * - at the artifact or anywhere above it - so nobody is offered a page that would only refuse them.
 * The check is a convenience for the link alone: the access page itself enforces permission again,
 * server-side. Shared by a component, a document and each template in Templates.
 */
export function ManageAccessLink({
  client,
  target,
  href,
  label,
  className,
}: {
  client: Client;
  /** The artifact, as a target: `artifact:<id>`. */
  target: string;
  href: string;
  /** The link's accessible name where "Manage access" alone would not say to what. */
  label?: string;
  className?: string;
}) {
  const [administers, setAdministers] = useState(false);
  useEffect(() => {
    let current = true;
    setAdministers(false);
    client
      .GET('/v1/access', { params: { query: { target } } })
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
  }, [client, target]);
  if (!administers) return null;
  return (
    <a href={href} className={className} {...(label === undefined ? {} : { 'aria-label': label })}>
      Manage access
    </a>
  );
}
