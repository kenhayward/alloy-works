import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';
import { formats, words } from '../words/words.js';

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

const day = (iso: string) =>
  formats().date(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });

const who = (person: { readonly name: string | null } | null) =>
  person?.name ?? words('publishing.somebody-in-sentence');

/** One generated item, said in a sentence. */
function sentence(item: Report['placements'][number]['items'][number]): string {
  const by = words('publishing.asked-of-on-by', {
    model: item.run.model ?? words('publishing.a-model'),
    endpoint: item.run.endpoint,
    who: who(item.askedBy),
  });
  const acted = {
    who: who(item.actedBy),
    acted: item.actedAt === null ? 'no' : 'yes',
    day: item.actedAt === null ? '' : day(item.actedAt),
    by,
  };
  // A part a model wrote whole, made as the person accepted it (G5-E).
  if (item.kind === 'creation') {
    return words('publishing.made-by-from-a-proposal', {
      ...acted,
      into: item.acceptedInto?.number ?? words('publishing.its-first-version'),
    });
  }
  switch (item.state) {
    case 'accepted':
      return words('publishing.accepted-by-into', {
        ...acted,
        into: item.acceptedInto?.number ?? words('publishing.a-version'),
        held: item.acceptedInto?.inPlaced === false ? 'no' : 'yes',
      });
    case 'open':
      return words('publishing.waiting-to-be-accepted-or', { by });
    case 'rejected':
      return words('publishing.rejected-by', acted);
    case 'withdrawn':
      return words('publishing.withdrawn-by', acted);
    case 'discarded':
      return words('publishing.discarded-by-before-it-was', acted);
  }
}

/**
 * **Generated content** (GEN-026; the G3 plan, G3-C, G3-D): for a document at its latest version, or a
 * publication as it recorded it, each part with content a model made, and what became of each piece.
 */
export function GeneratedContent({
  client,
  of,
  placeOf = () => words('publishing.a-part'),
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
  const heading =
    document !== null
      ? words('publishing.generated-content')
      : words('publishing.generated-content-it-printed');
  return (
    <section aria-label={heading}>
      <h4>{heading}</h4>
      {report.placements.length === 0 ? (
        <p>{words('publishing.nothing-here-came-from-a')}</p>
      ) : (
        <ul>
          {report.placements.map((placement) => (
            <li key={placement.node}>
              {placement.restoredFrom === null
                ? words('publishing.placed-version', {
                    place: placeOf(placement.node),
                    number: placement.number,
                  })
                : words('publishing.placed-version-restored', {
                    place: placeOf(placement.node),
                    number: placement.number,
                    restoredFrom: placement.restoredFrom,
                  })}
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
        <p>{words('publishing.parts-you-may-not-read', { count: report.unreadable })}</p>
      )}
    </section>
  );
}
