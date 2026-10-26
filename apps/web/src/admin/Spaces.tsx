import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { Chip } from '../parts/Chip.js';
import { RowActions, type MenuAction, type RowAction } from '../parts/RowActions.js';
import { SidePanel } from '../parts/SidePanel.js';
import styles from './Administration.module.css';
import { Shown, type Read } from './listing.js';
import { SpaceDialog, type SpaceAct, type SpaceRow } from './SpaceDialogs.js';
import { words as say } from '../words/words.js';

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
  const [show, setShow] = useState<Show>(say('admin.all'));
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
        label: say('admin.access'),
        name: say('admin.access-to-the-space', { name: space.name }),
        icon: say('admin.access'),
        onSelect: () => setAccess(space),
      });
    }
    if (mayChange) {
      const rename = () => setAct({ kind: 'rename', space });
      // Restore and Rename take turns in one place, so the focus stays as one becomes the other.
      if (space.archived) {
        shown.push({
          label: say('admin.restore'),
          name: say('admin.restore-2', { name: space.name }),
          icon: say('admin.restore'),
          slot: 'change',
          onSelect: () => setAct({ kind: 'restore', space }),
        });
        more.push({ label: say('admin.rename-2'), onSelect: rename });
      } else {
        shown.push({
          label: say('admin.rename-2'),
          name: say('admin.rename', { name: space.name }),
          icon: say('admin.rename-2'),
          slot: 'change',
          onSelect: rename,
        });
        more.push({
          label: say('admin.archive'),
          onSelect: () => setAct({ kind: 'archive', space }),
        });
      }
      // A legal hold on everything in it (AH-G), an environment administrator's as the rest is.
      more.push({
        label: say('admin.place-a-hold'),
        onSelect: () => setAct({ kind: 'hold', space }),
      });
    }
    return { shown, more };
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{say('admin.a-space-holds-components-and')}</p>
        {mayChange && (
          <button type="button" className="primary" onClick={() => setAct({ kind: 'new' })}>
            {say('admin.new-space')}
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
                  aria-label={say('admin.find-a-space')}
                  placeholder={say('admin.find-a-space')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div role="group" aria-label={say('admin.show')} className={styles['segments']}>
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
                  {`${shown.length} ${say('admin.spaces-2', { count: shown.length })}`}
                </p>
              </div>
              <div className={access === null ? undefined : styles['withPanel']}>
                <table aria-label={say('admin.spaces')} className={styles['table']}>
                  <colgroup>
                    <col />
                    <col className={styles['statusColumn']} />
                    <col className={styles['accessColumn']} />
                    <col className={styles['actionsColumn']} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{say('admin.name')}</th>
                      <th scope="col">{say('admin.status')}</th>
                      <th scope="col">{say('admin.your-access')}</th>
                      <th scope="col">
                        <span className={styles['hidden']}>{say('admin.actions')}</span>
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
                          {space.archived ? (
                            <Chip>{say('admin.archived')}</Chip>
                          ) : (
                            <Chip tone="ok">{say('admin.active')}</Chip>
                          )}
                        </td>
                        <td className={styles['muted']}>
                          {space.archived
                            ? ''
                            : space.mayCreate
                              ? say('admin.may-create')
                              : say('admin.reads-only')}
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
                    heading={say('admin.access-to', { name: access.name })}
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
