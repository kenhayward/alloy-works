import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

/** A report of what came from a model, as the service answers it (GEN-026; the G3 plan, G3-C, G3-D). */
interface Report {
  readonly placements: readonly {
    readonly node: string;
    readonly number: string;
    readonly restoredFrom: string | null;
    readonly items: readonly {
      readonly kind: 'suggestion' | 'proposal' | 'creation';
      readonly id: string;
      readonly state: 'accepted' | 'open' | 'rejected' | 'withdrawn' | 'discarded';
      readonly askedBy: { readonly name: string | null } | null;
      readonly actedBy: { readonly name: string | null } | null;
      readonly actedAt: string | null;
      readonly acceptedInto: { readonly number: string; readonly inPlaced: boolean } | null;
      readonly run: { readonly model: string | null; readonly endpoint: string };
    }[];
  }[];
  readonly unreadable: number;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const who = (person: { readonly name: string | null } | null) => person?.name ?? 'somebody';

/** One generated item, said in a sentence. */
function sentence(item: Report['placements'][number]['items'][number]): string {
  const by = `Asked of ${item.run.model ?? 'a model'} on ${item.run.endpoint} by ${who(item.askedBy)}.`;
  const on = item.actedAt === null ? '' : ` on ${day.format(new Date(item.actedAt))}`;
  // A part a model wrote whole, made as the person accepted it (G5-E).
  if (item.kind === 'creation') {
    return `Made by ${who(item.actedBy)}${on} from a proposal to make it, as ${item.acceptedInto?.number ?? 'its first version'}. ${by}`;
  }
  switch (item.state) {
    case 'accepted':
      return `Accepted by ${who(item.actedBy)}${on} into ${item.acceptedInto?.number ?? 'a version'}${
        item.acceptedInto?.inPlaced === false ? ', a version this does not hold' : ''
      }. ${by}`;
    case 'open':
      return `Waiting to be accepted or rejected in Review. ${by}`;
    case 'rejected':
      return `Rejected by ${who(item.actedBy)}${on}. ${by}`;
    case 'withdrawn':
      return `Withdrawn by ${who(item.actedBy)}${on}. ${by}`;
    case 'discarded':
      return `Discarded by ${who(item.actedBy)}${on} before it was suggested. ${by}`;
  }
}

/**
 * **Generated content** (GEN-026; the G3 plan, G3-C, G3-D): for a document at its latest version, or a
 * publication as it recorded it, each part with content a model made, and what became of each piece.
 */
export function GeneratedContent({
  client,
  of,
  placeOf = () => 'A part',
}: {
  client: Client;
  of: { readonly document: string } | { readonly publication: string };
  placeOf?: (node: string) => string;
}) {
  const [report, setReport] = useState<Report | 'failed' | 'none' | null>(null);
  const document = 'document' in of ? of.document : null;
  const publication = 'publication' in of ? of.publication : null;
  useEffect(() => {
    let current = true;
    // Another document's or publication's report is never shown while this one is read.
    setReport(null);
    const asked =
      document !== null
        ? client.GET('/v1/documents/{id}/generated', { params: { path: { id: document } } })
        : client.GET('/v1/publications/{id}/generated', {
            params: { path: { id: publication! } },
          });
    asked
      .then(({ data, response }) => {
        if (!current) return;
        // Nothing to say where there is nothing to read; a report only where it is a report's shape.
        if (response.status === 404) setReport('none');
        else if (data && Array.isArray((data as { placements?: unknown }).placements)) {
          setReport(data as Report);
        } else setReport('failed');
      })
      .catch(() => {
        if (current) setReport('failed');
      });
    return () => {
      current = false;
    };
  }, [client, document, publication]);

  // A report that cannot be read is left out: a publish still says by name what waits on it.
  if (report === null || report === 'none' || report === 'failed') return null;
  const heading = document !== null ? 'Generated content' : 'Generated content it printed';
  return (
    <section aria-label={heading}>
      <h4>{heading}</h4>
      {report.placements.length === 0 ? (
        <p>Nothing here came from a model.</p>
      ) : (
        <ul>
          {report.placements.map((placement) => (
            <li key={placement.node}>
              {placeOf(placement.node)}, version {placement.number}
              {placement.restoredFrom !== null && `, restored from ${placement.restoredFrom}`}
              <ul>
                {placement.items.map((item) => (
                  <li key={item.id}>{sentence(item)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {report.unreadable > 0 && (
        <p>
          {report.unreadable === 1
            ? 'One part you may not read is not shown.'
            : `${report.unreadable} parts you may not read are not shown.`}
        </p>
      )}
    </section>
  );
}
