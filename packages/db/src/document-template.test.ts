import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type OutlineOperation,
  type SectionNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument, editOutline, recordDocumentValues } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { requestPublication } from './publishing.js';
import {
  createTemplate,
  documentLayout,
  documentTemplate,
  readTemplate,
  recordTemplateVersion,
} from './templates.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, latestVersion, recordVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const REVIEW = '5c4e0000-0000-4000-8000-000000000001';
const OWNER = 'f1e1d000-0000-4000-8000-000000000001';
const STATUS = 'f1e1d000-0000-4000-8000-000000000002';

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const section = (key: string, words: string) => ({
  key,
  title: text(words),
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
});
const definition = (over: object = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  // The one schema at both levels: the owner required of the document, the status defaulted at each.
  schemas: [
    { schema: REVIEW, level: 'document', requires: [OWNER] },
    { schema: REVIEW, level: 'section', requires: [] },
  ],
  outline: { sections: [section('introduction', 'Introduction'), section('method', 'Method')] },
  changes: { add: true, remove: true, reorder: true },
  ...over,
});
const identity = (id: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id }) as const;
type Entry = { field: string; required: boolean; fixed: boolean; default?: string };
const review = (entries: Entry[]) => ({ ...identity(REVIEW), entries });

const words = (node: SectionNode) =>
  node.title.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');

describe('a document made from a template', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

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
      for (const field of [OWNER, STATUS]) {
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: { ...identity(field), dataType: 'text', multiplicity: 'one', validation: {} },
          },
        });
      }
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: review([
            { field: OWNER, required: false, fixed: false },
            { field: STATUS, required: false, fixed: false, default: 'draft' },
          ]),
        },
      });
      // Ada reads General, where the templates are; Grace holds nothing anywhere.
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const template = async (over: object = {}) => {
    const answer = await service.withTenant(production, (trx) =>
      createTemplate(trx, { spaceId: general, definition: definition(over), author: ada }),
    );
    if (answer.answer !== 'created') throw new Error(answer.answer);
    return answer.template;
  };
  const make = (templateId: string | undefined, author = ada) =>
    service.withTenant(production, (trx) =>
      createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author,
        ...(templateId === undefined ? {} : { template: templateId }),
      }),
    );
  const count = (table: 'artifact' | 'document_template') =>
    service.withTenant(production, async (trx) =>
      Number(
        (
          await trx
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );

  it('TPL-025 records the template and its version', async () => {
    const made = await template({ name: 'Inspection' });
    const next = await service.withTenant(production, (trx) =>
      recordTemplateVersion(trx, {
        templateId: made.id,
        openedFrom: made.version.id,
        definition: definition({ name: 'Site inspection' }),
        author: ada,
      }),
    );
    if (next.answer !== 'recorded') throw new Error(next.answer);
    const answer = await make(made.id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    // The template, and the version of it that was latest when the document was made.
    expect(
      await service.withTenant(production, (trx) =>
        documentTemplate(trx, answer.version.artifactId),
      ),
    ).toEqual({ template: made.id, version: next.template.version.id });
    // A blank document records none.
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    expect(
      await service.withTenant(production, (trx) =>
        documentTemplate(trx, blank.version.artifactId),
      ),
    ).toBeUndefined();
  });

  it('writes the starting outline, with its origins, and the seeded values at 0.1', async () => {
    const answer = await make((await template()).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const outline = answer.version.content as { nodes: SectionNode[] };
    expect(outline.nodes.map((node) => [words(node), node.origin, node.values])).toEqual([
      ['Introduction', 'introduction', { [STATUS]: 'draft' }],
      ['Method', 'method', { [STATUS]: 'draft' }],
    ]);
    expect(answer.version.values).toEqual({ [STATUS]: 'draft' });
    expect([answer.version.revision, answer.version.version]).toEqual([0, 1]);
  });

  it("keeps a document's values when its outline is changed", async () => {
    const answer = await make((await template()).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const edited = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: answer.version.artifactId,
        openedFrom: answer.version.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 2,
          node: { type: 'section', title: text('Results') },
        },
      }),
    );
    if (edited.answer !== 'recorded') throw new Error(edited.answer);
    expect(edited.version.values).toEqual({ [STATUS]: 'draft' });
  });

  it('answers a template the author may not read as missing, and writes nothing', async () => {
    const made = await template();
    const before = await count('artifact');
    expect(await make(made.id, grace)).toEqual({ answer: 'template.missing' });
    // Nor is anything but a template one: a document's id is no template.
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    expect(await make(blank.version.artifactId)).toEqual({ answer: 'template.missing' });
    expect(await count('artifact')).toBe(before + 1);
  });

  it("TPL-027 TPL-016 leaves the document's outline its own", async () => {
    const made = await template({ name: 'Minutes' });
    const answer = await make(made.id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const document = answer.version.artifactId;
    // The document departs from the starting shape: its first section removed.
    const first = (answer.version.content as { nodes: SectionNode[] }).nodes[0]!;
    const edited = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: document,
        openedFrom: answer.version.id,
        author: ada,
        operation: { operation: 'remove', node: first.id },
      }),
    );
    expect(edited.answer).toBe('recorded');
    // Which changes the document and not the template.
    const unchanged = await service.withTenant(production, (trx) => readTemplate(trx, made.id));
    expect(unchanged?.version.id).toBe(made.version.id);
    expect(unchanged?.definition.outline.sections.map((each) => each.key)).toEqual([
      'introduction',
      'method',
    ]);
    // And the template's next version changes no document made from it.
    const next = await service.withTenant(production, (trx) =>
      recordTemplateVersion(trx, {
        templateId: made.id,
        openedFrom: made.version.id,
        definition: definition({
          name: 'Minutes',
          outline: { sections: [section('agenda', 'Agenda')] },
        }),
        author: ada,
      }),
    );
    expect(next.answer).toBe('recorded');
    const latest = await service.withTenant(production, (trx) => latestVersion(trx, document));
    expect((latest!.content as { nodes: SectionNode[] }).nodes.map(words)).toEqual(['Method']);
    expect(await service.withTenant(production, (trx) => documentTemplate(trx, document))).toEqual({
      template: made.id,
      version: made.version.id,
    });
  });

  it('refuses to change or remove the record of the template a document was made from', async () => {
    const made = await template();
    const answer = await make(made.id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const document = answer.version.artifactId;
    // Raw, because the table's typing already gives an update nothing to set.
    await expect(
      service.withTenant(production, (trx) =>
        sql`update document_template set template_version_id = ${made.version.id}
            where document_id = ${document}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(production, (trx) =>
        trx.deleteFrom('document_template').where('document_id', '=', document).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  /**
   * A second theme or layout: a copy of the environment's latest version, under an artifact of its
   * own. Written row by row, because nothing yet makes one - `createArtifact` leaves both to their
   * migrations - and the copy's digests are the original's, being over the same content.
   */
  const copied = (kind: 'theme' | 'layout', of: string) =>
    service.withTenant(production, async (trx) => {
      const original = await latestVersion(trx, of);
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind, space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          kind,
          revision_no: 0,
          version_no: 1,
          author_id: ada,
          note: null,
          schema_version: original!.schemaVersion,
          content: JSON.stringify(original!.content),
          content_hash: original!.contentHash,
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: original!.versionDigest,
        })
        .execute();
      return artifact.id;
    });
  const requested = (document: string, version: string) =>
    service.withTenant(production, async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: document,
        version,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return trx
        .selectFrom('publication_request')
        .select(['theme_id', 'layout_id'])
        .where('id', '=', answer.request.id)
        .executeTakeFirstOrThrow();
    });

  it('STY-025 publishes a document under the theme its template binds', async () => {
    const theme = await copied('theme', DEFAULT_THEME_ID);
    // No schemas, so nothing it asks for stands between the document and its publication.
    const answer = await make((await template({ theme, schemas: [] })).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    expect((await requested(answer.version.artifactId, answer.version.id)).theme_id).toBe(theme);
    // A blank document keeps the environment's.
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    expect((await requested(blank.version.artifactId, blank.version.id)).theme_id).toBe(
      DEFAULT_THEME_ID,
    );
  });

  it('publishes and numbers a document under the layout its template binds', async () => {
    const layout = await copied('layout', DEFAULT_LAYOUT_ID);
    const answer = await make((await template({ layout, schemas: [] })).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const document = answer.version.artifactId;
    expect((await requested(document, answer.version.id)).layout_id).toBe(layout);
    // The one reader the page's numbering and its view take the layout from.
    const read = await service.withTenant(production, (trx) => documentLayout(trx, document));
    expect(read.artifactId).toBe(layout);
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    const kept = await service.withTenant(production, (trx) =>
      documentLayout(trx, blank.version.artifactId),
    );
    expect(kept.artifactId).toBe(DEFAULT_LAYOUT_ID);
  });

  it('holds an outline act to the changes of the template version the document was made from', async () => {
    const made = await template({
      name: 'Fixed',
      changes: { add: false, remove: false, reorder: false },
    });
    const answer = await make(made.id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    // The template's next version allows everything, and a document made before it is held still.
    const next = await service.withTenant(production, (trx) =>
      recordTemplateVersion(trx, {
        templateId: made.id,
        openedFrom: made.version.id,
        definition: definition({ name: 'Fixed' }),
        author: ada,
      }),
    );
    expect(next.answer).toBe('recorded');
    const insert = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: answer.version.artifactId,
        openedFrom: answer.version.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 2,
          node: { type: 'section', title: text('Results') },
        },
      }),
    );
    expect(insert).toEqual({
      answer: 'outline.invalid',
      reason: "This document's template does not allow sections to be added",
    });
    // A blank document is held to nothing.
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    const free = await service.withTenant(production, (trx) =>
      editOutline(trx, {
        artifactId: blank.version.artifactId,
        openedFrom: blank.version.id,
        author: ada,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'section', title: text('Results') },
        },
      }),
    );
    expect(free.answer).toBe('recorded');
  });

  it("writes a section's values against its template's section-level fields, refusing by name", async () => {
    const answer = await make((await template()).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const method = (answer.version.content as { nodes: SectionNode[] }).nodes[1]!;
    const set = (values: Record<string, unknown>, openedFrom = answer.version.id) =>
      service.withTenant(production, (trx) =>
        editOutline(trx, {
          artifactId: answer.version.artifactId,
          openedFrom,
          author: ada,
          operation: { operation: 'set', node: method.id, values },
        }),
      );
    const refused = await set({ [OWNER]: 'Ada', 'field-audience': 'clinical' });
    expect(refused).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: 'field-audience', rule: 'unknown' }],
    });
    const written = await set({ [STATUS]: 'final' });
    if (written.answer !== 'recorded') throw new Error(written.answer);
    const nodes = (written.version.content as { nodes: SectionNode[] }).nodes;
    expect(nodes[1]!.values).toEqual({ [STATUS]: 'final' });
    // And the document's own values are carried as they stood.
    expect(written.version.values).toEqual({ [STATUS]: 'draft' });
  });

  it("writes a document's values whole, as a version with its outline unchanged", async () => {
    const answer = await make((await template()).id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const write = (values: Record<string, unknown>, openedFrom: string) =>
      service.withTenant(production, (trx) =>
        recordDocumentValues(trx, {
          documentId: answer.version.artifactId,
          openedFrom,
          author: ada,
          values,
        }),
      );
    const written = await write({ [OWNER]: 'Ada' }, answer.version.id);
    if (written.answer !== 'recorded') throw new Error(written.answer);
    // The status left without a member takes its default, as a section's does.
    expect(written.version.values).toEqual({ [OWNER]: 'Ada', [STATUS]: 'draft' });
    expect(written.version.content).toEqual(answer.version.content);
    expect([written.version.revision, written.version.version]).toEqual([0, 2]);
    // The same again is no version; from the version before, it is refused as stale; and a field that
    // does not apply to the document is refused by name.
    expect((await write({ [OWNER]: 'Ada' }, written.version.id)).answer).toBe('version.unchanged');
    expect((await write({ [OWNER]: 'Grace' }, answer.version.id)).answer).toBe(
      'version.precondition',
    );
    expect(await write({ 'field-audience': 'clinical' }, written.version.id)).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: 'field-audience', rule: 'unknown' }],
    });
    // A blank document has no field to hold a value for.
    const blank = await make(undefined);
    if (blank.answer !== 'created') throw new Error(blank.answer);
    expect(
      await service.withTenant(production, (trx) =>
        recordDocumentValues(trx, {
          documentId: blank.version.artifactId,
          openedFrom: blank.version.id,
          author: ada,
          values: { [OWNER]: 'Ada' },
        }),
      ),
    ).toMatchObject({ answer: 'values.invalid', failures: [{ field: OWNER, rule: 'unknown' }] });
  });

  const publish = (document: string, version: string) =>
    service.withTenant(production, (trx) =>
      requestPublication(trx, {
        documentId: document,
        version,
        formats: ['pdf'],
        requester: ada,
      }),
    );
  const act = (document: string, openedFrom: string, operation: OutlineOperation) =>
    service.withTenant(production, async (trx) => {
      const answer = await editOutline(trx, {
        artifactId: document,
        openedFrom,
        author: ada,
        operation,
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });

  it('TPL-013 refuses to publish a document missing a required section, naming it', async () => {
    const made = await template({
      schemas: [],
      outline: {
        sections: [
          { ...section('introduction', 'Introduction'), required: true },
          section('method', 'Method'),
        ],
      },
    });
    // Removed: refused, naming the starting section by its title.
    const removed = await make(made.id);
    if (removed.answer !== 'created') throw new Error(removed.answer);
    const [introduction] = (removed.version.content as { nodes: SectionNode[] }).nodes;
    const without = await act(removed.version.artifactId, removed.version.id, {
      operation: 'remove',
      node: introduction!.id,
    });
    expect(await publish(removed.version.artifactId, without.id)).toEqual({
      answer: 'section.required',
      sections: [{ key: 'introduction', title: 'Introduction' }],
    });
    // Retitled and moved under Method, it is still the required section: found by its key.
    const kept = await make(made.id);
    if (kept.answer !== 'created') throw new Error(kept.answer);
    const nodes = (kept.version.content as { nodes: SectionNode[] }).nodes;
    const retitled = await act(kept.version.artifactId, kept.version.id, {
      operation: 'retitle',
      node: nodes[0]!.id,
      title: text('Background'),
    });
    const moved = await act(kept.version.artifactId, retitled.id, {
      operation: 'move',
      node: nodes[0]!.id,
      parent: nodes[1]!.id,
      position: 0,
    });
    expect((await publish(kept.version.artifactId, moved.id)).answer).toBe('requested');
  });

  it("TPL-055 refuses to publish a document whose fields, or any section's, do not satisfy its template, naming each failure", async () => {
    const made = await template({
      schemas: [
        { schema: REVIEW, level: 'document', requires: [OWNER] },
        { schema: REVIEW, level: 'section', requires: [OWNER] },
      ],
    });
    const answer = await make(made.id);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    const document = answer.version.artifactId;
    const [introduction, method] = (answer.version.content as { nodes: SectionNode[] }).nodes;
    // No owner anywhere: the document's own, and each section's, named with the node it belongs to.
    const refused = await publish(document, answer.version.id);
    if (refused.answer !== 'metadata.invalid') throw new Error(refused.answer);
    expect(refused.failures.map(({ node, field, rule }) => [node, field, rule])).toEqual([
      [null, OWNER, 'required'],
      [introduction!.id, OWNER, 'required'],
      [method!.id, OWNER, 'required'],
    ]);
    // Filled in everywhere, it publishes.
    let version = await service.withTenant(production, async (trx) => {
      const written = await recordDocumentValues(trx, {
        documentId: document,
        openedFrom: answer.version.id,
        author: ada,
        values: { [OWNER]: 'Ada' },
      });
      if (written.answer !== 'recorded') throw new Error(written.answer);
      return written.version;
    });
    for (const node of [introduction!, method!]) {
      version = await act(document, version.id, {
        operation: 'set',
        node: node.id,
        values: { [OWNER]: 'Grace' },
      });
    }
    expect((await publish(document, version.id)).answer).toBe('requested');
  });

  // Last, because it changes the one schema every template here assigns.
  it('TPL-004 refuses to make a document while any reference does not resolve, and writes nothing', async () => {
    const made = await template();
    // The schema's next version no longer groups the owner the template requires.
    await service.withTenant(production, async (trx) => {
      const current = await latestVersion(trx, REVIEW);
      const answer = await recordVersion(trx, {
        artifactId: REVIEW,
        openedFrom: current!.id,
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: review([{ field: STATUS, required: false, fixed: false, default: 'draft' }]),
        },
      });
      expect(answer.answer).toBe('recorded');
    });
    const artifacts = await count('artifact');
    const links = await count('document_template');
    expect(await make(made.id)).toEqual({
      answer: 'template.unresolved',
      unresolved: [{ reference: 'requires', id: REVIEW, field: OWNER }],
    });
    expect(await count('artifact')).toBe(artifacts);
    expect(await count('document_template')).toBe(links);
  });
});
