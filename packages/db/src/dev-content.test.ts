// packages/db/src/dev-content.test.ts
import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { componentFieldsNow } from './component-values.js';
import { STARTER_COMPONENT_TYPE_ID } from './creation.js';
import {
  REVIEWER_FIELD,
  seedDevelopmentConnectionUse,
  seedDevelopmentContent,
} from './dev-content.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { listReadableTemplates, recordTemplateVersion } from './templates.js';
import { latestVersion } from './versions.js';

const ISSUER = 'http://127.0.0.1:9090';

describe('the development content', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('makes a component Ada and Grace may edit and Alice may not read, once however often it runs', async () => {
    const first = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    const second = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ componentId: first.componentId, created: false });

    await service.withTenant(tenant, async (trx) => {
      const version = await latestVersion(trx, first.componentId);
      expect(version).toMatchObject({ revision: 0, version: 1, kind: 'component' });
      expect((version?.content as { title: string }).title).toBe('Install the printer');

      const target = { kind: 'artifact', id: first.componentId } as const;
      for (const subject of ['ada', 'grace']) {
        const principal = await trx
          .selectFrom('principal')
          .select('id')
          .where('issuer', '=', ISSUER)
          .where('subject', '=', subject)
          .executeTakeFirstOrThrow();
        const facts = await loadFacts(trx, principal.id, target);
        expect(decide('edit', facts!).allowed, subject).toBe(true);
        // Decision N: somebody in a development environment may publish what they author.
        expect(decide('publish', facts!).allowed, subject).toBe(true);
      }
      const alice = await trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'alice', email: null, display_name: 'Alice' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, alice.id, target);
      expect(decide('read', facts!).allowed).toBe(false);

      const grants = await trx.selectFrom('access_grant').select('id').execute();
      // Author, Publisher and Designer on General, for each of Ada and Grace.
      expect(grants).toHaveLength(6);
    });
  });

  it('finds Ada by her waiting invitation, and cuts the component as Grace', async () => {
    const invited = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Invited' },
      hostnames: ['invited.acme.alloy.test'],
    });
    await expect(
      inviteFirstAdministrator(db.adminUrl, invited, {
        email: 'ada@example.com',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ invited: true, renewed: false });
    const waiting = await service.withTenant(invited, (trx) =>
      trx
        .selectFrom('invitation')
        .select('principal_id')
        .where('email', '=', 'ada@example.com')
        .executeTakeFirstOrThrow(),
    );

    const seeded = await service.withTenant(invited, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(seeded.created).toBe(true);

    await service.withTenant(invited, async (trx) => {
      const author = await findRole(trx, 'Author');
      const grant = await trx
        .selectFrom('access_grant')
        .select('id')
        .where('role_id', '=', author!.id)
        .where('principal_id', '=', waiting.principal_id)
        .executeTakeFirst();
      expect(grant, "Ada's Author grant should name the invitation's principal").toBeDefined();

      const grace = await trx
        .selectFrom('principal')
        .select('id')
        .where('issuer', '=', ISSUER)
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow();
      const type = await latestVersion(trx, STARTER_COMPONENT_TYPE_ID);
      const component = await latestVersion(trx, seeded.componentId);
      // 0015 (task 1) now gives every tenant this component type unauthored, at migration time -
      // nobody made it, the same as the roles and General. Only the component is still cut by Grace.
      expect(type?.author).toBeNull();
      expect(component?.author).toBe(grace.id);
    });
  });

  it('never resolves Grace to a waiting invitation, even one that happens to name her address', async () => {
    const impostor = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Impostor' },
      hostnames: ['impostor.acme.alloy.test'],
    });
    // A waiting invitation to Grace's address, made the way any invitation route would - never through
    // `inviteFirstAdministrator`, which is Ada's alone in `person()` below. Only Ada's own lookup may
    // ever resolve to a waiting invitation; Grace must always be found or made by her identity, since
    // she authors content (the docstring above), which a principal still waiting on an invitation
    // cannot.
    const stray = await service.withTenant(impostor, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ email: 'grace@example.com', display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('invitation')
        .values({ email: 'grace@example.com', principal_id: principal.id })
        .execute();
      return principal.id;
    });

    const seeded = await service.withTenant(impostor, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(seeded.created).toBe(true);

    const grace = await service.withTenant(impostor, (trx) =>
      trx
        .selectFrom('principal')
        .select(['id', 'issuer'])
        .where('issuer', '=', ISSUER)
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow(),
    );
    expect(grace.id).not.toBe(stray);
    expect(grace.issuer).toBe(ISSUER);
  });

  it('makes one template in General, Report, with its required sections, however often it runs', async () => {
    const run = () =>
      service.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    await run();
    await run();
    const templates = await service.withTenant(tenant, async (trx) => {
      const ada = await trx
        .selectFrom('principal')
        .select('id')
        .where('subject', '=', 'ada')
        .executeTakeFirstOrThrow();
      return (await listReadableTemplates(trx, ada.id))!.items;
    });
    expect(templates.map((each) => [each.name, each.space.name])).toEqual([['Report', 'General']]);
    const report = await service.withTenant(tenant, (trx) => latestVersion(trx, templates[0]!.id));
    const definition = report!.content as {
      outline: { sections: { key: string; required: boolean }[] };
      changes: { reorder: boolean };
    };
    expect(definition.outline.sections.map((each) => [each.key, each.required])).toEqual([
      ['introduction', true],
      ['method', false],
      ['results', false],
      ['conclusion', true],
    ]);
    expect(definition.changes.reorder).toBe(false);
    // Two parameters to make a document with (the TP1 plan, Task 5): the reviewer seeding its field.
    const { parameters } = report!.content as {
      parameters: { name: string; required: boolean; changeable: boolean; feeds: unknown }[];
    };
    expect(parameters.map((each) => [each.name, each.required, each.changeable])).toEqual([
      ['reviewer', false, true],
      ['issued', false, false],
    ]);
    expect(parameters[0]!.feeds).toEqual({ field: REVIEWER_FIELD, arguments: false });
  });

  it('gives a Report made before parameters its two, once', async () => {
    const run = () =>
      service.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    await run();
    const report = await service.withTenant(tenant, async (trx) => {
      const found = await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'template')
        .executeTakeFirstOrThrow();
      return (await latestVersion(trx, found.id))!;
    });
    // As an environment seeded before TP1 holds it: the same definition, with no parameters.
    const before: Record<string, unknown> = { ...(report.content as Record<string, unknown>) };
    delete before['parameters'];
    await service.withTenant(tenant, async (trx) => {
      const grace = await trx
        .selectFrom('principal')
        .select('id')
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow();
      const cut = await recordTemplateVersion(trx, {
        templateId: report.artifactId,
        openedFrom: report.id,
        definition: before,
        author: grace.id,
      });
      expect(cut.answer).toBe('recorded');
    });
    await run();
    const after = await service.withTenant(tenant, (trx) => latestVersion(trx, report.artifactId));
    const { parameters } = after!.content as { parameters: { name: string }[] };
    expect(parameters.map((each) => each.name)).toEqual(['reviewer', 'issued']);
    await run();
    const again = await service.withTenant(tenant, (trx) => latestVersion(trx, report.artifactId));
    expect(again!.id).toBe(after!.id);
  });

  it('makes a Procedure component in General whose type gives it fields, however often it runs', async () => {
    const run = () =>
      service.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    await run();
    await run();
    const found = await service.withTenant(tenant, async (trx) => {
      const procedures = await trx
        .selectFrom('artifact_version as v')
        .select(['v.artifact_id', 'v.component_type_version_id'])
        .where('v.kind', '=', 'component')
        .where(sql<boolean>`v.content ->> 'title' = 'Calibrate the scanner'`)
        .execute();
      const latest = await latestVersion(trx, procedures[0]!.artifact_id);
      const { definitions, effective } = await componentFieldsNow(trx, latest!);
      return {
        components: new Set(procedures.map((each) => each.artifact_id)).size,
        type: definitions.type.definition.name,
        fields: effective.map((each) => [each.field.name, each.field.dataType, each.required]),
      };
    });
    expect(found).toEqual({
      components: 1,
      type: 'Procedure',
      fields: [
        ['Owner', 'user', true],
        ['Due', 'date', false],
        ['Reviewer', 'text', false],
      ],
    });
  });

  it('lets Ada use connections and write SQL against them in General, and Grace use them and write no SQL, through development roles of its own, however often it runs', async () => {
    await service.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    // The role as D1 made it, before it held write_sql: seeding again gives it write_sql (D2-T).
    await service.withTenant(tenant, (trx) =>
      createRole(trx, 'Connection user', ['read', 'use_connection']),
    );
    await service.withTenant(tenant, (trx) =>
      seedDevelopmentConnectionUse(trx, { issuer: ISSUER }),
    );
    await service.withTenant(tenant, (trx) =>
      seedDevelopmentConnectionUse(trx, { issuer: ISSUER }),
    );
    await service.withTenant(tenant, async (trx) => {
      const role = await findRole(trx, 'Connection user');
      expect(role?.permissions).toEqual(['read', 'use_connection', 'write_sql']);
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const grants = await trx
        .selectFrom('access_grant')
        .select(['principal_id', 'space_id'])
        .where('role_id', '=', role!.id)
        .execute();
      const ada = await trx
        .selectFrom('principal')
        .select('id')
        .where('subject', '=', 'ada')
        .executeTakeFirstOrThrow();
      expect(grants).toEqual([{ principal_id: ada.id, space_id: general.id }]);
      // Grace builds queries (D4): she uses the connections and writes no SQL.
      const builder = await findRole(trx, 'Query builder');
      expect(builder?.permissions).toEqual(['read', 'use_connection']);
      const grace = await trx
        .selectFrom('principal')
        .select('id')
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow();
      expect(
        await trx
          .selectFrom('access_grant')
          .select(['principal_id', 'space_id'])
          .where('role_id', '=', builder!.id)
          .execute(),
      ).toEqual([{ principal_id: grace.id, space_id: general.id }]);
      for (const [subject, uses, writes] of [
        ['ada', true, true],
        ['grace', true, false],
        ['alice', false, false],
      ] as const) {
        const principal = await trx
          .selectFrom('principal')
          .select('id')
          .where('subject', '=', subject)
          .executeTakeFirst();
        if (principal === undefined) {
          expect(uses, subject).toBe(false);
          continue;
        }
        const facts = await loadFacts(trx, principal.id, { kind: 'space', id: general.id });
        expect(decide('use_connection', facts!).allowed, subject).toBe(uses);
        expect(decide('write_sql', facts!).allowed, subject).toBe(writes);
      }
    });
  });
});
