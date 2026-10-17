import { randomUUID } from 'node:crypto';
import type { ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
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
import { styleUses } from './uses.js';
import { readVersion, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const text = (value: string) => [{ type: 'text', value, marks: [] }];

describe('where a style is used (relationships.md, "Where used"; the R20 plan, R20-A)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';
  let quality = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A component in a space, at a version holding these blocks. */
  const holding = (space: string, title: string, blocks: unknown[]) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...substance.content, content: blocks as ContentDocument['content'] },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version.artifactId;
    });
  const paragraph = (style: string) => ({
    type: 'paragraph',
    id: `p${randomUUID().slice(0, 6)}`,
    style,
    content: text('Set the tray.'),
  });
  const table = (style: string, cellStyle = 'body') => ({
    type: 'table',
    id: `t${randomUUID().slice(0, 6)}`,
    style,
    caption: text('Readings'),
    headerRows: 0,
    headerColumns: 0,
    rows: [
      {
        cells: [{ content: [paragraph(cellStyle)], colspan: 1, rowspan: 1 }],
      },
    ],
  });

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
    await as(async (trx) => {
      const person = async (subject: string, name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject, email: null, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Grace reads General alone; Ada reads both.
      const reader = (await findRole(trx, 'Reader'))!.id;
      for (const [who, space] of [
        [grace, general],
        [ada, general],
        [ada, quality],
      ] as const) {
        await grant(trx, {
          roleId: reader,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('REU-055 lists the components whose latest version uses a paragraph or a table style, and only those its reader may read', async () => {
    const warned = await holding(general, 'Warnings', [paragraph('warning')]);
    const inCell = await holding(general, 'Readings table', [table('wide', 'warning')]);
    const hidden = await holding(quality, 'Calibration', [paragraph('warning')]);
    await holding(general, 'Plain', [paragraph('body')]);

    const uses = (by: string, kind: 'paragraph' | 'table', key: string) =>
      as((trx) => styleUses(trx, by, { kind, key }));
    const byGrace = await uses(grace, 'paragraph', 'warning');
    // A paragraph style is found in a table's cells too; one Grace may not read is said, unnamed.
    expect(byGrace.components.map((each) => each.title).sort()).toEqual([
      'Readings table',
      'Warnings',
    ]);
    expect(byGrace.components.map((each) => each.id).sort()).toEqual([inCell, warned].sort());
    expect(byGrace.unreadable).toBe(true);
    expect((await uses(ada, 'paragraph', 'warning')).components.map((each) => each.id)).toContain(
      hidden,
    );
    // A table style is a table's alone: the paragraph style named "wide" is no table's.
    expect((await uses(grace, 'table', 'wide')).components.map((each) => each.id)).toEqual([
      inCell,
    ]);
    expect((await uses(grace, 'paragraph', 'wide')).components).toEqual([]);
    expect(await uses(grace, 'table', 'unused')).toEqual({ components: [], unreadable: false });
  });

  it('REU-055 lists the components using an image style, a figure or an image in a run of text, and reads only their latest versions', async () => {
    const inline = (imageStyle: string) => ({
      type: 'paragraph',
      id: `p${randomUUID().slice(0, 6)}`,
      style: 'body',
      content: [
        { type: 'text', value: 'Press ', marks: [] },
        {
          type: 'image',
          asset: randomUUID(),
          imageStyle,
          alternative: { kind: 'decorative' },
        },
      ],
    });
    const pressed = await holding(general, 'Press the button', [inline('icon')]);
    expect(
      (await as((trx) => styleUses(trx, grace, { kind: 'image', key: 'icon' }))).components.map(
        (each) => each.id,
      ),
    ).toEqual([pressed]);
    expect(
      (await as((trx) => styleUses(trx, grace, { kind: 'paragraph', key: 'icon' }))).components,
    ).toEqual([]);

    // A style its latest version no longer names is not used, whatever an earlier one did.
    const changed = await holding(general, 'Notice, once a caution', [paragraph('caution')]);
    await as(async (trx) => {
      const latest = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', changed)
        .orderBy('revision_no', 'desc')
        .orderBy('version_no', 'desc')
        .executeTakeFirstOrThrow();
      const substance = substanceOf((await readVersion(trx, latest.id))!);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: changed,
        openedFrom: latest.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [paragraph('body')] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
    });
    expect(
      (await as((trx) => styleUses(trx, ada, { kind: 'paragraph', key: 'caution' }))).components,
    ).toEqual([]);
  });
});
