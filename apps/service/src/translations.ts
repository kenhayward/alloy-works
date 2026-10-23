import type {
  LineParams,
  MarkCurrentBody,
  SourceChangeBody,
  SourceChangeParams,
  SourceChangesView,
  SpaceParams,
  SpaceTranslationsView,
  TranslationBody,
  TranslationsView,
  TranslationView,
  TransitionParams,
} from '@alloy-works/api-contract';
import {
  beginTranslation,
  declareSourceChange,
  latestVersion,
  lineNumbers,
  markCurrent,
  readVersion,
  sourceChanges,
  spaceTranslations,
  translationSource,
  translationsOf,
  type TenantTransaction,
  type Translation,
} from '@alloy-works/db';
import { parseContentDocument } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { shownVersionView, versionView } from './components.js';
import { refused } from './wire-codes.js';

/**
 * Translation (docs/design/translation.md; the TR plan): each route decided by its contract's access,
 * `read` or `edit` on the component, before it runs.
 */

/** A version by id, as shown: `fr-FR 1.2` on a language line, `2.3` on the main line. */
async function shown(trx: TenantTransaction, id: string | null) {
  if (id === null) return null;
  const version = await readVersion(trx, id);
  if (!version) return null;
  return { id: version.id, number: (await shownVersionView(trx, version)).number };
}

/** Versions by id, as shown, in two reads whatever their number (`shown`'s answer, batched). */
async function shownMany(
  trx: TenantTransaction,
  ids: readonly (string | null)[],
): Promise<Map<string, { id: string; number: string }>> {
  const asked = [...new Set(ids.filter((id): id is string => id !== null))];
  if (asked.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'revision_no', 'version_no', 'line_id'])
    .where('id', 'in', asked)
    .execute();
  const onLines = await lineNumbers(
    trx,
    rows.filter((row) => row.line_id !== null).map((row) => row.id),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        number: onLines.get(row.id)?.number ?? `${row.revision_no}.${row.version_no}`,
      },
    ]),
  );
}

async function translationView(
  trx: TenantTransaction,
  translation: Translation,
): Promise<TranslationView> {
  return {
    line: translation.line,
    language: translation.language,
    head: await shown(trx, translation.head),
    translates: await shown(trx, translation.translates),
    status: { ...translation.status },
  };
}

/** One component's translation on `line`, read afresh. */
async function translationOn(trx: TenantTransaction, id: string, line: string) {
  const found = (await translationsOf(trx, [id])).get(id)?.find((each) => each.line === line);
  if (!found) throw notFound();
  return translationView(trx, found);
}

export function translationHandlers() {
  return {
    getSpaceTranslations: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SpaceTranslationsView> => {
      const { space } = request.params as SpaceParams;
      const report = await spaceTranslations(trx, space, principalId);
      // Every version named, shown in two reads, not two a translation (the TR final review).
      const shownBy = await shownMany(
        trx,
        report.items.flatMap((item) =>
          item.translations.flatMap((each) => [each.head, each.translates]),
        ),
      );
      return {
        items: report.items.map((item) => ({
          component: { ...item.component },
          translations: item.translations.map((each) => ({
            line: each.line,
            language: each.language,
            head: each.head === null ? null : (shownBy.get(each.head) ?? null),
            translates: each.translates === null ? null : (shownBy.get(each.translates) ?? null),
            status: { ...each.status },
          })),
        })),
        capped: report.capped,
      };
    },

    listComponentTranslations: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TranslationsView> => {
      const { id } = request.params as TransitionParams;
      const source = await latestVersion(trx, id);
      if (!source || source.kind !== 'component') throw notFound();
      const translations = (await translationsOf(trx, [id])).get(id) ?? [];
      return {
        source: {
          language: parseContentDocument(source.content).language,
          latest: { id: source.id, number: versionView(source).number },
          from: await (async () => {
            const from = (await translationSource(trx, id)) ?? source;
            return { id: from.id, number: versionView(from).number };
          })(),
        },
        translations: await Promise.all(translations.map((each) => translationView(trx, each))),
      };
    },

    beginComponentTranslation: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationView> => {
      const { id } = request.params as TransitionParams;
      const { language } = request.body as TranslationBody;
      const answer = await beginTranslation(trx, { artifactId: id, language, by: principalId });
      switch (answer.answer) {
        case 'begun':
          return translationOn(trx, id, answer.line.id);
        case 'artifact.missing':
        case 'revision.missing':
          throw notFound();
        case 'translation.language_invalid':
          throw refused(400, answer.answer, 'That is not a BCP 47 language tag, such as fr-FR.');
        case 'translation.same_language':
          throw refused(400, answer.answer, 'The source is in that language already.');
        case 'translation.exists':
          throw refused(409, answer.answer, 'A translation into that language is begun already.');
        case 'translation.needs_revision':
          throw refused(
            409,
            answer.answer,
            'The source has no designated revision to translate from yet.',
          );
        case 'line.name_taken':
          throw refused(409, answer.answer, 'Another line of this component has that name.');
      }
    },

    markComponentTranslationCurrent: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationView> => {
      const { id, line } = request.params as LineParams;
      const { translates } = request.body as MarkCurrentBody;
      const answer = await markCurrent(trx, { artifactId: id, line, translates, by: principalId });
      switch (answer.answer) {
        case 'marked':
          return translationOn(trx, id, line);
        case 'line.missing':
        case 'line.closed':
          throw notFound();
        case 'translation.untranslated':
          throw refused(409, answer.answer, 'Nothing is translated yet to mark current.');
        case 'translation.source_required':
        case 'translation.source_invalid':
          throw refused(
            400,
            'translation.source_invalid',
            'A translation is marked current against a version of its own source.',
          );
      }
    },

    getComponentTranslationChanges: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<SourceChangesView> => {
      const { id, line } = request.params as LineParams;
      const changed = await sourceChanges(trx, id, line);
      if (!changed) throw notFound();
      return {
        translates: (await shown(trx, changed.translates))!,
        current: (await shown(trx, changed.current))!,
        changes: changed.changes.map((each) => ({ ...each })),
      };
    },

    declareComponentSourceChange: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ) => {
      const { id, version } = request.params as SourceChangeParams;
      const { retranslate } = request.body as SourceChangeBody;
      const answer = await declareSourceChange(trx, {
        artifactId: id,
        version,
        retranslate,
        by: principalId,
      });
      if (answer.answer !== 'declared') throw notFound();
      return { version, retranslate };
    },
  };
}
