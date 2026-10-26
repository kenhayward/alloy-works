import { createHash } from 'node:crypto';
import type {
  DocumentParams,
  HeldDecisionBody,
  HeldTranslationView,
  LineParams,
  MarkCurrentBody,
  SourceChangeBody,
  SourceChangeParams,
  SourceChangesView,
  SpaceParams,
  SpaceTranslationsView,
  TranslationBody,
  TranslationJobBody,
  TranslationJobItemParams,
  TranslationJobParams,
  TranslationJobsView,
  TranslationJobView,
  TranslationsView,
  TranslationView,
  TransitionParams,
} from '@alloy-works/api-contract';
import {
  RETURN_MAX_BYTES,
  acceptMachineDrafts,
  openMachineDraft,
  artifactPlace,
  beginTranslation,
  closeTranslationJob,
  decideHeld,
  holdObject,
  readHeld,
  receiveReturn,
  releaseObject,
  translationPolicy,
  type Tenant,
  declareSourceChange,
  jobFileParts,
  loadFactsFor,
  makeTranslationJob,
  readableComponents,
  readDocument,
  readTranslationJob,
  recordEvent,
  termsInSpace,
  translationJobsOf,
  type TranslationJob,
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
import {
  blockText,
  decide,
  parseContentDocument,
  sourceChangesBetween,
  readOutline,
  selectOutline,
  speaksFor,
  termLabel,
  walkOutline,
  writeXliff,
  xliffUnits,
  type XliffTerm,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, type Authorised } from './access.js';
import { AppError, storageUnavailable } from './errors.js';
import { shownVersionView, versionView } from './components.js';
import { refused } from './wire-codes.js';
import { languageOf } from './listing.js';

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

/** A line's machine draft waiting to be accepted, its missed terms by the source's labels (XL-J). */
async function machineView(
  trx: TenantTransaction,
  principal: string,
  component: string,
  line: string,
): Promise<TranslationView['machine']> {
  const open = await openMachineDraft(trx, line);
  if (!open) return null;
  const space = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', component)
    .executeTakeFirst();
  const terms =
    space?.space_id && open.missedTerms.length > 0
      ? await termsInSpace(trx, principal, space.space_id, open.missedTerms)
      : new Map();
  return {
    version: (await shown(trx, open.version))!,
    missedTerms: open.missedTerms.flatMap((term) => {
      const found = terms.get(term);
      // A term the reader may no longer read is not named.
      return found ? [{ term, label: termLabel(found.term, found.term.base).preferred }] : [];
    }),
  };
}

/** One component's translation on `line`, read afresh. */
async function translationOn(trx: TenantTransaction, id: string, line: string) {
  const found = (await translationsOf(trx, [id])).get(id)?.find((each) => each.line === line);
  if (!found) throw notFound();
  return translationView(trx, found);
}

/** The components a document places now, under its own profile, in order (XL-D). */
async function placed(trx: TenantTransaction, id: string) {
  const document = await readDocument(trx, id);
  if (!document) throw notFound();
  const read = readOutline(document.version.content, {
    artifact: id,
    version: document.version.id,
  });
  if (!read.ok) throw notFound();
  const outline = selectOutline(read.outline, read.outline.profile?.values ?? {}).outline;
  const components: string[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'reference' && !components.includes(node.component)) {
      components.push(node.component);
    }
  });
  return { version: document.version.id, components };
}

/** A job as shown to `principal`: only the components they may read now are named. */
async function jobView(
  trx: TenantTransaction,
  principal: string,
  job: TranslationJob,
): Promise<TranslationJobView> {
  const readable = await readableComponents(
    trx,
    principal,
    job.items.map((item) => item.component),
  );
  const items = job.items.filter((item) => readable.has(item.component));
  const titles = new Map(
    items.length === 0
      ? []
      : (
          await trx
            .selectFrom('artifact_version')
            .distinctOn('artifact_id')
            .select(['artifact_id', 'content'])
            .where(
              'artifact_id',
              'in',
              items.map((item) => item.component),
            )
            .where('line_id', 'is', null)
            .orderBy('artifact_id')
            .orderBy('revision_no', 'desc')
            .orderBy('version_no', 'desc')
            .execute()
        ).map((row) => [row.artifact_id, parseContentDocument(row.content).title]),
  );
  const sources = await shownMany(
    trx,
    items.map((item) => item.sourceVersion),
  );
  return {
    id: job.id,
    language: job.language,
    vendor: job.vendor,
    by: job.by,
    at: job.at.toISOString(),
    closed: job.closed && { by: job.closed.by, at: job.closed.at.toISOString() },
    items: items.map((item) => ({
      component: { id: item.component, title: titles.get(item.component) ?? '' },
      line: item.line,
      source: item.sourceVersion === null ? null : (sources.get(item.sourceVersion) ?? null),
      notSent: item.notSent,
      outcome: item.outcome,
    })),
    returns: job.returns.map((each) => ({
      id: each.id,
      by: each.by,
      at: each.at.toISOString(),
      state: each.state,
      failure: each.failure,
      returned: each.returned,
      held: each.held,
      refused: each.refused,
    })),
  };
}

/** The space's terms each file uses, labelled in the source's language and, where given, the job's (XL-B). */
async function jobTerms(
  trx: TenantTransaction,
  principal: string,
  files: readonly {
    readonly component: string;
    readonly content: ReturnType<typeof parseContentDocument>;
  }[],
  target: string,
): Promise<Map<string, XliffTerm>> {
  const terms = new Map<string, XliffTerm>();
  if (files.length === 0) return terms;
  const spaces = await trx
    .selectFrom('artifact')
    .select(['id', 'space_id'])
    .where(
      'id',
      'in',
      files.map((file) => file.component),
    )
    .execute();
  for (const file of files) {
    const space = spaces.find((row) => row.id === file.component)?.space_id;
    const used = [...new Set(xliffUnits(file.content).flatMap((unit) => unit.terms))];
    if (!space || used.length === 0) continue;
    for (const [id, { term }] of await termsInSpace(trx, principal, space, used)) {
      const translated = term.labels.find((label) => speaksFor(label.language, target));
      terms.set(id, {
        source: termLabel(term, file.content.language).preferred,
        target: translated?.preferred,
      });
    }
  }
  return terms;
}

export function translationHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    getSpaceTranslations: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SpaceTranslationsView> => {
      const { space } = request.params as SpaceParams;
      const report = await spaceTranslations(trx, space, principalId, languageOf(request));
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
      { trx, principalId }: Authorised,
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
        translations: await Promise.all(
          translations.map(async (each) => ({
            ...(await translationView(trx, each)),
            machine: await machineView(trx, principalId, id, each.line),
          })),
        ),
      };
    },

    acceptComponentMachineDraft: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationView> => {
      const { id, line } = request.params as LineParams;
      const answer = await acceptMachineDrafts(trx, { artifactId: id, line, by: principalId });
      switch (answer.answer) {
        case 'accepted':
          return translationOn(trx, id, line);
        case 'line.missing':
          throw notFound();
        case 'translation.nothing_drafted':
          throw refused(409, answer.answer, 'No machine draft of this translation waits.');
      }
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
    listDocumentTranslationJobs: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationJobsView> => {
      const { id } = request.params as DocumentParams;
      const jobs = await translationJobsOf(trx, id);
      return { jobs: await Promise.all(jobs.map((job) => jobView(trx, principalId, job))) };
    },

    makeDocumentTranslationJob: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationJobView> => {
      const { id } = request.params as DocumentParams;
      const { language, vendor } = request.body as TranslationJobBody;
      const { version, components } = await placed(trx, id);
      // Of those the maker may read, each saying whether they may edit it (XL-D).
      const facts = await loadFactsFor(trx, principalId, components);
      const answer = await makeTranslationJob(trx, {
        documentId: id,
        documentVersion: version,
        language,
        vendor,
        by: principalId,
        components: components.flatMap((component) => {
          const known = facts.get(component);
          if (!known || !decide('read', known).allowed) return [];
          return [{ id: component, editable: decide('edit', known).allowed }];
        }),
      });
      switch (answer.answer) {
        case 'made':
          return jobView(trx, principalId, answer.job);
        case 'translation.language_invalid':
          throw refused(400, answer.answer, 'That is not a BCP 47 language tag, such as fr-FR.');
        case 'translation.nothing_to_send':
          throw refused(
            409,
            answer.answer,
            'No component of this document needs translating into that language that you may send.',
          );
      }
    },

    downloadDocumentTranslationJob: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ) => {
      const { id, job: jobId } = request.params as TranslationJobParams;
      const job = await readTranslationJob(trx, id, jobId);
      if (!job) throw notFound();
      // Read-filtered now, not when it was sent (XL-D).
      const readable = await readableComponents(
        trx,
        principalId,
        job.items.map((item) => item.component),
      );
      const files = (await jobFileParts(trx, job, readable)).map((part) => ({
        component: part.component,
        title: part.title,
        type: part.type ?? '',
        content: parseContentDocument(part.content),
      }));
      const source = files[0]?.content.language ?? 'und';
      const xliff = writeXliff({
        job: job.id,
        source,
        target: job.language,
        files,
        terms: await jobTerms(trx, principalId, files, job.language),
      });
      const place = await artifactPlace(trx, id);
      await recordEvent(
        trx,
        {
          kind: 'export.downloaded',
          subject: { kind: 'document', id, version: place.version },
          space: place.space,
          detail: { export: job.id, of: 'translation_job' },
        },
        place.labels,
      );
      return {
        contentType: 'application/xliff+xml',
        bytes: Buffer.from(xliff, 'utf8'),
        immutable: false,
        // Named by its job and language, never a title, which would reach logs.
        attachment: `translation-${job.id}-${job.language}.xlf`,
      };
    },

    closeDocumentTranslationJob: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationJobView> => {
      const { id, job } = request.params as TranslationJobParams;
      const answer = await closeTranslationJob(trx, { documentId: id, job, by: principalId });
      switch (answer.answer) {
        case 'closed':
          return jobView(trx, principalId, answer.job);
        case 'job.missing':
          throw notFound();
        case 'translation.job_closed':
          throw refused(409, answer.answer, 'This job is closed already.');
      }
    },

    /**
     * The file kept by its hash as it came and the worker's read queued (XL-F): whatever it says is
     * read there, in a thread within an import's budget, never here.
     */
    returnDocumentTranslationJob: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationJobView> => {
      const { id, job } = request.params as TranslationJobParams;
      const bytes =
        Buffer.isBuffer(request.body) &&
        request.headers['content-type']?.split(';')[0]?.trim() === 'application/octet-stream'
          ? request.body
          : undefined;
      if (bytes === undefined) {
        throw new AppError(
          415,
          'translation_return_bytes_expected',
          "Send the file's bytes as application/octet-stream.",
        );
      }
      if (bytes.length > RETURN_MAX_BYTES) {
        throw new AppError(413, 'translation_return_too_large', 'A file may hold at most 25 MB.');
      }
      const known = await readTranslationJob(trx, id, job);
      if (!known) throw notFound();
      if (known.closed !== null) {
        throw refused(409, 'translation.job_closed', 'This job is closed already.');
      }
      if (!objects) throw storageUnavailable();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await holdObject(trx, sha256);
      const store = await objects.forTenant(trx, tenantOf(request));
      const stored = await store.put(bytes, 'application/octet-stream');
      const answer = await receiveReturn(trx, {
        documentId: id,
        job,
        key: stored.key,
        sha256,
        bytes: stored.size,
        by: principalId,
      });
      if (answer.answer !== 'received') {
        await releaseObject(trx, { key: stored.key, sha256 }, (key) => store.remove(key));
        if (answer.answer === 'job.missing') throw notFound();
        throw refused(409, answer.answer, 'This job is closed already.');
      }
      return jobView(trx, principalId, answer.job);
    },

    getDocumentTranslationJobHeld: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<HeldTranslationView> => {
      const { id, job, component } = request.params as TranslationJobItemParams;
      const readable = await readableComponents(trx, principalId, [component]);
      const held = readable.has(component)
        ? await readHeld(trx, { documentId: id, job, component })
        : undefined;
      if (!held) throw notFound();
      const sent = await readVersion(trx, held.item.sourceVersion!);
      const current = (await translationSource(trx, component)) ?? sent;
      if (!sent || !current) throw notFound();
      const before = parseContentDocument(sent.content);
      const after = parseContentDocument(current.content);
      const blocks = new Map(
        [...before.content, ...after.content].map((block) => [block.id, block]),
      );
      const shownBy = await shownMany(trx, [sent.id, current.id]);
      return {
        component: { id: component, title: after.title },
        sent: shownBy.get(sent.id)!,
        current: shownBy.get(current.id)!,
        changes: sourceChangesBetween(before, after).map((each) => ({
          ...each,
          words: blockText(blocks.get(each.block)!),
        })),
        returned: held.content.content.map((block) => ({
          block: block.id,
          words: blockText(block),
        })),
        offered: (await translationPolicy(trx)).conflict,
      };
    },

    decideDocumentTranslationJobItem: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationJobView> => {
      const { id, job, component } = request.params as TranslationJobItemParams;
      const { decision } = request.body as HeldDecisionBody;
      // Edit on the component held, as well as on the document the route decided (XL-G).
      await authoriseAt(trx, callerOf(request), 'edit', { kind: 'artifact', id: component });
      const answer = await decideHeld(trx, {
        documentId: id,
        job,
        component,
        decision,
        by: principalId,
      });
      switch (answer.answer) {
        case 'decided':
          return jobView(trx, principalId, answer.job);
        case 'item.missing':
          throw notFound();
        case 'translation.job_closed':
          throw refused(409, answer.answer, 'This job is closed already.');
        case 'lock.held':
          throw refused(
            409,
            answer.answer,
            'Somebody is editing this translation. Try again later.',
          );
        case 'translation.not_applied':
          throw refused(
            409,
            answer.answer,
            'The words could not be made a version of the translation: a fixed value refuses them.',
          );
      }
    },
  };
}
