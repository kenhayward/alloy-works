import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { followInFrame } from '../publishing/Preview.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

/** An export as Export lists it (API-044; the R21 plan, R21-B). */
interface ExportRow {
  readonly id: string;
  readonly state: 'queued' | 'done' | 'failed' | 'expired';
  readonly requestedAt: string;
  readonly expiresAt: string | null;
  readonly bytes: number | null;
}

const STATES: Readonly<Record<ExportRow['state'], string>> = {
  queued: 'Being written',
  done: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
};

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** A size in words: KB and MB of 1,024, to one place. */
function sizeOf(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Administration's Export (API-044; the R21 plan, R21-B): **Export everything** asks for an export of
 * the whole environment, written by a job; the past ones are listed, the newest first, each kept seven
 * days with **Download** while it is. Asking for one and each download are recorded in the audit log.
 */
export function TenantExport({
  client,
  followMs = 2000,
  follow = followInFrame,
}: {
  client: Client;
  /** How often an export being written is asked after: given in tests, which need not wait. */
  followMs?: number;
  /** Follows a download's link: given in tests. */
  follow?: (link: string) => void;
}) {
  const [load] = useState(
    () => () =>
      everyPage<ExportRow>((cursor) =>
        client.GET('/v1/exports', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      ),
  );
  const [generation, setGeneration] = useState(0);
  const read = useListing<ExportRow>(load, true, generation);
  const [said, setSaid] = useState('');
  const [asking, setAsking] = useState(false);

  // While one is being written, the list is read again until it is not.
  const writing =
    typeof read === 'object' && read !== null && read.rows.some((each) => each.state === 'queued');
  useEffect(() => {
    if (!writing) return undefined;
    const timer = setTimeout(() => setGeneration((was) => was + 1), followMs);
    return () => clearTimeout(timer);
  }, [writing, generation, followMs]);

  const exportAll = async () => {
    setAsking(true);
    setSaid('');
    try {
      const { data } = await client.POST('/v1/exports');
      setSaid(
        data
          ? 'Export asked for. It is listed below while it is written.'
          : 'The export could not be asked for.',
      );
      setGeneration((was) => was + 1);
    } catch {
      setSaid('The export could not be asked for.');
    } finally {
      setAsking(false);
    }
  };

  const download = async (id: string) => {
    setSaid('');
    try {
      const { data } = await client.GET('/v1/exports/{id}/download', {
        params: { path: { id } },
      });
      // Only a link the service signed, to the store, over the web.
      if (data && /^https?:\/\//.test(data.download)) follow(data.download);
      else setSaid('The export could not be downloaded.');
    } catch {
      setSaid('The export could not be downloaded.');
    }
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>
          An export holds everything in this environment as it stands when it is asked for: every
          component, document, template and definition with all their versions, relationships,
          baselines and publications, and the images and PDFs they hold. Its manifest says what it
          leaves out, such as people, credentials and the audit log. Each export is kept seven days.
        </p>
        <button type="button" disabled={asking} onClick={() => void exportAll()}>
          Export everything
        </button>
      </div>
      <Shown read={read} failed="The exports could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>Nothing has been exported yet.</p>
          ) : (
            <table aria-label="Exports" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Asked for</th>
                  <th scope="col">Status</th>
                  <th scope="col">Size</th>
                  <th scope="col">Kept until</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const asked = when.format(new Date(row.requestedAt));
                  return (
                    <tr key={row.id} data-archived={row.state === 'expired' ? 'true' : undefined}>
                      <td>{asked}</td>
                      <td>
                        <Chip>{STATES[row.state]}</Chip>
                      </td>
                      <td>{sizeOf(row.bytes)}</td>
                      <td>{row.expiresAt === null ? '' : when.format(new Date(row.expiresAt))}</td>
                      <td>
                        {row.state === 'done' && (
                          <button
                            type="button"
                            aria-label={`Download the export asked for ${asked}`}
                            onClick={() => void download(row.id)}
                          >
                            Download
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </Shown>
      <p role="status">{said}</p>
    </>
  );
}
