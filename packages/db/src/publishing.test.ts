import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  DEFAULT_CATALOGUE_VERSIONS,
  defaultNumberingScheme,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type PublishingFormat,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql, type KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { addThemeVersion, DEFAULT_THEME_ID, defaultTheme } from './themes.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  failPublicationRequest,
  publicationInputs,
  readPublication,
  readPublicationRequest,
  recordPreview,
  recordPublication,
  recordPublicationCheck,
  requestPublication,
  resolveOccurrences,
  sweepPreviews,
} from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  untilBlockedBy,
  type TestDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string, mode: ReferenceNode['mode'] = { kind: 'latest' }) =>
  ({
    type: 'reference',
    id: nodeId(),
    component,
    mode,
    ...base,
    children: [],
  }) satisfies ReferenceNode;
const section = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Like `latch`, but the opener carries a value out - here, a transaction's own backend pid. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

/**
 * Fails after an insert into `table` has run, as a lost connection or a driver's fault would: the
 * statement took effect, and its caller is told it failed.
 */
function failingAfterInsertInto(table: string): KyselyPlugin {
  const marked = new WeakSet<object>();
  return {
    transformQuery: (args) => {
      if (args.node.kind === 'InsertQueryNode' && args.node.into?.table.identifier.name === table) {
        marked.add(args.queryId);
      }
      return args.node;
    },
    transformResult: async (args) => {
      if (marked.has(args.queryId)) throw new Error('The connection was lost');
      return args.result;
    },
  };
}

/**
 * Every row any query returned, as Postgres returned it, so a test can say what was never selected -
 * not only what was left out of an answer after it was read.
 */
function capturingRows(): { readonly plugin: KyselyPlugin; readonly rows: unknown[] } {
  const rows: unknown[] = [];
  return {
    rows,
    plugin: {
      transformQuery: (args) => args.node,
      transformResult: async (args) => {
        rows.push(...args.result.rows);
        return args.result;
      },
    },
  };
}

describe('requesting and recording a publication', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const component = async (
    trx: TenantTransaction,
    space: string,
    author: string,
    title: string,
  ) => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  /** A document in General at a second version holding these nodes, or at 0.1 holding none. */
  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    if (nodes.length === 0) return made.version;
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const requested = async (trx: TenantTransaction, version: StoredVersion, requester: string) => {
    const answer = await requestPublication(trx, {
      documentId: version.artifactId,
      version: version.id,
      formats: ['pdf'],
      requester,
    });
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return answer.request.id;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada authors General; Grace authors General and Quality, which Ada may not read.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
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

  it('starts every tenant with a Publisher role holding read and publish', async () => {
    const role = await service.withTenant(production, (trx) => findRole(trx, 'Publisher'));
    expect(role?.permissions).toEqual(['read', 'publish']);
  });

  it('refuses a component the publisher may not read, recording its node and nothing of it', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [section('Introduction', [open, hidden])]);

      const id = await requested(trx, version, ada);
      const row = await trx
        .selectFrom('publication_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ state: 'queued', formats: ['pdf'], requested_by: ada });
      expect(row.failures).toEqual([
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden.id,
          block: null,
          detail: null,
        },
      ]);
      expect(JSON.stringify(row)).not.toContain(secret.artifactId);
      expect(JSON.stringify(row)).not.toContain(secret.id);
      const occurrences = await trx
        .selectFrom('publication_request_occurrence')
        .selectAll()
        .where('request_id', '=', id)
        .execute();
      expect(occurrences.map((each) => [each.node, each.version_id])).toEqual([
        [open.id, shared.id],
      ]);
    });
  });

  it('refuses a version that is not the latest, and a format the layout does not make, recording nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      const older = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', version.artifactId)
        .where('id', '<>', version.id)
        .executeTakeFirstOrThrow();
      const asked = (at: string, formats: string[]) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: at,
          formats,
          requester: ada,
        });
      // The current version by its heading alone: its outline names components the caller may not
      // read, so none of what it holds comes back.
      const stale = await asked(older.id, ['pdf']);
      expect(stale).toMatchObject({ answer: 'version.precondition', current: { id: version.id } });
      if (stale.answer !== 'version.precondition') throw new Error(stale.answer);
      expect(Object.keys(stale.current).sort()).toEqual(
        ['author', 'createdAt', 'id', 'note', 'revision', 'version'].sort(),
      );
      expect((await asked(version.id, ['html'])).answer).toBe('format.unsupported');
      expect((await asked(version.id, ['pdf', 'html'])).answer).toBe('format.unsupported');
      const requests = await trx
        .selectFrom('publication_request')
        .select('id')
        .where('document_id', '=', version.artifactId)
        .execute();
      expect(requests).toEqual([]);
    });
  });

  /** Every request the tenant holds, by id - to say a refusal recorded none. */
  const requestIds = (trx: TenantTransaction) =>
    trx
      .selectFrom('publication_request')
      .select('id')
      .execute()
      .then((rows) => rows.map((row) => row.id));

  /** A document in General at 0.1, in the language given. */
  const documentIn = async (trx: TenantTransaction, language: string) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
      language,
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  it('PUB-014 refuses a format its layout does not make, naming it, and records nothing', async () => {
    const rolledBack = new Error('rolled back');
    await expect(
      service.withTenant(production, async (trx) => {
        const version = await documentWith(trx, [section('Scope', [])]);
        // The layout the request would be made under declares its formats, one member each - here a
        // version of the default recorded without a Word page, so it makes `pdf` alone.
        const declared = await defaultLayout(trx);
        const pdfOnly = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: declared.versionId,
          author: ada,
          substance: {
            kind: 'layout',
            content: { ...declared.layout, formats: { pdf: declared.layout.formats.pdf } },
          },
        });
        if (pdfOnly.answer !== 'recorded') throw new Error(pdfOnly.answer);
        expect(Object.keys((await defaultLayout(trx)).layout.formats)).toEqual(['pdf']);
        const before = await requestIds(trx);
        const asked = (formats: string[]) =>
          requestPublication(trx, {
            documentId: version.artifactId,
            version: version.id,
            formats,
            requester: ada,
          });
        // Refused, never approximated as the formats it can make: the one it cannot is named.
        expect(await asked(['pdf', 'docx'])).toEqual({
          answer: 'format.unsupported',
          formats: ['docx'],
        });
        expect(await asked(['docx', 'odt', 'docx'])).toEqual({
          answer: 'format.unsupported',
          formats: ['docx', 'odt'],
        });
        expect(await requestIds(trx)).toEqual(before);
        // A format it declares is taken.
        expect((await asked(['pdf'])).answer).toBe('requested');
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });

  it('takes Word where its layout makes it, alone or beside the PDF, records the formats PDF first, and hands them to the job', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      // The default layout's 0.6 declares a Word page (Word 1, ruling R4).
      expect(Object.keys((await defaultLayout(trx)).layout.formats)).toEqual(['pdf', 'docx']);
      const formatsOf = async (formats: string[]) => {
        const answer = await requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats,
          requester: ada,
        });
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        const row = await trx
          .selectFrom('publication_request')
          .select('formats')
          .where('id', '=', answer.request.id)
          .executeTakeFirstOrThrow();
        // The job makes exactly the outputs the request recorded, in the order it recorded them.
        const inputs = await publicationInputs(trx, answer.request.id);
        expect(inputs!.request.formats).toEqual(row.formats);
        return row.formats;
      };
      expect(await formatsOf(['docx'])).toEqual(['docx']);
      expect(await formatsOf(['pdf', 'docx'])).toEqual(['pdf', 'docx']);
      // A set, in one order whichever it was asked in.
      expect(await formatsOf(['docx', 'pdf'])).toEqual(['pdf', 'docx']);
    });
  });

  it('refuses a request naming no format, or one format twice, and records nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, [section('Scope', [])]);
      const before = await requestIds(trx);
      for (const formats of [[], ['pdf', 'pdf']]) {
        expect(
          await requestPublication(trx, {
            documentId: version.artifactId,
            version: version.id,
            formats,
            requester: ada,
          }),
        ).toEqual({ answer: 'format.unsupported', formats: [] });
      }
      expect(await requestIds(trx)).toEqual(before);
    });
  });

  it("PUB-095 refuses a document in a language its layout is not written in, naming both, and takes one in the layout's language", async () => {
    await service.withTenant(production, async (trx) => {
      // The layout declares its words' language as a BCP 47 tag.
      expect((await defaultLayout(trx)).layout.language).toBe('en');
      const french = await documentIn(trx, 'fr');
      const before = await requestIds(trx);
      expect(
        await requestPublication(trx, {
          documentId: french.artifactId,
          version: french.id,
          formats: ['pdf'],
          requester: ada,
        }),
      ).toEqual({ answer: 'layout.language', document: 'fr', layout: 'en' });
      expect(await requestIds(trx)).toEqual(before);

      // `en`, taken as a language range, matches `en-GB`.
      const british = await documentIn(trx, 'en-GB');
      const answer = await requestPublication(trx, {
        documentId: british.artifactId,
        version: british.id,
        formats: ['pdf'],
        requester: ada,
      });
      expect(answer).toMatchObject({ answer: 'requested', request: { state: 'queued' } });
    });
  });

  it('records the layout version a request was made under, and hands it and the revision to the job', async () => {
    const rolledBack = new Error('rolled back');
    await expect(
      service.withTenant(production, async (trx) => {
        const declared = await defaultLayout(trx);
        const version = await documentIn(trx, 'en-GB');
        const id = await requested(trx, version, ada);
        const row = await trx
          .selectFrom('publication_request')
          .select(['layout_id', 'layout_version_id'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({
          layout_id: DEFAULT_LAYOUT_ID,
          layout_version_id: declared.versionId,
        });

        // The layout moves on after the request: the job is still handed the version it was made
        // under, never the latest.
        const next = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: declared.versionId,
          author: ada,
          substance: {
            kind: 'layout',
            content: {
              ...declared.layout,
              words: { ...declared.layout.words, contents: 'Table of contents' },
            },
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        // The default is at 0.7 since 0035, so the version recorded after it is 0.8.
        expect((await defaultLayout(trx)).number).toBe('0.8');

        const inputs = await publicationInputs(trx, id);
        expect(inputs!.layout).toEqual({ versionId: declared.versionId, layout: declared.layout });
        // The document's version as `revision.version` (VER-009): a first version is 0.1.
        expect(inputs!.revision).toBe('0.1');
        // Thrown to roll the layout's 0.8 back: the rest of the suite publishes under the default.
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });

  it('records the theme version a request was made under, and hands it to the job resolved', async () => {
    const rolledBack = new Error('rolled back');
    await expect(
      service.withTenant(production, async (trx) => {
        const declared = await defaultTheme(trx);
        const version = await documentIn(trx, 'en-GB');
        const id = await requested(trx, version, ada);
        const row = await trx
          .selectFrom('publication_request')
          .select(['theme_id', 'theme_version_id'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({ theme_id: DEFAULT_THEME_ID, theme_version_id: declared.versionId });

        // The theme moves on after the request: the job is still handed the version it was made
        // under, never the latest, read with the catalogue versions that version names.
        const next = await addThemeVersion(trx, {
          artifactId: DEFAULT_THEME_ID,
          openedFrom: declared.versionId,
          author: ada,
          theme: { ...declared.content, paper: '#fafafa' },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        // The default is at 0.4 since 0034, so the version recorded after it is 0.5.
        expect((await defaultTheme(trx)).number).toBe('0.5');

        const inputs = await publicationInputs(trx, id);
        expect(inputs!.theme).toEqual({ versionId: declared.versionId, theme: declared.theme });
        expect(inputs!.theme!.theme.paper).toBe('#ffffff');
        // Thrown to roll the theme's 0.5 back: the rest of the suite publishes under the default.
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });

  it('answers document.missing for an id that is no document, and records nothing', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Method');
      const before = await trx.selectFrom('publication_request').select('id').execute();
      for (const documentId of [shared.artifactId, randomUUID(), 'not-a-uuid']) {
        await expect(
          requestPublication(trx, {
            documentId,
            version: shared.id,
            formats: ['pdf'],
            requester: ada,
          }),
        ).resolves.toEqual({ answer: 'document.missing' });
      }
      const after = await trx.selectFrom('publication_request').select('id').execute();
      expect(after).toEqual(before);
    });
  });

  it('never selects a row of a component the publisher may not read, however it is referenced', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const hiddenPin = reference(secret.artifactId, { kind: 'pinned', version: secret.id });
      // A readable component's reference pinned to the unreadable one's version (F7).
      const crossPin = reference(shared.artifactId, { kind: 'pinned', version: secret.id });
      const approved = reference(shared.artifactId, { kind: 'approved' });
      const missing = reference(randomUUID());
      const version = await documentWith(trx, [
        section('Introduction', [open, hidden, hiddenPin, crossPin, approved, missing]),
      ]);
      const outline = version.content as OutlineDocument;

      const asAda = capturingRows();
      expect(await resolveOccurrences(trx.withPlugin(asAda.plugin), outline, ada)).toEqual([
        { node: open.id, outcome: 'resolved', component: shared.artifactId, version: shared.id },
        { node: hidden.id, outcome: 'unreadable' },
        { node: hiddenPin.id, outcome: 'unreadable' },
        { node: crossPin.id, outcome: 'unresolved' },
        { node: approved.id, outcome: 'unresolved' },
        // A component that does not exist is told apart from one that may not be read by nothing.
        { node: missing.id, outcome: 'unreadable' },
      ]);
      expect(asAda.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(asAda.rows)).not.toContain(secret.artifactId);
      expect(JSON.stringify(asAda.rows)).not.toContain(secret.id);

      // The same capture sees the component when its reader resolves it, so its silence above is the
      // query's restriction and not the capture missing a row.
      const asGrace = capturingRows();
      expect(await resolveOccurrences(trx.withPlugin(asGrace.plugin), outline, grace)).toEqual([
        { node: open.id, outcome: 'resolved', component: shared.artifactId, version: shared.id },
        { node: hidden.id, outcome: 'resolved', component: secret.artifactId, version: secret.id },
        {
          node: hiddenPin.id,
          outcome: 'resolved',
          component: secret.artifactId,
          version: secret.id,
        },
        { node: crossPin.id, outcome: 'unresolved' },
        { node: approved.id, outcome: 'unresolved' },
        { node: missing.id, outcome: 'unreadable' },
      ]);
      expect(JSON.stringify(asGrace.rows)).toContain(secret.id);
    });
  });

  it('lets the runtime role finish a request once, and change nothing else of it or its occurrences', async () => {
    const { id, node } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const open = reference(shared.artifactId);
      const version = await documentWith(trx, [section('Method', [open])]);
      return { id: await requested(trx, version, ada), node: open.id };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`update publication_request set requested_by = ${grace} where id = ${id}`,
      /permission denied/,
    );
    await refused(
      sql`update publication_request set formats = array['pdf'] where id = ${id}`,
      /permission denied/,
    );
    // Deleting a request is the preview sweep's alone (0036), and never a publish's.
    await refused(
      sql`delete from publication_request where id = ${id}`,
      /only a preview is deleted, an hour after it finished/,
    );
    await refused(sql`truncate publication_request cascade`, /permission denied/);
    await refused(
      sql`update publication_request_occurrence set node = ${nodeId()} where request_id = ${id}`,
      /permission denied/,
    );
    await refused(
      sql`delete from publication_request_occurrence where request_id = ${id}`,
      /permission denied/,
    );
    await refused(sql`truncate publication_request_occurrence`, /permission denied/);
    // Still queued, it may not have its failures rewritten short of finishing it.
    await refused(
      sql`update publication_request set failures = '[]' where id = ${id}`,
      /finished once/,
    );

    await service.withTenant(production, (trx) =>
      sql`update publication_request set state = 'done', finished_at = now() where id = ${id}`.execute(
        trx,
      ),
    );
    await refused(
      sql`update publication_request set state = 'queued', finished_at = null where id = ${id}`,
      /finished once/,
    );
    await refused(
      sql`update publication_request set state = 'failed',
            failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]'
          where id = ${id}`,
      /finished once/,
    );
    await refused(
      sql`update publication_request set finished_at = now() where id = ${id}`,
      /finished once/,
    );

    const { row, occurrences } = await service.withTenant(production, async (trx) => ({
      row: await trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'requested_by'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
      occurrences: await trx
        .selectFrom('publication_request_occurrence')
        .select('node')
        .where('request_id', '=', id)
        .execute(),
    }));
    expect(row).toEqual({ state: 'done', failures: [], requested_by: ada });
    expect(occurrences).toEqual([{ node }]);
  });

  it('finishes a request carrying a refusal only as failed, and lets only failed replace its failures', async () => {
    const { id, hidden } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [
        section('Method', [reference(shared.artifactId), hidden]),
      ]);
      return { id: await requested(trx, version, ada), hidden: hidden.id };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`update publication_request set state = 'done', finished_at = now() where id = ${id}`,
      /publication_request_done_without_failures/,
    );
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), failures = '[]'
          where id = ${id}`,
      /finished once/,
    );
    const failures = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select('failures')
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(failures.failures).toEqual([
      { stage: 'resolve', code: 'occurrence_unreadable', node: hidden, block: null, detail: null },
    ]);

    // A platform failure after the last attempt replaces the list with its own.
    const store = [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }];
    await service.withTenant(production, (trx) =>
      sql`update publication_request
            set state = 'failed', finished_at = now(), failures = ${JSON.stringify(store)}::jsonb
          where id = ${id}`.execute(trx),
    );
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select(['state', 'failures'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ state: 'failed', failures: store });
  });

  it('lets the runtime role insert a request only as queued and now, and an occurrence only into a queued one', async () => {
    const { version, shared, finished } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const version = await documentWith(trx, [section('Scope', [reference(shared.artifactId)])]);
      const finished = await requested(trx, version, ada);
      await sql`update publication_request set state = 'done', finished_at = now()
                where id = ${finished}`.execute(trx);
      return { version, shared, finished };
    });
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);

    await refused(
      sql`insert into publication_request
            (document_id, document_version_id, formats, requested_by, state, finished_at)
          values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, 'done', now())`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request
            (document_id, document_version_id, formats, requested_by, requested_at)
          values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, now() - interval '1 year')`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request (id, document_id, document_version_id, formats, requested_by)
          values (${randomUUID()}, ${version.artifactId}, ${version.id}, array['pdf'], ${ada})`,
      /permission denied/,
    );
    await refused(
      sql`insert into publication_request_occurrence (request_id, node, component_id, version_id)
          values (${finished}, ${nodeId()}, ${shared.artifactId}, ${shared.id})`,
      /only while its request is queued/,
    );

    const occurrences = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request_occurrence')
        .select('node')
        .where('request_id', '=', finished)
        .execute(),
    );
    expect(occurrences).toHaveLength(1);
  });
  /** A PDF made by Typst under template 2, over bytes the store need not hold. */
  const pdfOutput = (fill = 'c') => ({
    format: 'pdf' as const,
    engineVersion: '0.15.1',
    templateVersion: 2,
    key: `${production.role}/sha256/${fill.repeat(64)}`,
    sha256: fill.repeat(64),
    bytes: 1000,
  });
  /**
   * A Word document made by the writer's second version, with what it could not carry: a face, and a
   * table's header column, its header its style does not repeat, and its label (Word 2, ruling R7);
   * and a heading and a caption holding an equation Word's rebuilt entries flatten (the final review
   * of Word 4, I2), a heading's naming no block.
   */
  const readings = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1', label: 'Table 1.1' };
  const docxOutput = (fill = 'd') => ({
    format: 'docx' as const,
    writerVersion: 'word/2',
    report: [
      { kind: 'face_substituted' as const, family: 'STIX Two Math', wordFamily: 'Cambria Math' },
      { kind: 'header_column_lost' as const, ...readings },
      { kind: 'header_repeated' as const, ...readings },
      { kind: 'continuation_label_omitted' as const, ...readings, label: null },
      { kind: 'equation_flattened' as const, ...readings, block: null, label: '1' },
      { kind: 'equation_flattened' as const, ...readings },
      { kind: 'pages_cite_the_pdf' as const },
    ],
    key: `${production.role}/sha256/${fill.repeat(64)}`,
    sha256: fill.repeat(64),
    bytes: 2000,
  });
  /**
   * What a worker records for a request made under a layout - template 2 and pipeline 2 - over an
   * output the store need not hold.
   */
  const recording = (requestId: string) => ({
    requestId,
    pipelineVersion: '2',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    outputs: [pdfOutput()],
  });

  it('STY-002 sets publications from two spaces by the one tenant-wide theme and its catalogue versions', async () => {
    const { declared, requests, publications } = await service.withTenant(
      production,
      async (trx) => {
        const declared = await defaultTheme(trx);
        const inGeneral = await documentIn(trx, 'en-GB');
        const inQuality = await createDocument(trx, {
          spaceId: quality,
          title: 'Calibration record',
          language: 'en-GB',
          direction: 'ltr',
          author: grace,
        });
        if (inQuality.answer !== 'created') throw new Error(inQuality.answer);
        const requests = [
          await requested(trx, inGeneral, ada),
          await requested(trx, inQuality.version, grace),
        ];
        const inputs = await Promise.all(requests.map((id) => publicationInputs(trx, id)));
        expect(inputs.map((each) => each!.request.spaceId)).toEqual([general, quality]);
        for (const each of inputs) {
          expect(each!.theme!.versionId).toBe(declared.versionId);
          expect(each!.theme!.theme.catalogues).toEqual(DEFAULT_CATALOGUE_VERSIONS);
        }
        const publications = [];
        for (const id of requests) publications.push(await recordPublication(trx, recording(id)));
        return { declared, requests, publications };
      },
    );

    // Two publications, one in each space, each recording the one theme version, which names the six
    // catalogue versions: versions of catalogues that are the tenant's, in no space.
    const rows = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication as p')
        .innerJoin('artifact as a', 'a.id', 'p.id')
        .select(['p.request_id', 'a.space_id', 'p.theme_id', 'p.theme_version_id'])
        .where(
          'p.id',
          'in',
          publications.map((each) => each!),
        )
        .execute(),
    );
    expect(
      requests.map((id) => {
        const { space_id, theme_id, theme_version_id } = rows.find((row) => row.request_id === id)!;
        return { space_id, theme_id, theme_version_id };
      }),
    ).toEqual([
      { space_id: general, theme_id: DEFAULT_THEME_ID, theme_version_id: declared.versionId },
      { space_id: quality, theme_id: DEFAULT_THEME_ID, theme_version_id: declared.versionId },
    ]);
    expect(declared.content.catalogues).toEqual(DEFAULT_CATALOGUE_VERSIONS);
    const catalogues = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact_version as v')
        .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
        .select(['v.id', 'a.kind', 'a.space_id'])
        .where('v.id', 'in', Object.values(DEFAULT_CATALOGUE_VERSIONS))
        .execute(),
    );
    expect(catalogues).toHaveLength(6);
    for (const each of catalogues)
      expect(each).toMatchObject({ kind: 'catalogue', space_id: null });
  });

  /** How many of each row a publication is made of the tenant holds - to say a record left none. */
  const publications = () =>
    service.withTenant(production, async (trx) => ({
      records: (await trx.selectFrom('publication').select('id').execute()).length,
      artifacts: (
        await trx.selectFrom('artifact').select('id').where('kind', '=', 'publication').execute()
      ).length,
      inputs: (await trx.selectFrom('publication_input').select('version_id').execute()).length,
      outputs: (await trx.selectFrom('publication_output').select('sha256').execute()).length,
    }));

  const stateOf = (id: string) =>
    service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'finished_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );

  it('reads back exactly the versions a request recorded, and nothing it refused', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [section('Introduction', [open, hidden])]);
      const adas = await publicationInputs(trx, await requested(trx, version, ada));
      expect([...adas!.occurrences.keys()]).toEqual([open.id]);
      expect(adas!.refused.map((each) => each.node)).toEqual([hidden.id]);
      // Grace may read both.
      const graces = await publicationInputs(trx, await requested(trx, version, grace));
      // As a set: the occurrences are keyed by node, and the query reading them names no order, so
      // the order rows come back in is the plan's (it changed when 0018 added the layout's version).
      expect(new Set(graces!.occurrences.keys())).toEqual(new Set([open.id, hidden.id]));
      expect(graces!.refused).toEqual([]);
    });
  });

  it('reads a request as it was made: who asked, when, the document at its version, and each version it took', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const open = reference(shared.artifactId);
      const version = await documentWith(trx, [section('Method', [open])]);
      const id = await requested(trx, version, ada);
      const row = await trx
        .selectFrom('publication_request')
        .select('requested_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const inputs = await publicationInputs(trx, id);
      expect(inputs!.request).toEqual({
        id,
        kind: 'publish',
        documentId: version.artifactId,
        documentVersionId: version.id,
        requestedBy: ada,
        requestedAt: row.requested_at,
        spaceId: general,
        formats: ['pdf'],
      });
      expect(inputs!.outline).toEqual(version.content);
      expect(inputs!.occurrences.get(open.id)?.version).toBe(shared.id);
      expect(inputs!.occurrences.get(open.id)?.content).toEqual(shared.content);
      expect(await publicationInputs(trx, randomUUID())).toBeUndefined();
    });
  });

  it('PUB-050 records a publication the runtime role can insert and read and never change', async () => {
    const rowOf = (trx: TenantTransaction, id: string) =>
      trx.selectFrom('publication').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const { first, again, version, queued } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      const one = await recordPublication(trx, recording(await requested(trx, version, ada)));
      const recorded = await rowOf(trx, one!);
      // A second worker racing an expired lease finds the request done and records nothing.
      expect(await recordPublication(trx, recording(recorded.request_id))).toBeUndefined();
      // Correcting it is publishing again: another request, another publication, the first unchanged.
      const two = await recordPublication(trx, recording(await requested(trx, version, ada)));
      expect(await rowOf(trx, one!)).toEqual(recorded);
      return { first: one!, again: two!, version, queued: await requested(trx, version, ada) };
    });
    expect(again).not.toBe(first);
    for (const statement of [
      sql`update publication set approval = 'none' where id = ${first}`,
      sql`delete from publication where id = ${first}`,
      sql`delete from publication_output where publication_id = ${first}`,
      sql`update publication_input set node = null where publication_id = ${first}`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }

    // Nothing is added to a publication once made: not a version it did not read, nor another output.
    const other = 'e'.repeat(64);
    for (const statement of [
      sql`insert into publication_input (publication_id, version_id, node)
          values (${first}, ${version.id}, ${nodeId()})`,
      sql`insert into publication_output (publication_id, format, object_key, sha256, bytes, standard,
            producer, producer_version, report)
          values (${first}, 'docx', ${`${production.role}/sha256/${other}`}, ${other}, 1, null,
            'word', 'word/1', '[]')`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /only while its publication's request is queued/,
      );
    }

    // Nor is a publication made except as its request was made: one inserted beside a queued request
    // is refused when its transaction commits - bare, or whole and its request marked done, in
    // another publisher's name and back-dated.
    const forged = async (trx: TenantTransaction) => {
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'publication', space_id: general })
        .returning('id')
        .executeTakeFirstOrThrow();
      const made = recording(queued);
      // Under its request's own layout, so the row passes every check but the one at commit.
      const under = await trx
        .selectFrom('publication_request')
        .select(['layout_id', 'layout_version_id'])
        .where('id', '=', queued)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('publication')
        .values({
          id: artifact.id,
          request_id: queued,
          document_id: version.artifactId,
          document_version_id: version.id,
          publisher: grace,
          published_at: new Date('2020-01-01T00:00:00Z'),
          approval: 'none',
          formats: ['pdf'],
          engine: 'typst',
          engine_version: '0.15.1',
          template: 'publication',
          template_version: 2,
          pipeline_version: made.pipelineVersion,
          fonts: JSON.stringify(made.fonts),
          data_sha256: made.dataSha256,
          numbering: JSON.stringify(made.numbering),
          layout_id: under.layout_id,
          layout_version_id: under.layout_version_id,
        })
        .execute();
      return artifact.id;
    };
    await expect(service.withTenant(production, forged)).rejects.toThrow(/recorded whole/);
    await expect(
      service.withTenant(production, async (trx) => {
        const id = await forged(trx);
        await trx
          .insertInto('publication_input')
          .values({ publication_id: id, version_id: version.id, node: null })
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: id,
            format: 'pdf',
            object_key: `${production.role}/sha256/${other}`,
            sha256: other,
            bytes: 1,
            standard: 'ua-1',
            producer: 'typst',
            producer_version: '2',
            report: '[]',
          })
          .execute();
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${queued}`.execute(trx);
      }),
    ).rejects.toThrow(/recorded whole/);
    // Its request is untouched by either, and publishes as it was made.
    expect(await stateOf(queued)).toEqual({ state: 'queued', failures: [], finished_at: null });
    expect(
      await service.withTenant(production, (trx) => recordPublication(trx, recording(queued))),
    ).toBeDefined();
  });

  /** Asks for a preview of a version, as the PDF unless told; answers the request's id. */
  const previewed = async (
    trx: TenantTransaction,
    version: StoredVersion,
    requester: string,
    formats: readonly string[] = ['pdf'],
  ) => {
    const answer = await requestPublication(trx, {
      documentId: version.artifactId,
      version: version.id,
      formats,
      requester,
      kind: 'preview',
    });
    if (answer.answer !== 'requested') throw new Error(answer.answer);
    return answer.request.id;
  };
  /** A preview's PDF in the tenant's own store, over bytes the store need not hold. */
  const previewPdf = (fill = 'f') => ({
    key: `${production.role}/sha256/${fill.repeat(64)}`,
    sha256: fill.repeat(64),
    bytes: 1000,
  });
  /** The job queued for a request: its kind, read as the platform holds it. */
  const jobKindOf = async (requestId: string) =>
    (
      await queryAs(db.adminUrl, 'select kind from platform.job where subject_id = $1', [requestId])
    ).rows.map((row: { kind: string }) => row.kind);

  it('asks for a preview as a publish is asked for: the same versions, layout, theme and refusals recorded, the PDF alone, and a preview job queued', async () => {
    const { publish, preview, open } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const open = reference(shared.artifactId);
      const version = await documentWith(trx, [
        section('Method', [open, reference(secret.artifactId)]),
      ]);
      return {
        publish: await requested(trx, version, ada),
        preview: await previewed(trx, version, ada),
        open,
      };
    });
    const { rows, occurrences, inputs, read } = await service.withTenant(
      production,
      async (trx) => ({
        rows: await trx
          .selectFrom('publication_request')
          .select([
            'id',
            'kind',
            'formats',
            'state',
            'failures',
            'document_version_id',
            'layout_version_id',
            'theme_version_id',
            'preview_key',
            'expires_at',
          ])
          .where('id', 'in', [publish, preview])
          .execute(),
        occurrences: await trx
          .selectFrom('publication_request_occurrence')
          .select(['request_id', 'node', 'version_id'])
          .where('request_id', 'in', [publish, preview])
          .execute(),
        inputs: await publicationInputs(trx, preview),
        read: await readPublicationRequest(trx, preview),
      }),
    );
    const rowOf = (id: string) => rows.find((row) => row.id === id)!;
    /** A request's row but for its id and its kind. */
    const apart = (id: string) =>
      Object.fromEntries(
        Object.entries(rowOf(id)).filter(([column]) => column !== 'id' && column !== 'kind'),
      );
    expect([rowOf(publish).kind, rowOf(preview).kind]).toEqual(['publish', 'preview']);
    const asPublished = apart(publish);
    const asPreviewed = apart(preview);
    // Everything else alike: the PDF, the document's version, the layout and theme it is set under,
    // and the component the publisher may not read refused by its node, as a publish refuses it.
    expect(asPreviewed).toEqual(asPublished);
    expect(asPreviewed).toMatchObject({ formats: ['pdf'], state: 'queued', preview_key: null });
    expect((asPreviewed.failures as { code: string }[]).map((each) => each.code)).toEqual([
      'occurrence_unreadable',
    ]);
    const taken = (id: string) =>
      occurrences
        .filter((each) => each.request_id === id)
        .map(({ node, version_id }) => ({ node, version_id }));
    expect(taken(preview)).toEqual(taken(publish));
    expect(taken(preview).map((each) => each.node)).toEqual([open.id]);
    // Its own kind of job, on the one queue, and read back as a preview.
    expect(await jobKindOf(publish)).toEqual(['publish']);
    expect(await jobKindOf(preview)).toEqual(['preview']);
    expect(inputs!.request.kind).toBe('preview');
    expect(read).toMatchObject({ kind: 'preview', state: 'queued', preview: null });
  });

  it('refuses a preview in any format but the PDF alone, naming those beyond it, and records nothing', async () => {
    const counted = () =>
      service.withTenant(production, (trx) =>
        trx
          .selectFrom('publication_request')
          .select('id')
          .execute()
          .then((rows) => rows.length),
      );
    const before = await counted();
    const answers = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      const ask = (formats: string[]) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats,
          requester: ada,
          kind: 'preview',
        });
      return [await ask(['pdf', 'docx']), await ask(['docx']), await ask(['docx', 'pdf'])];
    });
    // The default layout makes Word, so it is the preview that refuses it (PV-C), never the layout.
    expect(answers).toEqual([
      { answer: 'format.unsupported', formats: ['docx'] },
      { answer: 'format.unsupported', formats: ['docx'] },
      { answer: 'format.unsupported', formats: ['docx'] },
    ]);
    expect(await counted()).toBe(before);
  });

  it("records a preview's PDF and when it expires, once, and nothing of a publication", async () => {
    const before = await publications();
    const { id, expiresAt, again, row, read } = await service.withTenant(
      production,
      async (trx) => {
        const version = await documentWith(trx, []);
        const id = await previewed(trx, version, ada);
        const expiresAt = await recordPreview(trx, { requestId: id, ...previewPdf() });
        // A second worker racing an expired lease finds it done and records nothing.
        const again = await recordPreview(trx, { requestId: id, ...previewPdf('e') });
        const row = await trx
          .selectFrom('publication_request')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return { id, expiresAt, again, row, read: await readPublicationRequest(trx, id) };
      },
    );
    expect(again).toBeUndefined();
    expect(row).toMatchObject({
      kind: 'preview',
      state: 'done',
      failures: [],
      preview_key: previewPdf().key,
      preview_sha256: previewPdf().sha256,
      preview_bytes: 1000,
    });
    // An hour after it finished (PV-F).
    expect(row.expires_at!.getTime() - row.finished_at!.getTime()).toBe(60 * 60 * 1000);
    expect(expiresAt).toEqual(row.expires_at);
    expect(read).toEqual({
      id,
      documentId: row.document_id,
      requestedBy: ada,
      kind: 'preview',
      state: 'done',
      failures: [],
      publication: null,
      preview: {
        key: previewPdf().key,
        sha256: previewPdf().sha256,
        bytes: 1000,
        expiresAt: row.expires_at,
      },
    });
    // No artifact, publication, input or output: nothing lists it, searches it or keeps it.
    expect(await publications()).toEqual(before);
  });

  it('records a preview only by recordPreview and a publication only by recordPublication, and a preview carrying a refusal by neither', async () => {
    const { publish, preview, refused } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      const secret = await component(trx, quality, grace, 'Calibration');
      const hidden = await documentWith(trx, [section('Method', [reference(secret.artifactId)])]);
      return {
        publish: await requested(trx, version, ada),
        preview: await previewed(trx, version, ada),
        refused: await previewed(trx, hidden, ada),
      };
    });
    await expect(
      service.withTenant(production, (trx) =>
        recordPreview(trx, { requestId: publish, ...previewPdf() }),
      ),
    ).rejects.toThrow(/a publish/);
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, recording(preview))),
    ).rejects.toThrow(/a preview/);
    await expect(
      service.withTenant(production, (trx) =>
        recordPreview(trx, { requestId: refused, ...previewPdf() }),
      ),
    ).rejects.toThrow(/carries failures/);
    for (const id of [publish, preview, refused]) {
      expect((await stateOf(id)).state, id).toBe('queued');
    }
    // A publish request is never read as a preview.
    const read = await service.withTenant(production, (trx) =>
      readPublicationRequest(trx, publish),
    );
    expect(read).toMatchObject({ kind: 'publish', preview: null, publication: null });
  });

  it('lets the runtime role finish a preview done only with its PDF, in its own store, and a publish never with one', async () => {
    const { publish, preview, version, under } = await service.withTenant(
      production,
      async (trx) => {
        const version = await documentWith(trx, []);
        const publish = await requested(trx, version, ada);
        const under = await trx
          .selectFrom('publication_request')
          .select(['layout_id', 'layout_version_id', 'theme_id', 'theme_version_id'])
          .where('id', '=', publish)
          .executeTakeFirstOrThrow();
        return { publish, preview: await previewed(trx, version, ada), version, under };
      },
    );
    const refused = async (statement: ReturnType<typeof sql>, why: RegExp) =>
      expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(why);
    const { key, sha256 } = previewPdf();
    const other = 'e'.repeat(64);

    // A preview done without its PDF, or with part of it.
    await refused(
      sql`update publication_request set state = 'done', finished_at = now() where id = ${preview}`,
      /publication_request_preview_whole/,
    );
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), preview_key = ${key},
            preview_sha256 = ${sha256}, preview_bytes = 1000 where id = ${preview}`,
      /publication_request_preview_whole/,
    );
    // Its PDF on a preview that failed.
    await refused(
      sql`update publication_request set state = 'failed', finished_at = now(),
            failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]',
            preview_key = ${key}, preview_sha256 = ${sha256}, preview_bytes = 1000,
            expires_at = now() + interval '1 hour'
          where id = ${preview}`,
      /publication_request_preview_whole/,
    );
    // A publish with any of a preview's columns.
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), preview_key = ${key},
            preview_sha256 = ${sha256}, preview_bytes = 1000, expires_at = now() + interval '1 hour'
          where id = ${publish}`,
      /publication_request_preview_only/,
    );
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(),
            expires_at = now() + interval '1 hour' where id = ${publish}`,
      /publication_request_preview_only/,
    );
    // A PDF that is not what it says: a key not ending in its own digest, a digest that is not one,
    // no bytes, or an expiry other than an hour after it finished.
    const capitals = sha256.toUpperCase();
    for (const [why, pdf] of [
      ['a key naming other bytes', { key: `${production.role}/sha256/${other}`, sha256, bytes: 1 }],
      [
        'a digest in capitals',
        { key: `${production.role}/sha256/${capitals}`, sha256: capitals, bytes: 1 },
      ],
      ['no bytes', { key, sha256, bytes: 0 }],
    ] as const) {
      await expect(
        service.withTenant(production, (trx) =>
          sql`update publication_request set state = 'done', finished_at = now(),
                preview_key = ${pdf.key}, preview_sha256 = ${pdf.sha256},
                preview_bytes = ${pdf.bytes}, expires_at = now() + interval '1 hour'
              where id = ${preview}`.execute(trx),
        ),
        why,
      ).rejects.toThrow(/publication_request_preview_output/);
    }
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), preview_key = ${key},
            preview_sha256 = ${sha256}, preview_bytes = 1000, expires_at = now()
          where id = ${preview}`,
      /publication_request_preview_output/,
    );
    // Kept for longer than the hour a preview lasts (PV-F): the links follow the expiry.
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(), preview_key = ${key},
            preview_sha256 = ${sha256}, preview_bytes = 1000, expires_at = now() + interval '1 year'
          where id = ${preview}`,
      /publication_request_preview_output/,
    );
    // Kept in another tenant's store: the key is the tenant's own, as an output's is.
    await refused(
      sql`update publication_request set state = 'done', finished_at = now(),
            preview_key = ${`t_other/sha256/${sha256}`}, preview_sha256 = ${sha256},
            preview_bytes = 1000, expires_at = now() + interval '1 hour'
          where id = ${preview}`,
      /its own tenant's store/,
    );
    // A preview asking for Word, or both, and one inserted with a PDF it has not made.
    for (const formats of [sql`array['pdf', 'docx']`, sql`array['docx']`]) {
      await refused(
        sql`insert into publication_request (document_id, document_version_id, formats, requested_by,
              kind, layout_id, layout_version_id, theme_id, theme_version_id)
            values (${version.artifactId}, ${version.id}, ${formats}, ${ada}, 'preview',
              ${under.layout_id}, ${under.layout_version_id}, ${under.theme_id},
              ${under.theme_version_id})`,
        /publication_request_preview_pdf_alone/,
      );
    }
    await refused(
      sql`insert into publication_request (document_id, document_version_id, formats, requested_by,
            kind, preview_key, layout_id, layout_version_id, theme_id, theme_version_id)
          values (${version.artifactId}, ${version.id}, array['pdf'], ${ada}, 'preview', ${key},
            ${under.layout_id}, ${under.layout_version_id}, ${under.theme_id},
            ${under.theme_version_id})`,
      /permission denied/,
    );

    // Whole, it is done, by the grant the runtime role holds; and then changes no more.
    await service.withTenant(production, (trx) =>
      sql`update publication_request set state = 'done', finished_at = now(), preview_key = ${key},
            preview_sha256 = ${sha256}, preview_bytes = 1000, expires_at = now() + interval '1 hour'
          where id = ${preview}`.execute(trx),
    );
    await refused(
      sql`update publication_request set preview_bytes = 2 where id = ${preview}`,
      /finished once/,
    );
    await refused(
      sql`update publication_request set expires_at = now() + interval '1 year' where id = ${preview}`,
      /finished once/,
    );
    expect(await stateOf(publish)).toMatchObject({ state: 'queued' });
  });

  it("freezes a request's kind when it is finished, whatever role finishes it", async () => {
    const publish = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const failed = JSON.stringify([
      { stage: 'store', code: 'store_failed', node: null, block: null, detail: null },
    ]);
    // The runtime role may not write the kind at all after the insert.
    await expect(
      service.withTenant(production, (trx) =>
        sql`update publication_request set state = 'failed', finished_at = now(),
              failures = ${failed}::jsonb, kind = 'preview'
            where id = ${publish}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    // And a role that may is refused by the rule every finish is held to: a failed publish turned
    // into a failed preview would otherwise pass every check.
    await expect(
      queryAs(
        db.adminUrl,
        `update "${production.schema}".publication_request
            set state = 'failed', finished_at = now(), failures = $2::jsonb, kind = 'preview'
          where id = $1`,
        [publish, failed],
      ),
    ).rejects.toThrow(/finished once/);
    expect(await stateOf(publish)).toMatchObject({ state: 'queued' });
  });

  it('refuses at commit a publication recorded for a preview, however whole', async () => {
    const { preview, publish } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      return {
        publish: await requested(trx, version, ada),
        preview: await previewed(trx, version, ada),
      };
    });
    const sha = 'a'.repeat(64);
    /**
     * A publication inserted whole beside its request, as `recordPublication` would insert it, and
     * the request marked done: a preview's with its PDF, which a publish's may not carry.
     */
    const forge = (requestId: string, asPreview: boolean) =>
      service.withTenant(production, async (trx) => {
        const request = await trx
          .selectFrom('publication_request')
          .selectAll()
          .where('id', '=', requestId)
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: general })
          .returning('id')
          .executeTakeFirstOrThrow();
        const made = recording(requestId);
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: requestId,
            document_id: request.document_id,
            document_version_id: request.document_version_id,
            publisher: request.requested_by,
            published_at: request.requested_at,
            approval: 'none',
            formats: ['pdf'],
            engine: 'typst',
            engine_version: '0.15.1',
            template: 'publication',
            template_version: 13,
            pipeline_version: '13',
            fonts: JSON.stringify(made.fonts),
            data_sha256: made.dataSha256,
            numbering: JSON.stringify(made.numbering),
            layout_id: request.layout_id,
            layout_version_id: request.layout_version_id,
            theme_id: request.theme_id,
            theme_version_id: request.theme_version_id,
          })
          .execute();
        await trx
          .insertInto('publication_input')
          .values({
            publication_id: artifact.id,
            version_id: request.document_version_id,
            node: null,
          })
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: artifact.id,
            format: 'pdf',
            object_key: `${production.role}/sha256/${sha}`,
            sha256: sha,
            bytes: 1,
            standard: 'ua-1',
            producer: 'typst',
            producer_version: '13',
            report: '[]',
          })
          .execute();
        await (
          asPreview
            ? sql`update publication_request set state = 'done', finished_at = now(),
                  preview_key = ${`${production.role}/sha256/${sha}`}, preview_sha256 = ${sha},
                  preview_bytes = 1, expires_at = now() + interval '1 hour'
                where id = ${requestId}`
            : sql`update publication_request set state = 'done', finished_at = now()
                where id = ${requestId}`
        ).execute(trx);
        return artifact.id;
      });
    const before = await publications();
    await expect(forge(preview, true)).rejects.toThrow(/recorded whole/);
    expect(await publications()).toEqual(before);
    expect(await stateOf(preview)).toMatchObject({ state: 'queued' });
    // The same forgery of a publish's commits: the preview's kind is all that refused it.
    expect(await forge(publish, false)).toBeDefined();
  });

  it('records every version a publication read, what made it, and its output by its own digest', async () => {
    const made = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const other = await component(trx, general, ada, 'Method');
      const open = reference(shared.artifactId);
      const pinned = reference(other.artifactId, { kind: 'pinned', version: other.id });
      const version = await documentWith(trx, [
        section('Introduction', [open]),
        section('Scope', [pinned]),
      ]);
      const request = await requested(trx, version, ada);
      const id = await recordPublication(trx, recording(request));
      return { id: id!, request, version, shared, other, open, pinned };
    });

    await service.withTenant(production, async (trx) => {
      const layout = await defaultLayout(trx);
      const theme = await defaultTheme(trx);
      const request = await trx
        .selectFrom('publication_request')
        .select(['state', 'failures', 'finished_at', 'requested_at'])
        .where('id', '=', made.request)
        .executeTakeFirstOrThrow();
      expect(request).toMatchObject({ state: 'done', failures: [] });
      expect(request.finished_at).toBeInstanceOf(Date);

      const artifact = await trx
        .selectFrom('artifact')
        .select(['kind', 'space_id'])
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(artifact).toEqual({ kind: 'publication', space_id: general });

      const publication = await trx
        .selectFrom('publication')
        .selectAll()
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow();
      expect(publication).toEqual({
        id: made.id,
        kind: 'publication',
        request_id: made.request,
        document_id: made.version.artifactId,
        document_version_id: made.version.id,
        document_kind: 'document',
        publisher: ada,
        // The time it was asked for, which is the time compiled into the PDF.
        published_at: request.requested_at,
        approval: 'none',
        formats: ['pdf'],
        engine: 'typst',
        engine_version: '0.15.1',
        template: 'publication',
        template_version: 2,
        pipeline_version: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        data_sha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        // Its request's layout version, copied under the request's lock (0018).
        layout_id: DEFAULT_LAYOUT_ID,
        layout_version_id: layout.versionId,
        layout_kind: 'layout',
        // And its theme version, the same way (0024).
        theme_id: DEFAULT_THEME_ID,
        theme_version_id: theme.versionId,
        theme_kind: 'theme',
        // The transaction that recorded it, which a listing's snapshot reads (0032).
        written_by: expect.stringMatching(/^\d+$/),
      });

      const inputs = await trx
        .selectFrom('publication_input')
        .select(['version_id', 'node'])
        .where('publication_id', '=', made.id)
        .execute();
      // The document's version with no place, and each occurrence's version at its place.
      expect(inputs).toHaveLength(3);
      expect(inputs).toEqual(
        expect.arrayContaining([
          { version_id: made.version.id, node: null },
          { version_id: made.shared.id, node: made.open.id },
          { version_id: made.other.id, node: made.pinned.id },
        ]),
      );

      const outputs = await trx
        .selectFrom('publication_output')
        .selectAll()
        .where('publication_id', '=', made.id)
        .execute();
      expect(outputs).toEqual([
        {
          publication_id: made.id,
          format: 'pdf',
          object_key: `${production.role}/sha256/${'c'.repeat(64)}`,
          sha256: 'c'.repeat(64),
          bytes: 1000,
          standard: 'ua-1',
          // Typst, under the template the publication names (Word 1, ruling R11), and a PDF's report,
          // which says nothing.
          producer: 'typst',
          producer_version: '2',
          report: [],
        },
      ]);
    });
  });

  it("records the publication under its request's layout, and refuses another", async () => {
    const { request, declared } = await service.withTenant(production, async (trx) => ({
      request: await requested(trx, await documentWith(trx, []), ada),
      declared: await defaultLayout(trx),
    }));

    // Rigged as the runtime role, in SQL: a publication whole in every other respect, its request
    // marked done, but made under another version of the layout - here a 0.2 recorded in the same
    // transaction. Refused when the transaction commits, which takes the 0.2 with it.
    const other = 'e'.repeat(64);
    await expect(
      service.withTenant(production, async (trx) => {
        const version = await trx
          .selectFrom('publication_request')
          .select([
            'document_id',
            'document_version_id',
            'requested_at',
            'theme_id',
            'theme_version_id',
          ])
          .where('id', '=', request)
          .executeTakeFirstOrThrow();
        const next = await recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: declared.versionId,
          author: ada,
          substance: {
            kind: 'layout',
            content: {
              ...declared.layout,
              words: { ...declared.layout.words, contents: 'Table of contents' },
            },
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: general })
          .returning('id')
          .executeTakeFirstOrThrow();
        const made = recording(request);
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: request,
            document_id: version.document_id,
            document_version_id: version.document_version_id,
            publisher: ada,
            published_at: version.requested_at,
            approval: 'none',
            formats: ['pdf'],
            engine: 'typst',
            engine_version: '0.15.1',
            template: 'publication',
            template_version: 2,
            pipeline_version: made.pipelineVersion,
            fonts: JSON.stringify(made.fonts),
            data_sha256: made.dataSha256,
            numbering: JSON.stringify(made.numbering),
            layout_id: DEFAULT_LAYOUT_ID,
            layout_version_id: next.version.id,
            theme_id: version.theme_id,
            theme_version_id: version.theme_version_id,
          })
          .execute();
        await trx
          .insertInto('publication_input')
          .values({
            publication_id: artifact.id,
            version_id: version.document_version_id,
            node: null,
          })
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: artifact.id,
            format: 'pdf',
            object_key: `${production.role}/sha256/${other}`,
            sha256: other,
            bytes: 1,
            standard: 'ua-1',
            producer: 'typst',
            producer_version: '2',
            report: '[]',
          })
          .execute();
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${request}`.execute(trx);
      }),
    ).rejects.toThrow(/recorded whole/);
    expect(await stateOf(request)).toEqual({ state: 'queued', failures: [], finished_at: null });

    // Recorded as the worker records it, the publication carries its request's layout version.
    const id = await service.withTenant(production, (trx) =>
      recordPublication(trx, recording(request)),
    );
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication')
        .select(['layout_id', 'layout_version_id'])
        .where('id', '=', id!)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ layout_id: DEFAULT_LAYOUT_ID, layout_version_id: declared.versionId });
  });

  it('leaves no row of a record any part of which is refused, such as an output keyed by other bytes', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    const elsewhere = {
      ...recording(id),
      outputs: [{ ...pdfOutput(), key: `${production.role}/sha256/${'d'.repeat(64)}` }],
    };
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, elsewhere)),
    ).rejects.toThrow(/publication_output_check/);
    const anotherTenants = {
      ...recording(id),
      outputs: [{ ...pdfOutput(), key: `t_another/sha256/${'c'.repeat(64)}` }],
    };
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, anotherTenants)),
    ).rejects.toThrow(/keyed in its own tenant's store/);
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toEqual({ state: 'queued', failures: [], finished_at: null });
    // Nothing of the refused record was kept, so the request can still be recorded whole.
    expect(
      await service.withTenant(production, (trx) => recordPublication(trx, recording(id))),
    ).toBeDefined();
  });

  it('keeps nothing of a record that fails part way, where its caller catches the failure and carries on', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    await service.withTenant(production, async (trx) => {
      await expect(
        recordPublication(
          trx.withPlugin(failingAfterInsertInto('publication_input')),
          recording(id),
        ),
      ).rejects.toThrow(/connection was lost/);
      // The caller carries on in the same transaction and fails the request, which commits.
      await failPublicationRequest(trx, id, [
        { stage: 'store', code: 'store_failed', node: null, block: null, detail: null },
      ]);
    });
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toMatchObject({
      state: 'failed',
      failures: [{ stage: 'store', code: 'store_failed', node: null, block: null, detail: null }],
    });
  });

  it('refuses loudly to record a request carrying failures, and leaves no row of it', async () => {
    const { id, hidden } = await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [
        section('Method', [reference(shared.artifactId), hidden]),
      ]);
      return { id: await requested(trx, version, ada), hidden: hidden.id };
    });
    const before = await publications();
    await expect(
      service.withTenant(production, (trx) => recordPublication(trx, recording(id))),
    ).rejects.toThrow(/carries failures/);
    expect(await publications()).toEqual(before);
    expect(await stateOf(id)).toEqual({
      state: 'queued',
      failures: [
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden,
          block: null,
          detail: null,
        },
      ],
      finished_at: null,
    });
  });

  it('lets two workers racing one request make one publication: the second waits, then records nothing', async () => {
    const id = await service.withTenant(production, async (trx) =>
      requested(trx, await documentWith(trx, []), ada),
    );
    const before = await publications();
    const holding = deferred<number>();
    const commit = latch();
    const winner = service.withTenant(production, async (trx) => {
      let answer: string | undefined;
      try {
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
        answer = await recordPublication(trx, recording(id));
        holding.resolve(rows[0]!.pid);
      } catch (error) {
        // Reported through `holding`, so the test fails on the winner's own error at once.
        holding.reject(error);
        throw error;
      }
      await commit.opened;
      return answer;
    });
    winner.catch(() => undefined);
    const pid = await holding.promise;
    // The winner holds the request's row until it commits, so the second worker must wait behind it.
    // The latch opens in `finally`, so a wait that fails still lets the winner commit.
    let loser: Promise<string | undefined>;
    try {
      loser = service.withTenant(production, (trx) => recordPublication(trx, recording(id)));
      await untilBlockedBy(db.adminUrl, pid, 1);
    } finally {
      commit.open();
    }
    const [won, lost] = await Promise.all([winner, loser]);
    expect(won).toBeDefined();
    expect(lost).toBeUndefined();
    expect(await publications()).toMatchObject({
      records: before.records + 1,
      artifacts: before.artifacts + 1,
    });
  });

  it('fails a request with every failure at once, after which it has nothing left to publish', async () => {
    await service.withTenant(production, async (trx) => {
      const id = await requested(trx, await documentWith(trx, []), ada);
      await failPublicationRequest(trx, id, [
        { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
      ]);
      // Finished at the database's time, as a recorded publication's request is, not the worker's.
      const { rows } = await sql<{ now: Date }>`select now() as now`.execute(trx);
      const finished = await trx
        .selectFrom('publication_request')
        .select('finished_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(finished.finished_at).toEqual(rows[0]!.now);
      expect(await publicationInputs(trx, id)).toBeUndefined();
      expect(await recordPublication(trx, recording(id))).toBeUndefined();
      // Only finishing it: nothing else about a request can be changed.
      await expect(
        sql`update publication_request set requested_by = ${grace} where id = ${id}`.execute(trx),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // Figures 3, ruling R6: every image the resolved components place, decided as the publisher.
  /** An asset version in this space, made directly, with the facts a request hands the job. */
  const image = (trx: TenantTransaction, space: string, author: string, fill: string) =>
    createArtifact(trx, {
      spaceId: space,
      author,
      substance: {
        kind: 'asset',
        content: {
          schemaVersion: 1,
          object: `${production.role}/sha256/${fill.repeat(64)}`,
          format: 'png',
          bytes: 3530,
          width: 800,
          height: 600,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
          alternative: { text: 'Two red squares', language: 'en-GB' },
        },
      },
    });
  const figureOf = (id: string, asset: string) => ({
    type: 'figure' as const,
    id,
    asset,
    imageStyle: 'figure' as const,
    caption: [{ type: 'text' as const, value: 'Shapes', marks: [] }],
    alternative: { kind: 'inherited' as const },
  });
  /** A component in General holding these blocks, at its second version. */
  const holding = async (trx: TenantTransaction, author: string, blocks: unknown[]) => {
    const first = await component(trx, general, author, 'Install the printer');
    const substance = substanceOf(first);
    if (substance.kind !== 'component') throw new Error('not a component');
    const next = await recordVersion(trx, {
      artifactId: first.artifactId,
      openedFrom: first.id,
      author,
      substance: {
        ...substance,
        content: { ...substance.content, content: blocks as ContentDocument['content'] },
      },
    });
    if (next.answer !== 'recorded') throw new Error(next.answer);
    return next.version;
  };
  /** A request's failures, read in the transaction that made it. */
  const failuresIn = (trx: TenantTransaction, id: string) =>
    trx
      .selectFrom('publication_request')
      .select('failures')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
      .then((row) => row.failures);
  const requestAssets = (trx: TenantTransaction, id: string) =>
    trx
      .selectFrom('publication_request_asset')
      .select(['version_id', 'asset_id'])
      .where('request_id', '=', id)
      .execute();

  it('resolves every image a figure places as the publisher, wherever it stands, and hands the job its facts', async () => {
    await service.withTenant(production, async (trx) => {
      const red = await image(trx, general, ada, 'd');
      const blue = await image(trx, general, ada, 'e');
      const placed = await holding(trx, ada, [
        figureOf('f1', red.id),
        {
          type: 'list',
          id: 'l1',
          kind: 'unordered',
          items: [{ content: [figureOf('f2', blue.id)] }],
        },
        { type: 'blockquote', id: 'q1', content: [figureOf('f3', red.id)] },
      ]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      const id = await requested(trx, version, ada);

      expect(await failuresIn(trx, id)).toEqual([]);
      // Each version once, however many figures place it.
      expect(new Set((await requestAssets(trx, id)).map((each) => each.version_id))).toEqual(
        new Set([red.id, blue.id]),
      );
      const inputs = await publicationInputs(trx, id);
      expect(inputs!.assets.get(red.id)).toEqual({
        object: `${production.role}/sha256/${'d'.repeat(64)}`,
        format: 'png',
        width: 800,
        height: 600,
        alternative: { text: 'Two red squares', language: 'en-GB' },
      });
      expect([...inputs!.assets.keys()].sort()).toEqual([red.id, blue.id].sort());
    });
  });

  it('refuses a figure whose image the publisher may not read, naming the figure and nothing of the image', async () => {
    await service.withTenant(production, async (trx) => {
      // In Quality, which Grace may read and Ada may not; placed by Grace in a component in General.
      const secret = await image(trx, quality, grace, 'f');
      const missing = randomUUID();
      const placed = await holding(trx, grace, [
        figureOf('f1', secret.id),
        figureOf('f2', missing),
      ]);
      const placement = reference(placed.artifactId);
      const version = await documentWith(trx, [placement]);

      const adas = await requested(trx, version, ada);
      const unreadable = (block: string) => ({
        stage: 'resolve',
        code: 'asset_unreadable',
        node: placement.id,
        block,
        detail: null,
      });
      const refused = await failuresIn(trx, adas);
      expect(refused).toEqual([unreadable('f1'), unreadable('f2')]);
      expect(JSON.stringify(refused)).not.toContain(secret.id);
      expect(JSON.stringify(refused)).not.toContain(secret.artifactId);
      expect(await requestAssets(trx, adas)).toEqual([]);

      // Grace may read the image; the one naming no version is still refused, and told the same way.
      const graces = await requested(trx, version, grace);
      expect(await failuresIn(trx, graces)).toEqual([unreadable('f2')]);
      expect(await requestAssets(trx, graces)).toEqual([
        { version_id: secret.id, asset_id: secret.artifactId },
      ]);
    });
  });

  it('resolves an image in a run of text as the publisher too, in a paragraph and in a table cell', async () => {
    // Figures 5, ruling R5: an inline image is resolved as a figure's is, and a refusal names the block
    // holding it.
    const inline = (asset: string) => ({
      type: 'image' as const,
      asset,
      imageStyle: 'inline',
      alternative: { kind: 'decorative' as const },
    });
    await service.withTenant(production, async (trx) => {
      const open = await image(trx, general, grace, '2');
      const secret = await image(trx, quality, grace, '3');
      const placed = await holding(trx, grace, [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [{ type: 'text', value: 'Press ', marks: [] }, inline(open.id)],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  // Two it may not read in one paragraph, which is named once.
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [inline(secret.id), inline(secret.id)],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ]);
      const placement = reference(placed.artifactId);
      const version = await documentWith(trx, [placement]);
      const adas = await requested(trx, version, ada);
      expect(await failuresIn(trx, adas)).toEqual([
        {
          stage: 'resolve',
          code: 'asset_unreadable',
          node: placement.id,
          block: 'c1',
          detail: null,
        },
      ]);
      expect(await requestAssets(trx, adas)).toEqual([
        { version_id: open.id, asset_id: open.artifactId },
      ]);
    });
  });

  it('records the images a publication printed, and never one on a request once it is finished', async () => {
    const { id, red } = await service.withTenant(production, async (trx) => {
      const red = await image(trx, general, ada, '1');
      const placed = await holding(trx, ada, [figureOf('f1', red.id)]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      return { id: await requested(trx, version, ada), red };
    });
    const publication = await service.withTenant(production, (trx) =>
      recordPublication(trx, recording(id)),
    );
    const printed = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_asset')
        .select(['version_id', 'asset_id'])
        .where('publication_id', '=', publication!)
        .execute(),
    );
    expect(printed).toEqual([{ version_id: red.id, asset_id: red.artifactId }]);

    // A publication naming fewer images than its request recorded does not commit.
    const { id: other } = await service.withTenant(production, async (trx) => {
      const placed = await holding(trx, ada, [figureOf('f1', red.id)]);
      const version = await documentWith(trx, [reference(placed.artifactId)]);
      return { id: await requested(trx, version, ada) };
    });
    // Written row by row as the runtime role, as recordPublication writes it, but for its image.
    await expect(
      service.withTenant(production, async (trx) => {
        const made = recording(other);
        const request = await trx
          .selectFrom('publication_request as r')
          .innerJoin('artifact as a', 'a.id', 'r.document_id')
          .selectAll('r')
          .select('a.space_id')
          .where('r.id', '=', other)
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: request.space_id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: other,
            document_id: request.document_id,
            document_version_id: request.document_version_id,
            publisher: request.requested_by,
            published_at: request.requested_at,
            approval: 'none',
            formats: ['pdf'],
            engine: 'typst',
            engine_version: '0.15.1',
            template: 'publication',
            template_version: 2,
            pipeline_version: made.pipelineVersion,
            fonts: JSON.stringify(made.fonts),
            data_sha256: made.dataSha256,
            numbering: JSON.stringify(made.numbering),
            layout_id: request.layout_id,
            layout_version_id: request.layout_version_id,
            theme_id: request.theme_id,
            theme_version_id: request.theme_version_id,
          })
          .execute();
        const occurrences = await trx
          .selectFrom('publication_request_occurrence')
          .select(['node', 'version_id'])
          .where('request_id', '=', other)
          .execute();
        await trx
          .insertInto('publication_input')
          .values([
            { publication_id: artifact.id, version_id: request.document_version_id, node: null },
            ...occurrences.map((each) => ({
              publication_id: artifact.id,
              version_id: each.version_id,
              node: each.node,
            })),
          ])
          .execute();
        await trx
          .insertInto('publication_output')
          .values({
            publication_id: artifact.id,
            format: 'pdf',
            object_key: made.outputs[0]!.key,
            sha256: made.outputs[0]!.sha256,
            bytes: made.outputs[0]!.bytes,
            standard: 'ua-1',
            producer: 'typst',
            producer_version: '2',
            report: '[]',
          })
          .execute();
        await trx
          .updateTable('publication_request')
          .set({ state: 'done', finished_at: new Date() })
          .where('id', '=', other)
          .execute();
      }),
    ).rejects.toThrow(/recorded whole/);
    expect((await stateOf(other)).state).toBe('queued');

    // The request is done: an image recorded on it now would say it read what it never read.
    await expect(
      service.withTenant(production, (trx) =>
        trx
          .insertInto('publication_request_asset')
          .values({ request_id: id, version_id: red.id, asset_id: red.artifactId })
          .execute(),
      ),
    ).rejects.toThrow(/only while its request is queued/);
    await expect(
      service.withTenant(production, (trx) =>
        trx.deleteFrom('publication_asset').where('publication_id', '=', publication!).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  // Word 1, ruling R11: one output per format the request names, each saying what made it.
  /** A request for these formats, of a document at 0.1. */
  const requestedAs = async (formats: string[]) =>
    service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats,
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  it('records one output per format its request names, each with its producer and its report', async () => {
    const request = await requestedAs(['pdf', 'docx']);
    const id = await service.withTenant(production, (trx) =>
      recordPublication(trx, { ...recording(request), outputs: [docxOutput(), pdfOutput()] }),
    );
    const rows = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_output')
        .select(['format', 'standard', 'producer', 'producer_version', 'report', 'bytes'])
        .where('publication_id', '=', id!)
        .orderBy('format', 'desc')
        .execute(),
    );
    expect(rows).toEqual([
      {
        format: 'pdf',
        standard: 'ua-1',
        producer: 'typst',
        producer_version: '2',
        report: [],
        bytes: 1000,
      },
      {
        format: 'docx',
        // A Word document claims no PDF standard.
        standard: null,
        producer: 'word',
        producer_version: 'word/2',
        report: docxOutput().report,
        bytes: 2000,
      },
    ]);
    const read = await service.withTenant(production, (trx) => readPublication(trx, id!));
    expect(read).toMatchObject({
      formats: ['pdf', 'docx'],
      engine: { name: 'typst', version: '0.15.1' },
      template: { name: 'publication', version: 2 },
      pipelineVersion: '2',
    });
    // The PDF first, as the formats are named.
    expect(read!.outputs).toEqual([
      {
        format: 'pdf',
        key: pdfOutput().key,
        sha256: pdfOutput().sha256,
        bytes: 1000,
        standard: 'ua-1',
        producer: 'typst',
        producerVersion: '2',
        report: [],
        // Not yet checked: the check joins it afterwards (ADR-0030).
        check: null,
      },
      {
        format: 'docx',
        key: docxOutput().key,
        sha256: docxOutput().sha256,
        bytes: 2000,
        standard: null,
        producer: 'word',
        producerVersion: 'word/2',
        report: docxOutput().report,
        check: null,
      },
    ]);
  });

  it('records a Word-only publication with no PDF engine or template, which made nothing of it', async () => {
    const request = await requestedAs(['docx']);
    const id = await service.withTenant(production, (trx) =>
      recordPublication(trx, { ...recording(request), outputs: [docxOutput('e')] }),
    );
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication')
        .select(['formats', 'engine', 'engine_version', 'template', 'template_version'])
        .where('id', '=', id!)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({
      formats: ['docx'],
      engine: null,
      engine_version: null,
      template: null,
      template_version: null,
    });
    const read = await service.withTenant(production, (trx) => readPublication(trx, id!));
    expect(read).toMatchObject({ formats: ['docx'], engine: null, template: null });
    expect(read!.outputs.map((each) => each.format)).toEqual(['docx']);
  });

  /** The accessibility checks queued in the platform, by subject, as the platform holds them. */
  const checksQueued = async () =>
    (
      await queryAs(
        db.adminUrl,
        "select subject_id from platform.job where tenant_id = $1 and kind = 'check_pdf'",
        [production.id],
      )
    ).rows.map((row: { subject_id: string }) => row.subject_id);

  /** veraPDF's whole report, as the worker keeps it in the tenant's store by its hash (PUB-091). */
  const keptReport = (fill = 'a') => ({
    key: `${production.role}/sha256/${fill.repeat(64)}`,
    sha256: fill.repeat(64),
    bytes: 4096,
  });

  /** A check veraPDF failed, as the worker records it (W-C): two rules, one described. */
  const failedCheck = (publicationId: string) => ({
    publicationId,
    checkerVersion: '1.30.2',
    compliant: false,
    failedRules: [
      { clause: '5', test: 1, description: 'The PDF/UA identification is missing' },
      { clause: '7.1', test: 10 },
    ],
    report: keptReport(),
  });

  it('queues one check_pdf job for a publication with a PDF, in the transaction that records it, and none for Word alone or a record rolled back', async () => {
    const pdf = await requestedAs(['pdf']);
    const both = await requestedAs(['pdf', 'docx']);
    const word = await requestedAs(['docx']);
    const rolledBack = await requestedAs(['pdf']);
    const before = await checksQueued();

    const withPdf = await service.withTenant(production, (trx) =>
      recordPublication(trx, recording(pdf)),
    );
    const withBoth = await service.withTenant(production, (trx) =>
      recordPublication(trx, { ...recording(both), outputs: [pdfOutput(), docxOutput()] }),
    );
    await service.withTenant(production, (trx) =>
      recordPublication(trx, { ...recording(word), outputs: [docxOutput('e')] }),
    );
    // Recorded, and then the transaction does not commit: the check goes with the publication.
    await expect(
      service.withTenant(production, async (trx) => {
        await recordPublication(trx, recording(rolledBack));
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    const queued = (await checksQueued()).filter((subject) => !before.includes(subject));
    expect(queued.sort()).toEqual([withPdf!, withBoth!].sort());
  });

  it('lets the runtime role record a check of a PDF output once, in its closed shape, and never change or delete it', async () => {
    const pdf = await requestedAs(['pdf']);
    const word = await requestedAs(['docx']);
    const { checked, unchecked, wordOnly } = await service.withTenant(production, async (trx) => ({
      checked: (await recordPublication(trx, recording(pdf)))!,
      unchecked: (await recordPublication(trx, recording(await requestedAs(['pdf']))))!,
      wordOnly: (await recordPublication(trx, {
        ...recording(word),
        outputs: [docxOutput('e')],
      }))!,
    }));

    expect(
      await service.withTenant(production, (trx) =>
        recordPublicationCheck(trx, failedCheck(checked)),
      ),
    ).toBe('recorded');
    // A second run of the job finds it checked and records nothing, whatever it found this time.
    expect(
      await service.withTenant(production, (trx) =>
        recordPublicationCheck(trx, { ...failedCheck(checked), compliant: true, failedRules: [] }),
      ),
    ).toBe('already');
    const rows = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_check')
        .selectAll()
        .where('publication_id', '=', checked)
        .execute(),
    );
    expect(rows).toEqual([
      {
        publication_id: checked,
        format: 'pdf',
        checker: 'verapdf',
        checker_version: '1.30.2',
        profile: 'ua1',
        compliant: false,
        failed_rules: failedCheck(checked).failedRules,
        report_key: keptReport().key,
        report_sha256: keptReport().sha256,
        report_bytes: 4096,
        checked_at: expect.any(Date),
      },
    ]);

    // Never changed, never deleted, and never timed by its caller.
    for (const statement of [
      sql`update publication_check set compliant = true, failed_rules = '[]'
          where publication_id = ${checked}`,
      sql`delete from publication_check where publication_id = ${checked}`,
      sql`insert into publication_check (publication_id, format, checker, checker_version, profile,
            compliant, failed_rules, checked_at)
          values (${unchecked}, 'pdf', 'verapdf', '1.30.2', 'ua1', true, '[]', now() - interval '1 day')`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }

    // Only a PDF the publication has, only as veraPDF under PDF/UA-1, and only its closed shape.
    const insert = (values: {
      publication: string;
      format?: string;
      checker?: string;
      version?: string;
      profile?: string;
      compliant?: boolean;
      rules?: unknown;
      report?: { key: string; sha256: string; bytes: number };
    }) => {
      const report = values.report ?? keptReport();
      return sql`insert into publication_check (publication_id, format, checker, checker_version,
            profile, compliant, failed_rules, report_key, report_sha256, report_bytes)
          values (${values.publication}, ${values.format ?? 'pdf'}, ${values.checker ?? 'verapdf'},
            ${values.version ?? '1.30.2'}, ${values.profile ?? 'ua1'}, ${values.compliant ?? false},
            ${JSON.stringify(values.rules ?? [{ clause: '5', test: 1 }])},
            ${report.key}, ${report.sha256}, ${report.bytes})`;
    };
    const tooMany = Array.from({ length: 201 }, (_, index) => ({ clause: '7.1', test: index }));
    for (const [values, refusal] of [
      [{ publication: wordOnly }, /publication_check_publication_id_format_fkey/],
      [{ publication: unchecked, format: 'docx' }, /publication_check_format_check/],
      [{ publication: unchecked, checker: 'pdfbox' }, /publication_check_checker_check/],
      [{ publication: unchecked, version: 'latest' }, /publication_check_checker_version_check/],
      [{ publication: unchecked, profile: 'ua2' }, /publication_check_profile_check/],
      [{ publication: unchecked, compliant: true }, /publication_check_compliant_without_failures/],
      [{ publication: unchecked, rules: { clause: '5' } }, /publication_check_failed_rules/],
      [
        { publication: unchecked, rules: [{ clause: 5, test: 1 }] },
        /publication_check_failed_rules/,
      ],
      [{ publication: unchecked, rules: [{ clause: '5' }] }, /publication_check_failed_rules/],
      [
        { publication: unchecked, rules: [{ clause: '5', test: 1, description: 2 }] },
        /publication_check_failed_rules/,
      ],
      [{ publication: unchecked, rules: tooMany }, /publication_check_failed_rules/],
      // The whole report, kept by its hash in this tenant's own store and nowhere else.
      [
        {
          publication: unchecked,
          report: { ...keptReport(), key: `t_another/sha256/${'a'.repeat(64)}` },
        },
        /a report is kept in its own tenant's store/,
      ],
      [
        { publication: unchecked, report: { ...keptReport(), key: keptReport('b').key } },
        /"publication_check_report_key"/,
      ],
      [
        {
          publication: unchecked,
          report: { key: `${production.role}/sha256/latest`, sha256: 'latest', bytes: 1 },
        },
        /publication_check_report_sha256_check/,
      ],
      [
        { publication: unchecked, report: { ...keptReport(), bytes: 0 } },
        /publication_check_report_bytes_check/,
      ],
    ] as const) {
      await expect(
        service.withTenant(production, (trx) => insert(values).execute(trx)),
        JSON.stringify(values),
      ).rejects.toThrow(refusal);
    }
    // And a bounded list of failures as `recordPublicationCheck` takes it: never more than the bound.
    await expect(
      service.withTenant(production, (trx) =>
        recordPublicationCheck(trx, { ...failedCheck(unchecked), failedRules: tooMany }),
      ),
    ).rejects.toThrow(/at most 200/);
  });

  it('keeps a check as long as its publication, which the runtime role cannot delete, and deletes it with it', async () => {
    const id = await service.withTenant(production, async (trx) => {
      const made = (await recordPublication(trx, recording(await requestedAs(['pdf']))))!;
      await recordPublicationCheck(trx, failedCheck(made));
      return made;
    });
    await expect(
      service.withTenant(production, (trx) =>
        sql`delete from publication where id = ${id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);

    // Nothing in the product deletes a publication (PUB-047). Its owner can, once the parts that
    // restrict it are gone, and its check goes with it by the cascade.
    const schema = production.schema;
    const { rows: before } = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${schema}.publication_check where publication_id = $1`,
      [id],
    );
    expect(before).toEqual([{ n: 1 }]);
    await queryAs(
      db.adminUrl,
      `delete from ${schema}.publication_input where publication_id = $1`,
      [id],
    );
    await queryAs(
      db.adminUrl,
      `delete from ${schema}.publication_output where publication_id = $1`,
      [id],
    );
    await queryAs(db.adminUrl, `delete from ${schema}.publication where id = $1`, [id]);
    const { rows: after } = await queryAs(
      db.adminUrl,
      `select count(*)::int as n from ${schema}.publication_check where publication_id = $1`,
      [id],
    );
    expect(after).toEqual([{ n: 0 }]);
  });

  it('reads a PDF output with its check once it is checked, none before, and a Word output with none', async () => {
    const { id, before } = await service.withTenant(production, async (trx) => {
      const made = (await recordPublication(trx, {
        ...recording(await requestedAs(['pdf', 'docx'])),
        outputs: [pdfOutput(), docxOutput()],
      }))!;
      return { id: made, before: await readPublication(trx, made) };
    });
    expect(before!.outputs.map((each) => [each.format, each.check])).toEqual([
      ['pdf', null],
      ['docx', null],
    ]);

    await service.withTenant(production, (trx) => recordPublicationCheck(trx, failedCheck(id)));
    const after = await service.withTenant(production, (trx) => readPublication(trx, id));
    expect(after!.outputs.map((each) => [each.format, each.check])).toEqual([
      [
        'pdf',
        {
          checker: 'verapdf',
          checkerVersion: '1.30.2',
          profile: 'ua1',
          compliant: false,
          failedRules: failedCheck(id).failedRules,
          report: keptReport(),
          checkedAt: expect.any(Date),
        },
      ],
      ['docx', null],
    ]);
  });

  it('refuses a record whose outputs are not its request formats, or whose report is not one, and keeps nothing', async () => {
    const both = await requestedAs(['pdf', 'docx']);
    const pdf = await requestedAs(['pdf']);
    const before = await publications();
    const refused = [
      [both, [pdfOutput()]],
      [both, [pdfOutput(), docxOutput(), docxOutput('f')]],
      [pdf, [pdfOutput(), docxOutput()]],
      [pdf, [docxOutput()]],
      [pdf, []],
    ] as const;
    for (const [request, outputs] of refused) {
      await expect(
        service.withTenant(production, (trx) =>
          recordPublication(trx, { ...recording(request), outputs }),
        ),
      ).rejects.toThrow(/one output per format/);
    }
    // A report that is not one - a table's entry that names no table - which the writer never makes:
    // refused before it is stored.
    const unreported = { ...docxOutput(), report: [{ kind: 'header_column_lost' }] };
    await expect(
      service.withTenant(production, (trx) =>
        recordPublication(trx, {
          ...recording(both),
          outputs: [pdfOutput(), unreported as unknown as ReturnType<typeof docxOutput>],
        }),
      ),
    ).rejects.toThrow();
    expect(await publications()).toEqual(before);
    expect(await stateOf(both)).toEqual({ state: 'queued', failures: [], finished_at: null });
  });

  it('holds each output to its format, and the record to one output per format, as the runtime role', async () => {
    const other = 'e'.repeat(64);
    /**
     * A publication of the request written row by row, with these outputs and publication columns,
     * committed or refused.
     */
    const rigged = async (
      request: string,
      columns: Partial<{
        formats: PublishingFormat[];
        engine: 'typst' | null;
        engine_version: string | null;
        template: 'publication' | null;
        template_version: number | null;
      }>,
      outputs: readonly Record<string, unknown>[],
    ) =>
      service.withTenant(production, async (trx) => {
        const made = await trx
          .selectFrom('publication_request as r')
          .innerJoin('artifact as a', 'a.id', 'r.document_id')
          .selectAll('r')
          .select('a.space_id')
          .where('r.id', '=', request)
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'publication', space_id: made.space_id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('publication')
          .values({
            id: artifact.id,
            request_id: request,
            document_id: made.document_id,
            document_version_id: made.document_version_id,
            publisher: made.requested_by,
            published_at: made.requested_at,
            approval: 'none',
            formats: made.formats,
            engine: 'typst',
            engine_version: '0.15.1',
            template: 'publication',
            template_version: 2,
            pipeline_version: '2',
            fonts: JSON.stringify([
              { file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) },
            ]),
            data_sha256: 'b'.repeat(64),
            numbering: JSON.stringify({ scheme: defaultNumberingScheme.id, entries: [] }),
            layout_id: made.layout_id,
            layout_version_id: made.layout_version_id,
            theme_id: made.theme_id,
            theme_version_id: made.theme_version_id,
            ...columns,
          })
          .execute();
        await trx
          .insertInto('publication_input')
          .values({ publication_id: artifact.id, version_id: made.document_version_id, node: null })
          .execute();
        for (const output of outputs) {
          await trx
            .insertInto('publication_output')
            .values({
              publication_id: artifact.id,
              format: 'pdf',
              object_key: `${production.role}/sha256/${other}`,
              sha256: other,
              bytes: 1,
              standard: 'ua-1',
              producer: 'typst',
              producer_version: '2',
              report: '[]',
              ...output,
            } as never)
            .execute();
        }
        await sql`update publication_request set state = 'done', finished_at = now()
                  where id = ${request}`.execute(trx);
      });
    const typst = {};
    const word = {
      format: 'docx',
      standard: null,
      producer: 'word',
      producer_version: 'word/1',
      report: JSON.stringify([{ kind: 'pages_cite_the_pdf' }]),
      object_key: `${production.role}/sha256/${'f'.repeat(64)}`,
      sha256: 'f'.repeat(64),
    };

    // At the row: each output's standard, producer and report are its format's.
    const pdf = await requestedAs(['pdf']);
    const both = await requestedAs(['pdf', 'docx']);
    for (const [output, constraint] of [
      [{ standard: null }, 'publication_output_standard'],
      [{ ...word, standard: 'ua-1' }, 'publication_output_standard'],
      [{ producer: 'word' }, 'publication_output_producer'],
      [{ producer_version: 'word/1' }, 'publication_output_producer'],
      [{ ...word, producer: 'typst' }, 'publication_output_producer'],
      [{ ...word, producer_version: '2' }, 'publication_output_producer'],
      [{ format: 'html' }, 'publication_output_format'],
      [{ report: JSON.stringify([{ kind: 'pages_cite_the_pdf' }]) }, 'publication_output_report'],
      [{ ...word, report: '{}' }, 'publication_output_report'],
    ] as const) {
      await expect(rigged(both, {}, [output]), constraint).rejects.toThrow(new RegExp(constraint));
    }
    // And at the publication: its engine and template are the PDF's, none where it has none.
    await expect(
      rigged(both, { engine: null, engine_version: null, template: null, template_version: null }, [
        typst,
        word,
      ]),
    ).rejects.toThrow(/publication_made_by_typst/);
    await expect(rigged(pdf, { formats: ['pdf', 'pdf'] }, [typst])).rejects.toThrow(
      /publication_formats_check/,
    );

    // At commit: one output per format its request names, the formats its request's, and a PDF made
    // by the template the publication names.
    const atCommit: [string, { formats?: PublishingFormat[] }, Record<string, unknown>[]][] = [
      [both, {}, [typst]],
      [both, {}, [word]],
      [pdf, { formats: ['pdf', 'docx'] }, [typst, word]],
      [pdf, {}, [{ producer_version: '3' }]],
    ];
    for (const [request, columns, outputs] of atCommit) {
      await expect(rigged(request, columns, outputs)).rejects.toThrow(/recorded whole/);
    }
    expect(await stateOf(both)).toEqual({ state: 'queued', failures: [], finished_at: null });
    // Whole, it commits.
    await rigged(both, {}, [typst, word]);
    expect((await stateOf(both)).state).toBe('done');
  });

  it('refuses a request without the PDF whose document cites a page, wherever it stands, before recording anything', async () => {
    await service.withTenant(production, async (trx) => {
      const scope = section('Scope', []);
      const pageOf = (id: string) => ({
        type: 'crossReference' as const,
        id,
        target: { kind: 'node' as const, node: scope.id },
        display: 'page' as const,
      });
      const numberOf = (id: string) => ({ ...pageOf(id), display: 'number' as const });
      const paragraph = (id: string, content: unknown[]) => ({
        type: 'paragraph',
        id,
        style: 'body',
        content,
      });
      const see = { type: 'text', value: 'See ', marks: [] };
      // In a table's cell, a list's item, a footnote's paragraph and a table's note: each a page.
      const inCell = await holding(trx, ada, [
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  content: [paragraph('c1', [see, pageOf('r1')])],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ]);
      const inItem = await holding(trx, ada, [
        {
          type: 'list',
          id: 'l1',
          kind: 'unordered',
          items: [{ content: [paragraph('i1', [see, pageOf('r1')])] }],
        },
      ]);
      const inFootnote = await holding(trx, ada, [
        paragraph('p1', [
          see,
          {
            type: 'footnote',
            id: 'n1',
            anchor: { kind: 'span' },
            content: [paragraph('n1p', [see, pageOf('r1')])],
          },
        ]),
      ]);
      const inNote = await holding(trx, ada, [
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          note: [see, pageOf('r1')],
          rows: [
            {
              cells: [{ content: [paragraph('c1', [see])], colspan: 1, rowspan: 1 }],
            },
          ],
        },
      ]);
      const byNumber = await holding(trx, ada, [paragraph('p1', [see, numberOf('r1')])]);
      const asked = async (nodes: OutlineNode[], formats: string[]) => {
        const version = await documentWith(trx, nodes);
        return requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats,
          requester: ada,
        });
      };
      const before = await requestIds(trx);
      for (const cites of [inCell, inItem, inFootnote, inNote]) {
        expect(
          await asked([{ ...scope, children: [reference(cites.artifactId)] }], ['docx']),
          cites.artifactId,
        ).toEqual({ answer: 'page_reference.without_pdf' });
      }
      // And in a section's title, which a document holds itself.
      const titled = {
        ...(section('Method', []) as Extract<OutlineNode, { type: 'section' }>),
        title: [see, pageOf('r1')] as Extract<OutlineNode, { type: 'section' }>['title'],
      };
      expect(await asked([scope, titled], ['docx'])).toEqual({
        answer: 'page_reference.without_pdf',
      });
      expect(await requestIds(trx)).toEqual(before);

      // With the PDF, whose pages it cites, it is taken; and without, where it cites no page.
      const inCellDoc = [{ ...scope, children: [reference(inCell.artifactId)] }];
      expect((await asked(inCellDoc, ['pdf', 'docx'])).answer).toBe('requested');
      expect((await asked([scope, titled], ['pdf'])).answer).toBe('requested');
      expect(
        (await asked([{ ...scope, children: [reference(byNumber.artifactId)] }], ['docx'])).answer,
      ).toBe('requested');
    });
  });

  it('decides a page citation as the publisher: a component it may not read is never read for one', async () => {
    await service.withTenant(production, async (trx) => {
      const scope = section('Scope', []);
      // In Quality, which Grace may read and Ada may not, citing a page.
      const secret = await component(trx, quality, grace, 'Calibration');
      const substance = substanceOf(secret);
      if (substance.kind !== 'component') throw new Error('not a component');
      const cited = await recordVersion(trx, {
        artifactId: secret.artifactId,
        openedFrom: secret.id,
        author: grace,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                style: 'body',
                content: [
                  {
                    type: 'crossReference',
                    id: 'r1',
                    target: { kind: 'node', node: scope.id },
                    display: 'page',
                  },
                ],
              },
            ] as ContentDocument['content'],
          },
        },
      });
      if (cited.answer !== 'recorded') throw new Error(cited.answer);
      const hidden = reference(secret.artifactId);
      const version = await documentWith(trx, [{ ...scope, children: [hidden] }]);
      const asked = (requester: string) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats: ['docx'],
          requester,
        });
      // Ada's request is taken, carrying the occurrence she may not read, and fails on it alone; the
      // answer says nothing of what the component holds.
      const adas = await asked(ada);
      if (adas.answer !== 'requested') throw new Error(adas.answer);
      expect(await failuresIn(trx, adas.request.id)).toEqual([
        {
          stage: 'resolve',
          code: 'occurrence_unreadable',
          node: hidden.id,
          block: null,
          detail: null,
        },
      ]);
      // Grace may read it, and is refused for the page it cites.
      expect(await asked(grace)).toEqual({ answer: 'page_reference.without_pdf' });
    });
  });

  // W10.2: a preview is swept an hour after it finished, with its request (PV-F).
  /**
   * Finishes a queued request `ago` before now by the database's clock, as the runtime role finishes
   * one, by the grant it holds: a preview done with its PDF under this fill's key, or, given no fill,
   * failed, as a publish is here.
   */
  const finishedAgo = (trx: TenantTransaction, id: string, ago: string, fill?: string) =>
    fill === undefined
      ? sql`update publication_request set state = 'failed',
              finished_at = now() - ${ago}::interval,
              failures = '[{"stage":"store","code":"store_failed","node":null,"block":null,"detail":null}]'
            where id = ${id}`.execute(trx)
      : sql`update publication_request set state = 'done',
              finished_at = now() - ${ago}::interval,
              expires_at = now() - ${ago}::interval + interval '1 hour',
              preview_key = ${previewPdf(fill).key}, preview_sha256 = ${previewPdf(fill).sha256},
              preview_bytes = 1000
            where id = ${id} and kind = 'preview'`.execute(trx);
  const requestsLeft = (ids: readonly string[]) =>
    service.withTenant(production, (trx) =>
      trx
        .selectFrom('publication_request')
        .select('id')
        .where('id', 'in', ids)
        .execute()
        .then((rows) => new Set(rows.map((row) => row.id))),
    );

  it('lets the runtime role delete a preview an hour after it finished, done or failed, and the versions and images it took with it', async () => {
    const { done, failed } = await service.withTenant(production, async (trx) => {
      const red = await image(trx, general, ada, 'a');
      const placed = await holding(trx, ada, [figureOf('f1', red.id)]);
      const version = await documentWith(trx, [section('Method', [reference(placed.artifactId)])]);
      const done = await previewed(trx, version, ada);
      const failed = await previewed(trx, version, ada);
      await finishedAgo(trx, done, '61 minutes', '5');
      await finishedAgo(trx, failed, '2 hours');
      return { done, failed };
    });
    const taken = (trx: TenantTransaction) =>
      Promise.all([
        trx
          .selectFrom('publication_request_occurrence')
          .select('node')
          .where('request_id', 'in', [done, failed])
          .execute(),
        trx
          .selectFrom('publication_request_asset')
          .select('version_id')
          .where('request_id', 'in', [done, failed])
          .execute(),
      ]).then(([occurrences, assets]) => ({
        occurrences: occurrences.length,
        assets: assets.length,
      }));
    expect(await service.withTenant(production, taken)).toEqual({ occurrences: 2, assets: 2 });

    await service.withTenant(production, (trx) =>
      sql`delete from publication_request where id in (${done}, ${failed})`.execute(trx),
    );

    // Its occurrences and images go with it, by their keys' cascades: the runtime role may delete
    // neither itself.
    expect(await requestsLeft([done, failed])).toEqual(new Set());
    expect(await service.withTenant(production, taken)).toEqual({ occurrences: 0, assets: 0 });
  });

  it('refuses the runtime role deleting a preview within the hour after it finished, one still queued, or any publish', async () => {
    const { recent, queued, publish, published } = await service.withTenant(
      production,
      async (trx) => {
        const version = await documentWith(trx, []);
        const recent = await previewed(trx, version, ada);
        await finishedAgo(trx, recent, '50 minutes', '6');
        const publish = await requested(trx, version, ada);
        const published = await requested(trx, version, ada);
        await finishedAgo(trx, published, '1 year');
        return { recent, queued: await previewed(trx, version, ada), publish, published };
      },
    );
    for (const id of [recent, queued, publish, published]) {
      await expect(
        service.withTenant(production, (trx) =>
          sql`delete from publication_request where id = ${id}`.execute(trx),
        ),
        id,
      ).rejects.toThrow(/only a preview is deleted, an hour after it finished/);
    }
    // Nor by the table at once: the grant is to delete, never to truncate.
    await expect(
      service.withTenant(production, (trx) =>
        sql`truncate publication_request cascade`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await requestsLeft([recent, queued, publish, published])).toEqual(
      new Set([recent, queued, publish, published]),
    );
  });

  it('sweeps every preview an hour after it finished, and answers the keys of those done that nothing else names', async () => {
    const made = await service.withTenant(production, async (trx) => {
      const document = () => documentWith(trx, []);
      const alone = await previewed(trx, await document(), ada);
      const failed = await previewed(trx, await document(), ada);
      // Two previews of one document in one second are the same bytes, and share a key.
      const twin = await document();
      const twins = [await previewed(trx, twin, ada), await previewed(trx, twin, ada)];
      const older = await previewed(trx, await document(), ada);
      const newer = await previewed(trx, await document(), ada);
      const beside = await previewed(trx, await document(), ada);
      await image(trx, general, ada, '9');
      const underImage = await previewed(trx, await document(), ada);
      const recent = await previewed(trx, await document(), ada);
      const queued = await previewed(trx, await document(), ada);
      const publish = await requested(trx, await document(), ada);
      const underReport = await previewed(trx, await document(), ada);

      await finishedAgo(trx, alone, '2 hours', '4');
      await finishedAgo(trx, failed, '2 hours');
      for (const id of twins) await finishedAgo(trx, id, '2 hours', '5');
      // Another preview, not yet an hour old, names the older one's key; so does a publication.
      await finishedAgo(trx, older, '2 hours', '6');
      await finishedAgo(trx, newer, '10 minutes', '6');
      await finishedAgo(trx, beside, '2 hours', '7');
      const publication = await recordPublication(trx, {
        ...recording(publish),
        outputs: [pdfOutput('7')],
      });
      if (!publication) throw new Error('The publication was not recorded');
      // And an image's version names this one's: however unlikely, bytes are bytes.
      await finishedAgo(trx, underImage, '2 hours', '9');
      await finishedAgo(trx, recent, '50 minutes', '8');
      // So does the publication's check, by the report veraPDF wrote.
      await finishedAgo(trx, underReport, '2 hours', '1');
      await recordPublicationCheck(trx, {
        publicationId: publication,
        checkerVersion: '1.30.2',
        compliant: true,
        failedRules: [],
        report: previewPdf('1'),
      });
      return {
        swept: [alone, failed, ...twins, older, beside, underImage, underReport],
        kept: [newer, recent, queued, publish],
      };
    });

    const keys = await service.withTenant(production, (trx) => sweepPreviews(trx));

    expect([...keys].sort()).toEqual([previewPdf('4').key, previewPdf('5').key]);
    expect(await requestsLeft([...made.swept, ...made.kept])).toEqual(new Set(made.kept));
    // Nothing left to sweep, so a second sweep finds nothing.
    expect(await service.withTenant(production, (trx) => sweepPreviews(trx))).toEqual([]);
  });

  it('keeps a preview while another of its document and its second is still queued, which may yet name its key', async () => {
    // Requested in one transaction, so in one second: the same bytes, were both to be made.
    const { first, second } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      return {
        first: await previewed(trx, version, ada),
        second: await previewed(trx, version, ada),
      };
    });
    await service.withTenant(production, (trx) => finishedAgo(trx, first, '2 hours', '0'));

    // The second's worker may have kept the bytes and not yet recorded them: the key is not removed,
    // and the first is kept to name it.
    expect(await service.withTenant(production, (trx) => sweepPreviews(trx))).toEqual([]);
    expect(await requestsLeft([first, second])).toEqual(new Set([first, second]));

    // Once the second is done, it names the key itself; the first goes, and the key stays.
    await service.withTenant(production, (trx) =>
      recordPreview(trx, { requestId: second, ...previewPdf('0') }),
    );
    expect(await service.withTenant(production, (trx) => sweepPreviews(trx))).toEqual([]);
    expect(await requestsLeft([first, second])).toEqual(new Set([second]));
  });

  it('sweeps a preview whatever is queued of its document in another second, which cannot make its bytes', async () => {
    const { version, first } = await service.withTenant(production, async (trx) => {
      const version = await documentWith(trx, []);
      return { version, first: await previewed(trx, version, ada) };
    });
    // A second later: the creation time compiled into its PDF differs, so its bytes would.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await service.withTenant(production, (trx) => previewed(trx, version, ada));
    await service.withTenant(production, (trx) => finishedAgo(trx, first, '2 hours', 'b'));

    expect(await service.withTenant(production, (trx) => sweepPreviews(trx))).toEqual([
      previewPdf('b').key,
    ]);
    expect(await requestsLeft([first, second])).toEqual(new Set([second]));
  });
});
