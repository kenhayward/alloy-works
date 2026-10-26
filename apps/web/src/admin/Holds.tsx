import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { HoldDialog, releaseHold } from '../lifecycle/Hold.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { formats, words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Person {
  readonly id: string;
  readonly name: string | null;
}

/** A hold as Legal holds lists it (lifecycle.md). */
export interface HoldRow {
  readonly id: string;
  readonly target: { readonly kind: string; readonly id: string; readonly title: string | null };
  readonly reason: string;
  readonly appliedBy: Person;
  readonly appliedAt: string;
  readonly released: { readonly reason: string; readonly by: Person; readonly at: string } | null;
}

const KINDS: Readonly<Record<string, string>> = {
  get component() {
    return say('admin.component');
  },
  get document() {
    return say('admin.document');
  },
  get publication() {
    return say('admin.publication');
  },
  get asset() {
    return say('admin.asset');
  },
  get space() {
    return say('admin.space');
  },
};

const when = (at: string) =>
  formats().date(new Date(at), { day: 'numeric', month: 'short', year: 'numeric' });

const titleOf = (hold: HoldRow) =>
  hold.target.title ?? say('admin.the', { kind: hold.target.kind });
const named = (person: Person) => person.name ?? say('admin.somebody');

/**
 * Administration's Legal holds (the AH plan, AH-G): every hold, newest first, with what it holds, who
 * placed it, when and why, and its release; **Release** on one in force, which asks why. The one place
 * a hold's reason is shown. Placed from a component's or a document's page, or a space's row.
 */
export function Holds({ client }: { client: Client }) {
  const [load] = useState(
    () => () =>
      everyPage<HoldRow>((cursor) =>
        client.GET('/v1/holds', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      ),
  );
  const [generation, setGeneration] = useState(0);
  const read = useListing<HoldRow>(load, true, generation);
  const [releasing, setReleasing] = useState<HoldRow | null>(null);
  const [said, setSaid] = useState('');

  return (
    <>
      <div className={styles['lead']}>
        <p>{say('admin.a-legal-hold-keeps-a')}</p>
      </div>
      <Shown read={read} failed={say('admin.the-legal-holds-could-not-be')}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{say('admin.nothing-is-on-hold')}</p>
          ) : (
            <table aria-label={say('admin.legal-holds')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{say('admin.held')}</th>
                  <th scope="col">{say('admin.reason')}</th>
                  <th scope="col">{say('admin.placed')}</th>
                  <th scope="col">{say('admin.status')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{say('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((hold) => (
                  <tr key={hold.id} data-archived={hold.released ? 'true' : undefined}>
                    <td>
                      <span
                        className={styles['strong']}
                        {...(hold.target.title === null ? {} : { 'data-content': '' })}
                      >
                        {titleOf(hold)}
                      </span>
                      <br />
                      <span className={styles['muted']}>{KINDS[hold.target.kind]}</span>
                    </td>
                    <td data-content>{hold.reason}</td>
                    <td>
                      <span {...(hold.appliedBy.name === null ? {} : { 'data-content': '' })}>
                        {named(hold.appliedBy)}
                      </span>
                      <br />
                      <span className={styles['muted']}>{when(hold.appliedAt)}</span>
                    </td>
                    <td>
                      {hold.released === null ? (
                        <Chip>{say('admin.in-force')}</Chip>
                      ) : (
                        <>
                          <Chip>{say('admin.released')}</Chip>
                          <br />
                          <span className={styles['muted']}>
                            {say('admin.released-by-at', {
                              by: named(hold.released.by),
                              at: when(hold.released.at),
                              reason: hold.released.reason,
                            })}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      {hold.released === null && (
                        <button
                          type="button"
                          aria-label={say('admin.release-the-hold-on', { title: titleOf(hold) })}
                          onClick={() => setReleasing(hold)}
                        >
                          {say('admin.release')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Shown>
      <p role="status">{said}</p>
      {releasing !== null && (
        <HoldDialog
          heading={say('admin.release-the-hold-on', { title: titleOf(releasing) })}
          explained={say('admin.it-is-no-longer-held')}
          submit={say('admin.release-hold')}
          act={(reason) => releaseHold(client, releasing.id, titleOf(releasing), reason)}
          onClose={() => setReleasing(null)}
          onDone={(words) => {
            setReleasing(null);
            setSaid(words);
            setGeneration((count) => count + 1);
          }}
        />
      )}
    </>
  );
}
