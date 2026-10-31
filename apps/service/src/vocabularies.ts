import type {
  ImportVocabularyBody,
  VocabularyExportAnswer,
  VocabularyImportAnswer,
  VocabularyList,
  VocabularyParams,
  VocabularyView,
} from '@alloy-works/api-contract';
import {
  createDefinition,
  listVocabularies,
  readDefinitionLatest,
  recordDefinitionVersion,
  type StoredDefinition,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  DEFINITION_SCHEMA_VERSION,
  VOCABULARY_LIMITS,
  VocabularyRefused,
  parseVocabulary,
  type Vocabulary,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refusedDefinition } from './definitions.js';
import { refused } from './wire-codes.js';
import { SKOS_QUADS_MOST } from './terms/skos.js';
import { exportVocabulary, readVocabularySkos } from './vocabulary-skos.js';

/**
 * The vocabulary routes (the VO plan, VO-A, VO-I): read by anyone signed in, so in a transaction of
 * their own; imported by `manage_definitions`, through the definitions' own writers and refusals.
 */

const versionNumber = (stored: StoredDefinition) => ({
  id: stored.version.id,
  number: `${stored.version.revision}.${stored.version.version}`,
});

const vocabularyView = (stored: StoredDefinition<'vocabulary'>): VocabularyView => ({
  id: stored.id,
  version: versionNumber(stored),
  vocabulary: stored.definition,
});

/** A vocabulary at its latest version, or undefined where the id is no vocabulary's. */
async function readVocabulary(
  trx: TenantTransaction,
  id: string,
): Promise<StoredDefinition<'vocabulary'> | undefined> {
  const stored = await readDefinitionLatest(trx, id);
  return stored?.kind === 'vocabulary' ? (stored as StoredDefinition<'vocabulary'>) : undefined;
}

/** The identifier a candidate is checked with before the writer allocates or keeps the real one. */
const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

export function vocabularyHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
) {
  const read = <T>(request: FastifyRequest, work: (trx: TenantTransaction) => Promise<T>) =>
    db.withTenant(tenantOf(request), work);
  return {
    listVocabularies: async (request: FastifyRequest): Promise<VocabularyList> => ({
      items: (await read(request, listVocabularies)).map((each) => ({
        id: each.id,
        key: each.definition.key,
        name: each.definition.name,
        version: versionNumber(each),
        values: each.definition.values.length,
      })),
    }),

    getVocabulary: async (request: FastifyRequest): Promise<VocabularyView> => {
      const { id } = request.params as VocabularyParams;
      const stored = await read(request, (trx) => readVocabulary(trx, id));
      if (!stored) throw notFound();
      return vocabularyView(stored);
    },

    exportVocabulary: async (request: FastifyRequest): Promise<VocabularyExportAnswer> => {
      const { id } = request.params as VocabularyParams;
      const stored = await read(request, (trx) => readVocabulary(trx, id));
      if (!stored) throw notFound();
      return {
        format: 'json-ld',
        text: JSON.stringify(exportVocabulary(stored.definition), null, 2),
      };
    },

    importVocabulary: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<VocabularyImportAnswer> => {
      const body = request.body as ImportVocabularyBody;
      const skos = await readVocabularySkos(body.format, body.text);
      if (skos.read === 'unreadable') {
        throw refused(400, 'import.unreadable', 'The text does not read as that format.');
      }
      if (skos.read === 'scheme') throw refused(400, 'import.unreadable', skos.message);
      if (skos.read === 'too many') {
        throw refused(
          400,
          'import.too_many',
          `The text holds more than ${VOCABULARY_LIMITS.values} concepts or ${SKOS_QUADS_MOST} statements.`,
        );
      }
      const held = (await listVocabularies(trx)).find(
        (each) => each.definition.key === skos.scheme.key,
      );
      // The held vocabulary's base stands; a new one takes the scheme's first label's language.
      const base =
        held?.definition.base ??
        skos.scheme.names[0]?.language ??
        skos.values[0]?.labels[0]?.language ??
        'en';
      const notRepresented = [...skos.notRepresented];
      let notRepresentedTotal = skos.notRepresentedTotal;
      const imported = skos.values.filter((value) => {
        if (value.labels.some((each) => each.language === base)) return true;
        notRepresentedTotal += 1;
        if (notRepresented.length < 1000) {
          notRepresented.push(`${value.id}: no label in ${base}, the base language`);
        }
        return false;
      });
      // Never a value removed (VO-B): one held and not imported is kept, after those imported.
      const ids = new Set(imported.map((each) => each.id));
      const kept = (held?.definition.values ?? []).filter((each) => !ids.has(each.id));
      const candidate: Omit<Vocabulary, 'id'> = {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name:
          skos.scheme.names.find((each) => each.language === base)?.text ??
          skos.scheme.names[0]?.text ??
          held?.definition.name ??
          skos.scheme.key,
        key: skos.scheme.key,
        base,
        order: skos.scheme.order ?? held?.definition.order ?? 'declared',
        values: [...imported, ...kept],
      };
      try {
        parseVocabulary({ ...candidate, id: PLACEHOLDER });
      } catch (error) {
        if (!(error instanceof VocabularyRefused)) throw error;
        throw refused(
          400,
          'vocabulary.invalid',
          'The vocabulary the import would make is not valid.',
          {
            problems: error.problems,
          },
        );
      }
      const answer = held
        ? await recordDefinitionVersion(trx, {
            id: held.id,
            openedFrom: held.version.id,
            definition: candidate,
            author: principalId,
          })
        : await createDefinition(trx, {
            kind: 'vocabulary',
            definition: candidate,
            author: principalId,
          });
      if (
        answer.answer !== 'created' &&
        answer.answer !== 'recorded' &&
        answer.answer !== 'version.unchanged'
      ) {
        return refusedDefinition(answer);
      }
      return {
        answer: answer.answer === 'version.unchanged' ? 'unchanged' : answer.answer,
        vocabulary: vocabularyView(answer.definition as StoredDefinition<'vocabulary'>),
        kept: kept.map((each) => each.id),
        notRepresented,
        notRepresentedTotal,
      };
    },
  };
}
