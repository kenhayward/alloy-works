import {
  heldVocabularyValues,
  readDefinition,
  valuesLabelled,
  vocabularyValueWarnings,
  type FieldDefinition,
  type MetadataValues,
  type Vocabulary,
  type VocabularyValueWarning,
} from '@alloy-works/domain';
import { readDefinitionLatest } from './definitions.js';
import type { TenantTransaction } from './tables.js';

/**
 * **The vocabularies a publish reads** (vocabularies.md; the VO plan, VO-D, VO-H): the latest version
 * of each vocabulary a document's value draws on, recorded on the request and pinned by a baseline as a
 * term's is (0177), and printed from at the job, never the latest then (LIB-004). Which field draws on
 * which vocabulary is each field's latest definition, as a variable's is read at the job (R5-A).
 * Vocabularies are environment-wide and read by anyone signed in, so nothing here decides access.
 */

/** A vocabulary version recorded or pinned. */
export interface ReadVocabulary {
  readonly vocabulary: string;
  readonly version: string;
}

/** The latest definitions of these fields that draw on a vocabulary. */
async function fieldsDrawing(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<FieldDefinition[]> {
  const fields: FieldDefinition[] = [];
  for (const id of new Set(ids)) {
    const stored = await readDefinitionLatest(trx, id);
    if (stored?.kind !== 'field') continue;
    const field = stored.definition as FieldDefinition;
    if (field.dataType === 'text' && field.validation.vocabulary !== undefined) fields.push(field);
  }
  return fields;
}

/** Each vocabulary's latest version, by id. */
async function latestOf(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, { readonly version: string; readonly vocabulary: Vocabulary }>> {
  const found = new Map<string, { version: string; vocabulary: Vocabulary }>();
  for (const id of new Set(ids)) {
    const stored = await readDefinitionLatest(trx, id);
    if (stored?.kind === 'vocabulary') {
      found.set(id, { version: stored.version.id, vocabulary: stored.definition as Vocabulary });
    }
  }
  return found;
}

/**
 * What a publish of the latest reads of vocabularies, in `language`: the latest version of each the
 * document's values draw on, to record; and each deprecated or retired value the document or a
 * resolved component holds, the document's first, which never stops it (LIB-023; VO-D).
 */
export async function resolveVocabularies(
  trx: TenantTransaction,
  values: MetadataValues,
  resolved: readonly { readonly node: string; readonly version: string }[],
  language: string,
): Promise<{
  readonly vocabularies: readonly ReadVocabulary[];
  readonly vocabularyWarnings: readonly VocabularyValueWarning[];
}> {
  const held = new Map(
    resolved.length === 0
      ? []
      : (
          await trx
            .selectFrom('artifact_version')
            .select(['id', 'metadata_values'])
            .where(
              'id',
              'in',
              resolved.map((each) => each.version),
            )
            .execute()
        ).map((row) => [row.id, (row.metadata_values ?? {}) as MetadataValues]),
  );
  const fields = await fieldsDrawing(trx, [
    ...Object.keys(values),
    ...[...held.values()].flatMap((each) => Object.keys(each)),
  ]);
  if (fields.length === 0) return { vocabularies: [], vocabularyWarnings: [] };
  const own = heldVocabularyValues(values, fields);
  const placed = resolved.map(({ node, version }) => ({
    node,
    held: heldVocabularyValues(held.get(version) ?? {}, fields),
  }));
  const latest = await latestOf(trx, [
    ...own.map((each) => each.vocabulary),
    ...placed.flatMap((each) => each.held.map((value) => value.vocabulary)),
  ]);
  const lookup = (id: string) => latest.get(id)?.vocabulary;
  return {
    vocabularies: [...new Set(own.map((each) => each.vocabulary))].flatMap((vocabulary) => {
      const read = latest.get(vocabulary);
      return read === undefined ? [] : [{ vocabulary, version: read.version }];
    }),
    vocabularyWarnings: [
      ...vocabularyValueWarnings(own, null, lookup, language),
      ...placed.flatMap((each) => vocabularyValueWarnings(each.held, each.node, lookup, language)),
    ],
  };
}

/** The vocabulary versions a request recorded. */
export async function requestVocabularies(
  trx: TenantTransaction,
  requestId: string,
): Promise<ReadVocabulary[]> {
  return (
    await trx
      .selectFrom('publication_request_asset')
      .select(['asset_id', 'version_id'])
      .where('request_id', '=', requestId)
      .where('asset_kind', '=', 'vocabulary')
      .execute()
  ).map((row) => ({ vocabulary: row.asset_id, version: row.version_id }));
}

/**
 * A document's values as its publication prints them (LIB-004, LIB-024): each id a field drawing on a
 * recorded vocabulary holds, its label in `language` from the version recorded. A version that does not
 * read is a broken store, thrown, as a component's is.
 */
export async function valuesPrinted(
  trx: TenantTransaction,
  values: MetadataValues,
  recorded: readonly ReadVocabulary[],
  language: string,
): Promise<MetadataValues> {
  if (recorded.length === 0) return values;
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content'])
    .where(
      'id',
      'in',
      recorded.map((each) => each.version),
    )
    .execute();
  const contents = new Map(rows.map((row) => [row.id, row.content]));
  const read = new Map<string, Vocabulary>();
  for (const { vocabulary, version } of recorded) {
    const outcome = readDefinition('vocabulary', contents.get(version), {
      artifact: vocabulary,
      version,
    });
    if (!outcome.ok) throw new Error(`The vocabulary ${vocabulary} at ${version} does not read`);
    read.set(vocabulary, outcome.definition);
  }
  return valuesLabelled(
    values,
    await fieldsDrawing(trx, Object.keys(values)),
    (id) => read.get(id),
    language,
  );
}
