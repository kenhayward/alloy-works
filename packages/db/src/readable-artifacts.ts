import type { ReadableSet } from '@alloy-works/domain';
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import type { ArtifactTable } from './tables.js';

/** Stands in for an empty list: `in ()` is not SQL, and no artifact has the nil UUID. */
const NONE = ['00000000-0000-0000-0000-000000000000'];

const listed = (ids: readonly string[]) => (ids.length > 0 ? [...ids] : NONE);

/**
 * access.md's readable-set predicate over an artifact aliased `a`, filtered inside a listing's query
 * rather than by deciding each row after it is read (access.md, "The readable set"). **One predicate
 * for every listing of content**, so a fix to how the readable set is applied reaches each of them -
 * `listReadableComponents` and `listReadableDocuments` both call this.
 *
 * An artifact is readable when it sits in a readable space and no grant on it refuses read, or when a
 * grant on it allows read outside every readable space. access.md's third disjunct, "space_id is null
 * and tenant", for an artifact that lives in no space, is left out rather than written dead: a listing
 * of content lists only content kinds, and `artifact_space_by_kind` (0007_spaces_and_artifacts.sql,
 * widened by 0016_documents.sql) requires a component and a document alike to carry a non-null
 * `space_id`. A listing of definitions, which live in no space, must not use this as it stands.
 */
export function readableArtifacts(
  eb: ExpressionBuilder<{ a: ArtifactTable }, 'a'>,
  readable: ReadableSet,
): Expression<SqlBool> {
  return eb.or([
    eb.and([
      eb('a.space_id', 'in', listed(readable.spaces)),
      eb('a.id', 'not in', listed(readable.excluded)),
    ]),
    eb('a.id', 'in', listed(readable.included)),
  ]);
}
