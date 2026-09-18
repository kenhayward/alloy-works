import {
  contributionsOf,
  readContent,
  walkOutline,
  type Contribution,
  type OutlineDocument,
} from '@alloy-works/domain';
import { readableComponents } from './documents.js';
import type { TenantTransaction } from './tables.js';

/**
 * Which version one occurrence resolved to, as its numbering is told it: `null` where the caller is
 * not told - a component they may not read, whose version is withheld as the outline withholds it; a
 * reference whose mode is `approved`, which resolves to nothing until revisions exist; a pinned
 * version that is not the component's; or a version whose content does not read.
 */
export interface OccurrenceResolution {
  readonly node: string;
  readonly version: string | null;
}

export interface NumberingInputs {
  readonly occurrences: readonly OccurrenceResolution[];
  /** What each resolved occurrence contributes, keyed by its node. Absent: not known to this caller. */
  readonly contributions: ReadonlyMap<string, readonly Contribution[]>;
}

/** A version row, as read for projection: identity, the artifact it belongs to, and its content. */
interface VersionRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly content: unknown;
}

/**
 * The rows a `pinned` reference's target versions read as, restricted to `readableComponentIds` -
 * so a version whose artifact is not in that set is never selected at all, rather than selected and
 * then discarded once its `artifact_id` is compared against the reference's own (F7). Exported so the
 * restriction is checked directly against the rows the query returns, which `numberingInputs`'s
 * result cannot distinguish from "read, then discarded": a mismatched `artifact_id` is refused either
 * way, so only the query itself proves which one happened.
 */
export async function readablePinnedVersions(
  trx: TenantTransaction,
  pinnedIds: readonly string[],
  readableComponentIds: ReadonlySet<string>,
): Promise<VersionRow[]> {
  if (pinnedIds.length === 0 || readableComponentIds.size === 0) return [];
  return trx
    .selectFrom('artifact_version')
    .select(['id', 'artifact_id', 'content'])
    .where('id', 'in', [...pinnedIds])
    .where('artifact_id', 'in', [...readableComponentIds])
    .execute();
}

/**
 * The resolve stage's inputs, for one principal (structure.md, "Numbering"): which version each
 * occurrence takes, and what that version's content contributes to the sequences.
 *
 * **A component the principal may not read is never read at all**, so nothing it contains can reach
 * the answer: its occurrence is simply absent from `contributions`, and `number` withholds every number
 * it could have moved. Readable components are read in two queries whatever the outline's size - the
 * head of every `latest` one, and every `pinned` version, each restricted to the readable set so an
 * unreadable component's row is never selected (F7) - each version once, however many occurrences
 * resolve to it, and each version's content through `readContent`, the read-back rule every stored
 * component is held to (CNT-013). One whose content does not read is not known either, and says so in
 * no other way: numbering it would be a guess.
 */
export async function numberingInputs(
  trx: TenantTransaction,
  outline: OutlineDocument,
  principalId: string,
): Promise<NumberingInputs> {
  const references: {
    node: string;
    component: string;
    pinned: string | null;
    approved: boolean;
  }[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    references.push({
      node: node.id,
      component: node.component,
      pinned: node.mode.kind === 'pinned' ? node.mode.version : null,
      approved: node.mode.kind === 'approved',
    });
  });
  const readable = await readableComponents(
    trx,
    principalId,
    references.map((reference) => reference.component),
  );
  const latest = [
    ...new Set(
      references
        .filter((each) => readable.has(each.component) && each.pinned === null && !each.approved)
        .map((each) => each.component),
    ),
  ];
  const pinned = [
    ...new Set(
      references.flatMap((each) =>
        readable.has(each.component) && each.pinned !== null ? [each.pinned] : [],
      ),
    ),
  ];

  const heads =
    latest.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .distinctOn('artifact_id')
          .select(['id', 'artifact_id', 'content'])
          // Mirrors `latestVersion`'s rule for a component's head, over the readable set already
          // computed above; `artifact_id in latest` alone already excludes every unreadable one.
          .where('artifact_id', 'in', latest)
          .orderBy('artifact_id')
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .execute();
  const pins = await readablePinnedVersions(trx, pinned, readable);

  const headOf = new Map(heads.map((row) => [row.artifact_id, row]));
  const pinOf = new Map(pins.map((row) => [row.id, row]));
  const projected = new Map<string, readonly Contribution[] | null>();
  const project = (row: VersionRow) => {
    if (!projected.has(row.id)) {
      const read = readContent(row.content, { artifact: row.artifact_id, version: row.id });
      projected.set(row.id, read.ok ? contributionsOf(read.document) : null);
    }
    return projected.get(row.id) ?? null;
  };

  const occurrences: OccurrenceResolution[] = [];
  const contributions = new Map<string, readonly Contribution[]>();
  for (const reference of references) {
    // `approved` resolves to nothing until revisions exist, even where the same component is also
    // placed at `latest` and its head was read for that occurrence.
    const row =
      !readable.has(reference.component) || reference.approved
        ? undefined
        : reference.pinned !== null
          ? pinOf.get(reference.pinned)
          : headOf.get(reference.component);
    // A pinned version of some other artifact is refused when it is written; checked again here,
    // because a check that runs only at the write is a rule the read trusts rather than holds.
    if (row === undefined || row.artifact_id !== reference.component) {
      occurrences.push({ node: reference.node, version: null });
      continue;
    }
    const projection = project(row);
    occurrences.push({ node: reference.node, version: projection === null ? null : row.id });
    if (projection !== null) contributions.set(reference.node, projection);
  }
  return { occurrences, contributions };
}
