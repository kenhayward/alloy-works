import { sql } from 'kysely';
import { isLabelledKind, labelFor } from '@alloy-works/domain';
import { labelled, labels, recordEvent } from './audit.js';
import { shareDeletion } from './deletion.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/**
 * **Legal holds** (lifecycle.md; the AH plan, AH-E to AH-H): placed on an artifact or a space with who,
 * when and why, in force until released by an act with a reason of its own. Nothing deletes yet, so a
 * hold is recorded, listed and shown; DL makes it refuse deletion. Who may place and release one -
 * `administer` at the tenant - is the caller's to decide first. The reason is kept here alone: never
 * in the log (LIF-030), and shown only by `listHolds`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The kinds a hold may be placed on: content, and what was published of it (0084). */
export const HELD_KINDS = ['component', 'document', 'publication', 'asset'] as const;
export type HeldKind = (typeof HELD_KINDS)[number];

export type HoldTarget = { readonly artifact: string } | { readonly space: string };

const MAX_REASON = 2000;

/** The reason trimmed, or undefined where it is empty or too long. */
function reasonOf(given: string): string | undefined {
  const reason = given.trim();
  return reason === '' || reason.length > MAX_REASON ? undefined : reason;
}

export type HoldPlaceAnswer =
  | { readonly answer: 'placed'; readonly id: string }
  | { readonly answer: 'target.missing' | 'reason.invalid' };

/**
 * Places a hold (LIF-022): on an artifact of a kind a hold takes, or on a space, which holds every
 * artifact in it. Several may stand on one thing. Audited as `hold.applied` about what it holds.
 */
export async function placeHold(
  trx: TenantTransaction,
  input: { readonly target: HoldTarget; readonly reason: string; readonly by: string },
): Promise<HoldPlaceAnswer> {
  const reason = reasonOf(input.reason);
  if (reason === undefined) return { answer: 'reason.invalid' };
  // A deletion's dependant (DL-D): placed before a delete reads the holds, or after it.
  await shareDeletion(trx);
  const on = await targetOf(trx, input.target);
  if (!on) return { answer: 'target.missing' };
  const { id } = await trx
    .insertInto('legal_hold')
    .values({
      artifact_id: on.kind === 'space' ? null : on.id,
      kind: on.kind === 'space' ? null : on.kind,
      space_id: on.kind === 'space' ? on.id : null,
      reason,
      applied_by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordHoldEvent(trx, 'hold.applied', id, on);
  return { answer: 'placed', id };
}

export type HoldReleaseAnswer = {
  readonly answer: 'released' | 'hold.missing' | 'hold.released' | 'reason.invalid';
};

/**
 * Releases a hold (LIF-022), once, with a reason: a released or unknown hold is refused. Under the
 * hold's own lock, so two releases at once record one between them. Audited as `hold.removed`.
 */
export async function releaseHold(
  trx: TenantTransaction,
  input: { readonly hold: string; readonly reason: string; readonly by: string },
): Promise<HoldReleaseAnswer> {
  const reason = reasonOf(input.reason);
  if (reason === undefined) return { answer: 'reason.invalid' };
  if (!UUID.test(input.hold)) return { answer: 'hold.missing' };
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:hold:${input.hold}`}, 0))`.execute(
    trx,
  );
  const hold = await trx
    .selectFrom('legal_hold as h')
    .leftJoin('legal_hold_release as r', 'r.hold_id', 'h.id')
    .select(['h.artifact_id', 'h.kind', 'h.space_id', 'r.hold_id as released'])
    .where('h.id', '=', input.hold)
    .executeTakeFirst();
  if (!hold) return { answer: 'hold.missing' };
  if (hold.released !== null) return { answer: 'hold.released' };
  await trx
    .insertInto('legal_hold_release')
    .values({ hold_id: input.hold, reason, released_by: input.by })
    .execute();
  const on: Target =
    hold.space_id !== null
      ? { kind: 'space', id: hold.space_id }
      : { kind: hold.kind!, id: hold.artifact_id! };
  await recordHoldEvent(trx, 'hold.removed', input.hold, on);
  return { answer: 'released' };
}

type Target = { readonly kind: HeldKind | 'space'; readonly id: string };

async function targetOf(trx: TenantTransaction, target: HoldTarget): Promise<Target | undefined> {
  const id = 'artifact' in target ? target.artifact : target.space;
  if (!UUID.test(id)) return undefined;
  if ('space' in target) {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return space && { kind: 'space', id };
  }
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', id)
    .executeTakeFirst();
  const kind = HELD_KINDS.find((each) => each === artifact?.kind);
  return kind && { kind, id };
}

/** An act on a hold, about what it holds: its id alone, never its reason (LIF-030). */
async function recordHoldEvent(
  trx: TenantTransaction,
  kind: 'hold.applied' | 'hold.removed',
  hold: string,
  on: Target,
): Promise<void> {
  if (on.kind === 'space') {
    const space = await trx
      .selectFrom('space')
      .select('name')
      .where('id', '=', on.id)
      .executeTakeFirstOrThrow();
    await recordEvent(
      trx,
      { kind, subject: { kind: 'space', id: on.id }, space: on.id, detail: { hold } },
      [{ role: 'subject', text: space.name, refersTo: on.id }],
    );
    return;
  }
  const place = await heldPlace(trx, on.kind, on.id);
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: on.kind, id: on.id, version: place.version },
      space: place.space,
      detail: { hold },
    },
    labels(
      labelled('subject', place.title, on.id),
      labelled('space', place.spaceName, place.space),
    ),
  );
}

interface HeldPlace {
  readonly version: string | null;
  readonly title: string | null;
  readonly space: string | null;
  readonly spaceName: string | null;
}

/**
 * Where a held artifact is and what it is called now. A publication has no versions: its document's
 * title at the version it published, as publications are listed. An asset has no name: its
 * alternative text, as search finds it.
 */
async function heldPlace(trx: TenantTransaction, kind: HeldKind, id: string): Promise<HeldPlace> {
  if (kind === 'publication') {
    const row = await trx
      .selectFrom('publication as p')
      .innerJoin('artifact as a', 'a.id', 'p.id')
      .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
      .leftJoin('space as s', 's.id', 'a.space_id')
      .select([sql<string | null>`v.content ->> 'title'`.as('title'), 'a.space_id', 's.name'])
      .where('p.id', '=', id)
      .executeTakeFirst();
    return {
      version: null,
      title: row?.title ?? null,
      space: row?.space_id ?? null,
      spaceName: row?.name ?? null,
    };
  }
  const row = await trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select(['v.id', 'v.kind', 'v.content', 'a.space_id', 's.name'])
    .where('v.artifact_id', '=', id)
    .orderBy('v.revision_no', 'desc')
    .orderBy('v.version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return { version: null, title: null, space: null, spaceName: null };
  const content = row.content as Record<string, unknown>;
  const alternative = content.alternative as { readonly text?: unknown } | null | undefined;
  const title =
    kind === 'asset'
      ? typeof alternative?.text === 'string'
        ? alternative.text
        : undefined
      : isLabelledKind(row.kind)
        ? labelFor(row.kind, content)
        : undefined;
  return { version: row.id, title: title ?? null, space: row.space_id, spaceName: row.name };
}

/** Whether an artifact is held now: by a hold of its own, or its space's, not released (AH-F). */
export async function isHeld(trx: TenantTransaction, artifactId: string): Promise<boolean> {
  if (!UUID.test(artifactId)) return false;
  const { rows } = await sql<{ held: boolean }>`
    select exists (
      select from legal_hold h
      where not exists (select from legal_hold_release r where r.hold_id = h.id)
        and (h.artifact_id = ${artifactId}
          or h.space_id = (select a.space_id from artifact a where a.id = ${artifactId}))
    ) as held`.execute(trx);
  return rows[0]?.held === true;
}

interface Person {
  readonly id: string;
  readonly name: string | null;
}

/** A hold as Administration lists it, its reason and its release's with it. */
export interface ListedHold {
  readonly id: string;
  readonly target: {
    readonly kind: HeldKind | 'space';
    readonly id: string;
    /** Its title or name now; null where it has none. */
    readonly title: string | null;
  };
  readonly reason: string;
  readonly appliedBy: Person;
  readonly appliedAt: Date;
  readonly released: {
    readonly reason: string;
    readonly by: Person;
    readonly at: Date;
  } | null;
}

/** The holds with what each needs to be listed. */
function holdRows(trx: TenantTransaction) {
  return trx
    .selectFrom('legal_hold as h')
    .innerJoin('principal as p', 'p.id', 'h.applied_by')
    .leftJoin('legal_hold_release as r', 'r.hold_id', 'h.id')
    .leftJoin('principal as q', 'q.id', 'r.released_by')
    .leftJoin('space as s', 's.id', 'h.space_id')
    .select([
      'h.id',
      'h.artifact_id',
      'h.kind',
      'h.space_id',
      's.name as space_name',
      'h.reason',
      'h.applied_by',
      sql<string | null>`coalesce(p.display_name, p.email)`.as('applied_by_name'),
      'h.applied_at',
      'r.reason as released_reason',
      'r.released_by',
      sql<string | null>`coalesce(q.display_name, q.email)`.as('released_by_name'),
      'r.released_at',
    ]);
}

type HoldRow = Awaited<ReturnType<ReturnType<typeof holdRows>['execute']>>[number];

async function listed(trx: TenantTransaction, row: HoldRow): Promise<ListedHold> {
  const title =
    row.space_id !== null
      ? row.space_name
      : (await heldPlace(trx, row.kind!, row.artifact_id!)).title;
  return {
    id: row.id,
    target:
      row.space_id !== null
        ? { kind: 'space', id: row.space_id, title }
        : { kind: row.kind!, id: row.artifact_id!, title },
    reason: row.reason,
    appliedBy: { id: row.applied_by, name: row.applied_by_name },
    appliedAt: row.applied_at,
    released:
      row.released_by === null
        ? null
        : {
            reason: row.released_reason!,
            by: { id: row.released_by, name: row.released_by_name },
            at: row.released_at!,
          },
  };
}

/**
 * Every hold in the tenant, released or not, newest first, a page at a time: the cursor is the id the
 * last page ended at, and a hold's time never changes, so a walk pages as begun.
 */
export async function listHolds(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<ListedHold>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await holdRows(trx)
    .$if(page.after !== undefined, (query) =>
      query.where(
        sql<boolean>`(h.applied_at, h.id) < (select applied_at, id from legal_hold
          where id = ${page.after!})`,
      ),
    )
    .orderBy('h.applied_at', 'desc')
    .orderBy('h.id', 'desc')
    .limit(page.limit + 1)
    .execute();
  const { items, after } = paged(rows, page.limit);
  const each: ListedHold[] = [];
  for (const row of items) each.push(await listed(trx, row));
  return { items: each, after };
}

/** One hold as `listHolds` lists it, or undefined where the tenant holds none by that id. */
export async function readHold(
  trx: TenantTransaction,
  id: string,
): Promise<ListedHold | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await holdRows(trx).where('h.id', '=', id).executeTakeFirst();
  return row && listed(trx, row);
}

/** How many holds `listHolds` lists. */
export async function countHolds(trx: TenantTransaction): Promise<number> {
  const row = await trx
    .selectFrom('legal_hold')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
