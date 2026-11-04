/**
 * A revision as `revisionStanding` reads it: when it was designated, the date set on it if any, and
 * each scope's acceptance: null while it waits on its party, and the designation where none was named.
 */
export interface TimedRevision {
  readonly number: number;
  readonly designatedAt: Date;
  readonly effectiveAt: Date | null;
  readonly scopes: readonly {
    readonly axis: string;
    readonly value: string;
    readonly acceptedAt: Date | null;
  }[];
}

/** Where a revision stands now: computed when read, never stored (LIF-048; the LS and VP plan, D1). */
export type RevisionStanding =
  | { readonly standing: 'pending' }
  | {
      readonly standing: 'effective';
      /** The values it holds; none where it is unscoped, so wherever no scoped revision holds. */
      readonly scopes: readonly { readonly axis: string; readonly value: string }[];
    }
  | { readonly standing: 'superseded'; readonly by: number }
  | { readonly standing: 'neverInForce' };

const UNSCOPED = '';
const placeOf = (axis: string, value: string) => `${axis}:${value}`;
const latest = (...dates: readonly Date[]) =>
  new Date(Math.max(...dates.map((each) => each.getTime())));

/** Each place a revision can hold and when it begins there; null while it waits on acceptance. */
function beginnings(revision: TimedRevision): ReadonlyMap<string, Date | null> {
  const from = (accepted: Date) =>
    latest(accepted, revision.designatedAt, revision.effectiveAt ?? accepted);
  return revision.scopes.length === 0
    ? new Map([[UNSCOPED, from(revision.designatedAt)]])
    : new Map(
        revision.scopes.map((scope) => [
          placeOf(scope.axis, scope.value),
          scope.acceptedAt === null ? null : from(scope.acceptedAt),
        ]),
      );
}

/**
 * Where each of one line's revisions stands at `now`, by number. `effectiveRevision`'s rule read over
 * time: in each place the newest revision begun there holds, and an unscoped revision never displaces
 * a scoped one, nor the reverse. So a revision is **effective** where it holds now, **superseded** where
 * it held and now holds nowhere, **pending** where it may yet hold, and **never in force** where newer
 * ones have already taken every place it could.
 */
export function revisionStanding(
  revisions: readonly TimedRevision[],
  now: Date,
): ReadonlyMap<number, RevisionStanding> {
  const all = revisions.map((revision) => ({ revision, begins: beginnings(revision) }));
  const standing = ({ revision, begins }: (typeof all)[number]): RevisionStanding => {
    const holds = new Set<string>();
    const displacedBy: number[] = [];
    let mayYetHold = false;
    for (const [place, begun] of begins) {
      const newer = all.flatMap((other) => {
        const at = other.revision.number > revision.number ? other.begins.get(place) : undefined;
        return at === undefined || at === null ? [] : [{ number: other.revision.number, at }];
      });
      if (begun !== null && begun <= now) {
        const inForce = newer.filter((other) => other.at <= now);
        if (inForce.length === 0) {
          holds.add(place);
          continue;
        }
        const next = inForce.reduce((first, other) => (other.at < first.at ? other : first));
        if (begun < next.at) displacedBy.push(next.number);
      } else {
        // The soonest it can begin: its date, or now for an acceptance that could come at any moment.
        const soonest = begun ?? latest(now, revision.effectiveAt ?? now);
        if (!newer.some((other) => other.at <= soonest)) mayYetHold = true;
      }
    }
    if (holds.size > 0) {
      return {
        standing: 'effective',
        scopes: revision.scopes
          .filter((scope) => holds.has(placeOf(scope.axis, scope.value)))
          .map(({ axis, value }) => ({ axis, value })),
      };
    }
    if (displacedBy.length > 0) return { standing: 'superseded', by: Math.max(...displacedBy) };
    return mayYetHold ? { standing: 'pending' } : { standing: 'neverInForce' };
  };
  return new Map(all.map((each) => [each.revision.number, standing(each)]));
}
