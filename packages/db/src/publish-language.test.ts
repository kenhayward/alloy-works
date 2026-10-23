import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  parseContentDocument,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument, mayReference, recordDocumentFallback } from './documents.js';
import { claimLock, saveIteration } from './editing.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { publicationInputs, requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { beginTranslation, setTranslationPolicy, translationPolicy } from './translation.js';
import { recordVersion, type StoredVersion } from './versions.js';
import { moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const para = (id: string, value: string) => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: [{ type: 'text' as const, value, marks: [] }],
});
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const reference = (component: string, mode: ReferenceNode['mode'] = { kind: 'latest' }) =>
  ({
    type: 'reference',
    id: nodeId(),
    component,
    mode,
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  }) satisfies ReferenceNode;

describe('publishing in a language (the TR plan, TRb)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });

  /** A component in English, its one block cut, and approved: revision 1. */
  const component = (title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
  const approve = (version: StoredVersion, line?: string) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
        ...(line === undefined ? {} : { line }),
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
        ...(line === undefined ? {} : { line }),
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });
  const cut = async (
    from: StoredVersion,
    blocks: ReturnType<typeof para>[],
    language: string,
    extra: { line?: string; translates?: string; retranslate?: boolean } = {},
  ) => {
    const answer = await as(async (trx) => {
      const session = randomUUID();
      const at = {
        artifactId: from.artifactId,
        principal: ada,
        session,
        ...(extra.line ? { line: extra.line } : {}),
      };
      await claimLock(trx, { ...at, move: true });
      const content: ContentDocument = parseContentDocument({
        ...parseContentDocument(from.content),
        language,
        content: blocks,
      });
      const saved = await saveIteration(trx, { ...at, sequence: 1, openedFrom: from.id, content });
      if (saved.answer !== 'accepted') throw new Error(saved.answer);
      return cutVersion(trx, {
        ...at,
        openedFrom: from.id,
        ...(extra.translates === undefined ? {} : { translates: extra.translates }),
        ...(extra.retranslate === undefined ? {} : { retranslate: extra.retranslate }),
      });
    });
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    return answer.version;
  };
  /** An approved English component, with a French translation of its approved revision. */
  const translated = async (title: string, english: string, french: string) => {
    const created = await component(title);
    const source = await cut(created, [para('b1', english)], 'en-GB');
    await approve(source);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: source.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const variant = await cut(source, [para('b1', french)], 'fr-FR', {
      line: begun.line.id,
      translates: source.id,
    });
    return { source, variant, line: begun.line.id };
  };
  const document = (nodes: OutlineNode[]) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title: 'Pond survey',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
  /** What resolving found, as the request recorded it. */
  const failuresOf = async (request: string) =>
    (await as((trx) => publicationInputs(trx, request)))!.refused;
  const publish = (version: StoredVersion, language?: string) =>
    as((trx) =>
      requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester: ada,
        ...(language === undefined ? {} : { language }),
      }),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LOC-010 publishes a document in a language, each reference reading its variant, recorded with the language, under the layout’s words in it', async () => {
    const methods = await translated(
      'Methods',
      'Ponds were sampled.',
      'Les étangs ont été échantillonnés.',
    );
    const results = await translated('Results', 'Twelve ponds.', 'Douze étangs.');
    const version = await document([
      reference(methods.source.artifactId),
      reference(results.source.artifactId, { kind: 'pinned', version: results.source.id }),
    ]);
    const asked = await publish(version, 'fr-FR');
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    const inputs = (await as((trx) => publicationInputs(trx, asked.request.id)))!;
    expect([...inputs.occurrences.values()].map((each) => each.version)).toEqual([
      methods.variant.id,
      results.variant.id,
    ]);
    expect(inputs.outline.language).toBe('fr-FR');
    expect(inputs.layout?.layout.language).toBe('fr');
    expect(inputs.layout?.layout.words.contents).toBe('Table des matières');
    expect(inputs.untranslated.size).toBe(0);
    // A range reads the variant it serves: `fr` takes the `fr-FR` translations.
    const ranged = await publish(version, 'fr');
    if (ranged.answer !== 'requested') throw new Error(ranged.answer);
    expect(
      [...(await as((trx) => publicationInputs(trx, ranged.request.id)))!.occurrences.values()].map(
        (each) => each.version,
      ),
    ).toEqual([methods.variant.id, results.variant.id]);
    // In its own language, as before: the sources.
    const own = await publish(version);
    if (own.answer !== 'requested') throw new Error(own.answer);
    const ownInputs = (await as((trx) => publicationInputs(trx, own.request.id)))!;
    expect([...ownInputs.occurrences.values()].map((each) => each.version)).toEqual([
      methods.source.id,
      results.source.id,
    ]);
    // A language the layout gives no words in is refused, naming both.
    expect(await publish(version, 'es-ES')).toMatchObject({
      answer: 'layout.language',
      document: 'es-ES',
    });
  });

  it('LOC-037 falls back to the source where a component has no variant, marked and reported, or refuses as the document says over the tenant', async () => {
    const methods = await translated('Methods', 'Ponds were sampled.', 'Les étangs.');
    const untranslated = await component('Discussion');
    const left = reference(untranslated.artifactId);
    const version = await document([reference(methods.source.artifactId), left]);

    const asked = await publish(version, 'fr-FR');
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    expect(await failuresOf(asked.request.id)).toEqual([]);
    const inputs = (await as((trx) => publicationInputs(trx, asked.request.id)))!;
    expect(inputs.occurrences.get(left.id)?.version).toBe(untranslated.id);
    expect(inputs.untranslated).toEqual(new Map([[left.id, 'Untranslated (en-GB)']]));
    const warnings = await as((trx) =>
      trx
        .selectFrom('publication_request')
        .select('warnings')
        .where('id', '=', asked.request.id)
        .executeTakeFirstOrThrow(),
    );
    expect(warnings.warnings).toEqual([
      { code: 'component_untranslated', node: left.id, language: 'en-GB' },
      // Its title given no words in French (TR-L).
      { code: 'title_untranslated', node: null },
    ]);

    // The tenant's words for the mark, by language.
    await as((trx) =>
      setTranslationPolicy(trx, {
        fallback: 'source',
        outOfDate: 'publish',
        note: { fr: 'Non traduit' },
      }),
    );
    const worded = await publish(version, 'fr-FR');
    if (worded.answer !== 'requested') throw new Error(worded.answer);
    // Recorded at request: a policy changed before the job runs changes nothing it prints.
    await as((trx) =>
      setTranslationPolicy(trx, {
        fallback: 'source',
        outOfDate: 'publish',
        note: { fr: 'Autre' },
      }),
    );
    expect(
      (await as((trx) => publicationInputs(trx, worded.request.id)))!.untranslated.get(left.id),
    ).toBe('Non traduit (en-GB)');

    // The document's own fallback refuses where the tenant's falls back.
    const refusing = await as((trx) =>
      recordDocumentFallback(trx, {
        documentId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        fallback: 'refuse',
      }),
    );
    if (refusing.answer !== 'recorded') throw new Error(refusing.answer);
    const refused = await publish(refusing.version, 'fr-FR');
    if (refused.answer !== 'requested') throw new Error(refused.answer);
    expect(await failuresOf(refused.request.id)).toEqual([
      {
        stage: 'resolve',
        code: 'occurrence_untranslated',
        node: left.id,
        block: null,
        detail: null,
      },
    ]);
    await as((trx) =>
      setTranslationPolicy(trx, { fallback: 'source', outOfDate: 'publish', note: {} }),
    );
    expect((await as((trx) => translationPolicy(trx))).note).toEqual({});
  });

  it('LOC-017 refuses a publish holding an out-of-date translation where the policy says so, and only for a change needing retranslation', async () => {
    const methods = await translated('Methods', 'Ponds were sampled.', 'Les étangs.');
    const version = await document([reference(methods.source.artifactId)]);
    const typo = await cut(methods.source, [para('b1', 'Ponds were sampled!')], 'en-GB', {
      retranslate: false,
    });
    await as((trx) =>
      setTranslationPolicy(trx, { fallback: 'source', outOfDate: 'refuse', note: {} }),
    );
    const fine = await publish(version, 'fr-FR');
    if (fine.answer !== 'requested') throw new Error(fine.answer);
    expect(await failuresOf(fine.request.id)).toEqual([]);

    await cut(typo, [para('b1', 'Ponds were sampled twice.')], 'en-GB');
    const stale = await publish(version, 'fr-FR');
    if (stale.answer !== 'requested') throw new Error(stale.answer);
    expect(await failuresOf(stale.request.id)).toEqual([
      expect.objectContaining({ code: 'translation_out_of_date' }),
    ]);
    await as((trx) =>
      setTranslationPolicy(trx, { fallback: 'source', outOfDate: 'publish', note: {} }),
    );
    const warned = await publish(version, 'fr-FR');
    if (warned.answer !== 'requested') throw new Error(warned.answer);
    expect(await failuresOf(warned.request.id)).toEqual([]);
  });

  it('reads an approved reference as the variant’s own approved revision, and falls back where the variant has none', async () => {
    const methods = await translated('Methods', 'Ponds were sampled.', 'Les étangs.');
    const approved = reference(methods.source.artifactId, { kind: 'approved' });
    const version = await document([approved]);
    const before = await publish(version, 'fr-FR');
    if (before.answer !== 'requested') throw new Error(before.answer);
    expect(
      (await as((trx) => publicationInputs(trx, before.request.id)))!.untranslated.has(approved.id),
    ).toBe(true);
    await approve(methods.variant, methods.line);
    const after = await publish(version, 'fr-FR');
    if (after.answer !== 'requested') throw new Error(after.answer);
    expect(
      (await as((trx) => publicationInputs(trx, after.request.id)))!.occurrences.get(approved.id)
        ?.version,
    ).toBe(methods.variant.id);
  });

  it('prints the document’s title and each section’s in the language where it gives them, reporting each it does not', async () => {
    const methods = await translated('Methods', 'Ponds were sampled.', 'Les étangs.');
    const section = (
      title: string,
      titles: Record<string, string> | undefined,
      children: OutlineNode[],
    ) => ({
      type: 'section' as const,
      id: nodeId(),
      title: [{ type: 'text' as const, value: title, marks: [] }],
      numbered: true,
      matter: 'body' as const,
      pageBreak: 'none' as const,
      values: {},
      ...(titles === undefined ? {} : { titles }),
      children,
    });
    const named = section('Field work', { 'fr-FR': 'Travail de terrain' }, [
      reference(methods.source.artifactId),
    ]);
    const unnamed = section('Discussion', undefined, []);
    const made = await document([named, unnamed]);
    const titled = await as(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: made.artifactId,
        openedFrom: made.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(made.content as OutlineDocument), titles: { fr: 'Étude des étangs' } },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    const asked = await publish(titled, 'fr-FR');
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    const inputs = (await as((trx) => publicationInputs(trx, asked.request.id)))!;
    expect(inputs.outline.title).toBe('Étude des étangs');
    expect(
      inputs.outline.nodes.map((node) => (node.type === 'section' ? node.title : null)),
    ).toEqual([
      [{ type: 'text', value: 'Travail de terrain', marks: [] }],
      [{ type: 'text', value: 'Discussion', marks: [] }],
    ]);
    const warnings = await as((trx) =>
      trx
        .selectFrom('publication_request')
        .select('warnings')
        .where('id', '=', asked.request.id)
        .executeTakeFirstOrThrow(),
    );
    expect(warnings.warnings).toEqual([{ code: 'title_untranslated', node: unnamed.id }]);
  });

  it('reads an approved reference as a translation of the approved source, though the source has newer drafts since', async () => {
    const created = await component('Summary');
    const approvedSource = await cut(created, [para('b1', 'Ponds.')], 'en-GB');
    await approve(approvedSource);
    await cut(approvedSource, [para('b1', 'Ponds, a draft.')], 'en-GB');
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: created.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    // Translated from the approved source, which a translator is shown: never refused as stale.
    const french = await cut(approvedSource, [para('b1', 'Étangs.')], 'fr-FR', {
      line: begun.line.id,
      translates: approvedSource.id,
    });
    await approve(french, begun.line.id);
    const approved = reference(created.artifactId, { kind: 'approved' });
    const version = await document([approved]);
    const asked = await publish(version, 'fr-FR');
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    const inputs = (await as((trx) => publicationInputs(trx, asked.request.id)))!;
    expect(inputs.occurrences.get(approved.id)?.version).toBe(french.id);
    expect(inputs.untranslated.has(approved.id)).toBe(false);
  });

  it('refuses a pin to a translation’s version, which only its source reads in a language, at the outline and at a publish', async () => {
    const methods = await translated('Methods', 'Ponds were sampled.', 'Les étangs.');
    expect(
      await as((trx) =>
        mayReference(trx, ada, {
          component: methods.source.artifactId,
          version: methods.variant.id,
        }),
      ),
    ).toBe('refused');
    // One stored before, or written past the outline's check, resolves to nothing.
    const pinned = reference(methods.source.artifactId, {
      kind: 'pinned',
      version: methods.variant.id,
    });
    const version = await document([pinned]);
    const asked = await publish(version);
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    expect(await failuresOf(asked.request.id)).toEqual([
      expect.objectContaining({ code: 'occurrence_unresolved', node: pinned.id }),
    ]);
  });

  it('never reads an approved reference as a variant translating source words newer than its approved revision', async () => {
    const created = await component('Abstract');
    const approvedSource = await cut(created, [para('b1', 'Ponds.')], 'en-GB');
    await approve(approvedSource);
    const draft = await cut(approvedSource, [para('b1', 'Ponds, unapproved.')], 'en-GB');
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: created.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const ahead = await cut(approvedSource, [para('b1', 'Étangs, non approuvé.')], 'fr-FR', {
      line: begun.line.id,
      translates: draft.id,
    });
    await approve(ahead, begun.line.id);
    const approved = reference(created.artifactId, { kind: 'approved' });
    const version = await document([approved]);
    const asked = await publish(version, 'fr-FR');
    if (asked.answer !== 'requested') throw new Error(asked.answer);
    const inputs = (await as((trx) => publicationInputs(trx, asked.request.id)))!;
    expect(inputs.occurrences.get(approved.id)?.version).toBe(approvedSource.id);
    expect(inputs.untranslated.has(approved.id)).toBe(true);
  });
});
