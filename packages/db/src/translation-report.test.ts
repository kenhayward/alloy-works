import { randomUUID } from 'node:crypto';
import {
  parseContentDocument,
  translationStatus,
  TRANSLATION_STATUSES,
  type InterfaceLanguage,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { claimLock, saveIteration } from './editing.js';
import { grant } from './grants.js';
import type { Keyset } from './listing.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
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
import {
  beginTranslation,
  spaceTranslations,
  translationStatusSql,
  type TranslationFilter,
} from './translation.js';
import type { StoredVersion } from './versions.js';
import { moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

/**
 * A space's translation report, paged (the TE plan, TE-C): status computed in SQL, so the report is
 * filtered and paged there, by title in the reader's collation, after the read filter.
 */
describe('a space’s translations, paged (the TE plan, TE-C)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let ivy = '';
  let space = '';
  const ids = new Map<string, string>();

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>, who = ada) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: who });

  /** Cut on the main line, or on a language line recording what it translates. */
  const cut = (
    version: StoredVersion,
    language: string,
    extra: { line?: string; translates?: string } = {},
  ) =>
    as(async (trx) => {
      const at = {
        artifactId: version.artifactId,
        principal: ada,
        session: randomUUID(),
        ...(extra.line ? { line: extra.line } : {}),
      };
      const claimed = await claimLock(trx, { ...at, move: true });
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const content = {
        ...parseContentDocument(version.content),
        language,
        content: [
          {
            type: 'paragraph' as const,
            id: 'b1',
            style: 'body',
            content: [{ type: 'text' as const, value: `${language} ${randomUUID()}`, marks: [] }],
          },
        ],
      };
      const saved = await saveIteration(trx, {
        ...at,
        sequence: 1,
        openedFrom: version.id,
        content,
      });
      if (saved.answer !== 'accepted') throw new Error(saved.answer);
      const made = await cutVersion(trx, {
        ...at,
        openedFrom: version.id,
        ...(extra.translates === undefined ? {} : { translates: extra.translates }),
      });
      if (made.answer !== 'recorded') throw new Error(made.answer);
      return made.version;
    });

  /** A component approved, so translatable, with each language begun and the translated ones cut. */
  const translated = async (
    title: string,
    languages: Record<string, 'untranslated' | 'translated' | 'outOfDate'>,
  ) => {
    const version = await as(async (trx) => {
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
    ids.set(title, version.artifactId);
    await as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
    });
    await as(async (trx) => {
      const passed = await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    }, grace);
    for (const [language, status] of Object.entries(languages)) {
      const begun = await as((trx) =>
        beginTranslation(trx, { artifactId: version.artifactId, language, by: ada }),
      );
      if (begun.answer !== 'begun') throw new Error(begun.answer);
      if (status !== 'untranslated') {
        await cut(version, language, { line: begun.line.id, translates: version.id });
      }
    }
    if (Object.values(languages).includes('outOfDate')) await cut(version, 'en-GB');
  };

  /** Every page of the report as `who` reads it, a page of `limit` at a time. */
  const walk = async (
    who: string,
    limit: number,
    filter: TranslationFilter = {},
    language?: InterfaceLanguage,
  ) => {
    const pages: { title: string; languages: string[] }[][] = [];
    let after: Keyset | undefined;
    let snapshot: string | undefined;
    for (;;) {
      const page = await as(
        (trx) =>
          spaceTranslations(
            trx,
            space,
            who,
            {
              limit,
              ...(after === undefined ? {} : { after }),
              ...(snapshot === undefined ? {} : { snapshot }),
              ...(language === undefined ? {} : { language }),
            },
            filter,
          ),
        who,
      );
      pages.push(
        page.items.map((item) => ({
          title: item.component.title,
          languages: item.translations.map((each) => `${each.language} ${each.status.status}`),
        })),
      );
      if (page.next === null) return pages;
      after = page.next;
      snapshot = page.snapshot;
    }
  };

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
      ivy = await person('Ivy');
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
        [ivy, 'Reader'],
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
    await translated('zebra', { 'fr-FR': 'translated' });
    await translated('apple', { 'fr-FR': 'untranslated', 'de-DE': 'translated' });
    await translated('Émile', { 'de-DE': 'outOfDate' });
    await translated('بحر', { 'fr-FR': 'translated' });
    await translated('Bach', { 'fr-FR': 'untranslated' });
    // A component of the space with no translation is no row of the report.
    await as((trx) =>
      createComponent(trx, {
        spaceId: space,
        title: 'Alone',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    // Ivy may not read Bach.
    await as(async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ivy },
        level: { kind: 'artifact', id: ids.get('Bach')! },
        effect: 'deny',
        grantedBy: ada,
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('holds the status SQL computes to translationStatus over every case', async () => {
    const laters = [[], [false], [true], [false, true]];
    const cases = [null, 'v1'].flatMap((translates) =>
      laters.flatMap((later) =>
        [false, true].flatMap((inTranslation) =>
          [false, true].map((machineDrafted) => ({
            translates,
            later,
            inTranslation,
            machineDrafted,
          })),
        ),
      ),
    );
    const said = await as(async (trx) => {
      const answers = [];
      for (const each of cases) {
        const { status, retranslate } = translationStatusSql({
          translates: sql`${each.translates}::text`,
          later: sql`${each.later}::boolean[]`,
          inTranslation: sql`${each.inTranslation}::boolean`,
          machineDrafted: sql`${each.machineDrafted}::boolean`,
        });
        const { rows } = await sql<{ status: string; retranslate: boolean }>`
          select ${status} as status, ${retranslate} as retranslate`.execute(trx);
        answers.push(rows[0]!);
      }
      return answers;
    });
    expect(new Set(said.map((each) => each.status))).toEqual(new Set(TRANSLATION_STATUSES));
    expect(
      said.map((each) =>
        each.status === 'outOfDate'
          ? { status: each.status, retranslate: each.retranslate }
          : { status: each.status },
      ),
    ).toEqual(
      cases.map((each) =>
        translationStatus({
          translates: each.translates,
          laterSource: each.later.map((retranslate) => ({ retranslate })),
          inTranslation: each.inTranslation,
          machineDrafted: each.machineDrafted,
        }),
      ),
    );
  });

  it('LOC-016 reports a space’s translated components a page at a time, by title in the reader’s collation, each once', async () => {
    const whole = (await walk(ada, 2)).flat();
    expect(whole.map((row) => row.title)).toEqual(['apple', 'Bach', 'Émile', 'zebra', 'بحر']);
    expect(whole[0]!.languages).toEqual(['de-DE translated', 'fr-FR untranslated']);
    expect(whole[2]!.languages).toEqual(['de-DE outOfDate']);
    expect((await walk(ada, 2, {}, 'ar-XB')).flat().map((row) => row.title)).toEqual([
      'بحر',
      'apple',
      'Bach',
      'Émile',
      'zebra',
    ]);
  });

  it('LOC-016 filters by language and status before paging, so every page but the last is full', async () => {
    const french = await walk(ada, 1, { language: 'fr-FR' });
    expect(french.flat()).toEqual([
      { title: 'apple', languages: ['fr-FR untranslated'] },
      { title: 'Bach', languages: ['fr-FR untranslated'] },
      { title: 'zebra', languages: ['fr-FR translated'] },
      { title: 'بحر', languages: ['fr-FR translated'] },
    ]);
    expect(french.every((page) => page.length === 1)).toBe(true);
    expect((await walk(ada, 2, { status: 'translated' })).flat().map((row) => row.title)).toEqual([
      'apple',
      'zebra',
      'بحر',
    ]);
    expect((await walk(ada, 2, { language: 'fr-FR', status: 'untranslated' })).flat()).toEqual([
      { title: 'apple', languages: ['fr-FR untranslated'] },
      { title: 'Bach', languages: ['fr-FR untranslated'] },
    ]);
    expect((await walk(ada, 2, { status: 'outOfDate' })).flat()).toEqual([
      { title: 'Émile', languages: ['de-DE outOfDate'] },
    ]);
  });

  it('LOC-016 never names a component, or its translations, to a reader who may not read it, and pages after that filter', async () => {
    const pages = await walk(ivy, 1, { language: 'fr-FR' });
    expect(pages.flat().map((row) => row.title)).toEqual(['apple', 'zebra', 'بحر']);
    expect(pages.every((page) => page.length === 1)).toBe(true);
  });
});
