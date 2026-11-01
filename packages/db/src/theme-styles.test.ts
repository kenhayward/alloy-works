import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type ParagraphStyle,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAuditContext } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
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
import { listThemes, saveStyle, styleImpact } from './theme-styles.js';
import { DEFAULT_THEME_ID, themeLatest } from './themes.js';
import { recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const text = (value: string) => [{ type: 'text', value, marks: [] }];
const paragraph = (style: string) => ({
  type: 'paragraph',
  id: `p${randomUUID().slice(0, 6)}`,
  style,
  content: text('Set the tray.'),
});
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: blockIdentifierFrom(randomBytes(16)),
  component,
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children: [],
});

/** A style of the default theme, named so a test can find it in an audit row. */
const warning: ParagraphStyle = {
  id: 'warning',
  name: 'Warning',
  basedOn: 'body',
  appliesTo: ['text'],
  properties: { bold: true },
};

describe('styles saved, deleted and weighed (the SY plan, SY-C, SY-D)', () => {
  let db: TestDatabase;
  let tenants = 0;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** A fresh environment with Ada, who authors General, and Grace, who reads nothing. */
  const environment = async () => {
    tenants += 1;
    const tenant: Tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: `Styles ${tenants}` },
      hostnames: [`styles-${tenants}.acme.alloy.test`],
    });
    const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
      service.withTenant(tenant, async (trx) => {
        await setAuditContext(trx, { actorKind: 'person', actor: people.ada });
        return work(trx);
      });
    const people = { ada: '', grace: '' };
    let general = '';
    let quality = '';
    await service.withTenant(tenant, async (trx) => {
      for (const who of ['ada', 'grace'] as const) {
        people[who] = (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: who, email: null, display_name: who })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      }
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      for (const space of [general, quality]) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: people.ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: people.ada,
        });
      }
      await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: people.grace },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: people.ada,
      });
    });
    /** A component holding these blocks, placed in a document of the same title. */
    const placed = (space: string, title: string, blocks: unknown[]) =>
      as(async (trx) => {
        const made = await createComponent(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: people.ada,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const substance = substanceOf(made.version);
        if (substance.kind !== 'component') throw new Error('not a component');
        const next = await recordVersion(trx, {
          artifactId: made.version.artifactId,
          openedFrom: made.version.id,
          author: people.ada,
          substance: {
            ...substance,
            content: { ...substance.content, content: blocks as ContentDocument['content'] },
          },
        });
        if (next.answer !== 'recorded') throw new Error(next.answer);
        const document = await createDocument(trx, {
          spaceId: space,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: people.ada,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        const outline: OutlineDocument = {
          ...(document.version.content as OutlineDocument),
          nodes: [reference(made.version.artifactId)],
        };
        const outlined = await recordVersion(trx, {
          artifactId: document.version.artifactId,
          openedFrom: document.version.id,
          author: people.ada,
          substance: { kind: 'document', content: outline },
        });
        if (outlined.answer !== 'recorded') throw new Error(outlined.answer);
        return document.version.artifactId;
      });
    const latest = () => as((trx) => themeLatest(trx, DEFAULT_THEME_ID));
    return { as, people, general, quality, placed, latest };
  };

  it('STY-029 adds a style to a catalogue as a catalogue version and a theme version naming it, without a release', async () => {
    const { as, people, latest } = await environment();
    const before = await latest();
    const answer = await as((trx) =>
      saveStyle(trx, {
        themeId: DEFAULT_THEME_ID,
        openedFrom: before.versionId,
        kind: 'paragraph',
        styleId: 'warning',
        style: warning,
        author: people.ada,
      }),
    );
    expect(answer.answer).toBe('recorded');
    const after = await latest();
    expect(after.versionId).not.toBe(before.versionId);
    expect(after.theme.paragraphStyles.get('warning')?.properties.bold).toBe(true);
    // The other catalogues are bound as they were.
    expect(after.content.catalogues.table).toBe(before.content.catalogues.table);
    expect(after.content.catalogues.paragraph).not.toBe(before.content.catalogues.paragraph);
  });

  it('STY-032 audits a style added, changed and deleted, naming the properties that changed', async () => {
    const { as, people, latest } = await environment();
    const save = async (style: ParagraphStyle | null) => {
      const answer = await as(async (trx) =>
        saveStyle(trx, {
          themeId: DEFAULT_THEME_ID,
          openedFrom: (await themeLatest(trx, DEFAULT_THEME_ID)).versionId,
          kind: 'paragraph',
          styleId: 'warning',
          style,
          author: people.ada,
        }),
      );
      expect(answer.answer).toBe('recorded');
    };
    await save(warning);
    await save({ ...warning, properties: { bold: true, colour: '#7a1f1f' } });
    await save(null);
    expect((await latest()).theme.paragraphStyles.has('warning')).toBe(false);
    const events = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['detail', 'subject', 'subject_kind'])
        .where('kind', '=', 'style.changed')
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      expect.objectContaining({
        subject_kind: 'theme',
        subject: DEFAULT_THEME_ID,
        detail: { catalogue: 'paragraph', style: 'warning', change: 'added', properties: [] },
      }),
      expect.objectContaining({
        detail: {
          catalogue: 'paragraph',
          style: 'warning',
          change: 'changed',
          properties: ['colour'],
        },
      }),
      expect.objectContaining({
        detail: { catalogue: 'paragraph', style: 'warning', change: 'deleted', properties: [] },
      }),
    ]);
  });

  it('STY-031 refuses to delete a style a component uses, with the count, and writes nothing', async () => {
    const { as, people, general, quality, placed, latest } = await environment();
    await as(async (trx) =>
      saveStyle(trx, {
        themeId: DEFAULT_THEME_ID,
        openedFrom: (await themeLatest(trx, DEFAULT_THEME_ID)).versionId,
        kind: 'paragraph',
        styleId: 'warning',
        style: warning,
        author: people.ada,
      }),
    );
    await placed(general, 'Pump checks', [paragraph('warning')]);
    await placed(quality, 'Calibration', [paragraph('warning')]);
    const before = await latest();
    const answer = await as((trx) =>
      saveStyle(trx, {
        themeId: DEFAULT_THEME_ID,
        openedFrom: before.versionId,
        kind: 'paragraph',
        styleId: 'warning',
        style: null,
        author: people.ada,
      }),
    );
    expect(answer).toEqual({ answer: 'style_in_use', components: 2 });
    expect((await latest()).versionId).toBe(before.versionId);
  });

  it('refuses a style the theme reader refuses, a stale version and an unknown style, writing nothing', async () => {
    const { as, people, latest } = await environment();
    const before = await latest();
    const save = (openedFrom: string, styleId: string, style: ParagraphStyle | null) =>
      as((trx) =>
        saveStyle(trx, {
          themeId: DEFAULT_THEME_ID,
          openedFrom,
          kind: 'paragraph',
          styleId,
          style,
          author: people.ada,
        }),
      );
    // Pale grey on white is below the contrast minimum (STY-069).
    const pale = await save(before.versionId, 'warning', {
      ...warning,
      properties: { colour: '#dddddd' },
    });
    expect(pale).toMatchObject({ answer: 'refused', refusals: [{ code: 'contrast_too_low' }] });
    const stale = await save(randomUUID(), 'warning', warning);
    expect(stale).toMatchObject({ answer: 'version.precondition' });
    const nowhere = await save(before.versionId, 'nowhere', null);
    expect(nowhere).toMatchObject({ answer: 'refused', refusals: [{ code: 'style_missing' }] });
    // A style's identifier is its key in the path, never another in the body.
    const mismatched = await save(before.versionId, 'warning', { ...warning, id: 'other' });
    expect(mismatched).toMatchObject({ answer: 'refused', refusals: [{ code: 'style_missing' }] });
    expect((await latest()).versionId).toBe(before.versionId);
  });

  it('STY-034 lists the documents a style change reaches, through the styles derived from it, naming only what the reader may read', async () => {
    const { as, people, general, quality, placed } = await environment();
    await as(async (trx) =>
      saveStyle(trx, {
        themeId: DEFAULT_THEME_ID,
        openedFrom: (await themeLatest(trx, DEFAULT_THEME_ID)).versionId,
        kind: 'paragraph',
        styleId: 'warning',
        style: warning,
        author: people.ada,
      }),
    );
    await as(async (trx) =>
      saveStyle(trx, {
        themeId: DEFAULT_THEME_ID,
        openedFrom: (await themeLatest(trx, DEFAULT_THEME_ID)).versionId,
        kind: 'paragraph',
        styleId: 'caution',
        style: { ...warning, id: 'caution', name: 'Caution', basedOn: 'warning', properties: {} },
        author: people.ada,
      }),
    );
    const checks = await placed(general, 'Pump checks', [paragraph('warning')]);
    const flush = await placed(general, 'Flush the line', [paragraph('caution')]);
    await placed(quality, 'Calibration', [paragraph('caution')]);
    await placed(general, 'Unrelated', [paragraph('quotation')]);

    const impact = (by: string, styleId: string) =>
      as((trx) => styleImpact(trx, by, { themeId: DEFAULT_THEME_ID, kind: 'paragraph', styleId }));
    expect(await impact(people.grace, 'warning')).toEqual({
      documents: [
        { id: flush, title: 'Flush the line' },
        { id: checks, title: 'Pump checks' },
      ],
      unreadable: 1,
    });
    // A style nothing derives from reaches only its own.
    expect((await impact(people.ada, 'caution')).documents.map((each) => each.title)).toEqual([
      'Calibration',
      'Flush the line',
    ]);
  });

  it("STY-067 counts every document set in the theme where the style is a place's default, since a paragraph there names none", async () => {
    const { as, people, general, placed } = await environment();
    await placed(general, 'Pump checks', [paragraph('warning')]);
    await placed(general, 'Unrelated', [paragraph('quotation')]);
    const impact = await as((trx) =>
      styleImpact(trx, people.ada, { themeId: DEFAULT_THEME_ID, kind: 'paragraph', styleId: 'body' }),
    );
    expect(impact.documents.map((each) => each.title)).toEqual(['Pump checks', 'Unrelated']);
  });

  it('lists the environment’s themes, each at its latest version, the declared one marked', async () => {
    const { as } = await environment();
    const themes = await as(listThemes);
    expect(themes).toEqual([
      {
        id: DEFAULT_THEME_ID,
        name: expect.any(String),
        version: { id: expect.any(String), number: expect.any(String) },
        isDefault: true,
      },
    ]);
  });
});
