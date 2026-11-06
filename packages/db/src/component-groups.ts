import {
  COMPONENT_GROUP_SCHEMA_VERSION,
  decide,
  groupPlacements,
  parseComponentGroup,
  placeGroup,
  readOutline,
  removeGroup,
  takeGroupVersion,
  type ComponentGroup,
  type GroupChange,
  type GroupMember,
  type OutlineDocument,
  type PlacedGroupVersion,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { isArchived } from './archival.js';
import { deletionStored, isDeleted, notDeletedAs } from './deletion.js';
import {
  mayReference,
  newNodeIdentifier,
  readableComponents,
  recordRepoints,
  REFERENCE_REFUSED,
  type OutlineAnswer,
} from './documents.js';
import {
  checkedLimit,
  countOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';
import { latestRevision, latestRevisionsOf, workflowStates } from './workflow.js';

/**
 * Component groups (the CG plan, CG-A to CG-K; REU-060 to REU-063): an authored artifact in one space,
 * each version a title and its members pinned, moving under the component workflow; placed in a
 * document as a run of ordinary references, and taken there at another version. Who may make, change
 * or place one is the route's to decide; each member is checked here, on every path a version is cut.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A member as a caller names it: its version, else the component's latest at the time. */
export interface MemberInput {
  readonly component: string;
  readonly version?: string | undefined;
}

/** A group at its latest version. */
export interface StoredComponentGroup {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly group: ComponentGroup;
  readonly archived: boolean;
}

async function stored(
  trx: TenantTransaction,
  version: StoredVersion,
): Promise<StoredComponentGroup> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  return {
    id: version.artifactId,
    space,
    version,
    group: parseComponentGroup(version.content),
    archived: await isArchived(trx, version.artifactId),
  };
}

/** A group at its latest version, or undefined where this tenant holds none by that id. */
export async function readComponentGroup(
  trx: TenantTransaction,
  id: string,
): Promise<StoredComponentGroup | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'componentGroup' || (await isDeleted(trx, id))) return undefined;
  return stored(trx, version);
}

export type ComponentGroupAnswer =
  | {
      readonly answer: 'created' | 'recorded' | 'version.unchanged';
      readonly group: StoredComponentGroup;
    }
  | { readonly answer: 'version.precondition'; readonly current: StoredComponentGroup }
  /** A member that is no component `author` may read, deleted, or a version not its own (CG-C). */
  | { readonly answer: 'member.invalid'; readonly index: number }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'group.missing' };

/**
 * Each member named made a pin (CG-B): its version, or its component's latest where none is named,
 * each a component (never a group: CG-C) `author` may read and not deleted, at a version of its own
 * that no language line holds. The first that is not, by its place in the list.
 */
async function pinnedMembers(
  trx: TenantTransaction,
  author: string,
  members: readonly MemberInput[],
): Promise<GroupMember[] | { readonly index: number }> {
  const pinned: GroupMember[] = [];
  for (const [index, member] of members.entries()) {
    if (!UUID.test(member.component)) return { index };
    const version = member.version ?? (await latestVersion(trx, member.component))?.id;
    if (version === undefined) return { index };
    if ((await mayReference(trx, author, { component: member.component, version })) !== 'ok') {
      return { index };
    }
    pinned.push({ component: member.component, version });
  }
  return pinned;
}

const contentOf = (title: string, members: readonly GroupMember[]): ComponentGroup =>
  parseComponentGroup({ schemaVersion: COMPONENT_GROUP_SCHEMA_VERSION, title, members });

/** Makes a group at 0.1 in a space, in the component workflow's initial state (CG-A). */
export async function createComponentGroup(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly title: string;
    readonly members: readonly MemberInput[];
  },
): Promise<ComponentGroupAnswer> {
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  const members = await pinnedMembers(trx, input.author, input.members);
  if (!Array.isArray(members)) return { answer: 'member.invalid', index: members.index };
  const version = await createArtifact(trx, {
    spaceId: input.spaceId,
    author: input.author,
    substance: { kind: 'componentGroup', content: contentOf(input.title, members) },
  });
  return { answer: 'created', group: await stored(trx, version) };
}

/** Cuts a group's next version from the one its author opened (CG-K). */
export async function recordComponentGroupVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly title: string;
    readonly members: readonly MemberInput[];
  },
): Promise<ComponentGroupAnswer> {
  if (!(await readComponentGroup(trx, input.id))) return { answer: 'group.missing' };
  const members = await pinnedMembers(trx, input.author, input.members);
  if (!Array.isArray(members)) return { answer: 'member.invalid', index: members.index };
  const answer = await recordVersion(trx, {
    artifactId: input.id,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'componentGroup', content: contentOf(input.title, members) },
  });
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', group: await stored(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', group: await stored(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'group.missing' };
  }
}

/** One member as a group's page shows it (CG-K). */
export interface MemberView {
  readonly component: { readonly id: string; readonly title: string } | null;
  readonly version: { readonly id: string; readonly number: string };
  /** Its component's latest version, where newer than the one pinned; null where not, or unreadable. */
  readonly newest: { readonly id: string; readonly number: string } | null;
}

const numberOf = (version: { readonly revision: number; readonly version: number }) =>
  `${version.revision}.${version.version}`;

/** A group's members as `principal` is shown them: an unreadable one's component withheld. */
export async function memberViews(
  trx: TenantTransaction,
  principal: string,
  group: ComponentGroup,
): Promise<MemberView[]> {
  const readable = await readableComponents(
    trx,
    principal,
    group.members.map((each) => each.component),
  );
  const views: MemberView[] = [];
  for (const member of group.members) {
    const pinned = await readVersion(trx, member.version);
    const version = { id: member.version, number: pinned ? numberOf(pinned) : '' };
    if (!readable.has(member.component)) {
      views.push({ component: null, version, newest: null });
      continue;
    }
    const latest = await latestVersion(trx, member.component);
    const title = (latest?.content as { readonly title?: unknown } | undefined)?.title;
    views.push({
      component: { id: member.component, title: typeof title === 'string' ? title : '' },
      version,
      newest:
        latest && latest.id !== member.version ? { id: latest.id, number: numberOf(latest) } : null,
    });
  }
  return views;
}

/** One group as a listing shows it. */
export interface ComponentGroupSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  readonly members: number;
  readonly changedAt: Date;
  readonly state: {
    readonly key: string;
    readonly name: string;
    readonly approved: boolean;
  } | null;
}

/**
 * The groups a principal may read, in one space or every one, a page at a time by keyset over their
 * title and then the id, as of the snapshot the walk's first page took (CG-D): deleted ones left out.
 * Undefined when the tenant holds no such principal.
 */
export async function listComponentGroups(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'componentGroups'>> = { limit: 100 },
  filter: { readonly space?: string } = {},
): Promise<(Listed<ComponentGroupSummary> & { readonly total: number }) | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'title';
  const { types, order: byDefault } = listingSorts.componentGroups[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const deletion = await deletionStored(trx);
  const base = () =>
    trx
      .selectFrom('artifact as a')
      .innerJoin('space as s', 's.id', 'a.space_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select(['v.id as version_id', 'v.revision_no', 'v.version_no', 'v.created_at'])
            .select('v.content')
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 'latest.content', 's.id as space_id', 's.name as space_name'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sql`lower(latest.content ->> 'title')`]))
      .where('a.kind', '=', 'componentGroup')
      .$if(filter.space !== undefined, (query) => query.where('a.space_id', '=', filter.space!))
      .where((eb) => readableArtifacts(eb, readable))
      .$if(deletion, (query) => query.where(notDeletedAs('a')));
  const { rows, next } = await keysetPage<{
    id: string;
    content: unknown;
    space_id: string;
    space_name: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after, request.language);
  const states = await workflowStates(
    trx,
    rows.map((row) => row.id),
  );
  return {
    items: rows.map((row) => {
      const group = parseComponentGroup(row.content);
      return {
        id: row.id,
        title: group.title,
        space: { id: row.space_id, name: row.space_name },
        version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
        members: group.members.length,
        changedAt: new Date(row.created_at),
        state: states.get(row.id) ?? null,
      };
    }),
    next,
    snapshot,
    total: await countOf(trx, base()),
  };
}

/** A group's version as `by` may place it: readable, not deleted, and one of its own versions. */
async function placeable(
  trx: TenantTransaction,
  by: string,
  groupId: string,
  versionId: string | undefined,
): Promise<
  | { readonly answer: 'found'; readonly group: PlacedGroupVersion; readonly title: string }
  | { readonly answer: 'group.missing' | 'group.unapproved' | 'version.invalid' }
> {
  if (!UUID.test(groupId)) return { answer: 'group.missing' };
  const facts = await loadFacts(trx, by, { kind: 'artifact', id: groupId });
  if (!facts || !decide('read', facts).allowed || !(await readComponentGroup(trx, groupId))) {
    return { answer: 'group.missing' };
  }
  let chosen = versionId;
  if (chosen === undefined) {
    chosen = (await latestRevision(trx, groupId))?.versionId;
    if (chosen === undefined) return { answer: 'group.unapproved' };
  }
  const version = UUID.test(chosen) ? await readVersion(trx, chosen) : undefined;
  if (!version || version.artifactId !== groupId) return { answer: 'version.invalid' };
  const group = parseComponentGroup(version.content);
  return {
    answer: 'found',
    group: { id: groupId, version: version.id, members: group.members },
    title: group.title,
  };
}

export type GroupActAnswer =
  | OutlineAnswer
  | { readonly answer: 'group.missing' | 'group.unapproved' | 'version.invalid' }
  | { readonly answer: 'placement.missing' };

/** The opened document version's outline, or why there is none to act on. */
async function openedOutline(
  trx: TenantTransaction,
  documentId: string,
  openedFrom: string,
): Promise<{ readonly version: StoredVersion; readonly outline: OutlineDocument } | undefined> {
  const opened = UUID.test(openedFrom) ? await readVersion(trx, openedFrom) : undefined;
  if (!opened || opened.artifactId !== documentId || opened.kind !== 'document') return undefined;
  const read = readOutline(opened.content, { artifact: documentId, version: opened.id });
  if (!read.ok) {
    throw new Error(`The document ${documentId} at ${opened.id} does not read: ${read.failure}`);
  }
  return { version: opened, outline: read.outline };
}

/** Every member one `author` may reference at its pin, else the one refusal a reference gets. */
async function membersReferenced(
  trx: TenantTransaction,
  author: string,
  group: PlacedGroupVersion,
): Promise<boolean> {
  for (const member of group.members) {
    const answer = await mayReference(trx, author, member);
    if (answer !== 'ok') return false;
  }
  return true;
}

function next(
  trx: TenantTransaction,
  documentId: string,
  openedFrom: string,
  author: string,
  opened: StoredVersion,
  outline: OutlineDocument,
) {
  return recordVersion(trx, {
    artifactId: documentId,
    openedFrom,
    author,
    substance: {
      kind: 'document',
      content: outline,
      values: opened.values,
      parameters: opened.parameters,
    },
  });
}

/**
 * A group placed in a document (CG-F; REU-061): its version, else its latest approved one, as one
 * reference per member pinned as it pins them, under `parent` at `position`; the document's next
 * version. Each member is one `author` may reference, as an inserted reference is.
 */
export async function placeComponentGroup(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly group: string;
    readonly version?: string | undefined;
    readonly parent: string | null;
    readonly position: number;
  },
): Promise<GroupActAnswer> {
  const found = await placeable(trx, input.author, input.group, input.version);
  if (found.answer !== 'found') return found;
  const opened = await openedOutline(trx, input.documentId, input.openedFrom);
  if (!opened) return { answer: 'artifact.missing' };
  if (!(await membersReferenced(trx, input.author, found.group))) {
    return { answer: 'outline.invalid', reason: REFERENCE_REFUSED };
  }
  const applied = placeGroup(
    opened.outline,
    { parent: input.parent, position: input.position, group: found.group },
    newNodeIdentifier,
  );
  if (!applied.applied) return { answer: 'outline.invalid', reason: applied.reason };
  return next(
    trx,
    input.documentId,
    input.openedFrom,
    input.author,
    opened.version,
    applied.outline,
  );
}

/** Each component by its id, titled at its latest version, for what a take says (CG-I). */
async function titled(
  trx: TenantTransaction,
  principal: string,
  components: readonly string[],
): Promise<{ readonly id: string; readonly title: string }[]> {
  const readable = await readableComponents(trx, principal, components);
  const said: { id: string; title: string }[] = [];
  for (const id of components) {
    if (!readable.has(id)) {
      said.push({ id, title: '' });
      continue;
    }
    const title = ((await latestVersion(trx, id))?.content as { title?: unknown } | undefined)
      ?.title;
    said.push({ id, title: typeof title === 'string' ? title : '' });
  }
  return said;
}

export interface GroupTakePreview {
  readonly added: readonly { readonly id: string; readonly title: string }[];
  readonly removed: readonly { readonly id: string; readonly title: string }[];
  readonly kept: number;
  readonly overridesDropped: number;
}

/**
 * What taking another version of a placed group would change in the document's latest version (CG-I;
 * REU-062), said first and nothing recorded: added and dropped members, by title where `by` may read
 * them, how many are kept, and the overrides that go with the dropped.
 */
export async function previewGroupTake(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly by: string;
    readonly placement: string;
    readonly version: string;
  },
): Promise<
  | { readonly answer: 'preview'; readonly preview: GroupTakePreview }
  | { readonly answer: 'artifact.missing' | 'placement.missing' }
  | { readonly answer: 'group.missing' | 'group.unapproved' | 'version.invalid' }
> {
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document') return { answer: 'artifact.missing' };
  const read = readOutline(latest.content, { artifact: input.documentId, version: latest.id });
  if (!read.ok) return { answer: 'artifact.missing' };
  const run = groupPlacements(read.outline).find((each) => each.placement === input.placement);
  if (!run) return { answer: 'placement.missing' };
  const found = await placeable(trx, input.by, run.group, input.version);
  if (found.answer !== 'found') return found;
  const taken = takeGroupVersion(read.outline, input.placement, found.group, newNodeIdentifier);
  if (!taken.applied) return { answer: 'placement.missing' };
  return { answer: 'preview', preview: await said(trx, input.by, taken.change) };
}

async function said(
  trx: TenantTransaction,
  by: string,
  change: GroupChange,
): Promise<GroupTakePreview> {
  return {
    added: await titled(trx, by, change.added),
    removed: await titled(trx, by, change.removed),
    kept: change.kept,
    overridesDropped: change.overridesDropped,
  };
}

/** Another version of a placed group taken, as the document's next version (CG-F, CG-I; REU-062). */
export async function takeComponentGroup(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly placement: string;
    readonly version: string;
  },
): Promise<GroupActAnswer> {
  const opened = await openedOutline(trx, input.documentId, input.openedFrom);
  if (!opened) return { answer: 'artifact.missing' };
  const run = groupPlacements(opened.outline).find((each) => each.placement === input.placement);
  if (!run) return { answer: 'placement.missing' };
  const found = await placeable(trx, input.author, run.group, input.version);
  if (found.answer !== 'found') return found;
  if (!(await membersReferenced(trx, input.author, found.group))) {
    return { answer: 'outline.invalid', reason: REFERENCE_REFUSED };
  }
  const taken = takeGroupVersion(opened.outline, input.placement, found.group, newNodeIdentifier);
  if (!taken.applied) return { answer: 'outline.invalid', reason: taken.reason };
  const recorded = await next(
    trx,
    input.documentId,
    input.openedFrom,
    input.author,
    opened.version,
    taken.outline,
  );
  // Each kept member repinned is a re-point, as the outline's own is (CNT-182).
  if (recorded.answer === 'recorded') {
    await recordRepoints(trx, recorded.version, opened.outline, taken.outline);
  }
  return recorded;
}

/** A placed group removed as one, as the document's next version (CG-G, "Remove group"). */
export async function removeComponentGroup(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly placement: string;
  },
): Promise<GroupActAnswer> {
  const opened = await openedOutline(trx, input.documentId, input.openedFrom);
  if (!opened) return { answer: 'artifact.missing' };
  const removed = removeGroup(opened.outline, input.placement);
  if (!removed.applied) return { answer: 'placement.missing' };
  return next(
    trx,
    input.documentId,
    input.openedFrom,
    input.author,
    opened.version,
    removed.outline,
  );
}

/** One placed group as a document's view shows it (CG-F): its placement, and a newer approved version. */
export interface PlacedGroupView {
  readonly placement: string;
  /** Its title at the version placed; null where `principal` may not read the group. */
  readonly group: { readonly id: string; readonly title: string | null };
  readonly version: { readonly id: string; readonly number: string };
  /** Its latest approved version, where newer than the one placed; null otherwise, or unreadable. */
  readonly newer: { readonly id: string; readonly number: string } | null;
}

/** Each group an outline places, in document order, as `principal` is shown it (CG-F; REU-062). */
export async function placedGroups(
  trx: TenantTransaction,
  principal: string,
  outline: OutlineDocument,
): Promise<PlacedGroupView[]> {
  const runs = groupPlacements(outline);
  if (runs.length === 0) return [];
  const groups = [...new Set(runs.map((run) => run.group))];
  const readable = new Set<string>();
  for (const group of groups) {
    const facts = await loadFacts(trx, principal, { kind: 'artifact', id: group });
    if (facts && decide('read', facts).allowed && !(await isDeleted(trx, group))) {
      readable.add(group);
    }
  }
  const approved = await latestRevisionsOf(trx, [...readable]);
  const views: PlacedGroupView[] = [];
  for (const run of runs) {
    const placed = await readVersion(trx, run.version);
    const shown = readable.has(run.group);
    const title = shown && placed ? parseComponentGroup(placed.content).title : null;
    const newest = shown ? approved.get(run.group) : undefined;
    const newer = newest && (await readVersion(trx, newest.versionId));
    views.push({
      placement: run.placement,
      group: { id: run.group, title },
      version: { id: run.version, number: placed ? numberOf(placed) : '' },
      newer:
        newer &&
        placed &&
        (newer.revision > placed.revision ||
          (newer.revision === placed.revision && newer.version > placed.version))
          ? { id: newer.id, number: numberOf(newer) }
          : null,
    });
  }
  return views;
}

/**
 * The groups, not deleted, any version of which pins this component (CG-J; REU-063): what holds a
 * deletion and a move of it back. Each with its latest title and space.
 */
export async function groupsPinning(
  trx: TenantTransaction,
  componentId: string,
): Promise<{ id: string; title: string | null; space_id: string }[]> {
  if (!UUID.test(componentId)) return [];
  const { rows } = await sql<{ id: string; title: string | null; space_id: string }>`
    select a.id, latest.content ->> 'title' as title, a.space_id
      from artifact a
      cross join lateral (
        select v.content from artifact_version v where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc limit 1) latest
     where a.kind = 'componentGroup'
       and exists (select from artifact_version v
                    where v.artifact_id = a.id and v.kind = 'componentGroup'
                      and v.content -> 'members' @> ${JSON.stringify([{ component: componentId }])}::jsonb)
       ${(await deletionStored(trx)) ? sql`and ${notDeletedAs('a')}` : sql``}
     order by latest.content ->> 'title', a.id`.execute(trx);
  return rows;
}
