import { TEMPLATE_SCHEMA_VERSION, type ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { listReadableComponents } from './components.js';
import { createComponent } from './creation.js';
import { createDocument, listReadableDocuments } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import type { Keyset, Listed, ListingRequest, SortOrder } from './listing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { listReadablePublications } from './publishing.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { listReadableTemplates } from './templates.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { publish } from './testing/every-kind.js';
import { DEFAULT_THEME_ID } from './themes.js';
import {
  createArtifact,
  latestVersion,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

const ISSUER = 'https://idp.example';
const TITLES = ['Mango', 'apple', 'Kiwi', 'banana', 'Cherry', 'damson', 'Elder'];

type Listing = (
  trx: TenantTransaction,
  principal: string,
  request: ListingRequest<string>,
) => Promise<Listed<{ readonly id: string }> | undefined>;

describe('listings, paged by keyset as of their first page', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;

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
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      // One of each for every title, a publication of each document among them.
      for (const title of TITLES) {
        const made = await createComponent(trx, {
          spaceId: general,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const document = await createDocument(trx, {
          spaceId: general,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        await publish(trx, {
          document: document.version,
          author: ada,
          role: production.role,
        });
        await createArtifact(trx, {
          author: ada,
          spaceId: general,
          substance: {
            kind: 'template',
            content: {
              schemaVersion: TEMPLATE_SCHEMA_VERSION,
              name: title,
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

  const listings: Record<string, { list: Listing; sorts: readonly string[] }> = {
    components: {
      list: (trx, principal, request) =>
        listReadableComponents(trx, principal, request as ListingRequest<'title' | 'changed'>),
      sorts: ['title', 'changed'],
    },
    documents: {
      list: (trx, principal, request) =>
        listReadableDocuments(trx, principal, request as ListingRequest<'title' | 'changed'>),
      sorts: ['title', 'changed'],
    },
    publications: {
      list: (trx, principal, request) =>
        listReadablePublications(trx, principal, request as ListingRequest<'published' | 'title'>),
      sorts: ['published', 'title'],
    },
    templates: {
      list: (trx, principal, request) =>
        listReadableTemplates(trx, principal, request as ListingRequest<'name' | 'changed'>),
      sorts: ['name', 'changed'],
    },
  };

  /** One page, in a transaction of its own, as a request is. */
  const page = (list: Listing, request: ListingRequest<string>) =>
    service.withTenant(production, async (trx) => (await list(trx, ada, request))!);

  /** Every page a walk turns, `between` run before each after the first, and every id it showed. */
  async function walk(
    list: Listing,
    sort: string,
    order: SortOrder,
    between: (turned: number) => Promise<void> = async () => undefined,
  ): Promise<string[]> {
    const shown: string[] = [];
    let after: Keyset | undefined;
    let snapshot: string | undefined;
    for (let turned = 0; turned < 50; turned += 1) {
      if (turned > 0) await between(turned);
      const listed = await page(list, {
        sort,
        order,
        limit: 2,
        ...(after === undefined ? {} : { after }),
        ...(snapshot === undefined ? {} : { snapshot }),
      });
      shown.push(...listed.items.map((each) => each.id));
      snapshot = listed.snapshot;
      if (listed.next === null) return shown;
      after = listed.next;
    }
    throw new Error('The walk never ended');
  }

  it('pages each listing in each of its sorts, both ways, to the order it reads whole', async () => {
    for (const [name, { list, sorts }] of Object.entries(listings)) {
      for (const sort of sorts) {
        for (const order of ['asc', 'desc'] as const) {
          const whole = await page(list, { sort, order, limit: 100 });
          expect(whole.items, `${name} ${sort} ${order}`).toHaveLength(TITLES.length);
          expect(await walk(list, sort, order), `${name} ${sort} ${order}`).toEqual(
            whole.items.map((each) => each.id),
          );
        }
      }
    }
  });

  it('sorts a title by the database collation, and a time newest first by default', async () => {
    const titles = (await page(listings.components!.list, { sort: 'title', limit: 100 })).items.map(
      (each) => (each as unknown as { title: string }).title,
    );
    expect(titles).toEqual(
      [...TITLES].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
    const times = (
      await page(listings.components!.list, { sort: 'changed', limit: 100 })
    ).items.map((each) => (each as unknown as { changedAt: Date }).changedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('SCH-022 pages without repeating or skipping while the set changes', async () => {
    /** A new version of the artifact, retitled, so it moves in every sort by title or time. */
    const retitle = (id: string, title: string) =>
      service.withTenant(production, async (trx) => {
        const current = (await latestVersion(trx, id)) as StoredVersion;
        const substance = substanceOf(current);
        const content = substance.content as ContentDocument & { name?: string };
        const answer = await recordVersion(trx, {
          artifactId: id,
          openedFrom: current.id,
          author: ada,
          substance: {
            ...substance,
            content: 'name' in content ? { ...content, name: title } : { ...content, title },
          } as never,
        });
        if (answer.answer !== 'recorded') throw new Error(answer.answer);
      });
    const walks: [string, string, SortOrder][] = [
      ['components', 'title', 'asc'],
      ['components', 'changed', 'desc'],
      ['documents', 'title', 'desc'],
      ['documents', 'changed', 'asc'],
      ['templates', 'name', 'asc'],
    ];
    for (const [name, sort, order] of walks) {
      const { list } = listings[name]!;
      const before = (await page(list, { sort, order, limit: 100 })).items.map((each) => each.id);
      let fresh = 0;
      const walked = await walk(list, sort, order, async (turned) => {
        // Between pages: something shown moves past the boundary, something not yet shown moves
        // before it, and something new arrives.
        const shownAlready = before[turned * 2 - 1]!;
        const notYet = before[before.length - 1]!;
        await retitle(shownAlready, `Zz ${name} ${sort} ${order} ${turned}`);
        await retitle(notYet, `Aa ${name} ${sort} ${order} ${turned}`);
        fresh += 1;
        await service.withTenant(production, (trx) =>
          createComponent(trx, {
            spaceId: general,
            title: `Aaa new ${fresh}`,
            language: 'en-GB',
            direction: 'ltr',
            author: ada,
          }),
        );
      });
      // The walk is over the set as its first page found it: each once, in its first order.
      expect(walked, `${name} ${sort} ${order}`).toEqual(before);
    }
  });
});
