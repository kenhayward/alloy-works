import {
  blockIdentifierFrom,
  OUTLINE_SCHEMA_VERSION,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { searchWords } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});
const section = (id: string, title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id,
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

describe('a section found by search (the R14 plan, R14-C)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let document: string;
  let pump: string;
  let gauge: string;
  const MAINTENANCE = nodeId();

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
    await service.withTenant(production, async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const secret = (await createSpace(trx, 'Secret')).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const made = async (spaceId: string, title: string) => {
        const answer = await createComponent(trx, {
          spaceId,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (answer.answer !== 'created') throw new Error(answer.answer);
        return answer.version.artifactId;
      };
      pump = await made(general, 'Prime the pump');
      gauge = await made(general, 'Read the gauge');
      const valve = await made(secret, 'Seal the valve');
      document = (
        await createArtifact(trx, {
          author: ada,
          spaceId: general,
          substance: {
            kind: 'document',
            content: {
              schemaVersion: OUTLINE_SCHEMA_VERSION,
              title: 'Pump manual',
              language: 'en-GB',
              direction: 'ltr',
              nodes: [
                section(MAINTENANCE, 'Wombat maintenance', [
                  reference(pump),
                  section(nodeId(), 'Checks', [
                    reference(valve),
                    reference(gauge),
                    reference(pump),
                  ]),
                ]),
                section(nodeId(), 'Wombat storage', []),
              ],
            },
          } as never,
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('SCH-053 carries its document and each component it places that the reader may read, once each in outline order', async () => {
    const answer = await service.withTenant(production, (trx) =>
      searchWords(trx, ada, 'wombat', { filters: { kinds: ['section'] } }),
    );
    if (answer?.outcome !== 'results') throw new Error(String(answer?.outcome));
    const byTitle = new Map(answer.items.map((each) => [each.title, each.section]));
    expect(byTitle.get('Wombat maintenance')).toEqual({
      document: { id: document, title: 'Pump manual' },
      components: [
        { id: pump, title: 'Prime the pump' },
        { id: gauge, title: 'Read the gauge' },
      ],
    });
    expect(byTitle.get('Wombat storage')).toEqual({
      document: { id: document, title: 'Pump manual' },
      components: [],
    });
    expect(answer.items.find((each) => each.title === 'Wombat maintenance')?.node).toBe(
      MAINTENANCE,
    );
  });

  it('carries nothing of the kind for a result that is not a section', async () => {
    const answer = await service.withTenant(production, (trx) =>
      searchWords(trx, ada, 'pump', { filters: { kinds: ['component', 'document'] } }),
    );
    if (answer?.outcome !== 'results') throw new Error(String(answer?.outcome));
    expect(answer.items.length).toBeGreaterThan(0);
    expect(answer.items.every((each) => each.section === null)).toBe(true);
  });
});
