import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  defaultNumberingScheme,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { axesByKey, createDefinition, recordDefinitionVersion } from './definitions.js';
import { createDocument, recordDocumentProfile } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { publicationInputs, recordPublication, requestPublication } from './publishing.js';
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
import type { StoredVersion } from './versions.js';

describe('condition axes and profiles (the R6 plan, R6-A, R6-B, R6-F)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const axis = (name: string, key: string, values: string[]) =>
    as((trx) =>
      createDefinition(trx, {
        kind: 'conditionAxis',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name,
          key,
          values: values.map((each) => ({ key: each, label: each })),
        },
        author: ada,
      }),
    );
  const document = () =>
    as(async (trx) => {
      const created = await createDocument(trx, {
        spaceId: space,
        title: `Site report ${randomUUID().slice(0, 8)}`,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      return created.version;
    });
  const profiled = (version: StoredVersion, profile: unknown) =>
    as((trx) =>
      recordDocumentProfile(trx, {
        documentId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        profile: profile as never,
      }),
    );

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
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: randomUUID(),
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      space = (await createSpace(trx, 'Shared')).id;
      for (const role of ['Author', 'Publisher']) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    const made = await axis('Audience', 'audience', ['regulator', 'internal']);
    if (made.answer !== 'created') throw new Error(made.answer);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REU-020 declares an axis with its values, its key fixed and its own', async () => {
    const audience = (await as((trx) => axesByKey(trx))).get('audience');
    expect(audience?.values.map((each) => each.key)).toEqual(['regulator', 'internal']);
    expect(await axis('Readers', 'audience', ['all'])).toMatchObject({
      answer: 'definition.name_taken',
    });
    const region = await axis('Region', 'region', ['uk']);
    if (region.answer !== 'created') throw new Error(region.answer);
    const renamed = await as((trx) =>
      recordDefinitionVersion(trx, {
        id: region.definition.id,
        openedFrom: region.definition.version.id,
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Region',
          key: 'territory',
          values: [{ key: 'uk', label: 'UK' }],
        },
        author: ada,
      }),
    );
    expect(renamed).toMatchObject({ answer: 'definition.invalid' });
  });

  it('REU-022 records the profile a document declares, refusing an axis or a value not declared', async () => {
    const version = await document();
    expect(await profiled(version, { values: { tone: ['plain'] } })).toEqual({
      answer: 'profile.invalid',
      unknown: ['tone'],
    });
    expect(await profiled(version, { values: { audience: ['public'] } })).toEqual({
      answer: 'profile.invalid',
      unknown: ['audience.public'],
    });
    const recorded = await profiled(version, {
      values: { audience: ['regulator'] },
      excludeUnset: true,
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    expect((recorded.version.content as OutlineDocument).profile).toEqual({
      values: { audience: ['regulator'] },
      excludeUnset: true,
    });
    // Cleared whole, as it is written whole.
    const cleared = await profiled(recorded.version, null);
    if (cleared.answer !== 'recorded') throw new Error(cleared.answer);
    expect(cleared.version.content as OutlineDocument).not.toHaveProperty('profile');
  });

  it('REU-027 publishes under the profile named in place of the document own, and records it on the request and the publication', async () => {
    const version = await document();
    const recorded = await profiled(version, { values: { audience: ['regulator'] } });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    const ask = (profile?: unknown) =>
      as(async (trx) => {
        const asked = await requestPublication(trx, {
          documentId: recorded.version.artifactId,
          version: recorded.version.id,
          formats: ['pdf'],
          requester: ada,
          ...(profile === undefined ? {} : { profile: profile as never }),
        });
        if (asked.answer !== 'requested') throw new Error(asked.answer);
        return asked.request.id;
      });
    const own = await ask();
    const inputs = (await as((trx) => publicationInputs(trx, own)))!;
    expect(inputs.profile).toEqual({ values: { audience: ['regulator'] } });

    const staff = await ask({ values: { audience: ['internal'] } });
    expect((await as((trx) => publicationInputs(trx, staff)))!.profile).toEqual({
      values: { audience: ['internal'] },
    });
    const id = await as((trx) =>
      recordPublication(trx, {
        requestId: staff,
        pipelineVersion: '26',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 13,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      }),
    );
    const row = await as((trx) =>
      trx
        .selectFrom('publication')
        .select('profile')
        .where('id', '=', id!)
        .executeTakeFirstOrThrow(),
    );
    expect(row.profile).toEqual({ values: { audience: ['internal'] } });

    // A profile naming what no axis declares is refused before anything is asked for.
    expect(
      await as((trx) =>
        requestPublication(trx, {
          documentId: recorded.version.artifactId,
          version: recorded.version.id,
          formats: ['pdf'],
          requester: ada,
          profile: { values: { audience: ['public'] } },
        }),
      ),
    ).toEqual({ answer: 'profile.invalid', unknown: ['audience.public'] });
  });
});
