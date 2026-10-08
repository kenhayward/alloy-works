import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type ContentDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { listReadableComponents } from './components.js';
import { createComponent } from './creation.js';
import { createDocument, listReadableDocuments } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import type { FacetCount } from './listing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { listPublications, listReadablePublications } from './publishing.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { listReadableTemplates } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { publish } from './testing/every-kind.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, latestVersion, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';

/** A facet as label and count, in the order it came. */
const counted = (facet: readonly FacetCount[] | undefined) =>
  (facet ?? []).map((each) => [each.label, each.count]);

describe('listings filtered on the service, each facet counted without its own filter', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  let quality: string;
  const procedure = randomUUID();
  const documents: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx: TenantTransaction) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      for (const space of [general, quality]) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'componentType',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
            id: procedure,
            name: 'Procedure',
            assignments: [],
          },
        },
      });
      // Components: two Topics and a Procedure in General, a Procedure in Quality.
      for (const [title, space, type] of [
        ['Pump', general, undefined],
        ['Valve', general, undefined],
        ['Calibrate', general, procedure],
        ['Inspect', quality, procedure],
      ] as const) {
        const made = await createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
          ...(type === undefined ? {} : { componentTypeId: type }),
        });
        if (made.answer !== 'created') throw new Error(made.answer);
      }
      // Documents: Manual published, Guide published and changed since, Notes never, all in
      // General; Audit in Quality, published twice.
      for (const [title, space] of [
        ['Manual', general],
        ['Guide', general],
        ['Notes', general],
        ['Audit', quality],
      ] as const) {
        const made = await createDocument(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        documents[title] = made.version.artifactId;
        if (title === 'Notes') continue;
        for (let times = 0; times < (title === 'Audit' ? 2 : 1); times += 1) {
          await publish(trx, { document: made.version, author: ada, role: production.role });
        }
      }
      const guide = (await latestVersion(trx, documents.Guide!))!;
      const substance = substanceOf(guide);
      await recordVersion(trx, {
        artifactId: documents.Guide!,
        openedFrom: guide.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...(substance.content as ContentDocument), title: 'Guide, revised' },
        } as never,
      });
      // Templates: two in General, one in Quality.
      for (const [name, space] of [
        ['Report', general],
        ['Letter', general],
        ['Checklist', quality],
      ] as const) {
        await createArtifact(trx, {
          author: ada,
          spaceId: space,
          substance: {
            kind: 'template',
            content: {
              schemaVersion: TEMPLATE_SCHEMA_VERSION,
              name,
              theme: DEFAULT_THEME_ID,
              layout: DEFAULT_LAYOUT_ID,
              schemas: [],
              outline: { sections: [] },
              changes: { add: true, remove: true, reorder: true },
            },
          } as never,
        });
      }
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const run = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  it('filters components by space and type, and counts each facet without its own', async () => {
    const byType = (await run((trx) =>
      listReadableComponents(trx, ada, { limit: 50 }, { types: [procedure] }),
    ))!;
    expect(byType.items.map((each) => each.title).sort()).toEqual(['Calibrate', 'Inspect']);
    expect(byType.total).toBe(2);
    // The type facet leaves out the type filter; the space facet counts only Procedures.
    expect(counted(byType.facets.types)).toEqual([
      ['Procedure', 2],
      ['Topic', 2],
    ]);
    expect(counted(byType.facets.spaces)).toEqual([
      ['General', 1],
      ['Quality', 1],
    ]);
  });

  it('filters documents by space and by publishing state, counting each', async () => {
    const published = (await run((trx) =>
      listReadableDocuments(trx, ada, { limit: 50 }, { publishing: ['published'] }),
    ))!;
    expect(published.items.map((each) => each.title).sort()).toEqual(['Audit', 'Manual']);
    expect(counted(published.facets.publishing)).toEqual([
      ['published', 2],
      ['changedSince', 1],
      ['neverPublished', 1],
    ]);
    expect(counted(published.facets.spaces)).toEqual([
      ['General', 1],
      ['Quality', 1],
    ]);
    const inGeneral = (await run((trx) =>
      listReadableDocuments(trx, ada, { limit: 50 }, { spaces: [general] }),
    ))!;
    expect(inGeneral.total).toBe(3);
    expect(counted(inGeneral.facets.publishing)).toEqual([
      ['changedSince', 1],
      ['neverPublished', 1],
      ['published', 1],
    ]);
  });

  it('reads a publishing state only from a publication the reader may read', async () => {
    // Ivy reads General, and is refused the Manual's one publication by a grant on it alone.
    const ivy = await run(async (trx) => {
      const id = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ivy', email: null, display_name: 'Ivy' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: id },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const manual = await trx
        .selectFrom('publication')
        .select('id')
        .where('document_id', '=', documents.Manual!)
        .executeTakeFirstOrThrow();
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: id },
        level: { kind: 'artifact', id: manual.id },
        effect: 'deny',
        grantedBy: ada,
      });
      return id;
    });
    const listed = (await run((trx) => listReadableDocuments(trx, ivy, { limit: 50 })))!;
    // To her the Manual was never published: the one publication of it is none of hers to read.
    expect(listed.items.find((each) => each.title === 'Manual')?.publishing).toBe('neverPublished');
    expect(counted(listed.facets.publishing)).toEqual([
      ['neverPublished', 2],
      ['changedSince', 1],
    ]);
  });

  it('filters publications by document and space, counting each', async () => {
    const audits = (await run((trx) =>
      listReadablePublications(trx, ada, { limit: 50 }, { documents: [documents.Audit!] }),
    ))!;
    expect(audits.total).toBe(2);
    expect(counted(audits.facets.documents)).toEqual([
      ['Audit', 2],
      ['Guide', 1],
      ['Manual', 1],
    ]);
    expect(counted(audits.facets.spaces)).toEqual([['Quality', 2]]);
    // A document's own publications take the space filter too.
    const own = (await run((trx) =>
      listPublications(trx, documents.Audit!, ada, { limit: 50 }, { spaces: [general] }),
    ))!;
    expect(own.items).toEqual([]);
  });

  it('filters templates by space, counting each', async () => {
    const inQuality = (await run((trx) =>
      listReadableTemplates(trx, ada, { limit: 50 }, { spaces: [quality] }),
    ))!;
    expect(inQuality.items.map((each) => each.name)).toEqual(['Checklist']);
    expect(counted(inQuality.facets.spaces)).toEqual([
      ['General', 2],
      ['Quality', 1],
    ]);
  });
});
