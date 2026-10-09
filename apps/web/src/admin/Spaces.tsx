import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { Chip } from '../parts/Chip.js';
import { RowActions, type MenuAction, type RowAction } from '../parts/RowActions.js';
import { SidePanel } from '../parts/SidePanel.js';
import styles from './Administration.module.css';
import { Shown, type Read } from './listing.js';
import { SpaceDialog, type SpaceAct, type SpaceRow } from './SpaceDialogs.js';

type Client = ReturnType<typeof createApiClient>;

const SHOWS = ['All', 'Active', 'Archived'] as const;
type Show = (typeof SHOWS)[number];

/**
 * Administration's Spaces, in the one shape (ADR-0049, decision 3; the AD plan, AD4): a sentence and
 * New space; a search, All, Active or Archived, and how many are shown; a table with a head, each row
 * its status and the reader's access, then Access and Rename as icons and the rest under More actions.
 * A space's Access opens in the side panel beside the list, which keeps its place (decision 5).
 */
export function Spaces({
  client,
  read,
  mayChange,
  administers,
  onChanged,
}: {
  client: Client;
  read: Read<SpaceRow>;
  /** Whether the reader may make, rename, archive and restore spaces: an administrator of the environment. */
  mayChange: boolean;
  /** Whether the reader administers a space, so may be offered its Access. */
  administers: (space: string) => boolean;
  /** A space was made or changed: read them again. */
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('All');
  const [act, setAct] = useState<SpaceAct | null>(null);
  const [said, setSaid] = useState('');
  const [access, setAccess] = useState<SpaceRow | null>(null);

  const shownOf = (rows: readonly SpaceRow[]) =>
    rows.filter(
      (space) =>
        space.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
        (show === 'All' || (show === 'Archived') === space.archived),
    );

  const actionsOf = (space: SpaceRow): { shown: RowAction[]; more: MenuAction[] } => {
    const shown: RowAction[] = [];
    const more: MenuAction[] = [];
    if (administers(space.id)) {
      shown.push({
        label: 'Access',
        name: `Access to the space ${space.name}`,
        icon: 'Access',
        onSelect: () => setAccess(space),
      });
    }
    if (mayChange) {
      const rename = () => setAct({ kind: 'rename', space });
      // Restore and Rename take turns in one place, so the focus stays as one becomes the other.
      if (space.archived) {
        shown.push({
          label: 'Restore',
          name: `Restore ${space.name}`,
          icon: 'Restore',
          slot: 'change',
          onSelect: () => setAct({ kind: 'restore', space }),
        });
        more.push({ label: 'Rename', onSelect: rename });
      } else {
        shown.push({
          label: 'Rename',
          name: `Rename ${space.name}`,
          icon: 'Rename',
          slot: 'change',
          onSelect: rename,
        });
        more.push({ label: 'Archive', onSelect: () => setAct({ kind: 'archive', space }) });
      }
    }
    return { shown, more };
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>A space holds components and documents, and has access of its own.</p>
        {mayChange && (
          <button type="button" className="primary" onClick={() => setAct({ kind: 'new' })}>
            New space
          </button>
        )}
      </div>
      <Shown read={read} failed="The spaces could not be loaded.">
        {(rows) => {
          const shown = shownOf(rows);
          return (
            <>
              <div className={styles['toolbar']}>
                <input
                  type="search"
                  className={styles['search']}
                  aria-label="Find a space"
                  placeholder="Find a space"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div role="group" aria-label="Show" className={styles['segments']}>
                  {SHOWS.map((each) => (
                    <button
                      key={each}
                      type="button"
                      aria-pressed={show === each}
                      onClick={() => setShow(each)}
                    >
                      {each}
                    </button>
                  ))}
                </div>
                <p className={styles['counted']}>
                  {`${shown.length} ${shown.length === 1 ? 'space' : 'spaces'}`}
                </p>
              </div>
              <div className={access === null ? undefined : styles['withPanel']}>
                <table aria-label="Spaces" className={styles['table']}>
                  <colgroup>
                    <col />
                    <col className={styles['statusColumn']} />
                    <col className={styles['accessColumn']} />
                    <col className={styles['actionsColumn']} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Status</th>
                      <th scope="col">Your access</th>
                      <th scope="col">
                        <span className={styles['hidden']}>Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((space) => (
                      <tr
                        key={space.id}
                        data-current={access?.id === space.id ? 'true' : undefined}
                        data-archived={space.archived ? 'true' : undefined}
                      >
                        <td className={styles['strong']}>{space.name}</td>
                        <td>
                          {space.archived ? <Chip>Archived</Chip> : <Chip tone="ok">Active</Chip>}
                        </td>
                        <td className={styles['muted']}>
                          {space.archived ? '' : space.mayCreate ? 'May create' : 'Reads only'}
                        </td>
                        <td>
                          <RowActions subject={space.name} {...actionsOf(space)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {access !== null && (
                  <SidePanel
                    key={access.id}
                    heading={`Access to ${access.name}`}
                    description="Space. Grants here add to the environment's."
                    icon="Access"
                    onClose={() => setAccess(null)}
                  >
                    <AccessPanel
                      at={{ kind: 'space', id: access.id, name: access.name }}
                      client={client}
                      headingLevel={3}
                      titled={false}
                    />
                  </SidePanel>
                )}
              </div>
            </>
          );
        }}
      </Shown>
      <p role="status">{said}</p>
      {act !== null && (
        <SpaceDialog
          client={client}
          act={act}
          onClose={() => setAct(null)}
          onDone={(words) => {
            setAct(null);
            setSaid(words);
            onChanged();
          }}
        />
      )}
    </>
  );
}
