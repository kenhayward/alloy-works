import {
  TEMPLATE_SCHEMA_VERSION,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { COHORT_ROWS_MAX, submitCohort } from './cohorts.js';
import { copyArtifact } from './copies.js';
import { createComponent } from './creation.js';
import {
  defaultTemplateOf,
  ensureDefaultTemplate,
  setDefaultTemplate,
} from './default-template.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { originOf } from './origins.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace, readSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, listReadableTemplates, readTemplate } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { latestVersion, readVersion, recordVersion, substanceOf } from './versions.js';

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const paragraph = (value: string) => ({
  type: 'paragraph',
  id: 'p1',
  style: 'body',
  content: text(value),
});

describe('a new document: the default template, copies and their origin (the ND plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let open = '';
  let other = '';

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, fn, { actorKind: 'person', actor: ada });

  const template = (over: object, space = open) =>
    work(async (trx) => {
      const made = await createTemplate(trx, {
        spaceId: space,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          ...over,
        },
      });
      if (made.answer !== 'created') throw new Error(JSON.stringify(made));
      return made.template;
    });

  const component = (title: string) =>
    work(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: open,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        blocks: [paragraph(`${title}.`) as never],
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const moveOut = (trx: TenantTransaction, id: string) =>
    sql`update artifact set space_id = ${other} where id = ${id}`.execute(trx);

  const references = (outline: OutlineDocument) => {
    const found: Extract<OutlineNode, { type: 'reference' }>[] = [];
    const walk = (nodes: readonly OutlineNode[]) =>
      nodes.forEach((node) => {
        if (node.type === 'reference') found.push(node);
        walk(node.children);
      });
    walk(outline.nodes);
    return found;
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
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject: 'ada', email: 'ada@example.com' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      open = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      other = (await createSpace(trx, 'Other')).id;
      for (const space of [open, other]) {
        await grant(trx, {
          subject: { principal: ada },
          roleId: (await findRole(trx, 'Author'))!.id,
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

  it('TPL-074 makes Blank as the space default when first needed, once, and again where the default no longer counts', async () => {
    expect(await work((trx) => defaultTemplateOf(trx, open))).toBeNull();
    const blank = await work((trx) => ensureDefaultTemplate(trx, open, ada));
    expect(await work((trx) => ensureDefaultTemplate(trx, open, ada))).toBe(blank);
    expect(await work((trx) => defaultTemplateOf(trx, open))).toBe(blank);
    expect((await work((trx) => readSpace(trx, open)))!.defaultTemplate).toBe(blank);
    const listed = await work((trx) => listReadableTemplates(trx, ada));
    expect(listed!.items.find((each) => each.id === blank)).toMatchObject({
      isDefault: true,
      summary: { sections: 0, copied: 1, referenced: 0, headings: [] },
    });
    const read = await work((trx) => readTemplate(trx, blank!));
    expect(read!.definition.name).toBe('Blank');
    expect(read!.version.author).toBe(ada);

    // Moved out of its space, it counts as none: the next to need one makes Blank again.
    await work((trx) => moveOut(trx, blank!));
    const again = await work((trx) => ensureDefaultTemplate(trx, open, ada));
    expect(again).not.toBe(blank);
    expect(await work((trx) => ensureDefaultTemplate(trx, 'not-a-space', ada))).toBeUndefined();
  });

  it('TPL-074 sets another of the space own templates as its default, refusing one elsewhere', async () => {
    const report = await template({ name: 'Survey' });
    const elsewhere = await template({ name: 'Elsewhere' }, other);
    expect(await work((trx) => setDefaultTemplate(trx, open, elsewhere.id))).toEqual({
      answer: 'template.unusable',
    });
    expect(await work((trx) => setDefaultTemplate(trx, open, report.id))).toEqual({
      answer: 'set',
    });
    expect(await work((trx) => defaultTemplateOf(trx, open))).toBe(report.id);
    // A component is no template.
    const part = await component('Part');
    expect(await work((trx) => setDefaultTemplate(trx, open, part.artifactId))).toEqual({
      answer: 'template.unusable',
    });
    await work((trx) => moveOut(trx, report.id));
    expect(await work((trx) => defaultTemplateOf(trx, open))).toBeNull();
  });

  it('TPL-075 REU-059 makes each copy the document own, placed latest, with its origin; a reference stays a reference', async () => {
    const statement = await component('Statement');
    const notice = await component('Notice');
    const made = await template({
      components: [
        {
          key: 'statement',
          component: statement.artifactId,
          instantiate: 'copy',
          place: { section: null, at: 'start' },
        },
        {
          key: 'words',
          content: { title: 'Please supply a title', blocks: [paragraph('Please supply it.')] },
          required: false,
          place: { section: null, at: 'end' },
        },
        {
          key: 'notice',
          component: notice.artifactId,
          mode: { kind: 'latest' },
          place: { section: null, at: 'end' },
        },
      ],
    });
    const document = await work(async (trx) => {
      const answer = await createDocument(trx, {
        spaceId: open,
        title: 'Site 4',
        language: 'fr-FR',
        direction: 'ltr',
        author: ada,
        template: made.id,
      });
      if (answer.answer !== 'created') throw new Error(JSON.stringify(answer));
      return answer.version;
    });
    const placed = references(document.content as OutlineDocument);
    expect(placed.map((each) => each.origin)).toEqual(['statement', 'words', 'notice']);
    const [copied, words, referenced] = placed;
    expect(copied!.component).not.toBe(statement.artifactId);
    expect(copied!.mode).toEqual({ kind: 'latest' });
    expect(referenced!.component).toBe(notice.artifactId);

    const copy = await work((trx) => latestVersion(trx, copied!.component));
    expect((copy!.content as ContentDocument).title).toBe('Statement');
    const fromWords = await work((trx) => latestVersion(trx, words!.component));
    expect(fromWords!.content as ContentDocument).toMatchObject({
      title: 'Please supply a title',
      language: 'fr-FR',
    });
    expect(fromWords!.author).toBe(ada);

    const origin = await work((trx) => originOf(trx, copied!.component));
    expect(origin).toEqual({
      from: statement.artifactId,
      version: statement.id,
      template: { id: made.id, version: made.version.id },
      changedSince: false,
    });
    expect(await work((trx) => originOf(trx, words!.component))).toEqual({
      from: null,
      version: null,
      template: { id: made.id, version: made.version.id },
      changedSince: false,
    });
    expect(await work((trx) => originOf(trx, notice.artifactId))).toBeUndefined();

    // The original changed since, the copy says so.
    await work(async (trx) => {
      const substance = substanceOf((await readVersion(trx, statement.id))!);
      if (substance.kind !== 'component') throw new Error('not a component');
      await recordVersion(trx, {
        artifactId: statement.artifactId,
        openedFrom: statement.id,
        author: ada,
        substance: { ...substance, content: { ...substance.content, title: 'Statement, revised' } },
      });
    });
    expect(await work((trx) => originOf(trx, copied!.component))).toMatchObject({
      changedSince: true,
    });

    // Duplicated, the document's copies are its own to copy, required ones too, each with its origin.
    const duplicate = await work(async (trx) => {
      const answer = await copyArtifact(trx, {
        artifactId: document.artifactId,
        to: open,
        title: 'Site 5',
        by: ada,
      });
      if (answer.answer !== 'copied') throw new Error(JSON.stringify(answer));
      return answer;
    });
    const again = references(duplicate.copy.content as OutlineDocument);
    expect(again[0]!.origin).toBe('statement');
    expect(again[0]!.component).not.toBe(copied!.component);
    expect(again[2]!.component).toBe(notice.artifactId);
    expect(await work((trx) => originOf(trx, again[0]!.component))).toMatchObject({
      from: copied!.component,
      version: copy!.id,
      template: null,
    });
  });

  it('TPL-075 refuses a cohort whose rows would make more than COHORT_ROWS_MAX copies', async () => {
    const made = await template({
      components: ['one', 'two'].map((key) => ({
        key,
        content: { title: key, blocks: [paragraph(key)] },
        place: { section: null, at: 'end' },
      })),
    });
    const rows = Array.from({ length: COHORT_ROWS_MAX / 2 + 1 }, () => ({}));
    const answer = await work((trx) =>
      submitCohort(trx, {
        by: ada,
        spaceId: open,
        template: made.id,
        title: 'Row',
        language: 'en-GB',
        direction: 'ltr',
        rows,
        source: { rows: rows.length },
      }),
    );
    expect(answer).toMatchObject({ answer: 'rows.invalid' });
  });
});
