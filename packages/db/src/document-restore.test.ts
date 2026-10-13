import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type MetadataSchemaDefinition,
  type MetadataValues,
  type OutlineDocument,
  type OutlineOperation,
  type SectionNode,
  type TemplateDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { deleteArtifact } from './deletion.js';
import { createDocument, editOutline, recordDocumentValues } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { previewRestore, restoreVersion } from './restore.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';

const REVIEW = '5c4e0000-0000-4000-8000-0000000000aa';
const STATUS = 'f1e1d000-0000-4000-8000-0000000000aa';
// A field added since, and one a template requires; the schemas applying them (the RS final review).
const PHASE = 'f1e1d000-0000-4000-8000-0000000000bb';
const OWNER = 'f1e1d000-0000-4000-8000-0000000000cc';
const DOCUMENT = '5c4e0000-0000-4000-8000-0000000000bb';
const SECTIONS = '5c4e0000-0000-4000-8000-0000000000cc';
const OWNED = '5c4e0000-0000-4000-8000-0000000000dd';

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const identity = (id: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id }) as const;
const section = (key: string, words: string) => ({
  key,
  title: text(words),
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
});

describe("restoring a document's earlier version (storage-and-versioning.md; the RS plan, RS-F)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, fn);

  /** A component Ada authors, at 0.1. */
  const component = () =>
    work(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const blank = () =>
    work(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** One outline act, by Ada unless named, recorded. */
  const act = (opened: StoredVersion, operation: OutlineOperation, author = ada) =>
    work(async (trx) => {
      const answer = await editOutline(trx, {
        artifactId: opened.artifactId,
        openedFrom: opened.id,
        author,
        operation,
      });
      if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
      return answer.version;
    });

  /** A version recorded past the outline's guards, as a since-changed template could leave one. */
  const direct = (opened: StoredVersion, content: OutlineDocument, values = opened.values) =>
    work(async (trx) => {
      const answer = await recordVersion(trx, {
        artifactId: opened.artifactId,
        openedFrom: opened.id,
        author: ada,
        substance: { kind: 'document', content, values, parameters: opened.parameters },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });

  /** The document's own values written, by Ada. */
  const valued = (opened: StoredVersion, values: MetadataValues) =>
    work(async (trx) => {
      const answer = await recordDocumentValues(trx, {
        documentId: opened.artifactId,
        openedFrom: opened.id,
        author: ada,
        values,
      });
      if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
      return answer.version;
    });

  /** A schema's next version, with these entries. */
  const reschema = (id: string, entries: MetadataSchemaDefinition['entries']) =>
    work(async (trx) => {
      const schema = (await latestVersion(trx, id))!;
      const answer = await recordVersion(trx, {
        artifactId: id,
        openedFrom: schema.id,
        author: ada,
        substance: { kind: 'metadataSchema', content: { ...identity(id), entries } },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
    });

  /** A document made from a template applying these schemas, with one section, Method. */
  const templated = (schemas: TemplateDefinition['schemas']) =>
    work(async (trx) => {
      const template = await createTemplate(trx, {
        spaceId: general,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Valued',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas,
          outline: { sections: [section('method', 'Method')] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (template.answer !== 'created') throw new Error(template.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: template.template.id,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      return document.version;
    });

  const outline = (version: StoredVersion) => version.content as OutlineDocument;
  const restore = (source: StoredVersion, latest: StoredVersion, by = ada) =>
    work((trx) =>
      restoreVersion(trx, {
        artifactId: source.artifactId,
        version: source.id,
        latest: latest.id,
        by,
      }),
    );
  const preview = (source: StoredVersion, by = ada) =>
    work((trx) => previewRestore(trx, { artifactId: source.artifactId, version: source.id, by }));
  const eventsOf = (version: string) =>
    work((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'subject', 'detail'])
        .where('subject_version', '=', version)
        .orderBy('sequence')
        .execute(),
    );
  const countOf = (artifactId: string) =>
    work(async (trx) => {
      const rows = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', artifactId)
        .execute();
      return rows.length;
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
    await work(async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const author = await findRole(trx, 'Author');
      for (const principal of [ada, grace]) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: { ...identity(STATUS), dataType: 'text', multiplicity: 'one', validation: {} },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...identity(REVIEW),
            entries: [{ field: STATUS, required: false, fixed: false }],
          },
        },
      });
      for (const field of [PHASE, OWNER]) {
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: { ...identity(field), dataType: 'text', multiplicity: 'one', validation: {} },
          },
        });
      }
      for (const [schema, fields] of [
        [DOCUMENT, [STATUS]],
        [SECTIONS, [STATUS]],
        [OWNED, [STATUS, OWNER]],
      ] as const) {
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'metadataSchema',
            content: {
              ...identity(schema),
              entries: fields.map((field) => ({ field, required: false, fixed: false })),
            },
          },
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("CNT-182 audits a set changing a reference's mode as reference.repointed, from and to; insert, move and remove are not re-points", async () => {
    const printer = await component();
    const made = await blank();
    const inserted = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: printer.artifactId, mode: { kind: 'latest' } },
    });
    const node = outline(inserted).nodes[0]!.id;
    const pinned = await act(
      inserted,
      { operation: 'set', node, mode: { kind: 'pinned', version: printer.id } },
      grace,
    );
    expect(await eventsOf(pinned.id)).toContainEqual({
      kind: 'reference.repointed',
      // Who acts is the request's (audit.md); a test transaction names nobody.
      actor: null,
      subject: made.artifactId,
      detail: {
        node,
        component: printer.artifactId,
        from: { kind: 'latest' },
        to: { kind: 'pinned', version: printer.id },
      },
    });
    const sectioned = await act(pinned, {
      operation: 'insert',
      parent: null,
      position: 1,
      node: { type: 'section', title: text('Method') },
    });
    const moved = await act(sectioned, { operation: 'move', node, parent: null, position: 1 });
    const numbered = await act(moved, { operation: 'set', node, numbered: false });
    const removed = await act(numbered, { operation: 'remove', node });
    for (const version of [inserted, sectioned, moved, numbered, removed]) {
      const kinds = (await eventsOf(version.id)).map((each) => each.kind);
      expect(kinds).not.toContain('reference.repointed');
    }
  });

  it('VER-032 restores an earlier outline as a new version, its parameters as they stand, the earlier untouched', async () => {
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text('Method') },
    });
    const second = await act(first, {
      operation: 'retitle',
      node: outline(first).nodes[0]!.id,
      title: text('Results'),
    });
    const before = await work((trx) => readVersion(trx, first.id));
    const answer = await restore(first, second, grace);
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version).toMatchObject({ revision: 0, version: 4, author: grace });
    expect(answer.version.content).toEqual(first.content);
    expect(answer.version.parameters).toEqual(second.parameters);
    expect(answer.version.restoredFrom).toBe(first.id);
    expect(await work((trx) => readVersion(trx, first.id))).toEqual(before);
  });

  it('VER-033 CNT-182 audits a restore as content.restored, and each reference it re-points from and to', async () => {
    const printer = await component();
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: {
        type: 'reference',
        component: printer.artifactId,
        mode: { kind: 'pinned', version: printer.id },
      },
    });
    const node = outline(first).nodes[0]!.id;
    const second = await act(first, { operation: 'set', node, mode: { kind: 'latest' } });
    const answer = await restore(first, second);
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(
      (await eventsOf(answer.version.id)).map(({ kind, detail }) => ({ kind, detail })),
    ).toEqual([
      { kind: 'content.version_cut', detail: { kind: 'document', parent: second.id, author: ada } },
      { kind: 'content.restored', detail: { kind: 'document', from: first.id } },
      {
        kind: 'reference.repointed',
        detail: {
          node,
          component: printer.artifactId,
          from: { kind: 'latest' },
          to: { kind: 'pinned', version: printer.id },
        },
      },
    ]);
  });

  it('VER-035 previews what a restore would make, inserting nothing, as the write then makes it', async () => {
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text('Method') },
    });
    const second = await act(first, { operation: 'remove', node: outline(first).nodes[0]!.id });
    const shown = await preview(first);
    expect(shown).toMatchObject({
      source: { id: first.id },
      latest: { id: second.id },
      refusals: [],
    });
    expect(shown!.outlines).toEqual({ latest: outline(second), restored: outline(first) });
    expect(await countOf(made.artifactId)).toBe(3);
    const answer = await restore(first, second);
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version.content).toEqual(shown!.substance!.content);
    // And it now refuses, as the write would.
    expect(await preview(first)).toMatchObject({ refusals: [{ answer: 'restore.unchanged' }] });
    expect(await restore(second, second)).toMatchObject({
      answer: 'version.precondition',
      current: { id: answer.version.id },
    });
  });

  it('refuses a reference the restorer may no longer read, in the words an outline act is refused in', async () => {
    const printer = await component();
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: printer.artifactId, mode: { kind: 'latest' } },
    });
    const second = await act(first, { operation: 'remove', node: outline(first).nodes[0]!.id });
    await work(async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: grace },
        level: { kind: 'artifact', id: printer.artifactId },
        effect: 'deny',
        grantedBy: ada,
      }),
    );
    const refused = {
      answer: 'outline.invalid',
      reason: 'The component is not one this outline can reference',
    };
    expect(await restore(first, second, grace)).toEqual(refused);
    expect(await preview(first, grace)).toMatchObject({ refusals: [refused] });
    // Ada still reads it.
    expect((await restore(first, second)).answer).toBe('restored');
  });

  it('VER-044 refuses restoring references to components since deleted, naming each by its node and last title', async () => {
    const printer = await component();
    const scanner = await component();
    const made = await blank();
    const insert = (opened: StoredVersion, id: string) =>
      act(opened, {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: id, mode: { kind: 'latest' } },
      });
    const both = await insert(await insert(made, printer.artifactId), scanner.artifactId);
    const [first, second] = outline(both).nodes.map((node) => node.id);
    const none = await act(await act(both, { operation: 'remove', node: first! }), {
      operation: 'remove',
      node: second!,
    });
    for (const gone of [printer, scanner]) {
      expect(await work((trx) => deleteArtifact(trx, gone.artifactId, ada))).toEqual({
        answer: 'deleted',
      });
    }
    const missing = [
      { answer: 'reference.deleted', node: first, title: 'Install the printer' },
      { answer: 'reference.deleted', node: second, title: 'Install the printer' },
    ];
    expect(await preview(both)).toMatchObject({ refusals: missing });
    expect(await restore(both, none)).toEqual(missing[0]);
    expect(await countOf(made.artifactId)).toBe(5);
  });

  it("refuses what the document's template does not allow its sections, over the whole outline", async () => {
    const made = await work(async (trx) => {
      const template = await createTemplate(trx, {
        spaceId: general,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Fixed',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: {
            sections: [section('introduction', 'Introduction'), section('method', 'Method')],
          },
          changes: { add: false, remove: false, reorder: false },
        },
      });
      if (template.answer !== 'created') throw new Error(template.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: template.template.id,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      return document.version;
    });
    const [introduction, method] = outline(made).nodes as SectionNode[];
    // Method gone, then Method back before Introduction.
    const shorter = await direct(made, { ...outline(made), nodes: [introduction!] });
    expect(await restore(made, shorter)).toEqual({
      answer: 'outline.invalid',
      reason: "This document's template does not allow sections to be added",
    });
    const reordered = await direct(shorter, { ...outline(made), nodes: [method!, introduction!] });
    expect(await preview(shorter)).toMatchObject({
      refusals: [
        {
          answer: 'outline.invalid',
          reason: "This document's template does not allow sections to be removed",
        },
      ],
    });
    expect(await preview(made)).toMatchObject({
      refusals: [
        {
          answer: 'outline.invalid',
          reason: "This document's template does not allow sections to be reordered",
        },
      ],
    });
    expect(await countOf(made.artifactId)).toBe(3);
    expect((await work((trx) => latestVersion(trx, made.artifactId)))!.id).toBe(reordered.id);
  });

  it("VER-032 restores the document's own values and a section's, each written with the default of a field added since, a fixed one included", async () => {
    const made = await templated([
      { schema: DOCUMENT, level: 'document', requires: [] },
      { schema: SECTIONS, level: 'section', requires: [] },
    ]);
    const node = outline(made).nodes[0]!.id;
    const first = await valued(
      await act(made, { operation: 'set', node, values: { [STATUS]: 'final' } }),
      { [STATUS]: 'final' },
    );
    const second = await valued(
      await act(first, { operation: 'set', node, values: { [STATUS]: 'draft' } }),
      { [STATUS]: 'draft' },
    );
    const added = [
      { field: STATUS, required: false, fixed: false },
      { field: PHASE, required: false, fixed: true, default: 'Trial' },
    ];
    await reschema(DOCUMENT, added);
    await reschema(SECTIONS, added);
    const shown = await preview(first);
    expect(shown!.refusals).toEqual([]);
    const answer = await restore(first, second);
    if (answer.answer !== 'restored') throw new Error(JSON.stringify(answer));
    const written = { [STATUS]: 'final', [PHASE]: 'Trial' };
    expect(answer.version.values).toEqual(written);
    expect((outline(answer.version).nodes[0] as SectionNode).values).toEqual(written);
    // What the preview showed is what was written, so restoring it again changes nothing.
    expect(shown!.substance).toMatchObject({ content: answer.version.content, values: written });
    expect(await preview(first)).toMatchObject({ refusals: [{ answer: 'restore.unchanged' }] });
  });

  it("refuses the document's own value its template's field now fixes at another", async () => {
    const made = await templated([{ schema: OWNED, level: 'document', requires: [] }]);
    const first = await valued(made, { [STATUS]: 'final' });
    const second = await valued(first, { [STATUS]: 'draft' });
    await reschema(OWNED, [
      { field: STATUS, required: false, fixed: true, default: 'draft' },
      { field: OWNER, required: false, fixed: false },
    ]);
    const refused = { answer: 'values.invalid', failures: [{ field: STATUS, rule: 'fixed' }] };
    expect(await restore(first, second)).toMatchObject(refused);
    expect(await preview(first)).toMatchObject({ refusals: [refused] });
    expect(await countOf(made.artifactId)).toBe(3);
    await reschema(OWNED, [
      { field: STATUS, required: false, fixed: false },
      { field: OWNER, required: false, fixed: false },
    ]);
  });

  it('refuses values its template no longer resolves to check, naming what does not resolve', async () => {
    const made = await templated([{ schema: OWNED, level: 'document', requires: [OWNER] }]);
    const first = await valued(made, { [STATUS]: 'final' });
    const second = await valued(first, { [STATUS]: 'draft' });
    // The schema no longer groups the owner the template requires.
    await reschema(OWNED, [{ field: STATUS, required: false, fixed: false }]);
    const refused = {
      answer: 'template.unresolved',
      unresolved: [{ reference: 'requires', id: OWNED, field: OWNER }],
    };
    expect(await restore(first, second)).toEqual(refused);
    expect(await preview(first)).toMatchObject({ refusals: [refused] });
    expect(await countOf(made.artifactId)).toBe(3);
  });

  it('refuses a document version that no longer reads', async () => {
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text('Method') },
    });
    // A version whose outline no reader takes, as only a fault could leave one, then a later one.
    const unreadable = await work(async (trx) => {
      const { rows } = await sql<{ id: string }>`
        insert into artifact_version (artifact_id, kind, revision_no, version_no, author_id,
          schema_version, content, content_hash, metadata_values, not_carried, parameters,
          version_digest)
        select artifact_id, kind, revision_no, version_no + 1, author_id, 999,
          jsonb_set(content, '{schemaVersion}', '999'), content_hash, metadata_values, not_carried,
          parameters, version_digest
        from artifact_version where id = ${first.id}
        returning id`.execute(trx);
      return (await readVersion(trx, rows[0]!.id))!;
    });
    const later = await direct(unreadable, { ...outline(first), nodes: [] });
    expect(await restore(unreadable, later)).toEqual({ answer: 'restore.unreadable' });
    expect(await preview(unreadable)).toMatchObject({
      refusals: [{ answer: 'restore.unreadable' }],
      substance: undefined,
    });
    expect(await countOf(made.artifactId)).toBe(4);
  });

  it('CNT-182 audits a restore re-pointing a reference between the latest and the approved version', async () => {
    const printer = await component();
    const made = await blank();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: printer.artifactId, mode: { kind: 'latest' } },
    });
    const node = outline(first).nodes[0]!.id;
    const second = await act(first, { operation: 'set', node, mode: { kind: 'approved' } });
    const answer = await restore(first, second);
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(
      (await eventsOf(answer.version.id))
        .filter((each) => each.kind === 'reference.repointed')
        .map((each) => each.detail),
    ).toEqual([
      { node, component: printer.artifactId, from: { kind: 'approved' }, to: { kind: 'latest' } },
    ]);
  });

  // Last: it changes the schema the template here applies to sections.
  it("refuses a section's value its template's field no longer takes, as an outline act does", async () => {
    const made = await work(async (trx) => {
      const template = await createTemplate(trx, {
        spaceId: general,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Reviewed',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [{ schema: REVIEW, level: 'section', requires: [] }],
          outline: { sections: [section('method', 'Method')] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (template.answer !== 'created') throw new Error(template.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: template.template.id,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      return document.version;
    });
    const node = outline(made).nodes[0]!.id;
    const first = await act(made, { operation: 'set', node, values: { [STATUS]: 'final' } });
    const second = await act(first, { operation: 'set', node, values: { [STATUS]: 'draft' } });
    await work(async (trx) => {
      const schema = (await latestVersion(trx, REVIEW))!;
      const answer = await recordVersion(trx, {
        artifactId: REVIEW,
        openedFrom: schema.id,
        author: ada,
        substance: { kind: 'metadataSchema', content: { ...identity(REVIEW), entries: [] } },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
    });
    expect(await restore(first, second)).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: STATUS, rule: 'unknown' }],
    });
    expect(await countOf(made.artifactId)).toBe(3);
  });
});
