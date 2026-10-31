import type { FieldDefinition, Vocabulary } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { latestOfKind } from './definitions.js';
import type { TenantTransaction } from './tables.js';
import { readableAmong } from './uses.js';

/** Where a vocabulary is used (LIB-005; the VO plan, VO-G), as one reader is shown it. */
export interface VocabularyUses {
  /** Each field drawing on it, at its latest definition, by name. */
  readonly fields: readonly { readonly id: string; readonly name: string }[];
  /** Each condition axis drawing on it, likewise. */
  readonly axes: readonly { readonly id: string; readonly key: string; readonly name: string }[];
  /**
   * Each value held, in the vocabulary's own order: how many components hold it, and those of them
   * the reader may read, by title.
   */
  readonly values: readonly {
    readonly value: string;
    readonly count: number;
    readonly components: readonly { readonly id: string; readonly title: string }[];
  }[];
}

/**
 * Where a vocabulary is used, as `by` may see it: the fields and axes naming it, and per value the
 * components, not deleted, whose latest version holds it in one of those fields. A component `by` may
 * not read is counted and never named (`readableAmong`), as a term's uses are, so a value is not
 * deprecated or retired blind.
 */
export async function vocabularyUses(
  trx: TenantTransaction,
  by: string,
  vocabulary: { readonly id: string; readonly definition: Vocabulary },
): Promise<VocabularyUses> {
  const fields = (await latestOfKind(trx, 'field')).filter(
    ({ definition }: { definition: FieldDefinition }) =>
      definition.dataType === 'text' && definition.validation.vocabulary === vocabulary.id,
  );
  const axes = (await latestOfKind(trx, 'conditionAxis')).filter(
    (each) => each.definition.vocabulary === vocabulary.id,
  );
  const ids = vocabulary.definition.values.map((each) => each.id);
  const { rows } =
    fields.length === 0 || ids.length === 0
      ? { rows: [] }
      : await sql<{ id: string; space_id: string; title: string | null; value: string }>`
          select distinct a.id, a.space_id, v.content ->> 'title' as title, x.value
            from artifact a
            join lateral (
              select l.content, l.metadata_values from artifact_version l
               where l.artifact_id = a.id
               order by l.revision_no desc, l.version_no desc limit 1) v on true
            join lateral jsonb_each(v.metadata_values) m(field, held)
              on m.field = any(${fields.map((each) => each.id)}::text[])
            join lateral jsonb_array_elements(
              case jsonb_typeof(m.held) when 'array' then m.held else jsonb_build_array(m.held) end
            ) e(element) on jsonb_typeof(e.element) = 'string'
            cross join lateral (select e.element #>> '{}' as value) x
           where a.kind = 'component' and x.value = any(${ids}::text[])
           order by title, a.id`.execute(trx);
  const readable = await loadReadableSet(trx, by);
  const values = [];
  for (const value of ids) {
    const holding = rows.filter((row) => row.value === value);
    if (holding.length === 0) continue;
    const shown = await readableAmong(trx, readable, holding);
    values.push({
      value,
      count: shown.total,
      components: shown.map((row) => ({ id: row.id, title: row.title ?? '' })),
    });
  }
  return {
    fields: fields.map((each) => ({ id: each.id, name: each.definition.name })),
    axes: axes.map((each) => ({
      id: each.id,
      key: each.definition.key,
      name: each.definition.name,
    })),
    values: values.filter((each) => each.count > 0),
  };
}
