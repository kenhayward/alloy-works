import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  blockIdentifierFrom,
  defaultNumberingScheme,
  type ContentDocument,
  type OutlineDocument,
  type ReferenceNode,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { publicationGenerated } from './generated-report.js';
import { actOnProposal, makeCreationProposal } from './generation-proposals.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { endRun, makeModelEndpoint, startRun } from './model-endpoints.js';
import { provisionTenant, type Tenant } from './provision.js';
import { recordPublication, requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { makeSuggestion } from './suggestions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const paragraph = (text: string) => ({
  type: 'paragraph',
  id: 'p1',
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

/**
 * Migration 0143: every publication made before it gains the list of the generated content it printed
 * (PUB-082), by the rule a publication made after it is recorded by, as of when its request finished.
 */
describe('migration 0143, which lists the generated content each publication printed', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0142 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0143-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 143;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** The component's next version, its paragraph saying `text`. */
  const next = async (trx: TenantTransaction, from: StoredVersion, text: string, by: string) => {
    const substance = substanceOf(from);
    if (substance.kind !== 'component') throw new Error('not a component');
    const recorded = await recordVersion(trx, {
      artifactId: from.artifactId,
      openedFrom: from.id,
      author: by,
      substance: {
        ...substance,
        content: { ...substance.content, content: [paragraph(text)] } as ContentDocument,
      },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  it('PUB-082 lists what each earlier publication printed of a model, accepted by the time it was made', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Earlier' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };

    const seeded = await service.withTenant(tenant, async (trx) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
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
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const endpoint = await makeModelEndpoint(
        trx,
        {
          name: 'Drafting',
          protocol: 'anthropic',
          baseUrl: 'https://models.example.test',
          model: 'stand-in-1',
          contextWindow: 200_000,
          priceIn: 3,
          priceOut: 15,
          currency: 'USD',
          boundary: 'outside',
        },
        ada,
      );
      if (endpoint.answer !== 'written') throw new Error(endpoint.answer);
      const run = await startRun(trx, {
        purpose: 'drafting',
        endpoint: endpoint.endpoint,
        parameters: {},
        contextDigest: 'a'.repeat(64),
        by: ada,
        documentId: null,
      });
      await endRun(trx, run, {
        outcome: 'finished',
        model: 'stand-in-1',
        usage: { in: 1, out: 1 },
      });

      const made = async (title: string) => {
        const answer = await createComponent(trx, {
          spaceId: general,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        });
        if (answer.answer !== 'created') throw new Error(answer.answer);
        return answer.version;
      };
      // The weir at 0.2, a generated suggestion accepted into it, and then 0.3, the one printed.
      const weir = await made('Weir');
      const second = await next(trx, weir, 'The weir floods.', ada);
      const suggested = await makeSuggestion(trx, {
        component: weir.artifactId,
        version: weir.id,
        proposed: {
          ...(weir.content as ContentDocument),
          content: [paragraph('The weir floods.')],
        } as ContentDocument,
        by: ada,
        generated: { run, digest: 'a'.repeat(64) },
      });
      if (suggested.answer !== 'made') throw new Error(suggested.answer);
      const earlier = suggested.suggestion;
      await sql`insert into suggestion_resolution (suggestion_id, act, version_id, resolved_by)
        values (${earlier}, 'accepted', ${second.id}, ${ada})`.execute(trx);
      const printed = await next(trx, second, 'The weir floods each spring.', ada);

      // A component a model made, accepted.
      const creation = await makeCreationProposal(trx, {
        run,
        creates: { space: general, title: 'Lock', language: 'en-GB', direction: 'ltr' },
        proposed: {} as ContentDocument,
      });
      const lock = await made('Lock');
      await actOnProposal(trx, {
        proposal: creation,
        act: 'accepted',
        made: { component: lock.artifactId, version: lock.id },
        by: ada,
      });

      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The readings report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const nodes = [weir.artifactId, lock.artifactId].map(
        (component) =>
          ({
            type: 'reference',
            id: blockIdentifierFrom(randomBytes(16)),
            component,
            mode: { kind: 'latest' },
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          }) satisfies ReferenceNode,
      );
      const outlined = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(document.version.content as OutlineDocument), nodes },
        },
      });
      if (outlined.answer !== 'recorded') throw new Error(outlined.answer);
      const asked = await requestPublication(trx, {
        documentId: document.version.artifactId,
        version: outlined.version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      return {
        ada,
        run,
        weir,
        printed,
        earlier,
        creation: creation.id,
        lock,
        request: asked.request.id,
        nodes: nodes.map((each) => each.id),
      };
    });
    const publication = await service.withTenant(tenant, (trx) =>
      recordPublication(trx, {
        requestId: seeded.request,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1,
          },
        ],
      }),
    );
    // Accepted after it was made, into the very version it printed: never in it.
    const later = await service.withTenant(tenant, async (trx) => {
      const suggested = await makeSuggestion(trx, {
        component: seeded.weir.artifactId,
        version: seeded.printed.id,
        proposed: {
          ...(seeded.printed.content as ContentDocument),
          content: [paragraph('The weir is dry.')],
        } as ContentDocument,
        by: seeded.ada,
        generated: { run: seeded.run, digest: 'a'.repeat(64) },
      });
      if (suggested.answer !== 'made') throw new Error(suggested.answer);
      await sql`insert into suggestion_resolution (suggestion_id, act, version_id, resolved_by)
        values (${suggested.suggestion}, 'accepted', ${seeded.printed.id}, ${seeded.ada})`.execute(
        trx,
      );
      return suggested.suggestion;
    });

    await migrate(db.migratorUrl);

    const listed = await service.withTenant(tenant, (trx) =>
      publicationGenerated(trx, publication!),
    );
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        {
          node: seeded.nodes[0],
          version: seeded.printed.id,
          kind: 'suggestion',
          suggestion: seeded.earlier,
          proposal: null,
          run: seeded.run,
        },
        {
          node: seeded.nodes[1],
          version: seeded.lock.id,
          kind: 'creation',
          suggestion: null,
          proposal: seeded.creation,
          run: seeded.run,
        },
      ]),
    );
    expect(listed.map((each) => each.suggestion)).not.toContain(later);
  });
});
